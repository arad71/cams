from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import httpx
from jose import jwt as jose_jwt, JWTError as JoseJWTError

from app.core.database import get_db
from app.core.auth import verify_password, create_access_token, get_current_user, hash_password
from app.core.config import get_settings
from app.models.user import User
from app.schemas import LoginRequest, TokenResponse, UserOut, ChangePasswordRequest

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()


# ═══════════════════════════════════════════════════════
#  Auth Configuration (public — tells frontend what's available)
# ═══════════════════════════════════════════════════════

@router.get("/config")
def auth_config():
    """Public endpoint — tells the frontend which auth methods are available."""
    cfg = {"local_enabled": True, "entra_enabled": settings.ENTRA_ENABLED}
    if settings.ENTRA_ENABLED and settings.ENTRA_TENANT_ID and settings.ENTRA_CLIENT_ID:
        cfg["entra_client_id"] = settings.ENTRA_CLIENT_ID
        cfg["entra_tenant_id"] = settings.ENTRA_TENANT_ID
        cfg["entra_authority"] = f"https://login.microsoftonline.com/{settings.ENTRA_TENANT_ID}"
        cfg["entra_redirect_uri"] = settings.ENTRA_REDIRECT_URI
    return cfg


# ═══════════════════════════════════════════════════════
#  Local Username/Password Login
# ═══════════════════════════════════════════════════════

@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token = create_access_token(data={"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


# ═══════════════════════════════════════════════════════
#  Microsoft Entra ID (Azure AD) SSO
# ═══════════════════════════════════════════════════════

@router.post("/entra/token")
def entra_token_exchange(
    code: str = Query(..., description="Authorization code from Microsoft"),
    redirect_uri: str = Query(..., description="Redirect URI used in the auth request"),
    db: Session = Depends(get_db),
):
    """
    Exchange a Microsoft authorization code for a CAMS access token.
    The frontend handles the OIDC redirect flow (PKCE), gets the auth code,
    then calls this endpoint to complete the login.
    """
    if not settings.ENTRA_ENABLED:
        raise HTTPException(400, "Microsoft Entra ID login is not enabled")

    tenant = settings.ENTRA_TENANT_ID
    client_id = settings.ENTRA_CLIENT_ID
    client_secret = settings.ENTRA_CLIENT_SECRET

    # Exchange authorization code for tokens with Microsoft
    token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    token_data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
        "scope": "openid profile email",
    }

    try:
        resp = httpx.post(token_url, data=token_data, timeout=15)
        if resp.status_code != 200:
            detail = resp.json().get("error_description", resp.text)
            raise HTTPException(400, f"Microsoft token exchange failed: {detail}")
        ms_tokens = resp.json()
    except httpx.RequestError as e:
        raise HTTPException(502, f"Failed to contact Microsoft: {e}")

    # Decode the ID token (we trust Microsoft's signature for now;
    # in production you'd verify with Microsoft's JWKS keys)
    id_token = ms_tokens.get("id_token")
    if not id_token:
        raise HTTPException(400, "No id_token in Microsoft response")

    try:
        # Decode without verification for claims extraction
        # (the token came directly from Microsoft over HTTPS)
        claims = jose_jwt.get_unverified_claims(id_token)
    except Exception:
        raise HTTPException(400, "Invalid id_token from Microsoft")

    # Extract user info from claims
    oid = claims.get("oid")           # Microsoft Object ID (unique per user)
    email = claims.get("preferred_username") or claims.get("email") or claims.get("upn")
    name = claims.get("name") or email

    if not oid or not email:
        raise HTTPException(400, "Microsoft token missing required claims (oid, email)")

    # Find or create user
    user = db.query(User).filter(User.entra_oid == oid).first()
    if not user:
        user = db.query(User).filter(User.email == email.lower()).first()

    if user:
        # Link existing user to Entra if not already
        if not user.entra_oid:
            user.entra_oid = oid
            user.auth_provider = "entra"
            db.commit()
    elif settings.ENTRA_AUTO_CREATE_USER:
        # Auto-create new user from Microsoft profile
        name_parts = name.split()
        initials = (name_parts[0][0] + (name_parts[-1][0] if len(name_parts) > 1 else "")).upper()
        user = User(
            email=email.lower(),
            name=name,
            initials=initials,
            hashed_password=None,
            role=settings.ENTRA_DEFAULT_ROLE,
            department="",
            auth_provider="entra",
            entra_oid=oid,
            must_change_password=False,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        raise HTTPException(403, "No CAMS account found for this Microsoft account. Contact your administrator.")

    if not user.is_active:
        raise HTTPException(403, "Account disabled")

    # Issue CAMS JWT
    token = create_access_token(data={"sub": str(user.id), "role": user.role})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


# ═══════════════════════════════════════════════════════
#  Common endpoints
# ═══════════════════════════════════════════════════════

@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/change-password")
def change_password(data: ChangePasswordRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.auth_provider == "entra" and not current_user.hashed_password:
        raise HTTPException(400, "SSO users cannot change password here — use Microsoft account settings")
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    current_user.hashed_password = hash_password(data.new_password)
    current_user.must_change_password = False
    db.commit()
    return {"message": "Password changed successfully"}

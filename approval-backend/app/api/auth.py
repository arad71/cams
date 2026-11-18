from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import httpx
from datetime import datetime, timedelta, timezone

from sqlalchemy import func

from app.core.entra import verify_id_token, EntraTokenError

from app.core.database import get_db
from app.core.auth import verify_password, create_access_token, create_media_token, get_current_user, hash_password
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
    cfg = {"local_enabled": True, "entra_enabled": settings.entra_configured}
    if settings.entra_configured:
        cfg["entra_client_id"] = settings.ENTRA_CLIENT_ID
        cfg["entra_tenant_id"] = settings.ENTRA_TENANT_ID
        cfg["entra_authority"] = f"https://login.microsoftonline.com/{settings.ENTRA_TENANT_ID}"
        cfg["entra_redirect_uri"] = settings.ENTRA_REDIRECT_URI
    return cfg


# ═══════════════════════════════════════════════════════
#  Local Username/Password Login
# ═══════════════════════════════════════════════════════

# Failed-login throttling. Counted from the audit log so it holds across
# gunicorn workers and restarts.
LOGIN_WINDOW = timedelta(minutes=15)
MAX_FAILS_PER_ACCOUNT = 5
MAX_FAILS_PER_IP = 20


def _recent_failures(db: Session, **filters) -> int:
    from app.models.audit import AuditLog
    since = datetime.now(timezone.utc) - LOGIN_WINDOW
    q = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action == "login_failed", AuditLog.timestamp >= since
    )
    for col, val in filters.items():
        q = q.filter(getattr(AuditLog, col) == val)
    return q.scalar() or 0


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db), request: Request = None):
    from app.services.audit import log_audit, _get_ip
    email = (form.username or "").strip().lower()
    ip = _get_ip(request)

    if (_recent_failures(db, entity_ref=email) >= MAX_FAILS_PER_ACCOUNT
            or (ip and _recent_failures(db, ip_address=ip) >= MAX_FAILS_PER_IP)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Try again in 15 minutes.",
            headers={"Retry-After": str(int(LOGIN_WINDOW.total_seconds()))},
        )

    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        log_audit(db=db, action="login_failed", entity_type="auth", entity_ref=email[:100], description=f"Failed login attempt for {email}", request=request, success=False, error_detail="Invalid credentials")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        log_audit(db=db, action="login_blocked", entity_type="auth", user=user, description="Login blocked — account disabled", request=request, success=False, error_detail="Account disabled")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token = create_access_token(data={"sub": str(user.id), "role": user.role})
    log_audit(db=db, action="login", entity_type="auth", user=user, description=f"User logged in via local auth", request=request)
    return TokenResponse(access_token=token, media_token=create_media_token(user.id), user=UserOut.model_validate(user))


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
    if not settings.entra_configured:
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

    id_token = ms_tokens.get("id_token")
    if not id_token:
        raise HTTPException(400, "No id_token in Microsoft response")

    # Verify signature, audience, issuer and tenant before trusting any claim
    try:
        claims = verify_id_token(id_token, tenant_id=tenant, client_id=client_id)
    except EntraTokenError as e:
        raise HTTPException(401, f"Microsoft sign-in rejected: {e}")

    # Extract user info from claims
    oid = claims.get("oid")           # Microsoft Object ID (unique per user)
    email = claims.get("preferred_username") or claims.get("email") or claims.get("upn")
    name = claims.get("name") or email

    if not oid or not email:
        raise HTTPException(400, "Microsoft token missing required claims (oid, email)")

    # Find or create user
    user = db.query(User).filter(User.entra_oid == oid).first()
    if not user:
        # The token is verified and from the council's own tenant, so its
        # username is controlled by the council's directory. Link an existing
        # account by email only if it isn't already linked to another identity.
        user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
        if user and user.entra_oid and user.entra_oid != oid:
            raise HTTPException(403, "This CAMS account is linked to a different Microsoft account. Contact your administrator.")

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
    from app.services.audit import log_audit
    log_audit(db=db, action="login", entity_type="auth", user=user, description=f"User logged in via Microsoft Entra ID SSO")
    return TokenResponse(access_token=token, media_token=create_media_token(user.id), user=UserOut.model_validate(user))


# ═══════════════════════════════════════════════════════
#  Common endpoints
# ═══════════════════════════════════════════════════════

@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/media-token")
def media_token(current_user: User = Depends(get_current_user)):
    """A read-only token for document/photo URLs (?token=...). It cannot call the API."""
    return {"media_token": create_media_token(current_user.id)}


@router.post("/change-password")
def change_password(data: ChangePasswordRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), request: Request = None):
    from app.services.audit import log_audit
    if current_user.auth_provider == "entra" and not current_user.hashed_password:
        raise HTTPException(400, "SSO users cannot change password here — use Microsoft account settings")
    if not verify_password(data.current_password, current_user.hashed_password):
        log_audit(db=db, action="password_change_failed", entity_type="auth", user=current_user, request=request, success=False, error_detail="Incorrect current password")
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    current_user.hashed_password = hash_password(data.new_password)
    current_user.must_change_password = False
    db.commit()
    log_audit(db=db, action="password_changed", entity_type="auth", user=current_user, description="Password changed successfully", request=request)
    return {"message": "Password changed successfully"}

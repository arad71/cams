from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from jwt import PyJWTError as JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.user import User

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        # Scoped tokens (e.g. "media" tokens used in <img>/<iframe> URLs) are not API tokens
        if payload.get("scope"):
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_role(*roles: str):
    """Dependency factory: require user has one of the given roles. Superadmin always passes."""
    def checker(current_user: User = Depends(get_current_user)):
        if current_user.role == "superadmin":
            return current_user
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Role '{current_user.role}' not permitted")
        return current_user
    return checker


# ─── Media tokens ──────────────────────────────────────────
# Documents and photos are shown with <iframe>/<img>, which can't send an
# Authorization header, so their URLs carry ?token=. That token ends up in
# access logs and browser history, so it must NOT be the full API token:
# a media token can only read files, nothing else.

MEDIA_SCOPE = "media"


def create_media_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
    return create_access_token(
        data={"sub": str(user_id), "scope": MEDIA_SCOPE},
        expires_delta=expires_delta,
    )


def get_media_user(
    token: Optional[str] = Query(None, description="Media token from /auth/media-token"),
    db: Session = Depends(get_db),
) -> User:
    """Authenticate a file/image request by its ?token= media token."""
    if not token:
        raise HTTPException(status_code=401, detail="Media token required")
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid media token")
    if payload.get("scope") != MEDIA_SCOPE or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid media token")
    user = db.query(User).filter(User.id == int(payload["sub"]), User.is_active == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=401, detail="Invalid media token")
    return user

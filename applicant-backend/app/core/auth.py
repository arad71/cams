from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.applicant import Applicant

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_current_applicant(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Applicant:
    """Authenticate and return the current applicant from JWT."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        applicant_id: str = payload.get("sub")
        if applicant_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    applicant = db.query(Applicant).filter(Applicant.id == int(applicant_id)).first()
    if applicant is None or not applicant.is_active:
        raise credentials_exception
    return applicant


def optional_applicant(
    token: Optional[str] = Depends(OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)),
    db: Session = Depends(get_db),
) -> Optional[Applicant]:
    """Return applicant if token present, None otherwise (for guest endpoints)."""
    if not token:
        return None
    try:
        return get_current_applicant(token, db)
    except HTTPException:
        return None

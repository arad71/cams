from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import hash_password, verify_password, create_access_token, get_current_applicant
from app.models.applicant import Applicant
from app.schemas import RegisterRequest, TokenResponse, ApplicantOut, ApplicantUpdate

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(Applicant).filter(Applicant.email == data.email).first():
        raise HTTPException(400, "Email already registered")

    applicant = Applicant(
        full_name=data.full_name, email=data.email,
        phone=data.phone, postal_address=data.postal_address,
        hashed_password=hash_password(data.password),
    )
    db.add(applicant)
    db.commit()
    db.refresh(applicant)

    token = create_access_token({"sub": str(applicant.id)})
    return TokenResponse(access_token=token, applicant=ApplicantOut.model_validate(applicant))


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    applicant = db.query(Applicant).filter(Applicant.email == form.username).first()
    if not applicant or not verify_password(form.password, applicant.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not applicant.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    token = create_access_token({"sub": str(applicant.id)})
    return TokenResponse(access_token=token, applicant=ApplicantOut.model_validate(applicant))


@router.get("/me", response_model=ApplicantOut)
def get_profile(current: Applicant = Depends(get_current_applicant)):
    return current


@router.patch("/me", response_model=ApplicantOut)
def update_profile(data: ApplicantUpdate, db: Session = Depends(get_db),
                   current: Applicant = Depends(get_current_applicant)):
    update = data.model_dump(exclude_unset=True)
    if "password" in update and update["password"]:
        update["hashed_password"] = hash_password(update.pop("password"))
    else:
        update.pop("password", None)
    for k, v in update.items():
        setattr(current, k, v)
    db.commit()
    db.refresh(current)
    return current

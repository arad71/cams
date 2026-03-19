from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import secrets
import string

from app.core.database import get_db
from app.core.auth import get_current_user, require_role, hash_password
from app.models.user import User
from app.schemas import UserOut, UserCreate, UserUpdate

router = APIRouter(prefix="/users", tags=["Users"])


def _generate_temp_password(length=10):
    """Generate a random one-time password."""
    chars = string.ascii_letters + string.digits + "!@#$%"
    return ''.join(secrets.choice(chars) for _ in range(length))


@router.get("/", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    return db.query(User).order_by(User.name).all()


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Generate random one-time password if not provided
    temp_password = data.password or _generate_temp_password()
    must_change = not data.password  # If auto-generated, must change on first login

    user = User(
        name=data.name,
        email=data.email,
        initials=data.initials or data.name.split()[0][0].upper() + (data.name.split()[-1][0].upper() if len(data.name.split()) > 1 else ""),
        hashed_password=hash_password(temp_password),
        role=data.role,
        department=data.department,
        must_change_password=must_change,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Return user data + the temp password (only shown once)
    user_out = UserOut.model_validate(user).model_dump()
    user_out["temp_password"] = temp_password
    return user_out


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = data.model_dump(exclude_unset=True)
    if "password" in update_data and update_data["password"]:
        update_data["hashed_password"] = hash_password(update_data.pop("password"))
    else:
        update_data.pop("password", None)

    for key, value in update_data.items():
        setattr(user, key, value)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()

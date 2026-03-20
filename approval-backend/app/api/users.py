from fastapi import APIRouter, Depends, HTTPException, status, Request
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
    request: Request = None,
):
    from app.services.audit import log_audit
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    temp_password = data.password or _generate_temp_password()
    must_change = not data.password

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
    log_audit(db=db, action="create", entity_type="user", user=current_user, entity_id=str(user.id), description=f"Created user {user.name} ({user.email}), role={user.role}", request=request)

    user_out = UserOut.model_validate(user).model_dump()
    user_out["temp_password"] = temp_password
    return user_out


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    request: Request = None,
):
    from app.services.audit import log_audit
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = data.model_dump(exclude_unset=True)
    if "password" in update_data and update_data["password"]:
        update_data["hashed_password"] = hash_password(update_data.pop("password"))
    else:
        update_data.pop("password", None)

    changes = {}
    for key, value in update_data.items():
        old = getattr(user, key, None)
        if key != "hashed_password" and old != value:
            changes[key] = {"old": str(old) if old is not None else None, "new": str(value) if value is not None else None}
        setattr(user, key, value)

    db.commit()
    db.refresh(user)
    if changes:
        log_audit(db=db, action="update", entity_type="user", user=current_user, entity_id=str(user.id), description=f"Updated user {user.name}: {', '.join(changes.keys())}", field_changes=changes, request=request)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    request: Request = None,
):
    from app.services.audit import log_audit
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    log_audit(db=db, action="delete", entity_type="user", user=current_user, entity_id=str(user.id), description=f"Deleted user {user.name} ({user.email})", request=request)
    db.delete(user)
    db.commit()

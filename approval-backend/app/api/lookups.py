from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.user import User
from app.models.lookup import Role, Department
from app.schemas import (
    RoleOut, RoleCreate, RoleUpdate,
    DepartmentOut, DepartmentCreate, DepartmentUpdate,
)

router = APIRouter(prefix="/lookups", tags=["Lookups"])


# ═══════════════════════════════════════════════════════
#  ROLES
# ═══════════════════════════════════════════════════════

@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Role).order_by(Role.sort_order, Role.code).all()


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role(data: RoleCreate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    if db.query(Role).filter(Role.code == data.code).first():
        raise HTTPException(400, "Role code already exists")
    role = Role(**data.model_dump())
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: int, data: RoleUpdate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(role, k, v)
    db.commit()
    db.refresh(role)
    return role


# ═══════════════════════════════════════════════════════
#  DEPARTMENTS
# ═══════════════════════════════════════════════════════

@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Department).order_by(Department.sort_order, Department.code).all()


@router.post("/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(data: DepartmentCreate, db: Session = Depends(get_db),
                      current_user: User = Depends(require_role("admin"))):
    if db.query(Department).filter(Department.code == data.code).first():
        raise HTTPException(400, "Department code already exists")
    dept = Department(**data.model_dump())
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.patch("/departments/{dept_id}", response_model=DepartmentOut)
def update_department(dept_id: int, data: DepartmentUpdate, db: Session = Depends(get_db),
                      current_user: User = Depends(require_role("admin"))):
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(404, "Department not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(dept, k, v)
    db.commit()
    db.refresh(dept)
    return dept

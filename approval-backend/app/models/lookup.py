from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, func
from app.core.database import Base


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, nullable=False, index=True)
    label = Column(String(100), nullable=False)
    icon = Column(String(10), default="")
    color = Column(String(20), default="#5a6a74")
    permissions = Column(JSON, default=list)  # ["view_all", "assign", "approve", ...]
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<Role {self.code}: {self.label}>"


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    label = Column(String(200), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<Department {self.code}: {self.label}>"

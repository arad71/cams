from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    initials = Column(String(4), nullable=False, default="")
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="engineer")  # admin | manager | engineer
    department = Column(String(100), default="Engineering")
    is_active = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    assigned_applications = relationship("Application", back_populates="assigned_officer", foreign_keys="Application.officer_id")
    notes = relationship("ApplicationNote", back_populates="author")

    def __repr__(self):
        return f"<User {self.name} ({self.role})>"

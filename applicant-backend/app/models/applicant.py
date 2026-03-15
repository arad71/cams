from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Applicant(Base):
    """Public user who submits crossover applications."""
    __tablename__ = "applicants"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(30))
    postal_address = Column(String(500))
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    applications = relationship("CrossoverApplication", back_populates="applicant",
                                order_by="CrossoverApplication.created_at.desc()")

    def __repr__(self):
        return f"<Applicant {self.full_name} ({self.email})>"

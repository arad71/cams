"""
Assessment master data and per-case assessment results.

Tables:
  assessment_categories  – 11 master categories (Ownership, Property, Dimensions, etc.)
  assessment_items       – 60 master items (owner_verified, min_width, sight_triangle, etc.)
  case_assessments       – Per-application per-item result: AI result, officer decision, status, notes
"""
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey,
    Text, JSON, UniqueConstraint, CheckConstraint, func
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class AssessmentCategory(Base):
    """Master table: 11 assessment categories."""
    __tablename__ = "assessment_categories"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, nullable=False, index=True)  # e.g. "ownership"
    label = Column(String(100), nullable=False)                         # "Ownership & Application"
    icon = Column(String(10), default="")                               # "👤"
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    items = relationship("AssessmentItem", back_populates="category", order_by="AssessmentItem.sort_order")

    def __repr__(self):
        return f"<Category {self.code}: {self.label}>"


class AssessmentItem(Base):
    """Master table: 60 individual assessment items."""
    __tablename__ = "assessment_items"

    id = Column(Integer, primary_key=True, index=True)
    category_id = Column(Integer, ForeignKey("assessment_categories.id"), nullable=False)
    code = Column(String(50), unique=True, nullable=False, index=True)  # e.g. "owner_verified"
    label = Column(String(500), nullable=False)                         # Full description
    reference = Column(String(50), default="")                          # "§2.1", "AS 2890.1"
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    auto_assess_rule = Column(String(200), nullable=True)               # Rule hint for AI engine
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    category = relationship("AssessmentCategory", back_populates="items")
    case_results = relationship("CaseAssessment", back_populates="item")

    def __repr__(self):
        return f"<Item {self.code}: {self.label[:40]}>"


class CaseAssessment(Base):
    """
    Per-application, per-item assessment result.
    Each row = one checklist item for one application.
    Tracks AI auto-assess, officer decision, overall status, and notes.
    """
    __tablename__ = "case_assessments"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("assessment_items.id"), nullable=False, index=True)

    # AI auto-assessment
    ai_result = Column(String(20), nullable=True)        # pass | review | fail | null
    ai_confidence = Column(Float, nullable=True)          # 0.0–1.0 confidence score
    ai_reason = Column(Text, nullable=True)               # AI explanation
    ai_assessed_at = Column(DateTime(timezone=True), nullable=True)

    # Officer decision
    officer_result = Column(String(20), nullable=True)    # approved | rejected | null
    officer_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    officer_assessed_at = Column(DateTime(timezone=True), nullable=True)

    # Overall status (derived or manual override)
    status = Column(String(20), default="pending")        # pending | pass | fail | waived | na
    status_changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status_changed_at = Column(DateTime(timezone=True), nullable=True)

    # Notes
    note = Column(Text, nullable=True)
    note_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    note_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Constraints
    __table_args__ = (
        UniqueConstraint("application_id", "item_id", name="uq_case_item"),
        CheckConstraint("ai_result IN ('pass','review','fail') OR ai_result IS NULL", name="ck_ai_result"),
        CheckConstraint("officer_result IN ('approved','rejected') OR officer_result IS NULL", name="ck_officer_result"),
        CheckConstraint("status IN ('pending','pass','fail','waived','na')", name="ck_status"),
    )

    # Relationships
    application = relationship("Application", back_populates="assessments")
    item = relationship("AssessmentItem", back_populates="case_results")
    officer = relationship("User", foreign_keys=[officer_id])
    status_changed_by = relationship("User", foreign_keys=[status_changed_by_id])
    note_by = relationship("User", foreign_keys=[note_by_id])

    def __repr__(self):
        return f"<CaseAssessment app={self.application_id} item={self.item_id} ai={self.ai_result} officer={self.officer_result}>"

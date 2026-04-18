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
    auto_assess_rule = Column(String(200), nullable=True)               # Legacy — see assessment_rules table
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    category = relationship("AssessmentCategory", back_populates="items")
    case_results = relationship("CaseAssessment", back_populates="item")
    rules = relationship("AssessmentRule", back_populates="item", order_by="AssessmentRule.priority")

    def __repr__(self):
        return f"<Item {self.code}: {self.label[:40]}>"


class AssessmentRule(Base):
    """
    Database-driven assessment rules.
    Each rule evaluates a condition against application data or site_plan_data.
    Multiple rules per item are evaluated in priority order (first match wins).
    
    Supports two modes:
    1. Simple (single field): uses source, field, operator, value columns
    2. Compound (multiple fields): uses conditions JSON column with AND/OR logic
       Format: {"logic": "and"|"or", "checks": [
         {"source": "app", "field": "crossover_width", "operator": "gte", "value": "3.0"},
         {"source": "sp", "field": "crossover_dimensions.width_at_boundary_m", "operator": "gte", "value": "3.0"}
       ]}
    When conditions is set, it takes precedence over source/field/operator/value.
    """
    __tablename__ = "assessment_rules"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("assessment_items.id"), nullable=False, index=True)
    priority = Column(Integer, default=0)          # Lower = evaluated first
    is_active = Column(Boolean, default=True)

    # Simple condition (single field)
    source = Column(String(10), default="app")     # app | sp | doc
    field = Column(String(100), nullable=False)     # e.g. "crossover_width", "crossover_dimensions.width_at_boundary_m"
    operator = Column(String(20), nullable=False)   # gte, lte, gt, lt, eq, neq, exists, not_exists, contains, true, false
    value = Column(String(200), nullable=True)      # threshold value (cast to appropriate type at runtime)

    # Compound condition (multiple fields with AND/OR)
    conditions = Column(JSON, nullable=True)        # {"logic": "and"|"or", "checks": [{source, field, operator, value}, ...]}

    # Result when condition matches
    result = Column(String(10), nullable=False)     # pass | fail | review | na
    confidence = Column(Float, default=0.8)
    reason_template = Column(String(500), nullable=False)  # Can use {field_value}, {threshold}, {field_values} placeholders

    # Fallback: what to return if NO rules match for this item
    # (only used on the last rule via a convention — see engine)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("AssessmentItem", back_populates="rules")

    def __repr__(self):
        return f"<Rule item={self.item_id} {self.source}.{self.field} {self.operator} {self.value} → {self.result}>"


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
    ai_result = Column(String(20), nullable=True)        # pass | review | fail | na | null
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
        CheckConstraint("ai_result IN ('pass','review','fail','na') OR ai_result IS NULL", name="ck_ai_result"),
        CheckConstraint("officer_result IN ('approved','rejected','not_required','referred','investigation') OR officer_result IS NULL", name="ck_officer_result"),
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

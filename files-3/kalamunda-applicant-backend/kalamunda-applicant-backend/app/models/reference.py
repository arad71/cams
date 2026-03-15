"""Master reference/lookup tables that drive the frontend form options."""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, func
from app.core.database import Base


class RoadType(Base):
    __tablename__ = "ref_road_types"
    id = Column(Integer, primary_key=True)
    code = Column(String(20), unique=True, nullable=False)
    label = Column(String(200), nullable=False)
    requires_referral = Column(String(50), nullable=True)  # MRWA | DPLH | null
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class SurfaceMaterial(Base):
    __tablename__ = "ref_surface_materials"
    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False)
    label = Column(String(200), nullable=False)
    min_thickness_mm = Column(Integer, nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class LotType(Base):
    __tablename__ = "ref_lot_types"
    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False)
    label = Column(String(200), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class DocumentCategory(Base):
    __tablename__ = "ref_document_categories"
    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False)
    label = Column(String(200), nullable=False)
    is_required = Column(Boolean, default=False)
    hint = Column(String(500), nullable=True)
    accepted_types = Column(String(500), default="pdf,jpg,png")
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class DrainageType(Base):
    __tablename__ = "ref_drainage_types"
    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False)
    label = Column(String(200), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class ValidationRule(Base):
    """Configurable validation rules for the application form."""
    __tablename__ = "ref_validation_rules"
    id = Column(Integer, primary_key=True)
    field = Column(String(50), nullable=False, index=True)  # e.g. "crossover_width"
    rule_type = Column(String(20), nullable=False)  # min | max | required | regex | depends_on
    value = Column(String(200))  # "3.0" | "6.0" | "true" | pattern
    message = Column(String(500))
    depends_field = Column(String(50), nullable=True)
    depends_value = Column(String(200), nullable=True)
    is_active = Column(Boolean, default=True)


class FeeSchedule(Base):
    """Crossover fee and contribution schedule."""
    __tablename__ = "ref_fee_schedule"
    id = Column(Integer, primary_key=True)
    fee_type = Column(String(50), nullable=False)  # application_fee | contribution
    description = Column(String(500))
    amount = Column(Float, nullable=False)
    conditions = Column(String(500), nullable=True)  # "first_crossover_only"
    effective_from = Column(DateTime(timezone=True))
    effective_to = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)

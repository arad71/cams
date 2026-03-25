from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON, func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    ref_number = Column(String(20), unique=True, nullable=False, index=True)  # e.g. CX-2026-0041
    submitted_date = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String(30), nullable=False, default="pending_review")

    # Owner
    owner_name = Column(String(255), nullable=False)
    owner_phone = Column(String(30))
    owner_email = Column(String(255))
    owner_postal_address = Column(String(500))

    # Property
    property_address = Column(String(500), nullable=False)
    lot_number = Column(String(50))
    plan_number = Column(String(50))
    lot_type = Column(String(100))
    frontage = Column(Float)
    depth = Column(Float)
    road_name = Column(String(200))
    road_type = Column(String(20), default="local")  # local | red | blue
    road_width = Column(Float)
    verge_width = Column(Float)

    # Crossover
    crossover_width = Column(Float)
    crossover_count = Column(Integer, default=1)
    crossover_surface = Column(String(200))
    crossover_est_date = Column(String(20))
    da_number = Column(String(50))
    offset_from_left = Column(Float)
    offset2_from_left = Column(Float, nullable=True)
    declaration_signed = Column(Boolean, default=False)
    date_signed = Column(String(30), nullable=True)
    attachment_count = Column(Integer, nullable=True)

    # Vegetation
    trees_nearby = Column(Boolean, default=False)
    tree_protection = Column(Text)
    clearing = Column(Boolean, default=False)
    drainage_type = Column(String(100))
    culvert = Column(Boolean, default=False)
    trees_data = Column(JSON, default=list)  # [{species, x, y, canopy, height}]

    # Assessment
    officer_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    risk_flags = Column(JSON, default=list)
    referral_authority = Column(String(100), nullable=True)
    referral_date_sent = Column(DateTime(timezone=True), nullable=True)
    referral_status = Column(String(30), nullable=True)
    contribution_eligible = Column(Boolean, default=False)
    contribution_amount = Column(Float, default=0)

    # Checklist
    checklist_data = Column(JSON, default=dict)  # {item_id: {auto, officer, note, ...}}

    # GeoJSON lot polygon
    lot_polygon = Column(JSON, nullable=True)  # [[lat,lng], ...]

    # Site plan AI extraction data
    site_plan_data = Column(JSON, nullable=True)          # Active data used by assessment (= corrected if corrections exist, else original)
    org_site_plan_data = Column(JSON, nullable=True)      # Original AI extraction (never modified after initial analysis)
    cor_site_plan_data = Column(JSON, nullable=True)      # Officer-corrected extraction (updated when officer corrects values)

    # Officer-drawn boundaries from site plan image
    site_lot_boundary = Column(JSON, nullable=True)         # [[x,y], ...] polygon points on site plan image
    site_building_boundary = Column(JSON, nullable=True)    # [[x,y], ...] building footprint on site plan
    site_crossover = Column(JSON, nullable=True)            # [[x,y], ...] crossover/driveway on site plan

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    assigned_officer = relationship("User", back_populates="assigned_applications", foreign_keys=[officer_id])
    notes = relationship("ApplicationNote", back_populates="application", cascade="all, delete-orphan", order_by="ApplicationNote.created_at.desc()")
    documents = relationship("Document", back_populates="application", cascade="all, delete-orphan")
    inspections = relationship("Inspection", back_populates="application", cascade="all, delete-orphan")
    assessments = relationship("CaseAssessment", back_populates="application", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="application", cascade="all, delete-orphan", order_by="Report.version.desc()")

    def __repr__(self):
        return f"<Application {self.ref_number}>"


class ApplicationNote(Base):
    __tablename__ = "application_notes"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    application = relationship("Application", back_populates="notes")
    author = relationship("User", back_populates="notes")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    name = Column(String(500), nullable=False)
    file_type = Column(String(10))  # pdf, jpg, png, dwg
    file_size = Column(String(20))
    category = Column(String(50))  # Application, Title, Site Plan, Photos, etc.
    status = Column(String(20), default="received")  # received | verified | rejected
    file_path = Column(String(1000), nullable=True)  # storage path
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Review fields
    review_note = Column(Text, nullable=True)
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    application = relationship("Application", back_populates="documents")
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_id])


class Inspection(Base):
    __tablename__ = "inspections"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    inspector_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    inspection_type = Column(String(50))  # Pre-construction | Post-construction
    scheduled_date = Column(DateTime(timezone=True))
    status = Column(String(20), default="scheduled")  # scheduled | passed | failed | cancelled
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    application = relationship("Application", back_populates="inspections")


class Report(Base):
    """Versioned assessment report snapshot for an application."""
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    generated_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status_at_generation = Column(String(30))
    recommendation = Column(String(20))  # APPROVE | REVIEW | REJECT
    summary_data = Column(JSON, default=dict)
    checklist_snapshot = Column(JSON, default=dict)
    app_snapshot = Column(JSON, default=dict)
    notes_snapshot = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    application = relationship("Application", back_populates="reports")
    generated_by = relationship("User")

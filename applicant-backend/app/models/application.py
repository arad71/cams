"""
CrossoverApplication: The full public crossover application mirroring the 8-step wizard.

Lifecycle: draft → submitted → acknowledged → under_review → approved/rejected/info_requested
"""
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey,
    Text, JSON, func
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class CrossoverApplication(Base):
    """Public crossover application submitted by an applicant."""
    __tablename__ = "crossover_applications"

    id = Column(Integer, primary_key=True, index=True)
    ref_number = Column(String(20), unique=True, nullable=False, index=True)  # CX-2026-0001
    applicant_id = Column(Integer, ForeignKey("applicants.id"), nullable=False, index=True)
    status = Column(String(30), default="draft", index=True)
    # draft | submitted | acknowledged | under_review | info_requested | approved | rejected | withdrawn
    current_step = Column(Integer, default=0)  # 0-7, tracks wizard progress for drafts

    # ─── Step 1: Owner Details ───────────────────────────
    owner_name = Column(String(255))
    owner_phone = Column(String(30))
    owner_email = Column(String(255))
    owner_postal_address = Column(String(500))

    # ─── Step 2: Property Info ───────────────────────────
    property_address = Column(String(500))
    lot_number = Column(String(50))
    plan_number = Column(String(50))
    lga_zone = Column(String(100))
    lot_type = Column(String(50))
    # res_urban_green | res_urban_strata | res_urban_battleaxe | res_rural_green | commercial_urban ...
    lot_frontage = Column(Float)
    existing_crossover = Column(Boolean, default=False)
    road_type = Column(String(20), default="local")  # local | red | blue | rav | mrwa
    road_name = Column(String(200))

    # ─── Step 3: Crossover Design ────────────────────────
    crossover_width = Column(Float)
    number_of_crossovers = Column(Integer, default=1)
    surface_material = Column(String(50))
    # asphalt | concrete | brick_paver | chip_seal
    estimated_date = Column(String(20))
    da_number = Column(String(50))
    offset_from_left = Column(Float, nullable=True)
    offset2_from_left = Column(Float, nullable=True)  # for dual crossovers

    # ─── Step 4: Vegetation & Drainage ───────────────────
    has_trees_nearby = Column(Boolean, default=False)
    tree_protection_plan = Column(Text, nullable=True)
    vegetation_cleared = Column(Boolean, default=False)
    drainage_type = Column(String(50), default="swale")
    # swale | soakwell | piped | culvert | detention_basin
    has_culvert = Column(Boolean, default=False)

    # ─── Step 6: AI Review Results ───────────────────────
    ai_review_data = Column(JSON, nullable=True)
    # [{check, status, message}, ...] — snapshot from pre-submit AI review

    # ─── Step 7: Declaration & Submit ────────────────────
    declaration_accepted = Column(Boolean, default=False)
    declaration_date = Column(DateTime(timezone=True), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)

    # ─── Contribution ────────────────────────────────────
    contribution_eligible = Column(Boolean, nullable=True)
    contribution_amount = Column(Float, nullable=True)

    # ─── Timestamps ──────────────────────────────────────
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # ─── Relationships ───────────────────────────────────
    applicant = relationship("Applicant", back_populates="applications")
    documents = relationship("ApplicationDocument", back_populates="application",
                             cascade="all, delete-orphan", order_by="ApplicationDocument.uploaded_at.desc()")
    drafts = relationship("ApplicationDraft", back_populates="application",
                          cascade="all, delete-orphan", order_by="ApplicationDraft.saved_at.desc()")
    status_history = relationship("StatusHistory", back_populates="application",
                                  cascade="all, delete-orphan", order_by="StatusHistory.changed_at.desc()")
    messages = relationship("ApplicationMessage", back_populates="application",
                            cascade="all, delete-orphan", order_by="ApplicationMessage.created_at.desc()")

    def __repr__(self):
        return f"<CrossoverApplication {self.ref_number} [{self.status}]>"


class ApplicationDocument(Base):
    """Document uploaded as part of a crossover application."""
    __tablename__ = "application_documents"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("crossover_applications.id"), nullable=False, index=True)
    category = Column(String(50), nullable=False)
    # site_plan | certificate_title | arborist_report | photos_existing |
    # engineering_drawing | stormwater_plan | da_approval | contractor_quote |
    # dial_before_dig | other
    category_label = Column(String(200))
    original_filename = Column(String(500), nullable=False)
    stored_filename = Column(String(500), nullable=False)
    file_type = Column(String(100))  # MIME type
    file_size = Column(Integer)  # bytes
    file_path = Column(String(1000))
    status = Column(String(20), default="uploaded")  # uploaded | verified | rejected
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    application = relationship("CrossoverApplication", back_populates="documents")

    def __repr__(self):
        return f"<Document {self.category}: {self.original_filename}>"


class ApplicationDraft(Base):
    """Auto-saved draft snapshots of the application form. Each save = new row (versioned)."""
    __tablename__ = "application_drafts"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("crossover_applications.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    step = Column(Integer, default=0)
    form_data = Column(JSON, nullable=False)  # Full form snapshot
    saved_at = Column(DateTime(timezone=True), server_default=func.now())

    application = relationship("CrossoverApplication", back_populates="drafts")


class StatusHistory(Base):
    """Audit trail of status changes for an application."""
    __tablename__ = "status_history"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("crossover_applications.id"), nullable=False, index=True)
    old_status = Column(String(30))
    new_status = Column(String(30), nullable=False)
    changed_by = Column(String(100))  # "applicant:email" or "officer:name" or "system"
    reason = Column(Text, nullable=True)
    changed_at = Column(DateTime(timezone=True), server_default=func.now())

    application = relationship("CrossoverApplication", back_populates="status_history")


class ApplicationMessage(Base):
    """Messages between applicant and officers (info requests, responses)."""
    __tablename__ = "application_messages"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("crossover_applications.id"), nullable=False, index=True)
    sender_type = Column(String(20), nullable=False)  # applicant | officer | system
    sender_name = Column(String(255))
    subject = Column(String(500))
    body = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    application = relationship("CrossoverApplication", back_populates="messages")

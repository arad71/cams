"""
AI Training Data Pipeline

Collects site plan analyses (AI Vision) + officer corrections as labeled
training data. When enough samples accumulate, a custom model (YOLOv8 or
fine-tuned vision model) can be trained to replace or supplement AI.

Three-phase deployment:
  Phase 1 (current): AI Vision API for all analysis
  Phase 2 (100+ samples): Train YOLOv8 on collected data, hybrid YOLO+AI
  Phase 3 (500+ samples): YOLO primary, AI fallback for low-confidence

Tables:
  ai_training_samples — one row per analysed document page
  ai_training_corrections — officer corrections to AI results (ground truth)
"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, JSON, Text, ForeignKey, func
from sqlalchemy.orm import relationship
from app.core.database import Base


class AITrainingSample(Base):
    """One row per site plan analysis — stores the image + AI extraction as training data."""
    __tablename__ = "ai_training_samples"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)

    # Source file info
    source_filename = Column(String(500))
    page_number = Column(Integer, default=1)
    image_path = Column(String(1000))  # Path to saved page image on disk
    image_width = Column(Integer, nullable=True)   # Pixel dimensions for annotation scaling
    image_height = Column(Integer, nullable=True)

    # Document classification
    document_type = Column(String(50), nullable=True)  # site_plan | survey | detail_map | engineering | locality
    drawing_scale = Column(String(20), nullable=True)   # 1:200, 1:500, etc.
    drawing_standard = Column(String(50), nullable=True) # council_kalamunda | surveyor_standard | etc.

    # AI extraction results (what AI returned)
    ai_model = Column(String(100))
    ai_provider = Column(String(50), default="ai")
    extraction_json = Column(JSON)  # Full extraction output
    compliance_json = Column(JSON)  # Compliance check results
    raw_response = Column(Text, nullable=True)  # Raw AI response for debugging

    # Key extracted values (denormalised for quick querying/filtering)
    width_at_boundary = Column(Float, nullable=True)
    total_width_at_road = Column(Float, nullable=True)
    verge_depth = Column(Float, nullable=True)
    material = Column(String(100), nullable=True)
    has_drainage = Column(Boolean, nullable=True)
    has_vegetation = Column(Boolean, nullable=True)

    # Additional key fields for training
    crossover_road = Column(String(200), nullable=True)
    constrained_side = Column(String(20), nullable=True)   # left | right
    is_corner_lot = Column(Boolean, nullable=True)
    garage_to_kerb = Column(Float, nullable=True)
    garage_nearest_boundary = Column(Float, nullable=True)
    left_boundary_dist = Column(Float, nullable=True)
    right_boundary_dist = Column(Float, nullable=True)
    fence_left_type = Column(String(100), nullable=True)
    fence_right_type = Column(String(100), nullable=True)

    # Officer review (ground truth)
    officer_verified = Column(Boolean, default=False)  # Officer confirmed AI was correct
    officer_corrected = Column(Boolean, default=False)  # Officer made corrections
    verified_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    quality_score = Column(Float, nullable=True)  # 0-100: how many fields needed correction

    # Training status
    used_in_training = Column(Boolean, default=False)  # Has been used to train a model
    training_batch = Column(String(50), nullable=True)  # Which training run used this

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    corrections = relationship("AITrainingCorrection", back_populates="sample", cascade="all, delete-orphan")


class AITrainingCorrection(Base):
    """Officer correction to an AI extraction — this is the ground truth label."""
    __tablename__ = "ai_training_corrections"

    id = Column(Integer, primary_key=True, index=True)
    sample_id = Column(Integer, ForeignKey("ai_training_samples.id"), nullable=False, index=True)
    corrected_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # What was corrected
    field_path = Column(String(200))  # e.g. "crossover_dimensions.width_at_boundary_m"
    ai_value = Column(String(500))     # What AI said
    correct_value = Column(String(500))  # What the officer corrected it to
    correction_type = Column(String(20))  # "value_wrong" | "missing" | "spurious" | "confirmed"

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    sample = relationship("AITrainingSample", back_populates="corrections")

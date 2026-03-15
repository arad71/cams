from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ─── Auth ────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = None
    postal_address: Optional[str] = None
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    applicant: "ApplicantOut"


# ─── Applicant ───────────────────────────────────────────
class ApplicantOut(BaseModel):
    id: int
    email: str
    full_name: str
    phone: Optional[str] = None
    postal_address: Optional[str] = None
    is_active: bool
    email_verified: bool
    created_at: datetime
    class Config:
        from_attributes = True

class ApplicantUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    postal_address: Optional[str] = None
    password: Optional[str] = None


# ─── Application ─────────────────────────────────────────
class ApplicationCreate(BaseModel):
    """Create a new application (starts as draft at step 0)."""
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None

class ApplicationFormUpdate(BaseModel):
    """Update form fields (any step). Partial updates allowed."""
    current_step: Optional[int] = None
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None
    owner_postal_address: Optional[str] = None
    property_address: Optional[str] = None
    lot_number: Optional[str] = None
    plan_number: Optional[str] = None
    lga_zone: Optional[str] = None
    lot_type: Optional[str] = None
    lot_frontage: Optional[float] = None
    existing_crossover: Optional[bool] = None
    road_type: Optional[str] = None
    road_name: Optional[str] = None
    crossover_width: Optional[float] = None
    number_of_crossovers: Optional[int] = None
    surface_material: Optional[str] = None
    estimated_date: Optional[str] = None
    da_number: Optional[str] = None
    offset_from_left: Optional[float] = None
    offset2_from_left: Optional[float] = None
    has_trees_nearby: Optional[bool] = None
    tree_protection_plan: Optional[str] = None
    vegetation_cleared: Optional[bool] = None
    drainage_type: Optional[str] = None
    has_culvert: Optional[bool] = None

class ApplicationSubmit(BaseModel):
    """Final submit: declaration accepted."""
    declaration_accepted: bool = True

class DocumentOut(BaseModel):
    id: int
    category: str
    category_label: Optional[str] = None
    original_filename: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    status: str = "uploaded"
    uploaded_at: datetime
    class Config:
        from_attributes = True

class DraftOut(BaseModel):
    id: int
    version: int
    step: int
    form_data: dict
    saved_at: datetime
    class Config:
        from_attributes = True

class StatusHistoryOut(BaseModel):
    id: int
    old_status: Optional[str] = None
    new_status: str
    changed_by: Optional[str] = None
    reason: Optional[str] = None
    changed_at: datetime
    class Config:
        from_attributes = True

class MessageOut(BaseModel):
    id: int
    sender_type: str
    sender_name: Optional[str] = None
    subject: Optional[str] = None
    body: str
    is_read: bool = False
    created_at: datetime
    class Config:
        from_attributes = True

class MessageCreate(BaseModel):
    subject: Optional[str] = None
    body: str

class AIReviewItem(BaseModel):
    check: str
    status: str   # pass | fail | warning | info
    message: str

class ApplicationOut(BaseModel):
    id: int
    ref_number: str
    status: str
    current_step: int
    owner_name: Optional[str] = None
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None
    owner_postal_address: Optional[str] = None
    property_address: Optional[str] = None
    lot_number: Optional[str] = None
    plan_number: Optional[str] = None
    lga_zone: Optional[str] = None
    lot_type: Optional[str] = None
    lot_frontage: Optional[float] = None
    existing_crossover: bool = False
    road_type: str = "local"
    road_name: Optional[str] = None
    crossover_width: Optional[float] = None
    number_of_crossovers: int = 1
    surface_material: Optional[str] = None
    estimated_date: Optional[str] = None
    da_number: Optional[str] = None
    offset_from_left: Optional[float] = None
    has_trees_nearby: bool = False
    tree_protection_plan: Optional[str] = None
    vegetation_cleared: bool = False
    drainage_type: str = "swale"
    has_culvert: bool = False
    ai_review_data: Optional[list] = None
    declaration_accepted: bool = False
    submitted_at: Optional[datetime] = None
    contribution_eligible: Optional[bool] = None
    contribution_amount: Optional[float] = None
    documents: list[DocumentOut] = []
    status_history: list[StatusHistoryOut] = []
    messages: list[MessageOut] = []
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True

class ApplicationListOut(BaseModel):
    id: int
    ref_number: str
    status: str
    property_address: Optional[str] = None
    current_step: int
    submitted_at: Optional[datetime] = None
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Reference Data ──────────────────────────────────────
class RefItemOut(BaseModel):
    code: str
    label: str
    class Config:
        from_attributes = True

class DocumentCategoryOut(BaseModel):
    code: str
    label: str
    is_required: bool
    hint: Optional[str] = None
    accepted_types: str = "pdf,jpg,png"
    class Config:
        from_attributes = True

class ValidationRuleOut(BaseModel):
    field: str
    rule_type: str
    value: Optional[str] = None
    message: Optional[str] = None
    depends_field: Optional[str] = None
    depends_value: Optional[str] = None
    class Config:
        from_attributes = True

class FeeScheduleOut(BaseModel):
    fee_type: str
    description: Optional[str] = None
    amount: float
    conditions: Optional[str] = None
    class Config:
        from_attributes = True


# Forward ref
TokenResponse.model_rebuild()

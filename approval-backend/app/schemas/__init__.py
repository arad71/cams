from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


# ─── Auth ────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


# ─── User ────────────────────────────────────────────────
class UserBase(BaseModel):
    name: str
    email: str
    role: str = "engineer"
    department: str = "Engineering"
    initials: str = ""

class UserCreate(UserBase):
    password: Optional[str] = None  # If not provided, a random one-time password is generated

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    initials: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    must_change_password: Optional[bool] = None

class UserOut(UserBase):
    id: int
    is_active: bool
    must_change_password: bool = False
    created_at: datetime
    class Config:
        from_attributes = True

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ─── Application ─────────────────────────────────────────
class ApplicationCreate(BaseModel):
    owner_name: str
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None
    owner_postal_address: Optional[str] = None
    property_address: str
    lot_number: Optional[str] = None
    plan_number: Optional[str] = None
    lot_type: Optional[str] = None
    frontage: Optional[float] = None
    depth: Optional[float] = None
    road_name: Optional[str] = None
    road_type: str = "local"
    road_width: Optional[float] = None
    verge_width: Optional[float] = None
    crossover_width: Optional[float] = None
    crossover_count: int = 1
    crossover_surface: Optional[str] = None
    crossover_est_date: Optional[str] = None
    da_number: Optional[str] = None
    offset_from_left: Optional[float] = None
    offset2_from_left: Optional[float] = None
    declaration_signed: bool = False
    date_signed: Optional[str] = None
    attachment_count: Optional[int] = None
    trees_nearby: bool = False
    tree_protection: Optional[str] = None
    clearing: bool = False
    drainage_type: Optional[str] = None
    culvert: bool = False
    trees_data: list = []
    lot_polygon: Optional[list] = None
    site_plan_data: Optional[dict] = None

class ApplicationUpdate(BaseModel):
    status: Optional[str] = None
    officer_id: Optional[int] = None
    crossover_width: Optional[float] = None
    crossover_count: Optional[int] = None
    crossover_surface: Optional[str] = None
    risk_flags: Optional[list] = None
    checklist_data: Optional[dict] = None
    contribution_eligible: Optional[bool] = None
    contribution_amount: Optional[float] = None
    referral_authority: Optional[str] = None
    referral_status: Optional[str] = None
    site_plan_data: Optional[dict] = None

class NoteOut(BaseModel):
    id: int
    text: str
    author_name: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

class DocumentOut(BaseModel):
    id: int
    name: str
    file_type: Optional[str] = None
    file_size: Optional[str] = None
    category: Optional[str] = None
    status: str = "received"
    file_path: Optional[str] = None
    review_note: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    uploaded_at: datetime
    class Config:
        from_attributes = True

class DocumentUpdate(BaseModel):
    status: Optional[str] = None
    review_note: Optional[str] = None

class InspectionOut(BaseModel):
    id: int
    inspection_type: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    status: str = "scheduled"
    notes: Optional[str] = None
    class Config:
        from_attributes = True

class ApplicationOut(BaseModel):
    id: int
    ref_number: str
    submitted_date: datetime
    status: str
    owner_name: str
    owner_phone: Optional[str] = None
    owner_email: Optional[str] = None
    property_address: str
    lot_number: Optional[str] = None
    plan_number: Optional[str] = None
    lot_type: Optional[str] = None
    frontage: Optional[float] = None
    depth: Optional[float] = None
    road_name: Optional[str] = None
    road_type: str = "local"
    road_width: Optional[float] = None
    verge_width: Optional[float] = None
    crossover_width: Optional[float] = None
    crossover_count: int = 1
    crossover_surface: Optional[str] = None
    da_number: Optional[str] = None
    offset_from_left: Optional[float] = None
    declaration_signed: Optional[bool] = None
    date_signed: Optional[str] = None
    attachment_count: Optional[int] = None
    trees_nearby: bool = False
    clearing: bool = False
    drainage_type: Optional[str] = None
    officer_id: Optional[int] = None
    officer_name: Optional[str] = None
    risk_flags: list = []
    checklist_data: dict = {}
    contribution_eligible: bool = False
    contribution_amount: float = 0
    lot_polygon: Optional[list] = None
    site_plan_data: Optional[dict] = None
    notes: list[NoteOut] = []
    documents: list[DocumentOut] = []
    inspections: list[InspectionOut] = []
    created_at: datetime
    class Config:
        from_attributes = True

class ApplicationListOut(BaseModel):
    id: int
    ref_number: str
    submitted_date: datetime
    status: str
    owner_name: str
    property_address: str
    officer_name: Optional[str] = None
    class Config:
        from_attributes = True


# ─── Checklist ───────────────────────────────────────────
class ChecklistUpdate(BaseModel):
    checklist_data: dict

class NoteCreate(BaseModel):
    text: str

class DocumentCreate(BaseModel):
    name: str
    file_type: Optional[str] = None
    file_size: Optional[str] = None
    category: Optional[str] = None

class InspectionCreate(BaseModel):
    inspection_type: str
    scheduled_date: datetime
    inspector_id: Optional[int] = None
    notes: Optional[str] = None

class InspectionUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


# ─── Assessment Master ───────────────────────────────────
class AssessmentItemOut(BaseModel):
    id: int
    code: str
    label: str
    reference: str = ""
    sort_order: int = 0
    is_active: bool = True
    auto_assess_rule: Optional[str] = None
    class Config:
        from_attributes = True

class AssessmentCategoryOut(BaseModel):
    id: int
    code: str
    label: str
    icon: str = ""
    sort_order: int = 0
    is_active: bool = True
    items: list[AssessmentItemOut] = []
    class Config:
        from_attributes = True

class AssessmentItemCreate(BaseModel):
    code: str
    label: str
    reference: str = ""
    sort_order: int = 0
    auto_assess_rule: Optional[str] = None

class AssessmentItemUpdate(BaseModel):
    label: Optional[str] = None
    reference: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
    auto_assess_rule: Optional[str] = None

class AssessmentCategoryCreate(BaseModel):
    code: str
    label: str
    icon: str = ""
    sort_order: int = 0

class AssessmentCategoryUpdate(BaseModel):
    label: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


# ─── Assessment Rules (database-driven) ─────────────────
class AssessmentRuleOut(BaseModel):
    id: int
    item_id: int
    item_code: Optional[str] = None
    priority: int = 0
    is_active: bool = True
    source: str = "app"
    field: str
    operator: str
    value: Optional[str] = None
    result: str
    confidence: float = 0.8
    reason_template: str
    class Config:
        from_attributes = True

class AssessmentRuleCreate(BaseModel):
    item_id: int
    priority: int = 0
    source: str = "app"
    field: str
    operator: str
    value: Optional[str] = None
    result: str
    confidence: float = 0.8
    reason_template: str

class AssessmentRuleUpdate(BaseModel):
    priority: Optional[int] = None
    is_active: Optional[bool] = None
    source: Optional[str] = None
    field: Optional[str] = None
    operator: Optional[str] = None
    value: Optional[str] = None
    result: Optional[str] = None
    confidence: Optional[float] = None
    reason_template: Optional[str] = None


# ─── Case Assessment (per-application per-item) ─────────
class CaseAssessmentOut(BaseModel):
    id: int
    application_id: int
    item_id: int
    item_code: Optional[str] = None
    item_label: Optional[str] = None
    category_code: Optional[str] = None
    ai_result: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_reason: Optional[str] = None
    ai_assessed_at: Optional[datetime] = None
    officer_result: Optional[str] = None
    officer_name: Optional[str] = None
    officer_assessed_at: Optional[datetime] = None
    status: str = "pending"
    note: Optional[str] = None
    note_by_name: Optional[str] = None
    note_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class CaseAssessmentUpdate(BaseModel):
    ai_result: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_reason: Optional[str] = None
    officer_result: Optional[str] = None
    status: Optional[str] = None
    note: Optional[str] = None

class BulkAIAssessRequest(BaseModel):
    """Run AI auto-assess on all items for an application."""
    pass  # No body needed; the backend computes results

class BulkOfficerDecisionRequest(BaseModel):
    """Bulk officer approve/reject for items matching a given AI result."""
    ai_result_filter: str  # e.g. "pass" → auto-approve all AI-passed items
    officer_decision: str  # "approved" or "rejected"

class CaseAssessmentSummary(BaseModel):
    total: int = 0
    ai_pass: int = 0
    ai_review: int = 0
    ai_fail: int = 0
    officer_approved: int = 0
    officer_rejected: int = 0
    officer_pending: int = 0
    status_pass: int = 0
    status_fail: int = 0
    status_pending: int = 0
    score_pct: float = 0.0


# ─── Reports ─────────────────────────────────────────────
class ReportOut(BaseModel):
    id: int
    application_id: int
    version: int
    generated_by_name: Optional[str] = None
    status_at_generation: Optional[str] = None
    recommendation: Optional[str] = None
    summary_data: dict = {}
    checklist_snapshot: dict = {}
    app_snapshot: dict = {}
    notes_snapshot: list = []
    created_at: datetime
    class Config:
        from_attributes = True

class ReportListOut(BaseModel):
    id: int
    version: int
    generated_by_name: Optional[str] = None
    recommendation: Optional[str] = None
    summary_data: dict = {}
    created_at: datetime
    class Config:
        from_attributes = True


# Forward ref resolution
TokenResponse.model_rebuild()

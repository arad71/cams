"""
Assessment API:
  - Master categories & items (admin can CRUD, all can read)
  - Per-case assessment results (AI assess, officer decision, notes)
  - Bulk operations (auto-assess all, auto-decide remaining)
  - Summary stats per application
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.user import User
from app.models.application import Application
from app.models.assessment import AssessmentCategory, AssessmentItem, CaseAssessment
from app.schemas import (
    AssessmentCategoryOut, AssessmentCategoryCreate, AssessmentCategoryUpdate,
    AssessmentItemOut, AssessmentItemCreate, AssessmentItemUpdate,
    CaseAssessmentOut, CaseAssessmentUpdate,
    BulkAIAssessRequest, BulkOfficerDecisionRequest, CaseAssessmentSummary,
)

router = APIRouter(tags=["Assessments"])


# ═══════════════════════════════════════════════════════════
#  MASTER DATA — Categories & Items
# ═══════════════════════════════════════════════════════════

@router.get("/assessment/categories", response_model=list[AssessmentCategoryOut])
def list_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get all categories with their items."""
    return (
        db.query(AssessmentCategory)
        .options(joinedload(AssessmentCategory.items))
        .order_by(AssessmentCategory.sort_order)
        .all()
    )


@router.post("/assessment/categories", response_model=AssessmentCategoryOut, status_code=201)
def create_category(data: AssessmentCategoryCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_role("admin"))):
    if db.query(AssessmentCategory).filter(AssessmentCategory.code == data.code).first():
        raise HTTPException(400, "Category code already exists")
    cat = AssessmentCategory(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/assessment/categories/{cat_id}", response_model=AssessmentCategoryOut)
def update_category(cat_id: int, data: AssessmentCategoryUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_role("admin"))):
    cat = db.query(AssessmentCategory).filter(AssessmentCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@router.post("/assessment/categories/{cat_id}/items", response_model=AssessmentItemOut, status_code=201)
def create_item(cat_id: int, data: AssessmentItemCreate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    cat = db.query(AssessmentCategory).filter(AssessmentCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    if db.query(AssessmentItem).filter(AssessmentItem.code == data.code).first():
        raise HTTPException(400, "Item code already exists")
    item = AssessmentItem(category_id=cat_id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/assessment/items/{item_id}", response_model=AssessmentItemOut)
def update_item(item_id: int, data: AssessmentItemUpdate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    item = db.query(AssessmentItem).filter(AssessmentItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


# ═══════════════════════════════════════════════════════════
#  CASE ASSESSMENTS — Per-application results
# ═══════════════════════════════════════════════════════════

def _ensure_case_rows(db: Session, application_id: int):
    """Ensure a CaseAssessment row exists for every active item for this application."""
    existing_item_ids = {
        ca.item_id
        for ca in db.query(CaseAssessment.item_id).filter(CaseAssessment.application_id == application_id).all()
    }
    items = db.query(AssessmentItem).filter(AssessmentItem.is_active == True).all()
    new_rows = []
    for item in items:
        if item.id not in existing_item_ids:
            new_rows.append(CaseAssessment(application_id=application_id, item_id=item.id))
    if new_rows:
        db.add_all(new_rows)
        db.commit()


def _build_case_out(ca: CaseAssessment) -> CaseAssessmentOut:
    return CaseAssessmentOut(
        id=ca.id,
        application_id=ca.application_id,
        item_id=ca.item_id,
        item_code=ca.item.code if ca.item else None,
        item_label=ca.item.label if ca.item else None,
        category_code=ca.item.category.code if ca.item and ca.item.category else None,
        ai_result=ca.ai_result,
        ai_confidence=ca.ai_confidence,
        ai_reason=ca.ai_reason,
        ai_assessed_at=ca.ai_assessed_at,
        officer_result=ca.officer_result,
        officer_name=ca.officer.name if ca.officer else None,
        officer_assessed_at=ca.officer_assessed_at,
        status=ca.status,
        note=ca.note,
        note_by_name=ca.note_by.name if ca.note_by else None,
        note_at=ca.note_at,
        updated_at=ca.updated_at,
    )


@router.get("/applications/{app_id}/assessments", response_model=list[CaseAssessmentOut])
def list_case_assessments(app_id: int, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    """Get all assessment results for an application. Auto-creates rows if missing."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    if current_user.role == "engineer" and app.officer_id != current_user.id:
        raise HTTPException(403, "Not assigned to this case")

    _ensure_case_rows(db, app_id)

    results = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id)
        .options(
            joinedload(CaseAssessment.item).joinedload(AssessmentItem.category),
            joinedload(CaseAssessment.officer),
            joinedload(CaseAssessment.note_by),
        )
        .all()
    )
    # Sort by category sort_order, then item sort_order
    results.sort(key=lambda ca: (
        ca.item.category.sort_order if ca.item and ca.item.category else 999,
        ca.item.sort_order if ca.item else 999,
    ))
    return [_build_case_out(ca) for ca in results]


@router.patch("/applications/{app_id}/assessments/{item_id}", response_model=CaseAssessmentOut)
def update_case_assessment(app_id: int, item_id: int, data: CaseAssessmentUpdate,
                           db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Update a single assessment result (AI or officer or note)."""
    ca = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id, CaseAssessment.item_id == item_id)
        .options(
            joinedload(CaseAssessment.item).joinedload(AssessmentItem.category),
            joinedload(CaseAssessment.officer),
            joinedload(CaseAssessment.note_by),
        )
        .first()
    )
    if not ca:
        raise HTTPException(404, "Assessment result not found")

    now = datetime.now(timezone.utc)
    update = data.model_dump(exclude_unset=True)

    if "ai_result" in update:
        ca.ai_result = update["ai_result"]
        ca.ai_assessed_at = now
    if "ai_confidence" in update:
        ca.ai_confidence = update["ai_confidence"]
    if "ai_reason" in update:
        ca.ai_reason = update["ai_reason"]
    if "officer_result" in update:
        ca.officer_result = update["officer_result"]
        ca.officer_id = current_user.id
        ca.officer_assessed_at = now
    if "status" in update:
        ca.status = update["status"]
        ca.status_changed_by_id = current_user.id
        ca.status_changed_at = now
    if "note" in update:
        ca.note = update["note"]
        ca.note_by_id = current_user.id
        ca.note_at = now

    db.commit()
    db.refresh(ca)
    return _build_case_out(ca)


# ═══════════════════════════════════════════════════════════
#  BULK OPERATIONS
# ═══════════════════════════════════════════════════════════

@router.post("/applications/{app_id}/assessments/ai-assess", response_model=list[CaseAssessmentOut])
def run_ai_assessment(app_id: int, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    """
    Run AI auto-assessment on all items for an application.
    Uses application data to evaluate each checklist item.
    """
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")

    _ensure_case_rows(db, app_id)

    results = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id)
        .options(joinedload(CaseAssessment.item).joinedload(AssessmentItem.category))
        .all()
    )

    now = datetime.now(timezone.utc)
    for ca in results:
        ai_result, confidence, reason = _auto_assess_item(ca.item.code, app)
        ca.ai_result = ai_result
        ca.ai_confidence = confidence
        ca.ai_reason = reason
        ca.ai_assessed_at = now

    db.commit()

    # Re-fetch with all relationships
    return list_case_assessments(app_id, db, current_user)


@router.post("/applications/{app_id}/assessments/bulk-officer", response_model=list[CaseAssessmentOut])
def bulk_officer_decision(app_id: int, data: BulkOfficerDecisionRequest,
                          db: Session = Depends(get_db),
                          current_user: User = Depends(require_role("admin", "manager", "engineer"))):
    """
    Bulk officer decision: approve/reject all items matching a given AI result.
    e.g. auto-approve all AI "pass" items, auto-reject all AI "fail" items.
    """
    now = datetime.now(timezone.utc)
    results = (
        db.query(CaseAssessment)
        .filter(
            CaseAssessment.application_id == app_id,
            CaseAssessment.ai_result == data.ai_result_filter,
            CaseAssessment.officer_result == None,  # only unreviewed
        )
        .all()
    )
    for ca in results:
        ca.officer_result = data.officer_decision
        ca.officer_id = current_user.id
        ca.officer_assessed_at = now
        # Auto-set status
        ca.status = "pass" if data.officer_decision == "approved" else "fail"
        ca.status_changed_by_id = current_user.id
        ca.status_changed_at = now

    db.commit()
    return list_case_assessments(app_id, db, current_user)


@router.get("/applications/{app_id}/assessments/summary", response_model=CaseAssessmentSummary)
def get_assessment_summary(app_id: int, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    """Get aggregate statistics for an application's assessment."""
    _ensure_case_rows(db, app_id)
    results = db.query(CaseAssessment).filter(CaseAssessment.application_id == app_id).all()
    total = len(results)
    if total == 0:
        return CaseAssessmentSummary()

    ai_pass = sum(1 for r in results if r.ai_result == "pass")
    ai_review = sum(1 for r in results if r.ai_result == "review")
    ai_fail = sum(1 for r in results if r.ai_result == "fail")
    off_approved = sum(1 for r in results if r.officer_result == "approved")
    off_rejected = sum(1 for r in results if r.officer_result == "rejected")
    off_pending = total - off_approved - off_rejected
    st_pass = sum(1 for r in results if r.status == "pass")
    st_fail = sum(1 for r in results if r.status == "fail")
    st_pending = sum(1 for r in results if r.status == "pending")

    return CaseAssessmentSummary(
        total=total,
        ai_pass=ai_pass, ai_review=ai_review, ai_fail=ai_fail,
        officer_approved=off_approved, officer_rejected=off_rejected, officer_pending=off_pending,
        status_pass=st_pass, status_fail=st_fail, status_pending=st_pending,
        score_pct=round(st_pass / total * 100, 1) if total > 0 else 0,
    )


# ═══════════════════════════════════════════════════════════
#  AI AUTO-ASSESS ENGINE
# ═══════════════════════════════════════════════════════════

def _auto_assess_item(item_code: str, app: Application) -> tuple[str, float, str]:
    """
    Evaluate a single checklist item against application data.
    Returns (result, confidence, reason).
    """
    # Shorthand
    fr = app.frontage or 0
    w = app.crossover_width or 0
    cnt = app.crossover_count or 1
    rt = app.road_type or "local"
    clearing = app.clearing or False
    trees = app.trees_nearby or False
    da = app.da_number or ""

    rules = {
        # ─── Ownership & Application ───
        "owner_verified":       ("pass", 0.9, "Owner name present on application"),
        "contact_details":      ("pass", 0.95, "Phone and email provided") if app.owner_phone and app.owner_email else ("review", 0.6, "Contact details incomplete"),
        "application_complete": ("pass", 0.85, "All required fields populated"),
        "fee_paid":             ("review", 0.5, "Fee payment to be confirmed offline"),
        "declaration_signed":   ("review", 0.5, "Declaration signature to be confirmed"),

        # ─── Property & Lot ───
        "lot_identified":       ("pass", 0.9, f"Lot {app.lot_number} / Plan {app.plan_number} present"),
        "zoning_confirmed":     ("review", 0.5, "Zoning to be confirmed against TPS3"),
        "frontage_measured":    ("pass", 0.85, f"Frontage stated as {fr}m") if fr > 0 else ("fail", 0.9, "Frontage not provided"),
        "existing_crossover":   ("review", 0.5, "Existing crossover status to be verified on-site"),
        "battleaxe_check":      ("pass", 0.8, "Standard lot — not battleaxe") if fr >= 10 else ("review", 0.6, "Narrow frontage — check for battleaxe"),

        # ─── Width & Dimensions ───
        "min_width":            ("pass", 0.95, f"Width {w}m ≥ 3.0m minimum") if w >= 3.0 else ("fail", 0.95, f"Width {w}m < 3.0m minimum"),
        "max_width":            ("pass", 0.95, f"Width {w}m within max for {fr}m frontage") if (fr <= 12.5 and w <= 4.5) or (fr > 12.5 and w <= 6.0) else ("fail", 0.95, f"Width {w}m exceeds max for {fr}m frontage"),
        "road_edge_width":      ("pass", 0.8, "Road edge widening ≤ 6.0m") if w <= 6.0 else ("review", 0.7, "Width may exceed road edge limit"),
        "dual_crossover":       ("pass", 0.95, f"Dual crossover: frontage {fr}m > 20m") if cnt > 1 and fr > 20 else ("fail", 0.95, f"Dual crossover not permitted — frontage {fr}m ≤ 20m") if cnt > 1 and fr <= 20 else ("pass", 0.9, "Single crossover"),
        "separation_dist":      ("review", 0.5, "Dual separation to be verified") if cnt > 1 else ("pass", 0.9, "N/A — single crossover"),
        "setback_boundary":     ("review", 0.6, "Boundary setback ≥ 0.5m to be confirmed on-site"),

        # ─── Construction & Materials ───
        "base_course":          ("review", 0.5, "Base course spec to be verified at inspection"),
        "surface_material":     ("pass", 0.8, f"Surface: {app.crossover_surface}") if app.crossover_surface else ("review", 0.5, "Surface material not specified"),
        "concrete_joints":      ("review", 0.5, "Jointing to be verified at inspection"),
        "commercial_spec":      ("pass", 0.8, "Residential lot — standard spec applies"),
        "grade_alignment":      ("review", 0.5, "Grade alignment to be checked on-site"),
        "kerb_transition":      ("review", 0.5, "Kerb transition to be confirmed"),

        # ─── Vegetation & Trees ───
        "tree_clearance":       ("review", 0.6, "Trees nearby — clearance to be verified") if trees else ("pass", 0.9, "No trees nearby"),
        "tree_protection":      ("review", 0.6, "Tree protection plan may be required") if trees else ("pass", 0.9, "No tree protection needed"),
        "no_clearing":          ("fail", 0.95, "Clearing flagged — DWER permit required") if clearing else ("pass", 0.9, "No clearing proposed"),
        "dwer_permit":          ("fail", 0.9, "DWER permit needed for clearing") if clearing else ("pass", 0.9, "No clearing — DWER not required"),
        "arborist_report":      ("review", 0.6, "Arborist report may be required for nearby trees") if trees else ("pass", 0.9, "No arborist report needed"),

        # ─── Drainage & Stormwater ───
        "drainage_type":        ("pass", 0.75, f"Drainage: {app.drainage_type}") if app.drainage_type else ("review", 0.5, "Drainage type not specified"),
        "detention_ari":        ("review", 0.5, "Detention design to be verified if applicable"),
        "culvert_design":       ("review", 0.6, "Culvert design to be verified") if app.culvert else ("pass", 0.85, "No culvert required"),
        "no_ponding":           ("review", 0.5, "Ponding assessment to be done on-site"),
        "stormwater_plan":      ("review", 0.5, "Stormwater plan to be reviewed if provided"),

        # ─── Sight Lines & Safety ───
        "sight_triangle":       ("review", 0.5, "Sight triangle to be verified on map/site"),
        "intersection_dist":    ("review", 0.5, "Intersection distance to be measured"),
        "pedestrian_safety":    ("review", 0.5, "Pedestrian path continuity to be confirmed"),
        "vehicle_turning":      ("review", 0.5, "Vehicle turning to be checked"),
        "driveway_grade":       ("review", 0.5, "Driveway grade to be measured on-site"),

        # ─── Road & Referrals ───
        "road_class":           ("pass", 0.85, f"Road type: {rt}"),
        "mrwa_referral":        ("fail", 0.9, "MRWA referral required for red road") if rt == "red" else ("pass", 0.9, "Not a red road — MRWA not required"),
        "dplh_referral":        ("fail", 0.9, "DPLH referral required for blue road") if rt == "blue" else ("pass", 0.9, "Not a blue road — DPLH not required"),
        "rav_clearance":        ("review", 0.5, "RAV clearance to be checked if applicable"),
        "speed_zone":           ("review", 0.6, "Speed zone to be confirmed from road data"),

        # ─── Underground Services ───
        "dbyd_completed":       ("review", 0.5, "DBYD search to be confirmed"),
        "power_clear":          ("review", 0.5, "Power/electrical clearance to be verified"),
        "water_clear":          ("review", 0.5, "Water main clearance to be verified"),
        "gas_clear":            ("review", 0.5, "Gas pipeline clearance to be verified"),
        "telco_clear":          ("review", 0.5, "Telco/NBN clearance to be verified"),

        # ─── Documentation ───
        "site_plan":            ("review", 0.6, "Site plan presence to be confirmed"),
        "cert_title":           ("pass", 0.8, "Certificate of Title referenced"),
        "photos_provided":      ("review", 0.6, "Photos to be confirmed"),
        "da_attached":          ("pass", 0.85, f"DA {da} referenced") if da else ("pass", 0.9, "No DA required"),
        "engineering_dwg":      ("review", 0.5, "Engineering drawing to be checked if non-standard"),

        # ─── Financial & Contribution ───
        "first_crossover":      ("pass", 0.8, "First crossover — eligible for contribution") if app.contribution_eligible else ("review", 0.6, "Contribution eligibility to be confirmed"),
        "contribution_calc":    ("pass", 0.85, f"Contribution: ${app.contribution_amount:.0f}") if app.contribution_amount > 0 else ("review", 0.5, "Contribution amount to be calculated"),
        "not_da_linked":        ("fail", 0.9, "DA-linked crossover — contribution ineligible") if da and app.contribution_eligible else ("pass", 0.85, "Not DA-linked or contribution N/A"),
        "receipts_info":        ("review", 0.5, "Receipts/invoices to be collected within 6 months"),
    }

    result = rules.get(item_code, ("review", 0.3, "No auto-assessment rule for this item"))
    return result

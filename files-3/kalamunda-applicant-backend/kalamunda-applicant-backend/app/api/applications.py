"""
Application lifecycle:
  1. POST /applications          → create draft (step 0)
  2. PATCH /applications/{id}    → update form fields (any step)
  3. POST /applications/{id}/save-draft → auto-save versioned snapshot
  4. POST /applications/{id}/documents  → upload files
  5. POST /applications/{id}/ai-review  → run pre-submit AI checks
  6. POST /applications/{id}/submit     → final submission
  7. GET  /applications/{id}/track      → status timeline
  8. POST /applications/{id}/messages   → send message / respond to info request
  9. POST /applications/{id}/withdraw   → withdraw application
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.auth import get_current_applicant
from app.models.applicant import Applicant
from app.models.application import (
    CrossoverApplication, ApplicationDocument, ApplicationDraft,
    StatusHistory, ApplicationMessage,
)
from app.schemas import (
    ApplicationCreate, ApplicationFormUpdate, ApplicationSubmit,
    ApplicationOut, ApplicationListOut, DocumentOut, DraftOut,
    StatusHistoryOut, MessageCreate, MessageOut, AIReviewItem,
)

router = APIRouter(prefix="/applications", tags=["Applications"])


def _gen_ref(db: Session) -> str:
    year = datetime.now().year
    last = (
        db.query(CrossoverApplication)
        .filter(CrossoverApplication.ref_number.like(f"CX-{year}-%"))
        .order_by(CrossoverApplication.ref_number.desc())
        .first()
    )
    seq = int(last.ref_number.split("-")[-1]) + 1 if last else 1
    return f"CX-{year}-{seq:04d}"


def _check_owner(app, applicant: Applicant):
    if app.applicant_id != applicant.id:
        raise HTTPException(403, "Not your application")


def _add_status(db: Session, app, new_status: str, by: str, reason: str = None):
    old = app.status
    db.add(StatusHistory(
        application_id=app.id, old_status=old, new_status=new_status,
        changed_by=by, reason=reason,
    ))
    app.status = new_status


def _to_out(app) -> ApplicationOut:
    return ApplicationOut(
        **{c.name: getattr(app, c.name) for c in app.__table__.columns},
        documents=[DocumentOut.model_validate(d) for d in app.documents],
        status_history=[StatusHistoryOut.model_validate(h) for h in app.status_history],
        messages=[MessageOut.model_validate(m) for m in app.messages],
    )


# ─── List my applications ───────────────────────────────
@router.get("/", response_model=list[ApplicationListOut])
def list_my_applications(db: Session = Depends(get_db), current: Applicant = Depends(get_current_applicant)):
    apps = (
        db.query(CrossoverApplication)
        .filter(CrossoverApplication.applicant_id == current.id)
        .order_by(CrossoverApplication.created_at.desc())
        .all()
    )
    return [ApplicationListOut.model_validate(a) for a in apps]


# ─── Create new application (draft) ─────────────────────
@router.post("/", response_model=ApplicationOut, status_code=201)
def create_application(data: ApplicationCreate, db: Session = Depends(get_db),
                       current: Applicant = Depends(get_current_applicant)):
    ref = _gen_ref(db)
    app = CrossoverApplication(
        ref_number=ref, applicant_id=current.id, status="draft",
        owner_name=data.owner_name or current.full_name,
        owner_phone=data.owner_phone or current.phone,
        owner_email=data.owner_email or current.email,
        owner_postal_address=current.postal_address,
    )
    db.add(app)
    db.flush()
    db.add(StatusHistory(
        application_id=app.id, old_status=None, new_status="draft",
        changed_by=f"applicant:{current.email}",
    ))
    db.commit()
    db.refresh(app)
    return _to_out(app)


# ─── Get application detail ─────────────────────────────
@router.get("/{app_id}", response_model=ApplicationOut)
def get_application(app_id: int, db: Session = Depends(get_db),
                    current: Applicant = Depends(get_current_applicant)):
    app = (
        db.query(CrossoverApplication)
        .options(
            joinedload(CrossoverApplication.documents),
            joinedload(CrossoverApplication.status_history),
            joinedload(CrossoverApplication.messages),
        )
        .filter(CrossoverApplication.id == app_id)
        .first()
    )
    if not app:
        raise HTTPException(404, "Application not found")
    _check_owner(app, current)
    return _to_out(app)


# ─── Update form fields (any step) ──────────────────────
@router.patch("/{app_id}", response_model=ApplicationOut)
def update_application(app_id: int, data: ApplicationFormUpdate, db: Session = Depends(get_db),
                       current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    _check_owner(app, current)
    if app.status not in ("draft", "info_requested"):
        raise HTTPException(400, f"Cannot edit application in '{app.status}' status")

    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(app, k, v)
    db.commit()
    db.refresh(app)
    return _to_out(app)


# ─── Auto-save draft (versioned) ────────────────────────
@router.post("/{app_id}/save-draft", response_model=DraftOut)
def save_draft(app_id: int, db: Session = Depends(get_db),
               current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    _check_owner(app, current)

    last_version = (
        db.query(ApplicationDraft.version)
        .filter(ApplicationDraft.application_id == app_id)
        .order_by(ApplicationDraft.version.desc())
        .first()
    )
    version = (last_version[0] + 1) if last_version else 1

    # Snapshot all form fields
    form_data = {c.name: getattr(app, c.name) for c in app.__table__.columns
                 if c.name not in ("id", "ref_number", "applicant_id", "created_at", "updated_at")}
    # Clean datetime objects for JSON
    for k, v in form_data.items():
        if isinstance(v, datetime):
            form_data[k] = v.isoformat() if v else None

    draft = ApplicationDraft(
        application_id=app_id, version=version,
        step=app.current_step, form_data=form_data,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return DraftOut.model_validate(draft)


# ─── List drafts ────────────────────────────────────────
@router.get("/{app_id}/drafts", response_model=list[DraftOut])
def list_drafts(app_id: int, db: Session = Depends(get_db),
                current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    _check_owner(app, current)
    drafts = db.query(ApplicationDraft).filter(ApplicationDraft.application_id == app_id).order_by(ApplicationDraft.version.desc()).all()
    return [DraftOut.model_validate(d) for d in drafts]


# ─── Restore draft version ──────────────────────────────
@router.post("/{app_id}/drafts/{version}/restore", response_model=ApplicationOut)
def restore_draft(app_id: int, version: int, db: Session = Depends(get_db),
                  current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)
    if app.status not in ("draft", "info_requested"):
        raise HTTPException(400, "Cannot restore draft for submitted application")

    draft = db.query(ApplicationDraft).filter(
        ApplicationDraft.application_id == app_id,
        ApplicationDraft.version == version,
    ).first()
    if not draft:
        raise HTTPException(404, "Draft version not found")

    skip = {"id", "ref_number", "applicant_id", "created_at", "updated_at"}
    for k, v in draft.form_data.items():
        if k not in skip and hasattr(app, k):
            setattr(app, k, v)
    db.commit()
    db.refresh(app)
    return _to_out(app)


# ─── Upload document ────────────────────────────────────
@router.post("/{app_id}/documents", response_model=DocumentOut, status_code=201)
def upload_document(
    app_id: int,
    category: str = Form(...),
    category_label: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: Applicant = Depends(get_current_applicant),
):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)

    import os, uuid
    from app.core.config import get_settings
    settings = get_settings()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1] if file.filename else ".bin"
    stored = f"{app.ref_number}_{uuid.uuid4().hex[:8]}{ext}"
    path = os.path.join(settings.UPLOAD_DIR, stored)

    content = file.file.read()
    with open(path, "wb") as f:
        f.write(content)

    doc = ApplicationDocument(
        application_id=app_id, category=category, category_label=category_label,
        original_filename=file.filename or "unknown",
        stored_filename=stored, file_type=file.content_type,
        file_size=len(content), file_path=path,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return DocumentOut.model_validate(doc)


@router.delete("/{app_id}/documents/{doc_id}", status_code=204)
def delete_document(app_id: int, doc_id: int, db: Session = Depends(get_db),
                    current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)
    if app.status not in ("draft", "info_requested"):
        raise HTTPException(400, "Cannot delete documents from submitted application")

    doc = db.query(ApplicationDocument).filter(
        ApplicationDocument.id == doc_id, ApplicationDocument.application_id == app_id
    ).first()
    if not doc:
        raise HTTPException(404)
    # Remove file
    import os
    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)
    db.delete(doc)
    db.commit()


# ─── AI Pre-Submit Review ───────────────────────────────
@router.post("/{app_id}/ai-review", response_model=list[AIReviewItem])
def run_ai_review(app_id: int, db: Session = Depends(get_db),
                  current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).options(
        joinedload(CrossoverApplication.documents)
    ).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)

    checks = _ai_review(app)
    app.ai_review_data = [c.model_dump() for c in checks]
    db.commit()
    return checks


# ─── Submit ──────────────────────────────────────────────
@router.post("/{app_id}/submit", response_model=ApplicationOut)
def submit_application(app_id: int, data: ApplicationSubmit, db: Session = Depends(get_db),
                       current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).options(
        joinedload(CrossoverApplication.documents),
        joinedload(CrossoverApplication.status_history),
        joinedload(CrossoverApplication.messages),
    ).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)
    if app.status not in ("draft", "info_requested"):
        raise HTTPException(400, f"Application in '{app.status}' status cannot be submitted")

    # Validation
    errors = _validate_submission(app)
    if errors:
        raise HTTPException(422, detail={"errors": errors})

    if not data.declaration_accepted:
        raise HTTPException(422, "Declaration must be accepted")

    now = datetime.now(timezone.utc)
    app.declaration_accepted = True
    app.declaration_date = now
    app.submitted_at = now
    app.current_step = 7
    _add_status(db, app, "submitted", f"applicant:{current.email}")

    # Calculate contribution eligibility
    app.contribution_eligible = not bool(app.da_number) and not app.existing_crossover
    if app.contribution_eligible:
        app.contribution_amount = 474.0

    db.commit()
    db.refresh(app)
    return _to_out(app)


# ─── Withdraw ────────────────────────────────────────────
@router.post("/{app_id}/withdraw", response_model=ApplicationOut)
def withdraw_application(app_id: int, db: Session = Depends(get_db),
                         current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).options(
        joinedload(CrossoverApplication.documents),
        joinedload(CrossoverApplication.status_history),
        joinedload(CrossoverApplication.messages),
    ).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)
    if app.status in ("approved", "rejected", "withdrawn"):
        raise HTTPException(400, "Cannot withdraw a finalised application")

    _add_status(db, app, "withdrawn", f"applicant:{current.email}", "Withdrawn by applicant")
    db.commit()
    db.refresh(app)
    return _to_out(app)


# ─── Messages ────────────────────────────────────────────
@router.post("/{app_id}/messages", response_model=MessageOut, status_code=201)
def send_message(app_id: int, data: MessageCreate, db: Session = Depends(get_db),
                 current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)
    msg = ApplicationMessage(
        application_id=app_id, sender_type="applicant",
        sender_name=current.full_name, subject=data.subject, body=data.body,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return MessageOut.model_validate(msg)


@router.patch("/{app_id}/messages/{msg_id}/read")
def mark_message_read(app_id: int, msg_id: int, db: Session = Depends(get_db),
                      current: Applicant = Depends(get_current_applicant)):
    msg = db.query(ApplicationMessage).filter(
        ApplicationMessage.id == msg_id, ApplicationMessage.application_id == app_id
    ).first()
    if not msg:
        raise HTTPException(404)
    msg.is_read = True
    db.commit()
    return {"ok": True}


# ─── Status tracking ────────────────────────────────────
@router.get("/{app_id}/track", response_model=list[StatusHistoryOut])
def track_status(app_id: int, db: Session = Depends(get_db),
                 current: Applicant = Depends(get_current_applicant)):
    app = db.query(CrossoverApplication).filter(CrossoverApplication.id == app_id).first()
    if not app:
        raise HTTPException(404)
    _check_owner(app, current)
    history = db.query(StatusHistory).filter(
        StatusHistory.application_id == app_id
    ).order_by(StatusHistory.changed_at.desc()).all()
    return [StatusHistoryOut.model_validate(h) for h in history]


# ═══════════════════════════════════════════════════════════
#  VALIDATION & AI REVIEW
# ═══════════════════════════════════════════════════════════

def _validate_submission(app: CrossoverApplication) -> list[str]:
    errors = []
    if not app.owner_name: errors.append("Owner name is required")
    if not app.owner_phone: errors.append("Phone is required")
    if not app.owner_email: errors.append("Email is required")
    if not app.property_address: errors.append("Property address is required")
    if not app.lot_frontage or app.lot_frontage <= 0: errors.append("Lot frontage must be > 0")
    if not app.crossover_width or app.crossover_width < 3.0: errors.append("Crossover width must be ≥ 3.0m")
    if not app.surface_material: errors.append("Surface material is required")
    if not app.estimated_date: errors.append("Estimated construction date is required")
    if app.number_of_crossovers and app.number_of_crossovers > 1:
        if (app.lot_frontage or 0) <= 20:
            errors.append("Dual crossover requires frontage > 20m")
    # Check required docs
    doc_cats = {d.category for d in app.documents}
    if "site_plan" not in doc_cats: errors.append("Scaled Site Plan is required")
    if "certificate_title" not in doc_cats: errors.append("Certificate of Title is required")
    return errors


def _ai_review(app: CrossoverApplication) -> list[AIReviewItem]:
    """Run AI pre-submit checks and return results."""
    checks = []
    f = app.lot_frontage or 0
    w = app.crossover_width or 0
    cnt = app.number_of_crossovers or 1
    rt = app.road_type or "local"

    # Width checks
    max_w = 4.5 if f <= 12.5 else 6.0
    if w >= 3.0:
        checks.append(AIReviewItem(check="Minimum width", status="pass", message=f"Width {w}m meets 3.0m minimum"))
    else:
        checks.append(AIReviewItem(check="Minimum width", status="fail", message=f"Width {w}m below 3.0m minimum"))

    if w <= max_w:
        checks.append(AIReviewItem(check="Maximum width", status="pass", message=f"Width {w}m within {max_w}m max for {f}m frontage"))
    else:
        checks.append(AIReviewItem(check="Maximum width", status="fail", message=f"Width {w}m exceeds {max_w}m max for {f}m frontage"))

    # Dual crossover
    if cnt > 1:
        if f > 20:
            checks.append(AIReviewItem(check="Dual crossover", status="pass", message=f"Frontage {f}m > 20m — dual permitted"))
        else:
            checks.append(AIReviewItem(check="Dual crossover", status="fail", message=f"Frontage {f}m ≤ 20m — dual not permitted"))
    else:
        checks.append(AIReviewItem(check="Crossover count", status="pass", message="Single crossover"))

    # Road referral
    if rt == "red":
        checks.append(AIReviewItem(check="MRWA referral", status="warning", message="Red road — MRWA referral will be required"))
    elif rt == "blue":
        checks.append(AIReviewItem(check="DPLH referral", status="warning", message="Blue road — DPLH referral will be required"))
    else:
        checks.append(AIReviewItem(check="Road type", status="pass", message="Local road — no referral needed"))

    # Trees
    if app.has_trees_nearby:
        if app.tree_protection_plan:
            checks.append(AIReviewItem(check="Tree protection", status="pass", message="Tree protection plan provided"))
        else:
            checks.append(AIReviewItem(check="Tree protection", status="warning", message="Trees nearby but no protection plan — may be requested"))
    else:
        checks.append(AIReviewItem(check="Vegetation", status="pass", message="No trees nearby"))

    # Clearing
    if app.vegetation_cleared:
        checks.append(AIReviewItem(check="Clearing permit", status="fail", message="Vegetation clearing requires DWER permit"))
    else:
        checks.append(AIReviewItem(check="Clearing", status="pass", message="No clearing proposed"))

    # Documents
    doc_cats = {d.category for d in app.documents}
    for req_cat, label in [("site_plan", "Scaled Site Plan"), ("certificate_title", "Certificate of Title")]:
        if req_cat in doc_cats:
            checks.append(AIReviewItem(check=label, status="pass", message=f"{label} uploaded"))
        else:
            checks.append(AIReviewItem(check=label, status="fail", message=f"{label} is required — please upload"))

    # Contribution
    if app.da_number:
        checks.append(AIReviewItem(check="Contribution", status="info", message="DA-linked crossover — not eligible for Council contribution"))
    elif app.existing_crossover:
        checks.append(AIReviewItem(check="Contribution", status="info", message="Existing crossover — contribution may not apply"))
    else:
        checks.append(AIReviewItem(check="Contribution", status="pass", message="First crossover — may be eligible for up to $474 contribution"))

    # Owner details
    if app.owner_name and app.owner_phone and app.owner_email:
        checks.append(AIReviewItem(check="Owner details", status="pass", message="All contact details provided"))
    else:
        checks.append(AIReviewItem(check="Owner details", status="fail", message="Owner name, phone and email are all required"))

    return checks

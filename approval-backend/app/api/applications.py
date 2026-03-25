from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status, Request
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.core.config import get_settings
from app.models.user import User
from app.models.application import Application, ApplicationNote, Document, Inspection, Report
from app.schemas import (
    ApplicationCreate, ApplicationUpdate, ApplicationOut, ApplicationListOut,
    ChecklistUpdate, NoteCreate, NoteOut, DocumentCreate, DocumentOut, DocumentUpdate,
    InspectionCreate, InspectionUpdate, InspectionOut,
    ReportOut, ReportListOut,
)

router = APIRouter(prefix="/applications", tags=["Applications"])


def _gen_ref_number(db: Session) -> str:
    """Generate next sequential ref number CX-YYYY-NNNN."""
    year = datetime.now().year
    last = (
        db.query(Application)
        .filter(Application.ref_number.like(f"CX-{year}-%"))
        .order_by(Application.ref_number.desc())
        .first()
    )
    if last:
        seq = int(last.ref_number.split("-")[-1]) + 1
    else:
        seq = 1
    return f"CX-{year}-{seq:04d}"


# ─── List Applications (role-filtered) ──────────────────
@router.get("/", response_model=list[ApplicationListOut])
def list_applications(
    status_filter: str = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Application).options(joinedload(Application.assigned_officer))

    # Engineers only see their assigned cases
    if current_user.role == "engineer":
        q = q.filter(Application.officer_id == current_user.id)

    if status_filter:
        q = q.filter(Application.status == status_filter)

    apps = q.order_by(Application.submitted_date.desc()).all()

    return [
        ApplicationListOut(
            id=a.id,
            ref_number=a.ref_number,
            submitted_date=a.submitted_date,
            status=a.status,
            owner_name=a.owner_name,
            property_address=a.property_address,
            officer_name=a.assigned_officer.name if a.assigned_officer else None,
        )
        for a in apps
    ]


# ─── Get Single Application ─────────────────────────────
@router.get("/{app_id}", response_model=ApplicationOut)
def get_application(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = (
        db.query(Application)
        .options(
            joinedload(Application.assigned_officer),
            joinedload(Application.notes).joinedload(ApplicationNote.author),
            joinedload(Application.documents).joinedload(Document.reviewed_by),
            joinedload(Application.inspections),
        )
        .filter(Application.id == app_id)
        .first()
    )
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Engineers can only view their own assigned cases
    if current_user.role == "engineer" and app.officer_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not assigned to this case")

    return ApplicationOut(
        **{c.name: getattr(app, c.name) for c in app.__table__.columns},
        officer_name=app.assigned_officer.name if app.assigned_officer else None,
        notes=[NoteOut(id=n.id, text=n.text, author_name=n.author.name if n.author else None, created_at=n.created_at) for n in app.notes],
        documents=[_build_doc_out(d) for d in app.documents],
        inspections=[InspectionOut.model_validate(i) for i in app.inspections],
    )


# ─── Create Application ─────────────────────────────────
@router.post("/", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(data: ApplicationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), request: Request = None):
    from app.services.audit import log_audit
    ref = _gen_ref_number(db)
    app = Application(ref_number=ref, **data.model_dump())
    db.add(app)
    db.commit()
    db.refresh(app)
    log_audit(db=db, action="create", entity_type="application", user=current_user, entity_id=str(app.id), entity_ref=ref, description=f"Created application {ref} for {data.property_address}", request=request)
    return get_application(app.id, db, current_user)


# ─── Update Application (status, assignment, checklist) ──
@router.patch("/{app_id}", response_model=ApplicationOut)
def update_application(app_id: int, data: ApplicationUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), request: Request = None):
    from app.services.audit import log_audit
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    update_data = data.model_dump(exclude_unset=True)

    # Only managers/admins can change status or assignment
    if current_user.role == "engineer":
        restricted = {"status", "officer_id", "contribution_eligible", "contribution_amount"}
        if restricted & set(update_data.keys()):
            raise HTTPException(status_code=403, detail="Engineers cannot change status or assignment")

    # Track changes for audit
    changes = {}
    for key, value in update_data.items():
        old_val = getattr(app, key, None)
        if old_val != value:
            changes[key] = {"old": str(old_val) if old_val is not None else None, "new": str(value) if value is not None else None}
        setattr(app, key, value)

    db.commit()
    db.refresh(app)
    if changes:
        log_audit(db=db, action="update", entity_type="application", user=current_user, entity_id=str(app.id), entity_ref=app.ref_number, description=f"Updated {', '.join(changes.keys())}", field_changes=changes, request=request)
    return get_application(app.id, db, current_user)


# ─── Assign Officer (manager/admin only) ─────────────────
@router.post("/{app_id}/assign/{officer_id}", response_model=ApplicationOut)
def assign_officer(
    app_id: int,
    officer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    officer = db.query(User).filter(User.id == officer_id, User.is_active == True).first()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found or inactive")

    app.officer_id = officer_id
    if app.status == "pending_review":
        app.status = "under_assessment"
    db.commit()
    db.refresh(app)
    from app.services.audit import log_audit
    log_audit(db=db, action="assign_officer", entity_type="application", user=current_user, entity_id=str(app.id), entity_ref=app.ref_number, description=f"Assigned officer {officer.name} to {app.ref_number}", field_changes={"officer_id": {"old": None, "new": str(officer_id)}})
    return get_application(app.id, db, current_user)


# ─── Update Checklist ────────────────────────────────────
@router.patch("/{app_id}/checklist", response_model=ApplicationOut)
def update_checklist(app_id: int, data: ChecklistUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Merge checklist data
    existing = app.checklist_data or {}
    existing.update(data.checklist_data)
    app.checklist_data = existing
    db.commit()
    db.refresh(app)
    return get_application(app.id, db, current_user)


# ─── Notes ───────────────────────────────────────────────
@router.post("/{app_id}/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def add_note(app_id: int, data: NoteCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    note = ApplicationNote(application_id=app_id, author_id=current_user.id, text=data.text)
    db.add(note)
    db.commit()
    db.refresh(note)
    return NoteOut(id=note.id, text=note.text, author_name=current_user.name, created_at=note.created_at)


# ─── Documents ───────────────────────────────────────────

def _build_doc_out(d: Document) -> DocumentOut:
    """Build a DocumentOut with reviewed_by_name resolved from relationship."""
    return DocumentOut(
        id=d.id, name=d.name, file_type=d.file_type, file_size=d.file_size,
        category=d.category, status=d.status, file_path=d.file_path,
        review_note=d.review_note,
        reviewed_by_name=d.reviewed_by.name if d.reviewed_by else None,
        reviewed_at=d.reviewed_at,
        uploaded_at=d.uploaded_at,
    )

@router.get("/{app_id}/documents", response_model=list[DocumentOut])
def list_documents(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    docs = db.query(Document).filter(Document.application_id == app_id).options(joinedload(Document.reviewed_by)).order_by(Document.uploaded_at.desc()).all()
    return [_build_doc_out(d) for d in docs]


@router.post("/{app_id}/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def add_document(app_id: int, data: DocumentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    doc = Document(application_id=app_id, uploaded_by_id=current_user.id, **data.model_dump())
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{app_id}/documents/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    app_id: int,
    file: UploadFile = File(...),
    category: str = Form("Other"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload an actual file and save it to disk under {DOCUMENT_DIR}/{ref_number}/."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    settings = get_settings()
    # Create subfolder: {DOCUMENT_DIR}/{ref_number}/
    app_dir = Path(settings.DOCUMENT_DIR) / app.ref_number
    app_dir.mkdir(parents=True, exist_ok=True)

    # Sanitise filename, keep original name
    safe_name = file.filename.replace("/", "_").replace("\\", "_").replace("..", "_")
    dest_path = app_dir / safe_name

    # If file already exists, add a suffix
    if dest_path.exists():
        stem = dest_path.stem
        suffix = dest_path.suffix
        counter = 1
        while dest_path.exists():
            dest_path = app_dir / f"{stem}_{counter}{suffix}"
            counter += 1

    # Write file to disk
    file_bytes = await file.read()
    file_size = len(file_bytes)
    with open(dest_path, "wb") as f:
        f.write(file_bytes)

    # Determine file type from extension
    file_ext = (safe_name.rsplit(".", 1)[-1] if "." in safe_name else "").lower()

    # Format size string
    if file_size < 1024:
        size_str = f"{file_size} B"
    elif file_size < 1048576:
        size_str = f"{file_size / 1024:.1f} KB"
    else:
        size_str = f"{file_size / 1048576:.1f} MB"

    # Create document record with file_path
    doc = Document(
        application_id=app_id,
        uploaded_by_id=current_user.id,
        name=safe_name,
        file_type=file_ext,
        file_size=size_str,
        category=category,
        file_path=str(dest_path),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # Auto AI analysis for site plan uploads (if enabled in settings)
    if "site" in category.lower() or "plan" in category.lower():
        from app.services.ai_config import get_ai_config
        ai_cfg = get_ai_config(db)
        if ai_cfg.auto_analyse:
            try:
                _run_site_plan_ai(app, doc, file_bytes, db, ai_cfg)
            except Exception as e:
                print(f"  ⚠ Auto site plan AI failed: {e}")

    from app.services.audit import log_audit
    log_audit(db=db, action="upload", entity_type="document", user=current_user, entity_id=str(doc.id), entity_ref=app.ref_number, description=f"Uploaded {safe_name} ({size_str}) to {app.ref_number}, category={category}")
    return _build_doc_out(doc)


@router.post("/{app_id}/documents/{doc_id}/extract-siteplan")
async def extract_siteplan_pages(
    app_id: int, doc_id: int,
    pages: str = Query(..., description="Comma-separated page numbers, e.g. '3,4'"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Extract specific pages from a document as a new Site Plan, then run AI analysis."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    # Parse page numbers
    try:
        page_nums = [int(p.strip()) for p in pages.split(",") if p.strip()]
    except ValueError:
        raise HTTPException(400, "Invalid page numbers — use comma-separated integers e.g. '3,4'")
    if not page_nums:
        raise HTTPException(400, "No page numbers provided")

    file_bytes = file_path.read_bytes()

    from app.services.building_app_processor import extract_pdf_pages, _count_pdf_pages
    total_pages = _count_pdf_pages(file_bytes)
    invalid = [p for p in page_nums if p < 1 or p > total_pages]
    if invalid:
        raise HTTPException(400, f"Invalid pages {invalid} — document has {total_pages} pages")

    # Extract pages
    sp_bytes = extract_pdf_pages(file_bytes, page_nums)
    sp_filename = f"SitePlan_p{'_'.join(str(p) for p in page_nums)}_{doc.name}"

    settings = get_settings()
    app_dir = Path(settings.DOCUMENT_DIR) / app.ref_number
    app_dir.mkdir(parents=True, exist_ok=True)
    sp_path = app_dir / sp_filename
    counter = 1
    while sp_path.exists():
        sp_path = app_dir / f"SitePlan_{counter}_p{'_'.join(str(p) for p in page_nums)}_{doc.name}"
        counter += 1

    with open(sp_path, "wb") as f:
        f.write(sp_bytes)

    sp_size = len(sp_bytes)
    size_str = f"{sp_size / 1024:.1f} KB" if sp_size < 1048576 else f"{sp_size / 1048576:.1f} MB"

    sp_doc = Document(
        application_id=app_id,
        uploaded_by_id=current_user.id,
        name=sp_filename,
        file_type="pdf",
        file_size=size_str,
        category="Site Plan",
        file_path=str(sp_path),
    )
    db.add(sp_doc)
    db.commit()
    db.refresh(sp_doc)

    from app.services.audit import log_audit
    log_audit(db=db, action="extract_siteplan", entity_type="document", user=current_user,
              entity_id=str(sp_doc.id), entity_ref=app.ref_number,
              description=f"Extracted pages {page_nums} from {doc.name} as site plan")

    return {
        "success": True,
        "site_plan_doc_id": sp_doc.id,
        "filename": sp_filename,
        "pages_extracted": page_nums,
        "total_pages": total_pages,
        "message": f"Extracted page(s) {', '.join(str(p) for p in page_nums)} as site plan.",
    }


def _run_site_plan_ai(app, doc, file_bytes: bytes, db: Session, ai_cfg=None):
    """Run AI analysis using configured mode (claude / yolo / hybrid)."""
    from app.services.ai_analyser import analyse_document, save_training_sample
    from app.services.ai_config import get_ai_config
    settings = get_settings()

    if ai_cfg is None:
        ai_cfg = get_ai_config(db)

    findings = None

    # ── YOLO-first modes ──
    if ai_cfg.mode in ("yolo", "hybrid") and ai_cfg.yolo_model_path:
        findings = _run_yolo_inference(file_bytes, doc.name, ai_cfg)
        if findings and ai_cfg.mode == "hybrid":
            # Check confidence — fallback to Claude if too low
            conf = findings.get("_yolo_confidence", 0)
            if conf < ai_cfg.yolo_confidence and ai_cfg.fallback_to_claude:
                print(f"  ℹ YOLO confidence {conf:.2f} < {ai_cfg.yolo_confidence} — falling back to Claude")
                findings = None  # will fall through to Claude below

    # ── Claude mode (or fallback) ──
    if findings is None:
        if not settings.ANTHROPIC_API_KEY:
            return
        findings = analyse_document(
            file_bytes=file_bytes,
            filename=doc.name,
            api_key=settings.ANTHROPIC_API_KEY,
            model=ai_cfg.claude_model,
        )

    if findings and "error" not in findings:
        clean = {k: v for k, v in findings.items() if not k.startswith("_")}
        app.org_site_plan_data = clean   # Original AI extraction — never modified
        app.site_plan_data = clean       # Active copy — assessment reads this
        # cor_site_plan_data stays null until officer corrects
        db.commit()

        try:
            save_training_sample(
                application_id=app.id,
                document_id=doc.id,
                findings=findings,
                file_bytes=file_bytes,
                filename=doc.name,
            )
        except Exception as e:
            print(f"  ⚠ Training data capture failed: {e}")

        mode_label = ai_cfg.mode.upper()
        print(f"  ✓ AI analysis complete for {app.ref_number} (mode={mode_label})")


def _run_yolo_inference(file_bytes: bytes, filename: str, ai_cfg) -> dict | None:
    """Run YOLO model inference on a site plan image. Returns findings dict or None."""
    try:
        from pathlib import Path
        model_path = Path(ai_cfg.yolo_model_path)
        if not model_path.exists():
            print(f"  ⚠ YOLO model not found: {model_path}")
            return None

        from ultralytics import YOLO
        model = YOLO(str(model_path))

        # Convert file to image
        from app.services.ai_analyser import file_to_images_from_upload
        from app.core.config import get_settings
        s = get_settings()
        images = file_to_images_from_upload(file_bytes, filename, max_dim=s.MAX_IMAGE_DIM)
        if not images:
            return None

        import base64, io
        from PIL import Image
        img_bytes = base64.standard_b64decode(images[0]["base64"])
        img = Image.open(io.BytesIO(img_bytes))

        results = model.predict(img, conf=ai_cfg.yolo_confidence)
        if not results or len(results[0].boxes) == 0:
            return None

        # Build extraction from YOLO detections
        detections = []
        max_conf = 0
        for box in results[0].boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            max_conf = max(max_conf, conf)
            detections.append({
                "class": results[0].names[cls_id],
                "confidence": round(conf, 3),
                "bbox": box.xyxy[0].tolist(),
            })

        return {
            "schema_version": "1.0",
            "analyser_version": "yolo-1.0",
            "ai_provider": "YOLO",
            "ai_model": str(ai_cfg.yolo_model_path),
            "source_file": filename,
            "extraction": {"yolo_detections": detections},
            "compliance": {},
            "_yolo_confidence": max_conf,
            "_page_images": images,
        }
    except ImportError:
        print("  ⚠ ultralytics not installed — YOLO mode unavailable")
        return None
    except Exception as e:
        print(f"  ⚠ YOLO inference error: {e}")
        return None


@router.post("/{app_id}/documents/{doc_id}/analyse")
async def analyse_document_endpoint(
    app_id: int, doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually trigger AI analysis on an uploaded document + save training data + run assessment."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")

    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found or no file on disk")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    file_bytes = file_path.read_bytes()
    _run_site_plan_ai(app, doc, file_bytes, db)

    if not app.site_plan_data or "error" in (app.site_plan_data or {}):
        settings = get_settings()
        if not settings.ANTHROPIC_API_KEY:
            raise HTTPException(400, "AI analysis unavailable — no ANTHROPIC_API_KEY configured")
        return {"success": False, "error": "Analysis failed"}

    # Auto-run assessment
    from app.api.assessments import _ensure_case_rows, _auto_assess_item
    from app.models.assessment import CaseAssessment
    from sqlalchemy.orm import joinedload as jl
    _ensure_case_rows(db, app_id)
    results = db.query(CaseAssessment).filter(CaseAssessment.application_id == app_id).options(jl(CaseAssessment.item)).all()
    now = datetime.now(timezone.utc)
    for ca in results:
        ai_result, confidence, reason = _auto_assess_item(ca.item.code, app, db)
        ca.ai_result = ai_result
        ca.ai_confidence = confidence
        ca.ai_reason = reason
        ca.ai_assessed_at = now
    db.commit()

    comp = (app.site_plan_data or {}).get("compliance", {})
    return {
        "success": True,
        "recommendation": comp.get("recommendation", "N/A"),
        "summary": comp.get("summary", {}),
        "assessment_updated": len(results),
    }


@router.patch("/{app_id}/site-plan-correction")
def correct_site_plan(
    app_id: int,
    corrections: dict,  # {"crossover_dimensions.width_at_boundary_m": "3.8", ...}
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
    request: Request = None,
):
    """
    Officer corrects AI extraction values.
    Updates cor_site_plan_data and site_plan_data (active copy used by assessment).
    Then re-runs auto-assess on all checklist items.

    Body: {"field.path": "corrected_value", ...}
    e.g. {"crossover_dimensions.width_at_boundary_m": "3.8", "construction.material": "Concrete"}
    """
    from app.services.audit import log_audit
    from app.api.assessments import _ensure_case_rows, _auto_assess_item
    from app.models.assessment import CaseAssessment
    from sqlalchemy.orm import joinedload as jl

    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")

    # Start from current corrected data, or original, or current active
    import copy
    base = copy.deepcopy(app.cor_site_plan_data or app.org_site_plan_data or app.site_plan_data or {})
    extraction = base.get("extraction", {})

    # Apply corrections to extraction using dot-path keys
    changes = {}
    for field_path, new_value in corrections.items():
        parts = field_path.split(".")
        obj = extraction
        for part in parts[:-1]:
            if part not in obj or not isinstance(obj[part], dict):
                obj[part] = {}
            obj = obj[part]
        old_value = obj.get(parts[-1])
        # Try to preserve type
        if isinstance(old_value, (int, float)) and new_value not in (None, "", "null"):
            try:
                new_value = float(new_value)
                if new_value == int(new_value):
                    new_value = int(new_value)
            except (ValueError, TypeError):
                pass
        elif isinstance(old_value, bool):
            new_value = str(new_value).lower() in ("true", "1", "yes")
        obj[parts[-1]] = new_value
        changes[field_path] = {"old": str(old_value), "new": str(new_value)}

    base["extraction"] = extraction

    # Re-run compliance check with corrected data
    from app.services.ai_analyser import check_compliance
    base["compliance"] = check_compliance(extraction)
    base["corrected_by"] = current_user.name
    base["corrected_at"] = datetime.now(timezone.utc).isoformat()

    # Save corrected version and update active copy
    app.cor_site_plan_data = base
    app.site_plan_data = base  # Assessment engine reads this
    db.commit()

    # Re-run auto-assess
    _ensure_case_rows(db, app_id)
    results = db.query(CaseAssessment).filter(CaseAssessment.application_id == app_id).options(jl(CaseAssessment.item)).all()
    now = datetime.now(timezone.utc)
    assessed = 0
    for ca in results:
        ai_result, confidence, reason = _auto_assess_item(ca.item.code, app, db)
        ca.ai_result = ai_result
        ca.ai_confidence = confidence
        ca.ai_reason = reason
        ca.ai_assessed_at = now
        assessed += 1
    db.commit()

    log_audit(db=db, action="correct_extraction", entity_type="application", user=current_user,
              entity_id=str(app.id), entity_ref=app.ref_number,
              description=f"Corrected {len(changes)} extraction value(s), re-ran assessment",
              field_changes=changes, request=request)

    return {
        "success": True,
        "corrections_applied": len(changes),
        "assessment_items_updated": assessed,
        "recommendation": base.get("compliance", {}).get("recommendation", "N/A"),
    }


@router.patch("/{app_id}/site-plan-corrections")
def apply_site_plan_corrections(
    app_id: int,
    corrections: list[dict],  # [{"field_path": "crossover_dimensions.width_at_boundary_m", "value": "3.8"}]
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """
    Officer corrects AI extraction values.
    Updates cor_site_plan_data and site_plan_data (active copy used by assessment).
    Then re-runs auto-assessment on all checklist items.
    """
    from app.services.audit import log_audit
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    if not app.site_plan_data:
        raise HTTPException(400, "No site plan data to correct")

    # Start from current corrected data, or original if no corrections yet
    import copy
    corrected = copy.deepcopy(app.cor_site_plan_data or app.org_site_plan_data or app.site_plan_data)
    extraction = corrected.get("extraction", {})

    changes = {}
    for c in corrections:
        path = c.get("field_path", "")
        new_val = c.get("value")
        parts = path.split(".")
        if len(parts) == 2:
            group, field = parts
            if group not in extraction:
                extraction[group] = {}
            old_val = extraction[group].get(field)
            extraction[group][field] = _parse_correction_value(new_val)
            changes[path] = {"old": str(old_val), "new": str(new_val)}

    corrected["extraction"] = extraction
    corrected["_corrected_by"] = current_user.name
    corrected["_corrected_at"] = datetime.now(timezone.utc).isoformat()

    app.cor_site_plan_data = corrected
    # site_plan_data keeps the original AI extraction — assessment reads cor first
    db.commit()

    # Re-run auto-assessment
    from app.api.assessments import _ensure_case_rows, _auto_assess_item
    from app.models.assessment import CaseAssessment
    from sqlalchemy.orm import joinedload as jl
    _ensure_case_rows(db, app_id)
    results = db.query(CaseAssessment).filter(CaseAssessment.application_id == app_id).options(jl(CaseAssessment.item)).all()
    now = datetime.now(timezone.utc)
    for ca in results:
        ai_result, confidence, reason = _auto_assess_item(ca.item.code, app, db)
        ca.ai_result = ai_result
        ca.ai_confidence = confidence
        ca.ai_reason = reason
        ca.ai_assessed_at = now
    db.commit()

    log_audit(db=db, action="correct_extraction", entity_type="application", user=current_user,
              entity_id=str(app.id), entity_ref=app.ref_number,
              description=f"Corrected {len(changes)} extraction values, re-ran assessment",
              field_changes=changes)

    return {"corrected_fields": len(changes), "assessment_updated": len(results)}


def _parse_correction_value(val):
    """Parse a correction value string into the appropriate type."""
    if val is None:
        return None
    if isinstance(val, (int, float, bool)):
        return val
    s = str(val).strip()
    if s.lower() in ("true", "yes"):
        return True
    if s.lower() in ("false", "no"):
        return False
    try:
        return float(s)
    except ValueError:
        return s


@router.get("/{app_id}/documents/{doc_id}/file")
def download_document(
    app_id: int, doc_id: int,
    token: str = Query(None, description="Bearer token (for iframe/new window access)"),
    db: Session = Depends(get_db),
):
    """Serve the uploaded document file for viewing/downloading."""
    from fastapi.responses import FileResponse
    from app.core.auth import get_current_user as _get_user
    from jose import jwt as jose_jwt, JWTError as JoseJWTError

    # Authenticate via query token (for iframe) or normal auth header
    if token:
        try:
            settings = get_settings()
            payload = jose_jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(401, "Invalid token")
            user = db.query(User).filter(User.id == int(user_id), User.is_active == True).first()
            if not user:
                raise HTTPException(401, "Invalid token")
        except Exception:
            raise HTTPException(401, "Invalid token")
    else:
        raise HTTPException(401, "Token required — pass ?token=... for document viewing")

    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.file_path:
        raise HTTPException(status_code=404, detail="No file on disk for this document")
    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    ext = (doc.file_type or "").lower()
    media_types = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "doc": "application/msword", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
    media_type = media_types.get(ext, "application/octet-stream")

    from app.services.audit import log_audit
    log_audit(db=db, action="download", entity_type="document", user=user, entity_id=str(doc.id), description=f"Downloaded {doc.name}")
    return FileResponse(file_path, media_type=media_type, filename=doc.name)


@router.get("/{app_id}/documents/{doc_id}/render")
def render_document_as_image(
    app_id: int, doc_id: int,
    page: int = Query(1, description="Page number (1-based)"),
    token: str = Query(None, description="Bearer token"),
    db: Session = Depends(get_db),
):
    """Render a document page as PNG image (for PDF → image conversion)."""
    from fastapi.responses import Response
    from jose import jwt as jose_jwt

    # Auth
    if not token:
        raise HTTPException(401, "Token required")
    try:
        settings = get_settings()
        payload = jose_jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user = db.query(User).filter(User.id == int(payload.get("sub", 0)), User.is_active == True).first()
        if not user:
            raise HTTPException(401, "Invalid token")
    except Exception:
        raise HTTPException(401, "Invalid token")

    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    ext = (doc.file_type or "").lower()

    # If already an image, serve directly
    if ext in ("jpg", "jpeg", "png", "gif", "webp"):
        return Response(content=file_path.read_bytes(), media_type=f"image/{ext}")

    # PDF → render page as PNG
    if ext == "pdf":
        try:
            from pdf2image import convert_from_bytes
            images = convert_from_bytes(file_path.read_bytes(), dpi=150, first_page=page, last_page=page)
            if not images:
                raise HTTPException(404, f"Page {page} not found")
            import io
            buf = io.BytesIO()
            images[0].save(buf, format="PNG")
            return Response(content=buf.getvalue(), media_type="image/png")
        except ImportError:
            raise HTTPException(500, "pdf2image not installed")
        except Exception as e:
            raise HTTPException(500, f"Render failed: {e}")

    raise HTTPException(400, f"Cannot render .{ext} files as images")


@router.patch("/{app_id}/documents/{doc_id}", response_model=DocumentOut)
def update_document(app_id: int, doc_id: int, data: DocumentUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).options(joinedload(Document.reviewed_by)).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    now = datetime.now(timezone.utc)
    update_data = data.model_dump(exclude_unset=True)

    if "status" in update_data:
        doc.status = update_data["status"]
        doc.reviewed_by_id = current_user.id
        doc.reviewed_at = now
    if "review_note" in update_data:
        doc.review_note = update_data["review_note"]
        doc.reviewed_by_id = current_user.id
        doc.reviewed_at = now

    db.commit()
    db.refresh(doc)
    return _build_doc_out(doc)


@router.put("/{app_id}/boundaries")
def save_boundaries(
    app_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save officer-drawn boundaries and compute lat/lng using lot_polygon as geo-reference."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")

    # Save pixel coordinates (ensure plain Python types)
    def clean_poly(poly):
        if not poly:
            return poly
        return [[round(float(p[0])), round(float(p[1]))] for p in poly]

    if "site_lot_boundary" in data:
        app.site_lot_boundary = clean_poly(data["site_lot_boundary"])
    if "site_building_boundary" in data:
        app.site_building_boundary = clean_poly(data["site_building_boundary"])
    if "site_crossover" in data:
        app.site_crossover = clean_poly(data["site_crossover"])

    # ── Geo-reference: map pixel lot boundary → real lot_polygon → affine transform ──
    pixel_lot = data.get("site_lot_boundary", app.site_lot_boundary) or []
    real_lot = app.lot_polygon or []  # [[lat,lng], ...] from lot.geojson

    latlon_results = {}

    if len(pixel_lot) >= 3 and len(real_lot) >= 3:
        import numpy as np

        # Remove closing points (first == last) for matching
        px_open = list(pixel_lot)
        if len(px_open) > 3 and px_open[0][0] == px_open[-1][0] and px_open[0][1] == px_open[-1][1]:
            px_open = px_open[:-1]

        re_open = list(real_lot)
        if len(re_open) > 3 and re_open[0] == re_open[-1]:
            re_open = re_open[:-1]

        n_px = len(px_open)
        n_re = len(re_open)

        if n_px >= 3 and n_re >= 3:
            # Resample: pick n_px evenly-spaced points from real polygon
            # This handles officer drawing 4 corners when lot has 20+ points
            if n_px < n_re:
                # Officer drew fewer points — sample real polygon at matching intervals
                indices = [round(i * (n_re - 1) / (n_px - 1)) for i in range(n_px)]
                real_pts = [re_open[i] for i in indices]
            elif n_px > n_re:
                # Officer drew more points — sample pixel polygon to match
                indices = [round(i * (n_px - 1) / (n_re - 1)) for i in range(n_re)]
                px_open = [px_open[i] for i in indices]
                real_pts = re_open
            else:
                real_pts = re_open

            pixel_pts = [(p[0], p[1]) for p in px_open[:len(real_pts)]]
            real_pts = [(p[0], p[1]) for p in real_pts[:len(pixel_pts)]]

            # Build least-squares affine: lat = a*x + b*y + c, lng = d*x + e*y + f
            A = np.array([[px[0], px[1], 1] for px in pixel_pts])
            lat_vec = np.array([rp[0] for rp in real_pts])
            lng_vec = np.array([rp[1] for rp in real_pts])

            try:
                lat_params, _, _, _ = np.linalg.lstsq(A, lat_vec, rcond=None)
                lng_params, _, _, _ = np.linalg.lstsq(A, lng_vec, rcond=None)

                def px_to_latlon(px_point):
                    x, y = float(px_point[0]), float(px_point[1])
                    lat = float(lat_params[0]) * x + float(lat_params[1]) * y + float(lat_params[2])
                    lng = float(lng_params[0]) * x + float(lng_params[1]) * y + float(lng_params[2])
                    return [round(lat, 7), round(lng, 7)]

                # Convert all boundaries to latlon
                for key in ["site_lot_boundary", "site_building_boundary", "site_crossover"]:
                    px_poly = data.get(key, getattr(app, key, None)) or []
                    if len(px_poly) >= 3:
                        ll_poly = [px_to_latlon(p) for p in px_poly]
                        # Ensure closed polygon
                        if len(ll_poly) >= 3 and ll_poly[0] != ll_poly[-1]:
                            ll_poly.append([ll_poly[0][0], ll_poly[0][1]])
                        setattr(app, f"{key}_latlon", ll_poly)
                        latlon_results[f"{key}_latlon"] = ll_poly

                # For lot boundary latlon, use the sampled real polygon points (most accurate)
                if "site_lot_boundary_latlon" in latlon_results:
                    lot_closed = [[round(float(p[0]), 7), round(float(p[1]), 7)] for p in real_pts]
                    if lot_closed and lot_closed[0] != lot_closed[-1]:
                        lot_closed.append([lot_closed[0][0], lot_closed[0][1]])
                    app.site_lot_boundary_latlon = lot_closed

            except Exception as e:
                print(f"  ⚠ Affine transform failed: {e}")

    db.commit()

    from app.services.audit import log_audit
    saved = [k for k in ["site_lot_boundary", "site_building_boundary", "site_crossover"] if k in data]
    log_audit(db=db, action="save_boundaries", entity_type="application", user=current_user,
              entity_id=str(app_id), entity_ref=app.ref_number,
              description=f"Saved boundary data: {', '.join(saved)}. Latlon computed: {bool(latlon_results)}")

    return {"saved": saved, "latlon_computed": bool(latlon_results), "latlon_keys": list(latlon_results.keys())}


@router.delete("/{app_id}/documents/{doc_id}", status_code=200)
def delete_document(app_id: int, doc_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(require_role("admin", "manager", "engineer"))):
    """Delete a document, its file, and all related data (training samples, site plan data)."""
    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_name = doc.name
    doc_category = doc.category
    cleaned = []

    # 1. Delete AI training samples referencing this document
    from app.models.ai_training import AITrainingSample, AITrainingCorrection
    training_samples = db.query(AITrainingSample).filter(AITrainingSample.document_id == doc_id).all()
    if training_samples:
        for ts in training_samples:
            # Delete corrections for each sample
            db.query(AITrainingCorrection).filter(AITrainingCorrection.sample_id == ts.id).delete()
            # Delete training image from disk
            if ts.image_path:
                img_path = Path(ts.image_path)
                if img_path.exists():
                    img_path.unlink()
        count = db.query(AITrainingSample).filter(AITrainingSample.document_id == doc_id).delete()
        cleaned.append(f"{count} training sample(s)")

    # 2. If this is a site plan, clear site_plan_data on the application
    app = db.query(Application).filter(Application.id == app_id).first()
    if doc_category and "site" in doc_category.lower():
        if app:
            app.site_plan_data = None
            app.org_site_plan_data = None
            app.cor_site_plan_data = None
            cleaned.append("site plan analysis data")

    # 3. Delete file from disk
    if doc.file_path:
        file_path = Path(doc.file_path)
        if file_path.exists():
            file_path.unlink()
            cleaned.append("file from disk")

    # 4. Delete document record
    db.delete(doc)
    db.commit()

    # Audit
    from app.services.audit import log_audit
    log_audit(db=db, action="delete", entity_type="document", user=current_user,
              entity_id=str(doc_id), entity_ref=app.ref_number if app else None,
              description=f"Deleted document {doc_name} ({doc_category}). Cleaned: {', '.join(cleaned) if cleaned else 'none'}")

    return {"deleted": doc_name, "cleaned": cleaned}


# ─── Inspections ─────────────────────────────────────────
@router.post("/{app_id}/inspections", response_model=InspectionOut, status_code=status.HTTP_201_CREATED)
def schedule_inspection(app_id: int, data: InspectionCreate, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin", "manager"))):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    insp = Inspection(application_id=app_id, **data.model_dump())
    db.add(insp)
    db.commit()
    db.refresh(insp)
    return insp


@router.patch("/{app_id}/inspections/{insp_id}", response_model=InspectionOut)
def update_inspection(app_id: int, insp_id: int, data: InspectionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    insp = db.query(Inspection).filter(Inspection.id == insp_id, Inspection.application_id == app_id).first()
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(insp, key, value)
    db.commit()
    db.refresh(insp)
    return insp

# ─── Reports (versioned snapshots) ───────────────────────
@router.post("/{app_id}/reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def generate_report(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Generate a new versioned report snapshot for an application."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Compute next version number
    last_version = (
        db.query(Report.version)
        .filter(Report.application_id == app_id)
        .order_by(Report.version.desc())
        .first()
    )
    version = (last_version[0] + 1) if last_version else 1

    # Snapshot assessment data
    from app.models.assessment import CaseAssessment, AssessmentItem
    case_results = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id)
        .options(joinedload(CaseAssessment.item))
        .all()
    )

    checklist_snap = {}
    ai_pass = ai_fail = ai_review = off_approved = off_rejected = 0
    for ca in case_results:
        code = ca.item.code if ca.item else str(ca.item_id)
        checklist_snap[code] = {
            "ai_result": ca.ai_result,
            "ai_confidence": ca.ai_confidence,
            "ai_reason": ca.ai_reason,
            "officer_result": ca.officer_result,
            "status": ca.status,
            "note": ca.note,
        }
        if ca.ai_result == "pass": ai_pass += 1
        elif ca.ai_result == "fail": ai_fail += 1
        else: ai_review += 1
        if ca.officer_result == "approved": off_approved += 1
        elif ca.officer_result == "rejected": off_rejected += 1

    total = len(case_results)
    recommendation = "APPROVE" if ai_fail == 0 and off_rejected == 0 else "REJECT" if ai_fail > 3 else "REVIEW"

    summary = {
        "total": total, "ai_pass": ai_pass, "ai_review": ai_review, "ai_fail": ai_fail,
        "officer_approved": off_approved, "officer_rejected": off_rejected,
        "score_pct": round(ai_pass / total * 100, 1) if total > 0 else 0,
    }

    app_snap = {
        "ref_number": app.ref_number, "owner_name": app.owner_name,
        "property_address": app.property_address, "lot_number": app.lot_number,
        "plan_number": app.plan_number, "frontage": app.frontage,
        "road_name": app.road_name, "road_type": app.road_type,
        "crossover_width": app.crossover_width, "crossover_surface": app.crossover_surface,
        "crossover_count": app.crossover_count,
        "officer": app.assigned_officer.name if app.assigned_officer else None,
    }

    notes_snap = [
        {"text": n.text, "author": n.author.name if n.author else "—", "date": n.created_at.isoformat()}
        for n in app.notes
    ]

    report = Report(
        application_id=app_id, version=version, generated_by_id=current_user.id,
        status_at_generation=app.status, recommendation=recommendation,
        summary_data=summary, checklist_snapshot=checklist_snap,
        app_snapshot=app_snap, notes_snapshot=notes_snap,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return ReportOut(
        id=report.id, application_id=report.application_id, version=report.version,
        generated_by_name=current_user.name, status_at_generation=report.status_at_generation,
        recommendation=report.recommendation, summary_data=report.summary_data,
        checklist_snapshot=report.checklist_snapshot, app_snapshot=report.app_snapshot,
        notes_snapshot=report.notes_snapshot, created_at=report.created_at,
    )


@router.get("/{app_id}/reports", response_model=list[ReportListOut])
def list_reports(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all report versions for an application."""
    reports = (
        db.query(Report)
        .filter(Report.application_id == app_id)
        .options(joinedload(Report.generated_by))
        .order_by(Report.version.desc())
        .all()
    )
    return [
        ReportListOut(
            id=r.id, version=r.version,
            generated_by_name=r.generated_by.name if r.generated_by else None,
            recommendation=r.recommendation, summary_data=r.summary_data,
            created_at=r.created_at,
        )
        for r in reports
    ]


@router.get("/{app_id}/reports/{version}", response_model=ReportOut)
def get_report(app_id: int, version: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get a specific report version."""
    report = (
        db.query(Report)
        .filter(Report.application_id == app_id, Report.version == version)
        .options(joinedload(Report.generated_by))
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report version not found")
    return ReportOut(
        id=report.id, application_id=report.application_id, version=report.version,
        generated_by_name=report.generated_by.name if report.generated_by else None,
        status_at_generation=report.status_at_generation,
        recommendation=report.recommendation, summary_data=report.summary_data,
        checklist_snapshot=report.checklist_snapshot, app_snapshot=report.app_snapshot,
        notes_snapshot=report.notes_snapshot, created_at=report.created_at,
    )

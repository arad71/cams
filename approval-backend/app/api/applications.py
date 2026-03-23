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
    app.site_plan_data = corrected  # Active copy — assessment reads this
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

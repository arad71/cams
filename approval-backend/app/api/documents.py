"""
Document management, extraction, OCR, file serving, and boundary endpoints.

Split from applications.py for maintainability.
All endpoints use the /applications/{app_id}/documents prefix.
"""
from datetime import datetime, timezone
from pathlib import Path
import os
import shutil  # noqa: F401 — used conditionally
import copy
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.core.config import get_settings
from app.models.user import User
from app.models.application import Application, Document, Report
from app.schemas import DocumentCreate, DocumentOut, DocumentUpdate

router = APIRouter(prefix="/applications", tags=["Documents"])

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


@router.post("/{app_id}/documents/{doc_id}/extract-pages")
async def extract_pages_generic(
    app_id: int, doc_id: int,
    body: dict,  # {"pages": "1,2", "category": "Application Form", "method": "ai_live"|"ai_local"|"none"}
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Extract pages from a PDF as a new document of specified category, optionally run AI extraction."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    pages_str = body.get("pages", "")
    category = body.get("category", "Other Documents")
    method = body.get("method", "none")  # ai_live | ai_local | none

    # Parse page numbers
    try:
        page_nums = [int(p.strip()) for p in pages_str.split(",") if p.strip()]
    except ValueError:
        raise HTTPException(400, "Invalid page numbers")
    if not page_nums:
        raise HTTPException(400, "No page numbers provided")

    file_bytes = file_path.read_bytes()
    from app.services.building_app_processor import extract_pdf_pages, _count_pdf_pages
    total_pages = _count_pdf_pages(file_bytes)
    invalid = [p for p in page_nums if p < 1 or p > total_pages]
    if invalid:
        raise HTTPException(400, f"Invalid pages {invalid} — document has {total_pages} pages")

    # Extract pages as new PDF
    new_bytes = extract_pdf_pages(file_bytes, page_nums)
    cat_prefix = category.replace(" ", "")
    new_filename = f"{cat_prefix}_p{'_'.join(str(p) for p in page_nums)}_{doc.name}"

    settings = get_settings()
    app_dir = Path(settings.DOCUMENT_DIR) / app.ref_number
    app_dir.mkdir(parents=True, exist_ok=True)
    new_path = app_dir / new_filename
    counter = 1
    while new_path.exists():
        new_path = app_dir / f"{cat_prefix}_{counter}_p{'_'.join(str(p) for p in page_nums)}_{doc.name}"
        counter += 1

    with open(new_path, "wb") as f:
        f.write(new_bytes)

    size_str = f"{len(new_bytes) / 1024:.1f} KB" if len(new_bytes) < 1048576 else f"{len(new_bytes) / 1048576:.1f} MB"
    new_doc = Document(
        application_id=app_id, uploaded_by_id=current_user.id,
        name=new_filename, file_type="pdf", file_size=size_str,
        category=category, file_path=str(new_path),
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    from app.services.audit import log_audit
    log_audit(db=db, action="extract_pages", entity_type="document", user=current_user,
              entity_id=str(new_doc.id), entity_ref=app.ref_number,
              description=f"Extracted pages {page_nums} from {doc.name} as {category}")

    result = {
        "success": True, "doc_id": new_doc.id, "filename": new_filename,
        "pages_extracted": page_nums, "total_pages": total_pages, "category": category,
        "message": f"Extracted page(s) {', '.join(str(p) for p in page_nums)} as {category}.",
        "extraction": None,
    }

    # If Site Plan, run site plan AI analysis
    if category == "Site Plan" and method != "none":
        try:
            _run_site_plan_ai(app, new_doc, new_bytes, db)
            result["message"] += " AI analysis complete."
            result["analysed"] = True
        except Exception as e:
            result["analyseError"] = str(e)

    # If Application Form or Certificate of Title, run field extraction
    if category in ("Application Form", "Certificate of Title") and method != "none":
        try:
            extract_type = "certificate_of_title" if "Title" in category else "application_form"
            if method == "ai_live":
                # Call Claude API
                extracted = _extract_fields_ai_live(new_path, extract_type)
                confidence = {k: 0.9 for k in extracted.keys()}  # AI Live assumed high confidence
            else:
                # Local OCR extraction with confidence scoring
                from app.services.local_extractor import extract_local
                local_result = extract_local(str(new_path), extract_type)
                extracted = local_result.get("fields", {})
                confidence = local_result.get("confidence", {})

            # Save to application
            updates = _map_extraction_to_app(extracted, extract_type)
            for key, val in updates.items():
                if hasattr(app, key):
                    setattr(app, key, val)

            # Save full extraction data with confidence to the application
            from datetime import datetime, timezone
            extraction_record = {
                "fields": extracted,
                "confidence": confidence,
                "method": method,
                "doc_id": new_doc.id,
                "doc_name": new_filename,
                "pages": page_nums,
                "extracted_at": datetime.now(timezone.utc).isoformat(),
                "fields_saved": list(updates.keys()),
            }
            if extract_type == "certificate_of_title":
                app.title_extraction_data = extraction_record
            else:
                app.form_extraction_data = extraction_record

            db.commit()

            result["extraction"] = extracted
            result["confidence"] = confidence
            result["fields_saved"] = list(updates.keys())
            result["message"] += f" Extracted {len(updates)} fields via {method}."
        except Exception as e:
            result["extractionError"] = str(e)

    return result


def _extract_fields_ai_live(file_path, extract_type):
    """Extract fields using Claude AI."""
    from PIL import Image
    from pdf2image import convert_from_bytes
    import base64, io, json, re, anthropic

    images = convert_from_bytes(Path(file_path).read_bytes(), dpi=150, last_page=3)
    image_contents = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        image_contents.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}})

    if extract_type == "certificate_of_title":
        prompt = 'Extract from this Certificate of Title / land title document. Return ONLY valid JSON: {"register_number":"string or null — the title register number","date_issued":"string or null — date the title was issued","volume":"string or null — volume number","folio":"string or null — folio number","land_description":"string or null — full legal land description (e.g. Lot 123 on Plan/Diagram 45678)","lot_number":"string or null","plan_number":"string or null — plan or diagram number","property_address":"string or null — registered street address","lot_area_sqm":"number or null — lot area in square metres","registered_owners":["array of owner name strings"],"mortgage":"string or null — mortgage holder/bank if shown","encumbrances":["array of easement/caveat/restriction strings"],"notes":"string or null"}'
    else:
        prompt = 'Extract from application form. Return ONLY JSON: {"owner_name":"","owner_phone":"","owner_email":"","owner_postal_address":"","property_address":"","lot_number":"","plan_number":"","crossover_width":null,"crossover_surface":"","crossover_count":null,"da_number":"","date_signed":"","declaration_signed":false,"trees_nearby":false,"clearing":false,"drainage_type":"","estimated_construction_date":""}'

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model="claude-sonnet-4-20250514", max_tokens=2000,
        messages=[{"role": "user", "content": image_contents + [{"type": "text", "text": prompt}]}],
    )
    raw = resp.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    return json.loads(raw)


def _extract_fields_local(file_path, extract_type):
    """Extract fields using local OCR pipeline — no AI API calls.
    Three-stage: text+layout extraction → field extraction → confidence scoring.
    """
    from app.services.local_extractor import extract_local

    result = extract_local(str(file_path), extract_type)
    # Return the fields dict (values only) for compatibility with _map_extraction_to_app
    # The full result with confidence is stored in the extraction detail
    return result.get("fields", {})


def _map_extraction_to_app(extracted, extract_type):
    """Map extracted fields to application model column names."""
    updates = {}
    if extract_type == "certificate_of_title":
        mapping = {"lot_number": "lot_number", "plan_number": "plan_number", "property_address": "property_address", "lot_area_sqm": "lot_area_sqm"}
        for src, dst in mapping.items():
            val = extracted.get(src)
            if val is not None and str(val).strip() and str(val).strip().lower() not in ("null", "none"):
                updates[dst] = val
        # Handle owner names (array or string)
        owners = extracted.get("registered_owners") or extracted.get("owner_names")
        if owners:
            if isinstance(owners, list):
                updates["owner_name"] = ", ".join(str(o) for o in owners if o)
            else:
                updates["owner_name"] = str(owners)
    else:  # application_form
        mapping = {
            "owner_name": "owner_name", "owner_phone": "owner_phone", "owner_email": "owner_email",
            "owner_postal_address": "owner_postal_address", "property_address": "property_address",
            "lot_number": "lot_number", "plan_number": "plan_number",
            "crossover_width": "crossover_width", "crossover_surface": "crossover_surface",
            "crossover_count": "crossover_count", "da_number": "da_number",
            "date_signed": "date_signed", "drainage_type": "drainage_type",
            "estimated_construction_date": "crossover_est_date",
        }
        for src, dst in mapping.items():
            val = extracted.get(src)
            if val is not None and str(val).strip() and str(val).strip().lower() not in ("null", "none", "n/a"):
                updates[dst] = val
        if extracted.get("declaration_signed"):
            updates["declaration_signed"] = True
        if extracted.get("trees_nearby"):
            updates["trees_nearby"] = True
        if extracted.get("clearing"):
            updates["clearing"] = True
    return updates


def _run_site_plan_ai(app, doc, file_bytes: bytes, db: Session, ai_cfg=None):
    """Run AI analysis."""
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
            # Check confidence — fallback to AI if too low
            conf = findings.get("_yolo_confidence", 0)
            if conf < ai_cfg.yolo_confidence and ai_cfg.fallback_to_ai:
                print(f"  ℹ YOLO confidence {conf:.2f} < {ai_cfg.yolo_confidence} — falling back to AI")
                findings = None  # will fall through to AI below

    # ── AI mode (or fallback) ──
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

    # ── Auto-capture corrections for AI training ──
    if changes:
        try:
            from app.models.ai_training import AITrainingSample, AITrainingCorrection
            sample = db.query(AITrainingSample).filter(
                AITrainingSample.application_id == app_id
            ).order_by(AITrainingSample.id.desc()).first()
            if sample:
                for field_path, vals in changes.items():
                    corr = AITrainingCorrection(
                        sample_id=sample.id,
                        corrected_by_id=current_user.id,
                        field_path=field_path,
                        ai_value=vals.get("old", ""),
                        correct_value=vals.get("new", ""),
                        correction_type="value_wrong" if vals.get("old") else "missing",
                    )
                    db.add(corr)
                sample.officer_corrected = True
                sample.verified_by_id = current_user.id
                sample.verified_at = datetime.now(timezone.utc)
                db.commit()
        except Exception as e:
            print(f"  Training capture failed: {e}")

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
    download: bool = Query(False, description="Force download (attachment) instead of inline view"),
    db: Session = Depends(get_db),
):
    """Serve the uploaded document file. Default: inline (for viewer). ?download=true for saving."""
    from fastapi.responses import FileResponse, Response
    from jose import jwt as jose_jwt

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
    action = "download" if download else "view"
    log_audit(db=db, action=action, entity_type="document", user=user, entity_id=str(doc.id), description=f"{action.title()} {doc.name}")

    if download:
        return FileResponse(file_path, media_type=media_type, filename=doc.name)
    else:
        # Inline: read file and return with Content-Disposition: inline
        file_bytes = file_path.read_bytes()
        safe_name = doc.name.replace('"', '\\"')
        return Response(
            content=file_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f'inline; filename="{safe_name}"'}
        )


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


@router.post("/{app_id}/documents/{doc_id}/ocr-region")
def ocr_region(
    app_id: int, doc_id: int,
    body: dict,  # {page, x, y, width, height, img_width, img_height}
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """OCR a region of a document page. Coordinates are relative to the rendered image."""
    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found")
    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    page = body.get("page", 1)
    cx = body.get("x", 0)
    cy = body.get("y", 0)
    region_w = body.get("width", 200)
    region_h = body.get("height", 80)
    img_w = body.get("img_width", 1)
    img_h = body.get("img_height", 1)
    img_rotation = body.get("rotation", 0)  # 0, 90, 180, 270

    ext = (doc.file_type or "").lower()
    try:
        from PIL import Image
        import io

        if ext in ("jpg", "jpeg", "png", "gif", "webp"):
            img = Image.open(file_path)
        elif ext == "pdf":
            from pdf2image import convert_from_bytes
            images = convert_from_bytes(file_path.read_bytes(), dpi=200, first_page=page, last_page=page)
            if not images:
                raise HTTPException(404, f"Page {page} not found")
            img = images[0]
        else:
            raise HTTPException(400, f"OCR not supported for .{ext}")

        # Rotate image to match frontend display
        if img_rotation:
            rot_map = {90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}
            if img_rotation in rot_map:
                img = img.transpose(rot_map[img_rotation])

        # Scale rectangle coordinates from displayed size to actual image size
        scale_x = img.width / max(img_w, 1)
        scale_y = img.height / max(img_h, 1)
        left = max(0, int(cx * scale_x))
        top = max(0, int(cy * scale_y))
        right = min(img.width, int((cx + region_w) * scale_x))
        bottom = min(img.height, int((cy + region_h) * scale_y))

        # Ensure minimum size
        if right - left < 10: right = min(img.width, left + 50)
        if bottom - top < 10: bottom = min(img.height, top + 30)

        crop = img.crop((left, top, right, bottom))

        # Upscale for better OCR (3x minimum 300px wide)
        up_w = max(crop.width * 3, 300)
        up_h = max(crop.height * 3, 100)
        crop = crop.resize((up_w, up_h), Image.LANCZOS)

        # Convert to grayscale and increase contrast for better OCR
        crop = crop.convert("L")

        # Run OCR — try single line first, fall back to block
        import pytesseract
        text = pytesseract.image_to_string(crop, config="--psm 7").strip()

        # Fallback: if single-line mode returned nothing, try block mode
        if not text or len(text) < 2:
            text = pytesseract.image_to_string(crop, config="--psm 6").strip()
        # Fallback: try single word mode
        if not text or len(text) < 2:
            text = pytesseract.image_to_string(crop, config="--psm 8").strip()

        # Clean: remove non-printable, collapse whitespace
        import re
        text = re.sub(r'[^\x20-\x7E]', '', text).strip()
        text = re.sub(r'\s+', ' ', text)

        return {"text": text, "region": {"left": left, "top": top, "right": right, "bottom": bottom}}

    except ImportError as e:
        raise HTTPException(500, f"OCR dependency missing: {e}")
    except Exception as e:
        raise HTTPException(500, f"OCR failed: {e}")


@router.post("/{app_id}/documents/{doc_id}/extract-fields")
async def extract_document_fields(
    app_id: int, doc_id: int,
    body: dict = None,  # {"type": "application_form" | "certificate_of_title"}
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """
    Extract structured data from a document using AI.
    Supports: application_form, certificate_of_title
    Extracted fields are saved to the application record.
    """
    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")

    extract_type = (body or {}).get("type", "auto")
    extraction_method = (body or {}).get("extraction_method", "ai_live")
    category = (doc.category or "").lower()

    # Auto-detect type from category
    if extract_type == "auto":
        if "application" in category or "form" in category:
            extract_type = "application_form"
        elif "title" in category or "certificate" in category:
            extract_type = "certificate_of_title"
        elif "site" in category or "plan" in category:
            extract_type = "site_plan"
        else:
            extract_type = "general"

    # For site plan with ai_local, use local extraction pipeline
    if extract_type == "site_plan" and extraction_method == "ai_local":
        try:
            from app.services.local_extractor import extract_local
            local_result = extract_local(str(file_path), "site_plan")
            extracted = local_result.get("fields", {})
            confidence = local_result.get("confidence", {})

            # Save extraction as site_plan_data on the application (same structure as AI)
            save_data = {"extraction": extracted, "method": "local_ocr", "confidence": confidence}
            app.org_site_plan_data = save_data  # Original — never modified
            app.site_plan_data = save_data      # Active copy — assessment reads this
            # cor_site_plan_data stays null until officer corrects
            db.commit()

            from app.services.audit import log_audit
            log_audit(db=db, action="extract", entity_type="document", user=current_user,
                      entity_id=str(doc.id), description=f"Local OCR extracted {len(extracted)} fields from {doc.name}")

            return {
                "type": extract_type, "extracted": extracted, "confidence": confidence,
                "fields_saved": list(extracted.keys()), "count": len(extracted),
                "message": f"Extracted {len(extracted)} fields from site plan via local OCR",
            }
        except Exception as e:
            raise HTTPException(500, f"Local site plan extraction failed: {e}")

    # For site plan with ai_live, use the existing AI analyser
    if extract_type == "site_plan" and extraction_method == "ai_live":
        try:
            _run_site_plan_ai(app, doc, file_path.read_bytes(), db)
            return {
                "type": extract_type, "extracted": {}, "fields_saved": [],
                "count": 0, "message": "AI site plan analysis complete",
            }
        except Exception as e:
            raise HTTPException(500, f"AI site plan analysis failed: {e}")

    # For application_form / certificate_of_title with ai_local, use local OCR
    if extract_type in ("application_form", "certificate_of_title") and extraction_method == "ai_local":
        try:
            from app.services.local_extractor import extract_local
            local_result = extract_local(str(file_path), extract_type)
            extracted = local_result.get("fields", {})
            confidence = local_result.get("confidence", {})

            updates = _map_extraction_to_app(extracted, extract_type)
            for key, val in updates.items():
                if hasattr(app, key):
                    setattr(app, key, val)

            from datetime import datetime, timezone
            extraction_record = {
                "fields": extracted, "confidence": confidence, "method": "ai_local",
                "doc_id": doc.id, "doc_name": doc.name,
                "extracted_at": datetime.now(timezone.utc).isoformat(),
                "fields_saved": list(updates.keys()),
            }
            if extract_type == "certificate_of_title":
                app.title_extraction_data = extraction_record
            else:
                app.form_extraction_data = extraction_record
            db.commit()

            from app.services.audit import log_audit
            log_audit(db=db, action="extract", entity_type="document", user=current_user,
                      entity_id=str(doc.id), description=f"Local OCR extracted {len(updates)} fields from {doc.name}")

            return {
                "type": extract_type, "extracted": extracted, "confidence": confidence,
                "fields_saved": list(updates.keys()), "count": len(updates),
                "message": f"Extracted {len(updates)} fields from {extract_type.replace('_', ' ')} via local OCR",
            }
        except Exception as e:
            raise HTTPException(500, f"Local extraction failed: {e}")

    # ── AI Live extraction (Claude) — for application_form and certificate_of_title ──
    ext = (doc.file_type or "").lower()
    try:
        # Render document pages as images
        from PIL import Image
        import io

        images = []
        if ext == "pdf":
            from pdf2image import convert_from_bytes
            pdf_bytes = file_path.read_bytes()
            images = convert_from_bytes(pdf_bytes, dpi=150, last_page=3)  # max 3 pages
        elif ext in ("jpg", "jpeg", "png"):
            images = [Image.open(file_path)]

        if not images:
            raise HTTPException(400, f"Cannot extract from .{ext} files")

        # Convert images to base64 for AI
        import base64
        image_contents = []
        for img in images:
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            image_contents.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": b64}
            })

        # Build extraction prompt based on type
        if extract_type == "application_form":
            prompt = """Extract ALL fields from this crossover application form. Return ONLY valid JSON:
{
  "owner_name": "string or null",
  "owner_phone": "string or null",
  "owner_email": "string or null",
  "owner_postal_address": "string or null",
  "property_address": "string or null",
  "lot_number": "string or null",
  "plan_number": "string or null",
  "crossover_width": "number or null (metres)",
  "crossover_surface": "string or null (concrete/asphalt/paving)",
  "crossover_count": "number or null",
  "crossover_offset_from_left": "number or null (metres)",
  "da_number": "string or null (development application number)",
  "date_signed": "string or null",
  "declaration_signed": "boolean",
  "trees_nearby": "boolean",
  "clearing": "boolean",
  "drainage_type": "string or null",
  "estimated_construction_date": "string or null",
  "notes": "string or null — any additional info"
}"""
        elif extract_type == "certificate_of_title":
            prompt = """Extract property details from this Certificate of Title. Return ONLY valid JSON:
{
  "register_number": "string or null — the title register number",
  "date_issued": "string or null — date the title was issued",
  "volume": "string or null — volume number",
  "folio": "string or null — folio number",
  "land_description": "string or null — full legal land description",
  "lot_number": "string or null",
  "plan_number": "string or null — plan or diagram number",
  "property_address": "string or null — registered street address",
  "lot_area_sqm": "number or null — lot area in square metres",
  "registered_owners": "array of strings — registered proprietor name(s)",
  "mortgage": "string or null — mortgage holder if shown",
  "encumbrances": "array of strings — easements, caveats, restrictions",
  "notes": "string or null"
}"""
        else:
            prompt = """Extract all text and structured information from this document. Return ONLY valid JSON:
{
  "document_type": "string — what type of document this is",
  "key_fields": {},
  "notes": "string"
}"""

        # Call AI
        import anthropic
        client = anthropic.Anthropic()
        message_content = image_contents + [{"type": "text", "text": prompt}]

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[{"role": "user", "content": message_content}],
        )

        # Parse response
        import json, re
        raw = response.content[0].text.strip()
        # Clean markdown fences
        raw = re.sub(r'^```json\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        extracted = json.loads(raw)

        # Map extracted fields to application
        updates = {}
        filled = []

        if extract_type == "application_form":
            mapping = {
                "owner_name": "owner_name", "owner_phone": "owner_phone",
                "owner_email": "owner_email", "owner_postal_address": "owner_postal_address",
                "property_address": "property_address", "lot_number": "lot_number",
                "plan_number": "plan_number", "crossover_width": "crossover_width",
                "crossover_surface": "crossover_surface", "crossover_count": "crossover_count",
                "crossover_offset_from_left": "crossover_offset_from_left",
                "da_number": "da_number", "date_signed": "date_signed",
                "drainage_type": "drainage_type",
                "estimated_construction_date": "crossover_est_date",
            }
            for src, dst in mapping.items():
                val = extracted.get(src)
                if val is not None and str(val).strip() and str(val).strip().lower() not in ("null", "none", "n/a"):
                    updates[dst] = val
                    filled.append(src)
            if extracted.get("declaration_signed"):
                updates["declaration_signed"] = True
                filled.append("declaration_signed")
            if extracted.get("trees_nearby"):
                updates["trees_nearby"] = True
                filled.append("trees_nearby")
            if extracted.get("clearing"):
                updates["clearing"] = True
                filled.append("clearing")

        elif extract_type == "certificate_of_title":
            if extracted.get("lot_number"):
                updates["lot_number"] = str(extracted["lot_number"])
                filled.append("lot_number")
            if extracted.get("plan_number"):
                updates["plan_number"] = str(extracted["plan_number"])
                filled.append("plan_number")
            if extracted.get("property_address"):
                updates["property_address"] = extracted["property_address"]
                filled.append("property_address")
            if extracted.get("lot_area_sqm"):
                updates["lot_area_sqm"] = extracted["lot_area_sqm"]
                filled.append("lot_area_sqm")
            if extracted.get("owner_names") and len(extracted["owner_names"]) > 0:
                updates["owner_name"] = ", ".join(extracted["owner_names"])
                filled.append("owner_names")
            if extracted.get("depth"):
                updates["depth"] = extracted["depth"]
                filled.append("depth")

        # Apply updates
        if updates:
            for key, val in updates.items():
                if hasattr(app, key):
                    setattr(app, key, val)

        # Save full extraction data to application
        from datetime import datetime, timezone
        extraction_record = {
            "fields": extracted,
            "confidence": {k: 0.9 for k in filled},
            "method": "ai_live",
            "doc_id": doc.id,
            "doc_name": doc.name,
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            "fields_saved": filled,
        }
        if extract_type == "certificate_of_title":
            app.title_extraction_data = extraction_record
        else:
            app.form_extraction_data = extraction_record

        db.commit()

        from app.services.audit import log_audit
        log_audit(db=db, action="extract", entity_type="document", user=current_user,
                  entity_id=str(doc.id), description=f"Extracted {len(filled)} fields from {doc.name} ({extract_type})")

        return {
            "type": extract_type,
            "extracted": extracted,
            "fields_saved": filled,
            "count": len(filled),
            "message": f"Extracted {len(filled)} fields from {extract_type.replace('_', ' ')}: {', '.join(filled)}" if filled else "No fields could be extracted",
        }

    except json.JSONDecodeError as e:
        raise HTTPException(500, f"AI response was not valid JSON: {e}")
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")


@router.post("/{app_id}/documents/{doc_id}/rotate")
def rotate_pdf(
    app_id: int, doc_id: int,
    body: dict,  # {"degrees": 32.5}
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """Rotate all pages of a PDF document by any angle."""
    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")

    ext = (doc.file_type or "").lower()
    if ext != "pdf":
        raise HTTPException(400, "Only PDF files can be rotated")

    degrees = body.get("degrees", 0)
    if not degrees:
        raise HTTPException(400, "Degrees required")

    try:
        # For exact 90° increments, use fast pypdf rotation (lossless)
        rounded = round(degrees)
        if rounded in (90, 180, 270, -90, -180, -270):
            from pypdf import PdfReader, PdfWriter
            reader = PdfReader(str(file_path))
            writer = PdfWriter()
            rot = rounded % 360
            for page in reader.pages:
                page.rotate(rot)
                writer.add_page(page)
            with open(file_path, "wb") as f:
                writer.write(f)
            page_count = len(reader.pages)
        else:
            # Arbitrary angle — render pages as images, rotate, save as new PDF
            from PIL import Image
            from pdf2image import convert_from_bytes
            from reportlab.pdfgen import canvas as rl_canvas
            import io

            pdf_bytes = file_path.read_bytes()
            images = convert_from_bytes(pdf_bytes, dpi=200)
            page_count = len(images)

            # Rotate each page image and build new PDF
            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf)
            for img in images:
                # Rotate with expand=True to fit the full rotated image
                rotated = img.rotate(-degrees, expand=True, fillcolor=(255, 255, 255))
                # Save rotated image to temp buffer
                img_buf = io.BytesIO()
                rotated.save(img_buf, format="PNG")
                img_buf.seek(0)

                # Page size matches rotated image at 200 DPI
                pw = rotated.width * 72 / 200
                ph = rotated.height * 72 / 200
                c.setPageSize((pw, ph))
                c.drawImage(
                    _pil_to_reportlab(img_buf, rotated.width, rotated.height),
                    0, 0, pw, ph
                )
                c.showPage()
            c.save()

            # Write back
            with open(file_path, "wb") as f:
                f.write(buf.getvalue())

        from app.services.audit import log_audit
        log_audit(db=db, action="rotate", entity_type="document", user=current_user,
                  entity_id=str(doc.id), description=f"Rotated {doc.name} by {degrees}°")

        return {"message": f"Rotated {page_count} page(s) by {degrees}°", "pages": page_count}

    except ImportError as e:
        raise HTTPException(500, f"Dependency missing: {e}")
    except Exception as e:
        raise HTTPException(500, f"Rotate failed: {e}")


def _pil_to_reportlab(img_buf, width, height):
    """Convert PIL image buffer to a ReportLab ImageReader."""
    from reportlab.lib.utils import ImageReader
    img_buf.seek(0)
    return ImageReader(img_buf)


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

    # Save pixel coordinates (ensure plain Python types), clear latlon if empty
    def clean_poly(poly):
        if not poly or (isinstance(poly, list) and len(poly) < 3):
            return None
        return [[round(float(p[0])), round(float(p[1]))] for p in poly]

    for key in ["site_lot_boundary", "site_building_boundary", "site_crossover"]:
        if key in data:
            cleaned = clean_poly(data[key])
            setattr(app, key, cleaned)
            if cleaned is None:
                setattr(app, f"{key}_latlon", None)

    # ── Geo-reference: map pixel lot boundary → real lot_polygon → affine transform ──
    pixel_lot = app.site_lot_boundary or []  # Already cleaned and saved above
    real_lot = app.lot_polygon or []

    # Normalize coordinate order — ensure [lat, lng] (lat ~ -31, lng ~ 116 for Perth)
    if real_lot and len(real_lot) >= 3:
        first = real_lot[0]
        if abs(first[0]) > 90:  # First value is lng (>90), need to swap
            real_lot = [[p[1], p[0]] for p in real_lot]

    latlon_results = {}

    if len(pixel_lot) >= 3 and len(real_lot) >= 3:
        import numpy as np
        import math

        # Remove closing points (first == last) for matching
        px_open = list(pixel_lot)
        if len(px_open) > 3 and px_open[0][0] == px_open[-1][0] and px_open[0][1] == px_open[-1][1]:
            px_open = px_open[:-1]

        re_open = list(real_lot)
        if len(re_open) > 3 and re_open[0] == re_open[-1]:
            re_open = re_open[:-1]

        # ── Remove collinear mid-side points from lot polygon ──
        def remove_collinear(poly):
            """Remove points that lie on the straight line between their neighbours.
            Uses gap detection: mid-side points have dramatically smaller deviation than real corners."""
            if len(poly) <= 4:
                return poly
            n = len(poly)
            deviations = []
            for i in range(n):
                prev = poly[(i-1) % n]
                curr = poly[i]
                nxt = poly[(i+1) % n]
                dx, dy = nxt[0]-prev[0], nxt[1]-prev[1]
                seg_len = math.sqrt(dx*dx + dy*dy)
                if seg_len < 1e-12:
                    deviations.append((i, float('inf')))
                    continue
                cross = abs((curr[0]-prev[0])*dy - (curr[1]-prev[1])*dx)
                deviations.append((i, cross / seg_len))
            # Sort by deviation ascending
            sorted_devs = sorted(deviations, key=lambda x: x[1])
            # Find gap: where ratio jumps > 10x
            keep = set(range(n))
            for k in range(len(sorted_devs) - 1):
                curr_d = sorted_devs[k][1]
                next_d = sorted_devs[k+1][1]
                if curr_d < 1e-10 or (next_d > 0 and next_d / max(curr_d, 1e-15) > 10):
                    for j in range(k+1):
                        keep.discard(sorted_devs[j][0])
                    break
            result = [poly[i] for i in sorted(keep)]
            return result if len(result) >= 3 else poly

        re_corners = remove_collinear(re_open)
        print(f"  → Lot polygon: {len(re_open)} points → {len(re_corners)} true corners")

        n_px = len(px_open)
        n_re = len(re_corners)

        if n_px >= 3 and n_re >= 3:
            if n_px < n_re:
                # Still more real corners than drawn — pick evenly spaced
                indices = [round(i * (n_re - 1) / (n_px - 1)) for i in range(n_px)]
                real_pts = [re_corners[i] for i in indices]
            elif n_px > n_re:
                indices = [round(i * (n_px - 1) / (n_re - 1)) for i in range(n_re)]
                px_open = [px_open[i] for i in indices]
                real_pts = re_corners
            else:
                real_pts = re_corners

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
                    px_poly = getattr(app, key, None) or []
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



"""
AI Training Data API

Endpoints for managing the training dataset:
- GET /training/stats — dataset statistics
- GET /training/samples — list training samples with filters
- POST /training/samples/{id}/verify — officer verifies AI was correct
- POST /training/samples/{id}/correct — officer submits correction (ground truth)
- GET /training/export — export dataset for model training
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.user import User
from app.models.ai_training import AITrainingSample, AITrainingCorrection

router = APIRouter(prefix="/training", tags=["AI Training"])


@router.get("/stats")
def training_stats(db: Session = Depends(get_db), current_user: User = Depends(require_role("admin", "manager"))):
    """Get training dataset statistics."""
    from app.services.ai_config import get_ai_config
    ai_cfg = get_ai_config(db)

    total = db.query(AITrainingSample).count()
    verified = db.query(AITrainingSample).filter(AITrainingSample.officer_verified == True).count()
    corrected = db.query(AITrainingSample).filter(AITrainingSample.officer_corrected == True).count()
    used = db.query(AITrainingSample).filter(AITrainingSample.used_in_training == True).count()
    corrections = db.query(AITrainingCorrection).count()

    # Field accuracy: which fields get corrected most
    field_corrections = {}
    all_corrections = db.query(AITrainingCorrection).all()
    for c in all_corrections:
        fp = c.field_path
        if fp not in field_corrections:
            field_corrections[fp] = 0
        field_corrections[fp] += 1
    # Top 10 most corrected fields
    top_corrections = sorted(field_corrections.items(), key=lambda x: -x[1])[:10]

    # Corner lot distribution
    corner_count = db.query(AITrainingSample).filter(AITrainingSample.is_corner_lot == True).count()

    p2 = ai_cfg.phase2_threshold
    p3 = ai_cfg.phase3_threshold

    if total >= p3:
        phase = "Phase 3 — Local primary, AI fallback"
    elif total >= p2:
        phase = "Phase 2 — Hybrid mode"
    else:
        phase = f"Phase 1 — AI only ({p2 - total} more samples needed for Phase 2)"

    return {
        "total_samples": total,
        "officer_verified": verified,
        "officer_corrected": corrected,
        "used_in_training": used,
        "total_corrections": corrections,
        "unreviewed": total - verified - corrected,
        "phase": phase,
        "ready_for_training": total >= p2,
        "current_mode": ai_cfg.mode,
        "yolo_model_path": ai_cfg.yolo_model_path or "(not configured)",
        "yolo_confidence_threshold": ai_cfg.yolo_confidence,
        "phase2_threshold": p2,
        "phase3_threshold": p3,
    }


@router.get("/samples")
def list_samples(
    verified_only: bool = False,
    unreviewed_only: bool = False,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """List training samples with optional filters."""
    q = db.query(AITrainingSample).options(joinedload(AITrainingSample.corrections))
    if verified_only:
        q = q.filter(AITrainingSample.officer_verified == True)
    if unreviewed_only:
        q = q.filter(AITrainingSample.officer_verified == False, AITrainingSample.officer_corrected == False)
    total = q.count()
    samples = q.order_by(AITrainingSample.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "samples": [{
            "id": s.id,
            "application_id": s.application_id,
            "source_filename": s.source_filename,
            "page_number": s.page_number,
            "ai_model": s.ai_model,
            "width_at_boundary": s.width_at_boundary,
            "total_width_at_road": s.total_width_at_road,
            "material": s.material,
            "has_drainage": s.has_drainage,
            "officer_verified": s.officer_verified,
            "officer_corrected": s.officer_corrected,
            "corrections_count": len(s.corrections),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        } for s in samples],
    }


@router.post("/samples/{sample_id}/verify")
def verify_sample(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """Officer confirms AI extraction was correct — marks as verified ground truth."""
    sample = db.query(AITrainingSample).filter(AITrainingSample.id == sample_id).first()
    if not sample:
        raise HTTPException(404, "Sample not found")
    sample.officer_verified = True
    sample.verified_by_id = current_user.id
    sample.verified_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Sample verified as correct", "id": sample_id}


@router.post("/samples/{sample_id}/correct")
def correct_sample(
    sample_id: int,
    corrections: list[dict],  # [{"field_path": "...", "ai_value": "...", "correct_value": "...", "type": "value_wrong"}]
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """Officer submits corrections to AI extraction — these become ground truth labels."""
    sample = db.query(AITrainingSample).filter(AITrainingSample.id == sample_id).first()
    if not sample:
        raise HTTPException(404, "Sample not found")

    for c in corrections:
        corr = AITrainingCorrection(
            sample_id=sample_id,
            corrected_by_id=current_user.id,
            field_path=c.get("field_path", ""),
            ai_value=str(c.get("ai_value", "")),
            correct_value=str(c.get("correct_value", "")),
            correction_type=c.get("type", "value_wrong"),
        )
        db.add(corr)

    sample.officer_corrected = True
    sample.verified_by_id = current_user.id
    sample.verified_at = datetime.now(timezone.utc)
    db.commit()

    return {"message": f"{len(corrections)} correction(s) saved", "id": sample_id}


@router.get("/export")
def export_dataset(
    verified_only: bool = True,
    format: str = Query("json", description="Export format: json or yolo"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Export training dataset for model training.

    JSON format: array of {image_path, extraction, corrections, compliance}
    YOLO format: manifest with image paths + annotation file paths
    """
    q = db.query(AITrainingSample).options(joinedload(AITrainingSample.corrections))
    if verified_only:
        q = q.filter(
            (AITrainingSample.officer_verified == True) | (AITrainingSample.officer_corrected == True)
        )
    samples = q.order_by(AITrainingSample.id).all()

    if format == "yolo":
        # YOLO-style manifest for object detection training
        manifest = []
        for s in samples:
            # Apply corrections to extraction
            extraction = dict(s.extraction_json or {})
            for c in s.corrections:
                # Simple flat override
                extraction[f"_corrected_{c.field_path}"] = c.correct_value

            manifest.append({
                "image": s.image_path,
                "page": s.page_number,
                "application_id": s.application_id,
                "labels": extraction,
                "corrections": [{
                    "field": c.field_path,
                    "ai": c.ai_value,
                    "truth": c.correct_value,
                    "type": c.correction_type,
                } for c in s.corrections],
            })
        return {"format": "yolo", "count": len(manifest), "samples": manifest}

    # JSON format (default)
    dataset = []
    for s in samples:
        # Calculate quality score: % of fields that didn't need correction
        total_fields = len([k for k in (s.extraction_json or {}).keys() if isinstance((s.extraction_json or {}).get(k), dict)])
        corrected_fields = len(s.corrections)
        quality = round(max(0, (1 - corrected_fields / max(total_fields, 1))) * 100, 1) if total_fields > 0 else None

        entry = {
            "id": s.id,
            "image_path": s.image_path,
            "image_width": s.image_width,
            "image_height": s.image_height,
            "source_filename": s.source_filename,
            "page_number": s.page_number,
            "document_type": s.document_type,
            "drawing_scale": s.drawing_scale,
            "extraction": s.extraction_json,
            "compliance": s.compliance_json,
            "verified": s.officer_verified,
            "corrected": s.officer_corrected,
            "quality_score": quality,
            # Key fields for filtering
            "crossover_road": s.crossover_road,
            "constrained_side": s.constrained_side,
            "is_corner_lot": s.is_corner_lot,
            "width_at_boundary": s.width_at_boundary,
            "verge_depth": s.verge_depth,
            "garage_to_kerb": s.garage_to_kerb,
            "left_boundary_dist": s.left_boundary_dist,
            "right_boundary_dist": s.right_boundary_dist,
            "fence_left_type": s.fence_left_type,
            "fence_right_type": s.fence_right_type,
            # Ground truth corrections
            "corrections": [{
                "field_path": c.field_path,
                "ai_value": c.ai_value,
                "correct_value": c.correct_value,
                "type": c.correction_type,
            } for c in s.corrections],
            # Derived ground truth: apply corrections to extraction
            "ground_truth": _apply_corrections(s.extraction_json, s.corrections),
        }
        dataset.append(entry)

    return {"format": "json", "count": len(dataset), "dataset": dataset}


def _apply_corrections(extraction_json, corrections):
    """Apply officer corrections to AI extraction to produce ground truth."""
    import copy
    gt = copy.deepcopy(extraction_json or {})
    for c in corrections:
        parts = c.field_path.split(".")
        obj = gt
        for part in parts[:-1]:
            if part not in obj or not isinstance(obj[part], dict):
                obj[part] = {}
            obj = obj[part]
        try:
            val = c.correct_value
            # Try numeric conversion
            try:
                val = float(val)
                if val == int(val):
                    val = int(val)
            except (ValueError, TypeError):
                if val in ("true", "True"):
                    val = True
                elif val in ("false", "False"):
                    val = False
        except Exception:
            pass
        obj[parts[-1]] = val
    return gt


@router.get("/quality")
def training_quality_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """
    AI quality report — per-field accuracy based on officer corrections.
    Shows which fields the AI gets right vs wrong, and improvement over time.
    """
    corrections = db.query(AITrainingCorrection).order_by(AITrainingCorrection.created_at).all()
    samples = db.query(AITrainingSample).count()

    if not corrections:
        return {"message": "No corrections yet — AI quality unknown", "total_samples": samples}

    # Per-field stats
    field_stats = {}
    for c in corrections:
        fp = c.field_path
        if fp not in field_stats:
            field_stats[fp] = {"total": 0, "ai_correct": 0, "ai_wrong": 0, "ai_null": 0}
        field_stats[fp]["total"] += 1
        if c.ai_value == c.correct_value:
            field_stats[fp]["ai_correct"] += 1
        elif not c.ai_value or c.ai_value in ("None", "null", "—"):
            field_stats[fp]["ai_null"] += 1
        else:
            field_stats[fp]["ai_wrong"] += 1

    # Accuracy per field
    results = []
    for fp, s in sorted(field_stats.items(), key=lambda x: -x[1]["total"]):
        accuracy = s["ai_correct"] / s["total"] * 100 if s["total"] > 0 else 0
        results.append({
            "field": fp,
            "corrections": s["total"],
            "ai_correct": s["ai_correct"],
            "ai_wrong": s["ai_wrong"],
            "ai_missed": s["ai_null"],
            "accuracy_pct": round(accuracy, 1),
        })

    overall = sum(s["ai_correct"] for s in field_stats.values())
    total_corrections = sum(s["total"] for s in field_stats.values())
    overall_accuracy = overall / total_corrections * 100 if total_corrections > 0 else 0

    return {
        "total_samples": samples,
        "total_corrections": total_corrections,
        "overall_accuracy_pct": round(overall_accuracy, 1),
        "fields": results,
        "most_corrected": results[:5] if results else [],
        "recommendation": (
            "AI performing well — maintain current model" if overall_accuracy > 80
            else "AI needs improvement — consider fine-tuning with corrected data" if overall_accuracy > 50
            else "AI accuracy low — more training data needed before deployment"
        ),
    }


# ═══════════════════════════════════════════════════════════
#  YOLO TRAINING PIPELINE
# ═══════════════════════════════════════════════════════════

@router.post("/prepare-dataset")
def prepare_yolo_dataset(
    verified_only: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Prepare YOLO training dataset from collected training samples.
    Generates annotation files from AI extraction data and exports
    images + labels in YOLO format.
    """
    from app.services.training.yolo_annotator import export_yolo_dataset
    from app.core.config import get_settings
    from pathlib import Path

    settings = get_settings()
    output_dir = str(Path(settings.DOCUMENT_DIR).parent / "yolo_dataset")

    # Get training samples
    q = db.query(AITrainingSample)
    if verified_only:
        q = q.filter(
            (AITrainingSample.officer_verified == True) | (AITrainingSample.officer_corrected == True)
        )
    samples = q.all()

    if not samples:
        return {"error": "No training samples found. Run AI extraction on some site plans first."}

    sample_dicts = []
    for s in samples:
        sample_dicts.append({
            "image_path": s.image_path,
            "extraction_json": s.extraction_json,
            "image_width": s.image_width or 1,
            "image_height": s.image_height or 1,
        })

    result = export_yolo_dataset(sample_dicts, output_dir)
    return {
        "message": f"Dataset prepared: {result['total']} images ({result['train']} train, {result['val']} val)",
        **result,
    }


@router.post("/train-yolo")
def start_yolo_training(
    body: dict = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Start YOLO model training. This runs in a background thread.
    Check /training/stats for progress.
    """
    from app.services.training.yolo_trainer import train_model
    from app.core.config import get_settings
    from pathlib import Path
    import threading

    settings = get_settings()
    dataset_yaml = str(Path(settings.DOCUMENT_DIR).parent / "yolo_dataset" / "dataset.yaml")

    if not Path(dataset_yaml).exists():
        return {"error": "Dataset not prepared. Run POST /training/prepare-dataset first."}

    body = body or {}
    epochs = body.get("epochs", 100)
    model_base = body.get("model", "yolov8n.pt")
    batch_size = body.get("batch_size", 8)
    device = body.get("device", "cpu")

    # Run training in background thread
    def _train():
        try:
            result = train_model(
                dataset_yaml=dataset_yaml,
                model_base=model_base,
                epochs=epochs,
                batch_size=batch_size,
                device=device,
            )
            # Save model path to settings
            from app.core.database import SessionLocal
            from app.models.settings import SiteSetting
            db_sess = SessionLocal()
            try:
                setting = db_sess.query(SiteSetting).filter(
                    SiteSetting.category == "ai", SiteSetting.key == "ai_yolo_model_path"
                ).first()
                if setting:
                    setting.value = result["model_path"]
                else:
                    db_sess.add(SiteSetting(category="ai", key="ai_yolo_model_path", value=result["model_path"]))
                db_sess.commit()
            finally:
                db_sess.close()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"YOLO training failed: {e}")

    thread = threading.Thread(target=_train, daemon=True)
    thread.start()

    return {
        "message": f"Training started in background: {model_base}, {epochs} epochs, batch={batch_size}, device={device}",
        "status": "running",
        "dataset": dataset_yaml,
    }


@router.post("/detect")
def run_yolo_detection(
    body: dict,  # {"image_path": "/path/to/image.png"} or {"app_id": 1, "doc_id": 2}
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """
    Run YOLO object detection on a site plan image.
    Returns detected objects with bounding boxes and confidence scores.
    """
    from app.services.ai_config import get_ai_config
    from app.services.training.yolo_trainer import run_inference, detections_to_extraction_hints
    from pathlib import Path

    ai_cfg = get_ai_config(db)
    model_path = ai_cfg.yolo_model_path
    if not model_path or not Path(model_path).exists():
        return {"error": "No trained YOLO model found. Train one first via POST /training/train-yolo"}

    image_path = body.get("image_path")

    # If app_id + doc_id provided, render the document
    if not image_path and body.get("app_id") and body.get("doc_id"):
        from app.models.application import Application, Document
        doc = db.query(Document).filter(
            Document.id == body["doc_id"],
            Document.application_id == body["app_id"]
        ).first()
        if not doc or not doc.file_path:
            return {"error": "Document not found"}

        file_path = Path(doc.file_path)
        ext = (doc.file_type or "").lower()
        if ext == "pdf":
            from pdf2image import convert_from_bytes
            images = convert_from_bytes(file_path.read_bytes(), dpi=200, first_page=1, last_page=1)
            if images:
                import tempfile
                tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
                images[0].save(tmp.name)
                image_path = tmp.name
        elif ext in ("jpg", "jpeg", "png"):
            image_path = str(file_path)

    if not image_path or not Path(image_path).exists():
        return {"error": "Image not found"}

    # Run detection
    detections = run_inference(model_path, image_path, confidence=ai_cfg.yolo_confidence)

    # Get image dimensions for hints
    from PIL import Image
    img = Image.open(image_path)
    hints = detections_to_extraction_hints(detections, img.width, img.height)

    return {
        "detections": detections,
        "hints": hints,
        "model": model_path,
        "confidence_threshold": ai_cfg.yolo_confidence,
        "image_size": {"width": img.width, "height": img.height},
    }


# ═══════════════════════════════════════════════════════════
#  YOLO OBJECT DETECTION — Annotation, Training, Inference
# ═══════════════════════════════════════════════════════════

@router.post("/samples/{sample_id}/annotate")
def annotate_sample(
    sample_id: int,
    annotations: list,  # [{class_name, x_center, y_center, width, height}]
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """Add or update bounding box annotations for a training sample."""
    sample = db.query(AITrainingSample).filter(AITrainingSample.id == sample_id).first()
    if not sample:
        raise HTTPException(404, "Sample not found")

    from app.services.yolo_training import CLASS_TO_ID

    # Validate and normalise annotations
    valid = []
    for ann in annotations:
        cls_name = ann.get("class_name", "")
        if cls_name not in CLASS_TO_ID:
            continue
        valid.append({
            "class_name": cls_name,
            "class_id": CLASS_TO_ID[cls_name],
            "x_center": float(ann.get("x_center", 0)),
            "y_center": float(ann.get("y_center", 0)),
            "width": float(ann.get("width", 0)),
            "height": float(ann.get("height", 0)),
            "confidence": float(ann.get("confidence", 1.0)),
            "source": ann.get("source", "manual"),
        })

    # Store in extraction_json under _annotations key
    ext = dict(sample.extraction_json or {})
    ext["_annotations"] = valid
    sample.extraction_json = ext
    db.commit()

    return {"sample_id": sample_id, "annotations": len(valid)}


@router.post("/samples/{sample_id}/auto-annotate")
def auto_annotate_sample(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Generate automatic annotations from AI extraction data."""
    sample = db.query(AITrainingSample).filter(AITrainingSample.id == sample_id).first()
    if not sample:
        raise HTTPException(404, "Sample not found")

    from app.services.yolo_training import auto_annotate_from_extraction

    extraction = (sample.extraction_json or {}).get("extraction") or sample.extraction_json or {}
    img_w = sample.image_width or 1000
    img_h = sample.image_height or 1000

    annotations = auto_annotate_from_extraction(extraction, img_w, img_h)

    # Store
    ext = dict(sample.extraction_json or {})
    ext["_annotations"] = annotations
    sample.extraction_json = ext
    db.commit()

    return {"sample_id": sample_id, "auto_annotations": len(annotations), "annotations": annotations}


@router.post("/auto-annotate-all")
def auto_annotate_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Auto-annotate ALL training samples that don't have annotations yet."""
    from app.services.yolo_training import auto_annotate_from_extraction

    samples = db.query(AITrainingSample).all()
    annotated = 0
    for sample in samples:
        ext = dict(sample.extraction_json or {})
        if ext.get("_annotations"):
            continue  # Already has annotations

        extraction = ext.get("extraction") or ext
        img_w = sample.image_width or 1000
        img_h = sample.image_height or 1000

        annotations = auto_annotate_from_extraction(extraction, img_w, img_h)
        if annotations:
            ext["_annotations"] = annotations
            sample.extraction_json = ext
            annotated += 1

    db.commit()
    return {"total_samples": len(samples), "newly_annotated": annotated}


@router.post("/export-yolo")
def export_yolo_dataset_endpoint(
    train_split: float = 0.8,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Export annotated samples as YOLO dataset for training."""
    from app.services.yolo_training import export_yolo_dataset
    from app.core.config import get_settings
    settings = get_settings()

    samples = db.query(AITrainingSample).filter(
        AITrainingSample.image_path.isnot(None)
    ).all()

    # Build sample dicts with annotations
    sample_dicts = []
    for s in samples:
        ext = s.extraction_json or {}
        annotations = ext.get("_annotations", [])
        if not annotations:
            continue  # Skip unannotated
        sample_dicts.append({
            "id": s.id,
            "image_path": s.image_path,
            "annotations": annotations,
        })

    if not sample_dicts:
        return {"error": "No annotated samples found. Run auto-annotate-all first."}

    output_dir = str(Path(settings.DOCUMENT_DIR).parent / "yolo_dataset")
    result = export_yolo_dataset(sample_dicts, output_dir, train_split)
    return result


@router.post("/train-yolo")
def train_yolo_endpoint(
    model_size: str = "n",
    epochs: int = 50,
    imgsz: int = 640,
    batch: int = 4,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Train YOLOv8 model on annotated site plan dataset.
    This is a long-running operation — may take minutes to hours.
    model_size: n=nano(fastest), s=small, m=medium, l=large, x=xlarge(most accurate)
    """
    from app.services.yolo_training import train_yolo_model
    from app.core.config import get_settings
    settings = get_settings()

    data_yaml = str(Path(settings.DOCUMENT_DIR).parent / "yolo_dataset" / "data.yaml")
    if not Path(data_yaml).exists():
        return {"error": "Dataset not exported yet. Run export-yolo first."}

    output_dir = str(Path(settings.DOCUMENT_DIR).parent / "yolo_models")

    result = train_yolo_model(
        data_yaml=data_yaml,
        model_size=model_size,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        output_dir=output_dir,
    )

    # Update AI config with new model path if training succeeded
    if result.get("model_path") and not result.get("error"):
        from app.models.user import SiteSetting
        setting = db.query(SiteSetting).filter(
            SiteSetting.category == "ai", SiteSetting.key == "ai_yolo_model_path"
        ).first()
        if setting:
            setting.value = result["model_path"]
        else:
            db.add(SiteSetting(category="ai", key="ai_yolo_model_path", value=result["model_path"]))
        db.commit()

    return result


@router.post("/detect/{app_id}/documents/{doc_id}")
def run_detection(
    app_id: int, doc_id: int,
    page: int = 1,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "engineer")),
):
    """Run trained YOLO model on a document page to detect drawing elements."""
    from app.services.yolo_training import run_inference
    from app.services.ai_config import get_ai_config
    from app.models.application import Document, Application
    from pathlib import Path

    ai_cfg = get_ai_config(db)
    model_path = ai_cfg.yolo_model_path
    if not model_path or not Path(model_path).exists():
        raise HTTPException(400, "No trained YOLO model available. Train a model first.")

    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc or not doc.file_path:
        raise HTTPException(404, "Document not found")

    file_path = Path(doc.file_path)
    ext = (doc.file_type or "").lower()

    # Get image for the page
    if ext in ("jpg", "jpeg", "png"):
        img_path = str(file_path)
    elif ext == "pdf":
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(file_path.read_bytes(), dpi=200, first_page=page, last_page=page)
        if not images:
            raise HTTPException(404, f"Page {page} not found")
        import tempfile
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        images[0].save(tmp.name)
        img_path = tmp.name
    else:
        raise HTTPException(400, f"Cannot detect on .{ext} files")

    detections = run_inference(model_path, img_path, confidence=ai_cfg.yolo_confidence)

    return {
        "detections": detections,
        "count": len(detections),
        "model": model_path,
        "confidence_threshold": ai_cfg.yolo_confidence,
        "page": page,
    }

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

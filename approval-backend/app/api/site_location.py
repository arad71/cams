"""
Site location endpoints: which cadastre lot an application is on, whether the
site plan matches that lot, and automatic alignment of the plan to the map.
"""
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models.application import Application, Document
from app.models.user import User
from app.services import site_geo

router = APIRouter(prefix="/applications", tags=["site-location"])


def _app(db: Session, app_id: int) -> Application:
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    return app


def _site_plan_doc(db: Session, app: Application, doc_id: int | None = None) -> Document | None:
    q = db.query(Document).filter(Document.application_id == app.id)
    if doc_id:
        return q.filter(Document.id == doc_id).first()
    docs = [d for d in q.all() if d.file_path and "site" in (d.category or "").lower() and Path(d.file_path).exists()]
    return sorted(docs, key=lambda d: d.id)[-1] if docs else None


def resolve_lot(app: Application, db: Session, force: bool = False) -> dict:
    """Find the cadastre lot and store it on the application."""
    if app.lot_match and app.lot_match.get("status") == "matched" and app.lot_match.get("manual") and not force:
        return app.lot_match
    ex = (app.site_plan_data or {}).get("extraction", app.site_plan_data or {})
    lot_no = app.lot_number or (ex.get("property") or {}).get("lot_number")
    res = site_geo.find_lot(app.property_address or "", lot_no)
    record = {k: v for k, v in res.items() if k != "feature"}
    record["checked_at"] = datetime.now(timezone.utc).isoformat()
    record["searched"] = {"address": app.property_address, "lot_number": lot_no}
    if res.get("feature"):
        record["lot"] = site_geo.feature_summary(res["feature"])
        if res["status"] == "matched":
            ring = site_geo.normalise_latlng_ring(res["feature"].get("geometry"))
            if len(ring) >= 3:
                new_poly = [[round(a, 7), round(b, 7)] for a, b in ring]
                if new_poly != (app.lot_polygon or []):
                    app.lot_polygon = new_poly
                    app.georef_overlay = None  # an alignment to a different lot is no longer valid
    app.lot_match = record
    db.commit()
    return record


def auto_align(app: Application, db: Session, doc: Document | None = None) -> dict:
    """Align the site plan to the lot automatically. Vector PDF first, then AI-located corners."""
    doc = doc or _site_plan_doc(db, app)
    if not doc:
        return {"status": "skipped", "reason": "No site plan file"}
    if not app.lot_polygon or len(app.lot_polygon) < 3:
        return {"status": "skipped", "reason": "No cadastre lot for this application"}
    data = Path(doc.file_path).read_bytes()
    overlay, tried = None, []
    is_pdf = (doc.file_type or Path(doc.file_path).suffix.lstrip(".")).lower() == "pdf"
    if is_pdf:
        tried.append("vector")
        try:
            overlay = site_geo.georef_from_vector(data, app.lot_polygon)
        except Exception as e:
            print(f"  ⚠ Vector georeference failed: {e}")
    accept = overlay and overlay["fit_rms_m"] <= 1.0 and abs(overlay.get("scale_error_pct") or 0) <= 5
    if not accept:
        settings = get_settings()
        if settings.ANTHROPIC_API_KEY:
            tried.append("ai-corners")
            try:
                from app.services.ai_config import get_ai_config
                if is_pdf:
                    from pdf2image import convert_from_bytes
                    import io
                    im = convert_from_bytes(data, dpi=site_geo.PDF_RENDER_DPI, first_page=1, last_page=1)[0]
                    b = io.BytesIO(); im.save(b, format="PNG"); png = b.getvalue()
                    dpi = site_geo.PDF_RENDER_DPI
                else:
                    png, dpi = data, None
                scale = None
                ex = (app.site_plan_data or {}).get("extraction", {})
                for s in (ex.get("siteplan_measurements") or {}).get("all_dimensions_found") or []:
                    scale = scale or site_geo.find_drawing_scale(str(s))
                ai = site_geo.georef_from_image(png, app.lot_polygon, settings.ANTHROPIC_API_KEY,
                                                get_ai_config(db).claude_model, scale if dpi else None,
                                                dpi or site_geo.PDF_RENDER_DPI)
                if ai and (not overlay or ai["fit_rms_m"] < overlay["fit_rms_m"]):
                    overlay = ai
            except Exception as e:
                print(f"  ⚠ AI corner georeference failed: {e}")
    if not overlay:
        return {"status": "failed", "tried": tried,
                "reason": "Couldn't find the lot boundary on the plan. Align it manually by clicking its corners."}
    overlay["docId"] = doc.id
    overlay["aligned_at"] = datetime.now(timezone.utc).isoformat()
    app.georef_overlay = overlay
    db.commit()
    return {"status": "aligned", "tried": tried, "overlay": overlay}


def location_summary(app: Application) -> dict:
    vector_area = (app.georef_overlay or {}).get("plan_lot_area_m2")
    return {
        "lot_match": app.lot_match,
        "plan_check": site_geo.plan_cadastre_check(app.site_plan_data, app.lot_polygon, vector_area),
        "alignment": {**site_geo.alignment_quality(app.georef_overlay),
                      "overlay": app.georef_overlay},
    }


@router.get("/{app_id}/site-location")
def get_site_location(app_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return location_summary(_app(db, app_id))


@router.post("/{app_id}/site-location/resolve-lot")
def post_resolve_lot(app_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    app = _app(db, app_id)
    resolve_lot(app, db, force=True)
    return location_summary(app)


@router.post("/{app_id}/site-location/auto-align")
def post_auto_align(app_id: int, doc_id: int | None = None, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    app = _app(db, app_id)
    if not app.lot_polygon:
        resolve_lot(app, db)
    result = auto_align(app, db, _site_plan_doc(db, app, doc_id))
    return {**location_summary(app), "result": {k: v for k, v in result.items() if k != "overlay"}}


def after_site_plan_analysis(app: Application, doc: Document, db: Session) -> None:
    """Called after AI reads a site plan: find the lot (if needed) and align the plan."""
    try:
        if not app.lot_match or app.lot_match.get("status") != "matched":
            resolve_lot(app, db)
        if not app.georef_overlay or (app.georef_overlay or {}).get("autoMatched"):
            r = auto_align(app, db, doc)
            print(f"  ✓ Site plan alignment for {app.ref_number}: {r.get('status')} {r.get('reason', '')}")
    except Exception as e:
        print(f"  ⚠ Site location step failed for {app.ref_number}: {e}")

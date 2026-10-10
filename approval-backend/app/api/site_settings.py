from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.user import User
from app.models.site_settings import SiteSetting

router = APIRouter(prefix="/settings", tags=["Site Settings"])

# Default settings — seeded on first access if table is empty
DEFAULTS = [
    # Branding
    ("org_name",           "Council",                      "branding", "Organisation Name",       True),
    ("org_short_name",     "Council",                              "branding", "Short Name",              True),
    ("system_name",        "Crossover Approval Management System",   "branding", "System Name",             True),
    ("system_short_name",  "CAMS",                                   "branding", "System Short Name",       True),
    ("system_version",     "3.1",                                    "branding", "Version",                 True),
    ("system_icon",        "🏛",                                     "branding", "System Icon (emoji)",     True),
    ("logo_url",           "",                                       "branding", "Logo URL (optional)",     True),
    ("primary_color",      "#1abc9c",                                "branding", "Primary Color",           True),
    ("dark_color",         "#1a3a4a",                                "branding", "Dark Color",              True),
    ("portal_title",       "Approval Portal",                        "branding", "Portal Title",            True),

    # Contact
    ("contact_email",      "asset.services@council.wa.gov.au",     "contact",  "Contact Email",           True),
    ("contact_phone",      "(08) 9257 9999",                         "contact",  "Contact Phone",           True),
    ("contact_address",    "Council Office Address",      "contact",  "Street Address",          True),
    ("website_url",        "https://www.council.wa.gov.au",        "contact",  "Website URL",             True),
    ("portal_url",         "",                                       "contact",  "CAMS Portal URL (for email links)", True),

    # Legal
    ("copyright_text",     "© 2026 Council. All rights reserved.", "legal", "Copyright Text",     True),
    ("privacy_url",        "",                                       "legal",    "Privacy Policy URL",      True),
    ("terms_url",          "",                                       "legal",    "Terms of Use URL",        True),
    ("disclaimer",         "This system is for authorised council staff only.", "legal", "Login Disclaimer", True),

    # System (not public)
    ("email_domain",       "council.wa.gov.au",                    "system",   "Default Email Domain",    False),
    ("ref_prefix",         "CRO",                                    "system",   "Reference Number Prefix", False),
    ("guideline_version",  "3.1",                                    "system",   "Guideline Version",       False),
    ("guideline_date",     "23/06/2022",                             "system",   "Guideline Date",          False),

    # AI Pipeline (not public)
    ("ai_analysis_mode",            "ai",                        "ai",       "Analysis Mode",       False),
    ("ai_claude_model",             "claude-sonnet-5-5",                   "ai",       "AI Model",                             False),
    ("ai_yolo_model_path",          "",                              "ai",       "YOLO Model File Path (.pt)",                  False),
    ("ai_yolo_confidence_threshold","0.7",                           "ai",       "YOLO Confidence Threshold (0.0-1.0)",         False),
    ("ai_phase2_sample_threshold",  "100",                           "ai",       "Phase 2 (Hybrid) Min Training Samples",       False),
    ("ai_phase3_sample_threshold",  "500",                           "ai",       "Phase 3 (YOLO Primary) Min Training Samples", False),
    ("ai_auto_analyse_on_upload",   "true",                          "ai",       "Auto-run AI on Site Plan Upload",             False),
    ("ai_fallback_to_claude",       "true",                          "ai",       "Fallback to AI When Low Confidence", False),
]


def _ensure_defaults(db: Session):
    """Seed default settings — adds any missing keys (safe to run repeatedly)."""
    existing_keys = {r.key for r in db.query(SiteSetting.key).all()}
    added = 0
    for key, value, cat, label, public in DEFAULTS:
        if key not in existing_keys:
            db.add(SiteSetting(key=key, value=value, category=cat, label=label, is_public=public))
            added += 1
    # Move installs off retired model ids, which the API now rejects with 404
    from app.services.ai_analyser import RETIRED_MODELS, CURRENT_MODEL
    row = db.query(SiteSetting).filter(SiteSetting.key == "ai_claude_model").first()
    if row and row.value in RETIRED_MODELS:
        print(f"  ✓ ai_claude_model: {row.value} is retired, switched to {CURRENT_MODEL}")
        row.value = CURRENT_MODEL
        added += 1
    if added:
        db.commit()
        print(f"  ✓ Added/updated {added} site settings")


@router.get("/public")
def get_public_settings(db: Session = Depends(get_db)):
    """Public endpoint — returns branding/contact settings for login page and UI.
    No authentication required."""
    _ensure_defaults(db)
    settings = db.query(SiteSetting).filter(SiteSetting.is_public == True).all()
    return {s.key: s.value for s in settings}


@router.get("/")
def get_all_settings(db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    """Admin only — returns all settings with metadata."""
    _ensure_defaults(db)
    settings = db.query(SiteSetting).order_by(SiteSetting.category, SiteSetting.key).all()
    return [{
        "id": s.id, "key": s.key, "value": s.value,
        "category": s.category, "label": s.label,
        "is_public": s.is_public, "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    } for s in settings]


@router.patch("/")
def update_settings(
    updates: dict,  # {"org_name": "City of Armadale", "system_version": "4.0"}
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin only — update one or more settings."""
    from app.services.audit import log_audit
    _ensure_defaults(db)
    changed = {}
    for key, new_value in updates.items():
        setting = db.query(SiteSetting).filter(SiteSetting.key == key).first()
        if setting:
            old = setting.value
            setting.value = new_value
            if old != new_value:
                changed[key] = {"old": old, "new": new_value}
    db.commit()
    if changed:
        log_audit(db=db, action="update", entity_type="site_settings", user=current_user,
                  description=f"Updated settings: {', '.join(changed.keys())}",
                  field_changes=changed)
    return {"updated": list(changed.keys()), "count": len(changed)}

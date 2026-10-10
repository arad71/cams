"""
AI Pipeline Configuration — reads from site_settings table.

Usage:
    from app.services.ai_config import get_ai_config
    cfg = get_ai_config(db)
    if cfg.mode == "claude":
        # use AI API
    elif cfg.mode == "yolo":
        # use YOLO model
    elif cfg.mode == "hybrid":
        # try YOLO first, fallback to AI if low confidence
"""
from dataclasses import dataclass
from sqlalchemy.orm import Session
from app.models.site_settings import SiteSetting


@dataclass
class AIConfig:
    mode: str                     # "claude" | "yolo" | "hybrid"
    claude_model: str             # e.g. "claude-sonnet-5-5"
    yolo_model_path: str          # e.g. "/opt/cams/models/siteplan_v1.pt"
    yolo_confidence: float        # 0.0 - 1.0
    phase2_threshold: int         # samples needed for hybrid mode
    phase3_threshold: int         # samples needed for YOLO-primary mode
    auto_analyse: bool            # auto-run on site plan upload
    fallback_to_ai: bool      # YOLO fallback to AI when low confidence


def get_ai_config(db: Session) -> AIConfig:
    """Read AI pipeline settings from site_settings table."""
    rows = db.query(SiteSetting).filter(SiteSetting.category == "ai").all()
    s = {r.key: r.value for r in rows}

    return AIConfig(
        mode=s.get("ai_analysis_mode", "claude"),
        claude_model=s.get("ai_claude_model", "claude-sonnet-5-5"),
        yolo_model_path=s.get("ai_yolo_model_path", ""),
        yolo_confidence=float(s.get("ai_yolo_confidence_threshold", "0.7")),
        phase2_threshold=int(s.get("ai_phase2_sample_threshold", "100")),
        phase3_threshold=int(s.get("ai_phase3_sample_threshold", "500")),
        auto_analyse=s.get("ai_auto_analyse_on_upload", "true").lower() == "true",
        fallback_to_ai=s.get("ai_fallback_to_ai", "true").lower() == "true",
    )

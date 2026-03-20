"""
Audit Logging Service

Usage in any endpoint:
    from app.services.audit import log_audit

    log_audit(
        db=db,
        user=current_user,
        action="update",
        entity_type="application",
        entity_id=str(app.id),
        entity_ref=app.ref_number,
        description="Updated application status to approved",
        field_changes={"status": {"old": "pending_review", "new": "approved"}},
        request=request,  # FastAPI Request object (for IP/UA)
    )

For system actions (no user):
    log_audit(db=db, action="seed", entity_type="system", description="Database seeded")
"""
from typing import Optional
from sqlalchemy.orm import Session
from app.models.audit import AuditLog
from app.models.user import User


def log_audit(
    db: Session,
    action: str,
    entity_type: str,
    user: Optional[User] = None,
    entity_id: Optional[str] = None,
    entity_ref: Optional[str] = None,
    description: Optional[str] = None,
    field_changes: Optional[dict] = None,
    request=None,
    success: bool = True,
    error_detail: Optional[str] = None,
):
    """Write one audit log entry. Non-blocking — catches all errors."""
    try:
        entry = AuditLog(
            user_id=user.id if user else None,
            user_name=user.name if user else "system",
            user_email=user.email if user else None,
            user_role=user.role if user else "system",
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            entity_ref=entity_ref,
            description=description,
            field_changes=field_changes,
            ip_address=_get_ip(request),
            user_agent=_get_ua(request),
            success=success,
            error_detail=error_detail,
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        # Audit logging must never break the main operation
        print(f"  ⚠ Audit log write failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def _get_ip(request) -> Optional[str]:
    if not request:
        return None
    # Check X-Forwarded-For (behind reverse proxy)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if hasattr(request, "client") and request.client:
        return request.client.host
    return None


def _get_ua(request) -> Optional[str]:
    if not request:
        return None
    return (request.headers.get("user-agent") or "")[:500]

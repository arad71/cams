"""
Audit Log API — WA Government IT Audit Compliance

Endpoints:
  GET  /api/audit/logs    — query audit logs with filters
  GET  /api/audit/summary — aggregate stats for audit dashboard
  GET  /api/audit/export  — CSV export for external audit tools

Access: admin and manager roles only (auditor access)
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta, timezone
from typing import Optional
import csv
import io

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.user import User
from app.models.audit import AuditLog

router = APIRouter(prefix="/audit", tags=["Audit Log"])


@router.get("/logs")
def query_audit_logs(
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    user_id: Optional[int] = None,
    user_email: Optional[str] = None,
    success: Optional[bool] = None,
    date_from: Optional[str] = Query(None, description="ISO date: 2026-01-01"),
    date_to: Optional[str] = Query(None, description="ISO date: 2026-12-31"),
    search: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Query audit logs with comprehensive filters."""
    q = db.query(AuditLog)

    if action:
        q = q.filter(AuditLog.action == action)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if user_email:
        q = q.filter(AuditLog.user_email.ilike(f"%{user_email}%"))
    if success is not None:
        q = q.filter(AuditLog.success == success)
    if date_from:
        q = q.filter(AuditLog.timestamp >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(AuditLog.timestamp <= datetime.fromisoformat(date_to + "T23:59:59"))
    if search:
        q = q.filter(AuditLog.description.ilike(f"%{search}%"))

    total = q.count()
    logs = q.order_by(desc(AuditLog.timestamp)).offset(offset).limit(limit).all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "logs": [{
            "id": l.id,
            "timestamp": l.timestamp.isoformat() if l.timestamp else None,
            "user_id": l.user_id,
            "user_name": l.user_name,
            "user_email": l.user_email,
            "user_role": l.user_role,
            "action": l.action,
            "entity_type": l.entity_type,
            "entity_id": l.entity_id,
            "entity_ref": l.entity_ref,
            "description": l.description,
            "field_changes": l.field_changes,
            "ip_address": l.ip_address,
            "success": l.success,
            "error_detail": l.error_detail,
        } for l in logs],
    }


@router.get("/summary")
def audit_summary(
    days: int = Query(30, description="Number of days to summarise"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Aggregate audit stats for dashboard/reporting."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    total = db.query(AuditLog).filter(AuditLog.timestamp >= since).count()
    failed = db.query(AuditLog).filter(AuditLog.timestamp >= since, AuditLog.success == False).count()
    logins = db.query(AuditLog).filter(AuditLog.timestamp >= since, AuditLog.action == "login").count()
    login_fails = db.query(AuditLog).filter(AuditLog.timestamp >= since, AuditLog.action == "login_failed").count()

    # Actions breakdown
    actions = db.query(
        AuditLog.action, func.count(AuditLog.id)
    ).filter(AuditLog.timestamp >= since).group_by(AuditLog.action).all()

    # Most active users
    active_users = db.query(
        AuditLog.user_name, AuditLog.user_role, func.count(AuditLog.id)
    ).filter(AuditLog.timestamp >= since, AuditLog.user_id != None
    ).group_by(AuditLog.user_name, AuditLog.user_role
    ).order_by(desc(func.count(AuditLog.id))).limit(10).all()

    # Unique IPs
    unique_ips = db.query(func.count(func.distinct(AuditLog.ip_address))).filter(
        AuditLog.timestamp >= since).scalar()

    return {
        "period_days": days,
        "total_events": total,
        "failed_events": failed,
        "successful_logins": logins,
        "failed_logins": login_fails,
        "unique_ip_addresses": unique_ips,
        "actions_breakdown": {a: c for a, c in actions},
        "most_active_users": [{"name": n, "role": r, "actions": c} for n, r, c in active_users],
    }


@router.get("/export")
def export_audit_csv(
    date_from: str = Query(..., description="ISO date: 2026-01-01"),
    date_to: str = Query(..., description="ISO date: 2026-03-31"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Export audit logs as CSV for external audit tools and compliance reporting."""
    from app.services.audit import log_audit
    q = db.query(AuditLog).filter(
        AuditLog.timestamp >= datetime.fromisoformat(date_from),
        AuditLog.timestamp <= datetime.fromisoformat(date_to + "T23:59:59"),
    ).order_by(AuditLog.timestamp)

    logs = q.all()

    # Log the export itself
    log_audit(db=db, action="audit_export", entity_type="audit", user=current_user,
              description=f"Exported {len(logs)} audit records ({date_from} to {date_to})")

    # Generate CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Timestamp", "User ID", "User Name", "User Email", "User Role",
        "Action", "Entity Type", "Entity ID", "Entity Ref",
        "Description", "IP Address", "Success", "Error",
    ])
    for l in logs:
        writer.writerow([
            l.timestamp.isoformat() if l.timestamp else "",
            l.user_id or "", l.user_name or "", l.user_email or "", l.user_role or "",
            l.action, l.entity_type, l.entity_id or "", l.entity_ref or "",
            l.description or "", l.ip_address or "",
            "Yes" if l.success else "No", l.error_detail or "",
        ])

    output.seek(0)
    filename = f"cams_audit_{date_from}_to_{date_to}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

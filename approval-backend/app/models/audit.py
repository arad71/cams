"""
Audit Log — WA Government IT Audit Compliance

Meets requirements of:
- WA Digital Security Policy (DSP) — Section 8: Logging and Monitoring
- State Records Act 2000 (WA) — record keeping obligations
- AS/NZS ISO 27001 — A.12.4 Logging and Monitoring
- ACSC Essential Eight — Event Logging maturity

Every significant action is recorded with:
  WHO    — user ID, name, role, IP address, user agent
  WHAT   — action type, entity type, entity ID, field changes
  WHEN   — timestamp (UTC)
  WHERE  — IP address, session info
  RESULT — success/failure, error details
"""
from sqlalchemy import Column, Integer, String, DateTime, JSON, Text, Boolean, Index, func
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)

    # WHO
    user_id = Column(Integer, nullable=True, index=True)      # null for anonymous/system
    user_name = Column(String(255))
    user_email = Column(String(255))
    user_role = Column(String(30))

    # WHAT
    action = Column(String(50), nullable=False, index=True)    # login, create, update, delete, view, export, assess, approve, reject, upload, download, etc.
    entity_type = Column(String(50), nullable=False, index=True) # user, application, document, assessment, training_sample, role, department, etc.
    entity_id = Column(String(50))                              # ID of the affected record
    entity_ref = Column(String(100))                            # human-readable ref (e.g. "CRO-2026-0015")
    description = Column(Text)                                  # human-readable description
    field_changes = Column(JSON, nullable=True)                 # {"field": {"old": x, "new": y}} for updates

    # WHEN
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    # WHERE
    ip_address = Column(String(50))
    user_agent = Column(String(500))
    session_id = Column(String(100))                            # JWT jti or session identifier

    # RESULT
    success = Column(Boolean, default=True)
    error_detail = Column(Text, nullable=True)

    # Indexes for common audit queries
    __table_args__ = (
        Index("ix_audit_user_time", "user_id", "timestamp"),
        Index("ix_audit_entity_time", "entity_type", "entity_id", "timestamp"),
        Index("ix_audit_action_time", "action", "timestamp"),
    )

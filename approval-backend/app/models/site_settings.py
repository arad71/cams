from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, func
from app.core.database import Base


class SiteSetting(Base):
    """Key-value store for site-wide settings — branding, copyright, contact info.
    Editable by admin only via System Admin > Settings tab."""
    __tablename__ = "site_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    category = Column(String(50), default="branding")  # branding | contact | legal | system
    label = Column(String(200))  # Human-readable label for admin UI
    is_public = Column(Boolean, default=True)  # Visible without auth (login page needs branding)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

"""
CAMS — Email Notification Service

Sends email notifications for application events.
Configure via environment variables:
  SMTP_ENABLED=true
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=your-email@gmail.com
  SMTP_PASSWORD=your-app-password
  SMTP_FROM_EMAIL=noreply@council.wa.gov.au
  SMTP_FROM_NAME=CAMS Crossover System
"""

import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import get_settings


def _send_email_thread(to_email: str, subject: str, html_body: str, text_body: str = ""):
    """Send email in a background thread so API doesn't block."""
    settings = get_settings()
    if not settings.SMTP_ENABLED:
        print(f"  [EMAIL] SMTP disabled — would send to {to_email}: {subject}")
        return

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to_email
        msg["Subject"] = subject

        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        if settings.SMTP_USE_TLS:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT)

        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)

        server.sendmail(settings.SMTP_FROM_EMAIL, to_email, msg.as_string())
        server.quit()
        print(f"  [EMAIL] Sent to {to_email}: {subject}")
    except Exception as e:
        print(f"  [EMAIL] Failed to send to {to_email}: {e}")


def send_email(to_email: str, subject: str, html_body: str, text_body: str = ""):
    """Send email asynchronously (non-blocking)."""
    thread = threading.Thread(target=_send_email_thread, args=(to_email, subject, html_body, text_body))
    thread.daemon = True
    thread.start()


# ══════════════════════════════════════════════════════════
# Notification Templates
# ══════════════════════════════════════════════════════════

def _base_template(content: str, council_name: str = "Council") -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f8fa; padding: 20px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a3a4a, #2c5364); padding: 20px 24px;">
      <div style="color: #fff; font-size: 18px; font-weight: 700;">{council_name}</div>
      <div style="color: #1abc9c; font-size: 12px; margin-top: 2px;">Crossover Assessment Management System</div>
    </div>
    <!-- Content -->
    <div style="padding: 24px;">
      {content}
    </div>
    <!-- Footer -->
    <div style="padding: 16px 24px; background: #f8fafb; border-top: 1px solid #eef2f4; font-size: 11px; color: #95a5a6; text-align: center;">
      This is an automated notification from CAMS. Please do not reply to this email.
    </div>
  </div>
</body>
</html>"""


def notify_officer_assigned(officer_email: str, officer_name: str, app_ref: str,
                            property_address: str, owner_name: str,
                            assigned_by: str, portal_url: str = "",
                            council_name: str = "Council"):
    """Notify an officer they've been assigned to an application."""
    content = f"""
      <div style="font-size: 14px; color: #1a3a4a; margin-bottom: 16px;">
        Hi <strong>{officer_name}</strong>,
      </div>
      <div style="font-size: 13px; color: #333; line-height: 1.6; margin-bottom: 16px;">
        You have been assigned a new crossover application for assessment.
      </div>
      <!-- Details card -->
      <div style="background: #f5f8fa; border: 1px solid #e4e9ec; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 8px; color: #7a8a94; font-weight: 600; width: 120px;">Reference</td>
            <td style="padding: 4px 8px; color: #1a3a4a; font-weight: 700;">{app_ref}</td>
          </tr>
          <tr>
            <td style="padding: 4px 8px; color: #7a8a94; font-weight: 600;">Property</td>
            <td style="padding: 4px 8px; color: #1a3a4a;">{property_address}</td>
          </tr>
          <tr>
            <td style="padding: 4px 8px; color: #7a8a94; font-weight: 600;">Applicant</td>
            <td style="padding: 4px 8px; color: #1a3a4a;">{owner_name}</td>
          </tr>
          <tr>
            <td style="padding: 4px 8px; color: #7a8a94; font-weight: 600;">Assigned by</td>
            <td style="padding: 4px 8px; color: #1a3a4a;">{assigned_by}</td>
          </tr>
        </table>
      </div>
      {f'<a href="{portal_url}" style="display: inline-block; background: linear-gradient(135deg, #1a3a4a, #2c5364); color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 700; font-size: 13px;">Open in CAMS</a>' if portal_url else ''}
      <div style="font-size: 12px; color: #95a5a6; margin-top: 16px;">
        Please review the application and complete the assessment checklist.
      </div>"""

    subject = f"[CAMS] Application {app_ref} assigned to you — {property_address}"
    html = _base_template(content, council_name)
    text = f"Hi {officer_name},\n\nYou have been assigned application {app_ref} for {property_address} (applicant: {owner_name}).\nAssigned by: {assigned_by}\n\nPlease log in to CAMS to review."

    send_email(officer_email, subject, html, text)


def notify_status_change(to_email: str, to_name: str, app_ref: str,
                         property_address: str, old_status: str, new_status: str,
                         changed_by: str, portal_url: str = "",
                         council_name: str = "Council"):
    """Notify when application status changes."""
    status_colors = {
        "approved": "#27ae60", "conditionally_approved": "#e67e22",
        "refused": "#e74c3c", "under_assessment": "#3498db",
        "pending_review": "#95a5a6", "on_hold": "#f39c12",
    }
    color = status_colors.get(new_status, "#7a8a94")
    display_status = new_status.replace("_", " ").title()

    content = f"""
      <div style="font-size: 14px; color: #1a3a4a; margin-bottom: 16px;">
        Hi <strong>{to_name}</strong>,
      </div>
      <div style="font-size: 13px; color: #333; line-height: 1.6; margin-bottom: 16px;">
        The status of application <strong>{app_ref}</strong> has been updated.
      </div>
      <div style="background: #f5f8fa; border: 1px solid #e4e9ec; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <div style="font-size: 12px; color: #7a8a94; margin-bottom: 6px;">Property: {property_address}</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="padding: 4px 12px; border-radius: 4px; background: #e4e9ec; color: #7a8a94; font-size: 12px; font-weight: 600;">{old_status.replace('_', ' ').title()}</span>
          <span style="color: #95a5a6;">&rarr;</span>
          <span style="padding: 4px 12px; border-radius: 4px; background: {color}20; color: {color}; font-size: 12px; font-weight: 700;">{display_status}</span>
        </div>
        <div style="font-size: 11px; color: #95a5a6; margin-top: 8px;">Changed by: {changed_by}</div>
      </div>
      {f'<a href="{portal_url}" style="display: inline-block; background: linear-gradient(135deg, #1a3a4a, #2c5364); color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 700; font-size: 13px;">View Application</a>' if portal_url else ''}"""

    subject = f"[CAMS] {app_ref} status: {display_status}"
    html = _base_template(content, council_name)
    text = f"Hi {to_name},\n\nApplication {app_ref} ({property_address}) status changed from {old_status} to {new_status}.\nChanged by: {changed_by}"

    send_email(to_email, subject, html, text)

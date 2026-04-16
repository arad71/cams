from datetime import datetime
from pathlib import Path
import os
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status, Request
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.user import User
from app.models.application import Application, ApplicationNote, Document, Inspection, Report
from app.schemas import (
    ApplicationCreate, ApplicationUpdate, ApplicationOut, ApplicationListOut,
    ChecklistUpdate, NoteCreate, NoteOut,
    InspectionCreate, InspectionUpdate, InspectionOut,
    ReportOut, ReportListOut,
)
from app.api.documents import _build_doc_out

router = APIRouter(prefix="/applications", tags=["Applications"])


def _gen_ref_number(db: Session) -> str:
    """Generate next sequential ref number CX-YYYY-NNNN."""
    year = datetime.now().year
    last = (
        db.query(Application)
        .filter(Application.ref_number.like(f"CX-{year}-%"))
        .order_by(Application.ref_number.desc())
        .first()
    )
    if last:
        seq = int(last.ref_number.split("-")[-1]) + 1
    else:
        seq = 1
    return f"CX-{year}-{seq:04d}"


# ─── List Applications (role-filtered) ──────────────────
@router.get("/", response_model=list[ApplicationListOut])
def list_applications(
    status_filter: str = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Application).options(joinedload(Application.assigned_officer))

    # Exclude soft-deleted applications
    q = q.filter((Application.is_deleted == False) | (Application.is_deleted == None))

    # Engineers only see their assigned cases
    if current_user.role == "engineer":
        q = q.filter(Application.officer_id == current_user.id)

    if status_filter:
        q = q.filter(Application.status == status_filter)

    try:
        apps = q.order_by(Application.submitted_date.desc()).all()
    except Exception:
        # Fallback if is_deleted column doesn't exist yet
        db.rollback()
        q2 = db.query(Application).options(joinedload(Application.assigned_officer))
        if current_user.role == "engineer":
            q2 = q2.filter(Application.officer_id == current_user.id)
        if status_filter:
            q2 = q2.filter(Application.status == status_filter)
        apps = q2.order_by(Application.submitted_date.desc()).all()

    return [
        ApplicationListOut(
            id=a.id,
            ref_number=a.ref_number,
            submitted_date=a.submitted_date,
            status=a.status,
            owner_name=a.owner_name,
            property_address=a.property_address,
            officer_name=a.assigned_officer.name if a.assigned_officer else None,
        )
        for a in apps
    ]


# ─── List Deleted Applications (admin only) ───────────────
@router.get("/deleted/list")
def list_deleted_applications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Return all soft-deleted applications for the admin panel."""
    apps = (
        db.query(Application)
        .options(joinedload(Application.deleted_by))
        .filter(Application.is_deleted == True)
        .order_by(Application.deleted_at.desc())
        .all()
    )
    return [
        {
            "id": a.id,
            "ref_number": a.ref_number,
            "property_address": a.property_address,
            "owner_name": a.owner_name,
            "deleted_by": a.deleted_by.name if a.deleted_by else "Unknown",
            "deleted_at": a.deleted_at.isoformat() if a.deleted_at else None,
            "reason": a.delete_reason,
        }
        for a in apps
    ]


# ─── Get Single Application ─────────────────────────────
@router.get("/{app_id}", response_model=ApplicationOut)
def get_application(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = (
        db.query(Application)
        .options(
            joinedload(Application.assigned_officer),
            joinedload(Application.notes).joinedload(ApplicationNote.author),
            joinedload(Application.documents).joinedload(Document.reviewed_by),
            joinedload(Application.inspections),
        )
        .filter(Application.id == app_id)
        .first()
    )
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Engineers can only view their own assigned cases
    if current_user.role == "engineer" and app.officer_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not assigned to this case")

    _out_fields = set(ApplicationOut.model_fields.keys())
    return ApplicationOut(
        **{c.name: getattr(app, c.name) for c in app.__table__.columns if c.name in _out_fields},
        officer_name=app.assigned_officer.name if app.assigned_officer else None,
        notes=[NoteOut(id=n.id, text=n.text, author_name=n.author.name if n.author else None, created_at=n.created_at) for n in app.notes],
        documents=[_build_doc_out(d) for d in app.documents],
        inspections=[InspectionOut.model_validate(i) for i in app.inspections],
    )


# ─── Create Application ─────────────────────────────────
@router.post("/", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(data: ApplicationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), request: Request = None):
    from app.services.audit import log_audit
    ref = _gen_ref_number(db)
    app = Application(ref_number=ref, **data.model_dump())
    db.add(app)
    db.commit()
    db.refresh(app)
    log_audit(db=db, action="create", entity_type="application", user=current_user, entity_id=str(app.id), entity_ref=ref, description=f"Created application {ref} for {data.property_address}", request=request)
    return get_application(app.id, db, current_user)


# ─── Update Application (status, assignment, checklist) ──
@router.patch("/{app_id}", response_model=ApplicationOut)
def update_application(app_id: int, data: ApplicationUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), request: Request = None):
    from app.services.audit import log_audit
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    update_data = data.model_dump(exclude_unset=True)

    # Only managers/admins can change status or assignment
    if current_user.role == "engineer":
        restricted = {"status", "officer_id", "contribution_eligible", "contribution_amount"}
        if restricted & set(update_data.keys()):
            raise HTTPException(status_code=403, detail="Engineers cannot change status or assignment")

    # Track changes for audit
    changes = {}
    for key, value in update_data.items():
        old_val = getattr(app, key, None)
        if old_val != value:
            changes[key] = {"old": str(old_val) if old_val is not None else None, "new": str(value) if value is not None else None}
        setattr(app, key, value)

    db.commit()
    db.refresh(app)
    if changes:
        log_audit(db=db, action="update", entity_type="application", user=current_user, entity_id=str(app.id), entity_ref=app.ref_number, description=f"Updated {', '.join(changes.keys())}", field_changes=changes, request=request)

    # Send email notification on status change
    if "status" in changes and app.assigned_officer:
        from app.services.email import notify_status_change
        from app.models.site_settings import SiteSetting
        council_setting = db.query(SiteSetting).filter(SiteSetting.key == "council_name").first()
        council_name = council_setting.value if council_setting else "Council"
        portal_setting = db.query(SiteSetting).filter(SiteSetting.key == "portal_url").first()
        portal_url = portal_setting.value if portal_setting else ""

        notify_status_change(
            to_email=app.assigned_officer.email,
            to_name=app.assigned_officer.name,
            app_ref=app.ref_number,
            property_address=app.property_address or "",
            old_status=changes["status"]["old"] or "—",
            new_status=changes["status"]["new"] or "—",
            changed_by=current_user.name,
            portal_url=portal_url,
            council_name=council_name,
        )

    return get_application(app.id, db, current_user)


# ─── Assign Officer (manager/admin only) ─────────────────
@router.post("/{app_id}/assign/{officer_id}", response_model=ApplicationOut)
def assign_officer(
    app_id: int,
    officer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    officer = db.query(User).filter(User.id == officer_id, User.is_active == True).first()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found or inactive")

    app.officer_id = officer_id
    if app.status == "pending_review":
        app.status = "under_assessment"
    db.commit()
    db.refresh(app)
    from app.services.audit import log_audit
    log_audit(db=db, action="assign_officer", entity_type="application", user=current_user, entity_id=str(app.id), entity_ref=app.ref_number, description=f"Assigned officer {officer.name} to {app.ref_number}", field_changes={"officer_id": {"old": None, "new": str(officer_id)}})

    # Send email notification to assigned officer
    from app.services.email import notify_officer_assigned
    from app.models.site_settings import SiteSetting
    council_setting = db.query(SiteSetting).filter(SiteSetting.key == "council_name").first()
    council_name = council_setting.value if council_setting else "Council"
    portal_setting = db.query(SiteSetting).filter(SiteSetting.key == "portal_url").first()
    portal_url = portal_setting.value if portal_setting else ""

    notify_officer_assigned(
        officer_email=officer.email,
        officer_name=officer.name,
        app_ref=app.ref_number,
        property_address=app.property_address or "—",
        owner_name=app.owner_name or "—",
        assigned_by=current_user.name,
        portal_url=portal_url,
        council_name=council_name,
    )

    return get_application(app.id, db, current_user)


# ─── Update Checklist ────────────────────────────────────
@router.patch("/{app_id}/checklist", response_model=ApplicationOut)
def update_checklist(app_id: int, data: ChecklistUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Merge checklist data
    existing = app.checklist_data or {}
    existing.update(data.checklist_data)
    app.checklist_data = existing
    db.commit()
    db.refresh(app)
    return get_application(app.id, db, current_user)


# ─── Notes ───────────────────────────────────────────────
@router.post("/{app_id}/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def add_note(app_id: int, data: NoteCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    note = ApplicationNote(application_id=app_id, author_id=current_user.id, text=data.text)
    db.add(note)
    db.commit()
    db.refresh(note)
    return NoteOut(id=note.id, text=note.text, author_name=current_user.name, created_at=note.created_at)


# ─── Documents ───────────────────────────────────────────

# ─── Inspections ─────────────────────────────────────────
@router.post("/{app_id}/inspections", response_model=InspectionOut, status_code=status.HTTP_201_CREATED)
def schedule_inspection(app_id: int, data: InspectionCreate, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin", "manager"))):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    insp = Inspection(application_id=app_id, **data.model_dump())
    db.add(insp)
    db.commit()
    db.refresh(insp)
    return insp


@router.patch("/{app_id}/inspections/{insp_id}", response_model=InspectionOut)
def update_inspection(app_id: int, insp_id: int, data: InspectionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    insp = db.query(Inspection).filter(Inspection.id == insp_id, Inspection.application_id == app_id).first()
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")

    update_data = data.model_dump(exclude_unset=True)
    # Merge field_checklist instead of replacing
    if "field_checklist" in update_data and insp.field_checklist:
        merged = {**(insp.field_checklist or {}), **update_data["field_checklist"]}
        update_data["field_checklist"] = merged
    for key, value in update_data.items():
        setattr(insp, key, value)
    db.commit()
    db.refresh(insp)
    return insp


@router.post("/{app_id}/inspections/{insp_id}/photo")
async def upload_inspection_photo(app_id: int, insp_id: int, file: UploadFile = File(...), caption: str = "", checklist_item: str = "", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Upload a photo for an inspection."""
    from pathlib import Path
    import uuid
    insp = db.query(Inspection).filter(Inspection.id == insp_id, Inspection.application_id == app_id).first()
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")

    # Save file
    upload_dir = Path("/app/uploads/inspections") if Path("/app").exists() else Path("uploads/inspections")
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename).suffix or ".jpg"
    photo_id = str(uuid.uuid4())[:8]
    filename = f"insp_{insp_id}_{photo_id}{ext}"
    filepath = upload_dir / filename
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Add to photos list
    photos = insp.photos or []
    photos.append({
        "id": photo_id,
        "filename": filename,
        "caption": caption,
        "checklist_item": checklist_item,
        "timestamp": datetime.utcnow().isoformat(),
        "size_bytes": len(content),
    })
    insp.photos = photos
    db.commit()
    db.refresh(insp)
    return {"id": photo_id, "filename": filename}


@router.get("/{app_id}/inspections/{insp_id}/photos/{filename}")
def get_inspection_photo(app_id: int, insp_id: int, filename: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Serve an inspection photo."""
    from fastapi.responses import FileResponse
    from pathlib import Path
    insp = db.query(Inspection).filter(Inspection.id == insp_id, Inspection.application_id == app_id).first()
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")

    upload_dir = Path("/app/uploads/inspections") if Path("/app").exists() else Path("uploads/inspections")
    file_path = upload_dir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    media_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    media_type = media_types.get(file_path.suffix.lower(), "image/jpeg")
    return FileResponse(file_path, media_type=media_type)

# ─── Reports (versioned snapshots) ───────────────────────
@router.post("/{app_id}/reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def generate_report(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Generate a new versioned report snapshot for an application."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Compute next version number
    last_version = (
        db.query(Report.version)
        .filter(Report.application_id == app_id)
        .order_by(Report.version.desc())
        .first()
    )
    version = (last_version[0] + 1) if last_version else 1

    # Snapshot assessment data
    from app.models.assessment import CaseAssessment, AssessmentItem
    case_results = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id)
        .options(joinedload(CaseAssessment.item))
        .all()
    )

    checklist_snap = {}
    ai_pass = ai_fail = ai_review = off_approved = off_rejected = 0
    for ca in case_results:
        code = ca.item.code if ca.item else str(ca.item_id)
        checklist_snap[code] = {
            "ai_result": ca.ai_result,
            "ai_confidence": ca.ai_confidence,
            "ai_reason": ca.ai_reason,
            "officer_result": ca.officer_result,
            "status": ca.status,
            "note": ca.note,
        }
        if ca.ai_result == "pass": ai_pass += 1
        elif ca.ai_result == "fail": ai_fail += 1
        else: ai_review += 1
        if ca.officer_result == "approved": off_approved += 1
        elif ca.officer_result == "rejected": off_rejected += 1

    total = len(case_results)
    recommendation = "APPROVE" if ai_fail == 0 and off_rejected == 0 else "REJECT" if ai_fail > 3 else "REVIEW"

    summary = {
        "total": total, "ai_pass": ai_pass, "ai_review": ai_review, "ai_fail": ai_fail,
        "officer_approved": off_approved, "officer_rejected": off_rejected,
        "score_pct": round(ai_pass / total * 100, 1) if total > 0 else 0,
    }

    app_snap = {
        "ref_number": app.ref_number, "owner_name": app.owner_name,
        "property_address": app.property_address, "lot_number": app.lot_number,
        "plan_number": app.plan_number, "frontage": app.frontage,
        "road_name": app.road_name, "road_type": app.road_type,
        "crossover_width": app.crossover_width, "crossover_surface": app.crossover_surface,
        "crossover_count": app.crossover_count,
        "officer": app.assigned_officer.name if app.assigned_officer else None,
        "conditions": app.conditions or [],
        "decision_note": app.decision_note or "",
    }

    notes_snap = [
        {"text": n.text, "author": n.author.name if n.author else "—", "date": n.created_at.isoformat()}
        for n in app.notes
    ]

    report = Report(
        application_id=app_id, version=version, generated_by_id=current_user.id,
        status_at_generation=app.status, recommendation=recommendation,
        summary_data=summary, checklist_snapshot=checklist_snap,
        app_snapshot=app_snap, notes_snapshot=notes_snap,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return ReportOut(
        id=report.id, application_id=report.application_id, version=report.version,
        generated_by_name=current_user.name, status_at_generation=report.status_at_generation,
        recommendation=report.recommendation, summary_data=report.summary_data,
        checklist_snapshot=report.checklist_snapshot, app_snapshot=report.app_snapshot,
        notes_snapshot=report.notes_snapshot, created_at=report.created_at,
    )


@router.get("/{app_id}/reports", response_model=list[ReportListOut])
def list_reports(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all report versions for an application."""
    reports = (
        db.query(Report)
        .filter(Report.application_id == app_id)
        .options(joinedload(Report.generated_by))
        .order_by(Report.version.desc())
        .all()
    )
    return [
        ReportListOut(
            id=r.id, version=r.version,
            generated_by_name=r.generated_by.name if r.generated_by else None,
            recommendation=r.recommendation, summary_data=r.summary_data,
            created_at=r.created_at,
        )
        for r in reports
    ]


@router.get("/{app_id}/reports/{version}", response_model=ReportOut)
def get_report(app_id: int, version: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get a specific report version."""
    report = (
        db.query(Report)
        .filter(Report.application_id == app_id, Report.version == version)
        .options(joinedload(Report.generated_by))
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report version not found")
    return ReportOut(
        id=report.id, application_id=report.application_id, version=report.version,
        generated_by_name=report.generated_by.name if report.generated_by else None,
        status_at_generation=report.status_at_generation,
        recommendation=report.recommendation, summary_data=report.summary_data,
        checklist_snapshot=report.checklist_snapshot, app_snapshot=report.app_snapshot,
        notes_snapshot=report.notes_snapshot, created_at=report.created_at,
    )


@router.get("/{app_id}/reports/{version}/pdf")
def download_report_pdf(app_id: int, version: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Download a report as a formatted PDF."""
    from fastapi.responses import Response
    from app.services.report_pdf import generate_assessment_pdf
    from app.models.assessment import AssessmentCategory, AssessmentItem

    report = (
        db.query(Report)
        .filter(Report.application_id == app_id, Report.version == version)
        .options(joinedload(Report.generated_by))
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report version not found")

    # Build categories with items for the PDF
    cats = (
        db.query(AssessmentCategory)
        .filter(AssessmentCategory.is_active == True)
        .order_by(AssessmentCategory.sort_order)
        .all()
    )
    categories = []
    for cat in cats:
        items = (
            db.query(AssessmentItem)
            .filter(AssessmentItem.category_id == cat.id, AssessmentItem.is_active == True)
            .order_by(AssessmentItem.sort_order)
            .all()
        )
        categories.append({
            "code": cat.code,
            "label": cat.label,
            "icon": cat.icon or "",
            "items": [{"code": it.code, "label": it.label, "reference": it.reference or ""} for it in items],
        })

    # Get council name from site settings
    from app.models.site_settings import SiteSetting
    council_setting = db.query(SiteSetting).filter(SiteSetting.key == "council_name").first()
    council_name = council_setting.value if council_setting else "Council"

    report_data = {
        "app_snapshot": report.app_snapshot or {},
        "summary_data": report.summary_data or {},
        "checklist_snapshot": report.checklist_snapshot or {},
        "notes_snapshot": report.notes_snapshot or [],
        "recommendation": report.recommendation or "REVIEW",
        "categories": categories,
        "status_at_generation": report.status_at_generation or "—",
        "generated_by_name": report.generated_by.name if report.generated_by else "—",
        "version": report.version,
    }

    pdf_bytes = generate_assessment_pdf(report_data, council_name)
    app_ref = (report.app_snapshot or {}).get("ref_number", f"APP-{app_id}")
    filename = f"CAMS_Report_{app_ref}_v{version}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── Soft-Delete Application (admin only) ─────────────────
@router.delete("/{app_id}")
def delete_application(
    app_id: int,
    body: dict,  # {"reason": "Duplicate application"}
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    request: Request = None,
):
    """Soft-delete an application. Requires a reason. Admin only."""
    from app.services.audit import log_audit
    from datetime import timezone

    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "A reason for deletion is required")

    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    if app.is_deleted:
        raise HTTPException(400, "Application is already deleted")

    app.is_deleted = True
    app.deleted_at = datetime.now(timezone.utc)
    app.deleted_by_id = current_user.id
    app.delete_reason = reason
    app.status = "deleted"
    db.commit()

    log_audit(
        db=db, action="delete", entity_type="application", user=current_user,
        entity_id=str(app.id), entity_ref=app.ref_number,
        description=f"Soft-deleted application {app.ref_number}: {reason}",
        request=request,
    )

    return {"message": f"Application {app.ref_number} deleted", "reason": reason}


# ─── Restore Deleted Application (admin only) ─────────────
@router.post("/{app_id}/restore")
def restore_application(
    app_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    request: Request = None,
):
    """Restore a soft-deleted application."""
    from app.services.audit import log_audit

    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    if not app.is_deleted:
        raise HTTPException(400, "Application is not deleted")

    app.is_deleted = False
    app.deleted_at = None
    app.deleted_by_id = None
    app.delete_reason = None
    app.status = "pending_review"
    db.commit()

    log_audit(
        db=db, action="restore", entity_type="application", user=current_user,
        entity_id=str(app.id), entity_ref=app.ref_number,
        description=f"Restored application {app.ref_number}",
        request=request,
    )

    return {"message": f"Application {app.ref_number} restored"}

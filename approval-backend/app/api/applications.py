from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.core.config import get_settings
from app.models.user import User
from app.models.application import Application, ApplicationNote, Document, Inspection, Report
from app.schemas import (
    ApplicationCreate, ApplicationUpdate, ApplicationOut, ApplicationListOut,
    ChecklistUpdate, NoteCreate, NoteOut, DocumentCreate, DocumentOut,
    InspectionCreate, InspectionUpdate, InspectionOut,
    ReportOut, ReportListOut,
)

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

    # Engineers only see their assigned cases
    if current_user.role == "engineer":
        q = q.filter(Application.officer_id == current_user.id)

    if status_filter:
        q = q.filter(Application.status == status_filter)

    apps = q.order_by(Application.submitted_date.desc()).all()

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


# ─── Get Single Application ─────────────────────────────
@router.get("/{app_id}", response_model=ApplicationOut)
def get_application(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = (
        db.query(Application)
        .options(
            joinedload(Application.assigned_officer),
            joinedload(Application.notes).joinedload(ApplicationNote.author),
            joinedload(Application.documents),
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

    return ApplicationOut(
        **{c.name: getattr(app, c.name) for c in app.__table__.columns},
        officer_name=app.assigned_officer.name if app.assigned_officer else None,
        notes=[NoteOut(id=n.id, text=n.text, author_name=n.author.name if n.author else None, created_at=n.created_at) for n in app.notes],
        documents=[DocumentOut.model_validate(d) for d in app.documents],
        inspections=[InspectionOut.model_validate(i) for i in app.inspections],
    )


# ─── Create Application ─────────────────────────────────
@router.post("/", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(data: ApplicationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ref = _gen_ref_number(db)
    app = Application(ref_number=ref, **data.model_dump())
    db.add(app)
    db.commit()
    db.refresh(app)
    return get_application(app.id, db, current_user)


# ─── Update Application (status, assignment, checklist) ──
@router.patch("/{app_id}", response_model=ApplicationOut)
def update_application(app_id: int, data: ApplicationUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    update_data = data.model_dump(exclude_unset=True)

    # Only managers/admins can change status or assignment
    if current_user.role == "engineer":
        restricted = {"status", "officer_id", "contribution_eligible", "contribution_amount"}
        if restricted & set(update_data.keys()):
            raise HTTPException(status_code=403, detail="Engineers cannot change status or assignment")

    for key, value in update_data.items():
        setattr(app, key, value)

    db.commit()
    db.refresh(app)
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
@router.get("/{app_id}/documents", response_model=list[DocumentOut])
def list_documents(app_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Document).filter(Document.application_id == app_id).order_by(Document.uploaded_at.desc()).all()


@router.post("/{app_id}/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def add_document(app_id: int, data: DocumentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    doc = Document(application_id=app_id, uploaded_by_id=current_user.id, **data.model_dump())
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{app_id}/documents/upload", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    app_id: int,
    file: UploadFile = File(...),
    category: str = Form("Other"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload an actual file and save it to disk under {DOCUMENT_DIR}/{ref_number}/."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    settings = get_settings()
    # Create subfolder: {DOCUMENT_DIR}/{ref_number}/
    app_dir = Path(settings.DOCUMENT_DIR) / app.ref_number
    app_dir.mkdir(parents=True, exist_ok=True)

    # Sanitise filename, keep original name
    safe_name = file.filename.replace("/", "_").replace("\\", "_").replace("..", "_")
    dest_path = app_dir / safe_name

    # If file already exists, add a suffix
    if dest_path.exists():
        stem = dest_path.stem
        suffix = dest_path.suffix
        counter = 1
        while dest_path.exists():
            dest_path = app_dir / f"{stem}_{counter}{suffix}"
            counter += 1

    # Write file to disk
    file_bytes = await file.read()
    file_size = len(file_bytes)
    with open(dest_path, "wb") as f:
        f.write(file_bytes)

    # Determine file type from extension
    file_ext = (safe_name.rsplit(".", 1)[-1] if "." in safe_name else "").lower()

    # Format size string
    if file_size < 1024:
        size_str = f"{file_size} B"
    elif file_size < 1048576:
        size_str = f"{file_size / 1024:.1f} KB"
    else:
        size_str = f"{file_size / 1048576:.1f} MB"

    # Create document record with file_path
    doc = Document(
        application_id=app_id,
        uploaded_by_id=current_user.id,
        name=safe_name,
        file_type=file_ext,
        file_size=size_str,
        category=category,
        file_path=str(dest_path),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.patch("/{app_id}/documents/{doc_id}", response_model=DocumentOut)
def update_document_status(app_id: int, doc_id: int, doc_status: str = Query(..., alias="status"), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.application_id == app_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = doc_status
    db.commit()
    db.refresh(doc)
    return doc


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
    for key, value in update_data.items():
        setattr(insp, key, value)
    db.commit()
    db.refresh(insp)
    return insp

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

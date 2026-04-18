from fastapi import FastAPI, UploadFile, File, Query, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import engine, Base
from app.api import auth, users, applications, documents, assessments, sight_distance, lookups, ai_training, audit, site_settings, geodata, extract_local

from app.schemas.ai import FindingsResponse, ErrorResponse
from app.services.ai_analyser import analyse_document, GUIDELINE

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    version="3.1.0",
    description="Council — Crossover Approval System Backend API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",  
    swagger_ui_parameters={
        "url": "/api/openapi.json"
    }
)


origins = [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

# CORS
app.add_middleware(
    CORSMiddleware,
    # allow_origins=settings.cors_origins_list,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(applications.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(assessments.router, prefix="/api")
app.include_router(sight_distance.router, prefix="/api")

app.include_router(lookups.router, prefix="/api")
app.include_router(ai_training.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(site_settings.router, prefix="/api")
app.include_router(geodata.router, prefix="/api")
app.include_router(extract_local.router, prefix="/api")


@app.get("/ai/guideline")
def ai_guideline():
    return GUIDELINE

@app.post("/ai/analyse", response_model=FindingsResponse | ErrorResponse)
async def ai_analyse(
    file: UploadFile = File(..., description="PDF or image (.pdf/.jpg/.jpeg/.png)"),
    model: str = Query(default=settings.AI_MODEL_DEFAULT, description="AI vision model"),
    api_key_query: str | None = Query(default=None, alias="api_key"),
    api_key_header: str | None = Header(default=None, alias="X-Anthropic-Api-Key"),
    # current_user: dict = Depends(get_current_user),  # ⟵ uncomment to protect route
):
    # We accept any content-type; detection happens in service; it returns a clean error for bad bytes.
    api_key = api_key_query or api_key_header or settings.ANTHROPIC_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing AI API key. Set ANTHROPIC_API_KEY in .env")

    try:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty file uploaded.")

        findings = analyse_document(
            file_bytes=data,
            filename=file.filename or "upload",
            api_key=api_key,
            model=model,
        )

        if "error" in findings:
            # Return as ErrorResponse
            return ErrorResponse(
                error=findings["error"],
                raw_response=findings.get("raw_response"),
                analysed_at=findings["analysed_at"],
                source_file=findings.get("source_file"),
            )
        # Normal response
        return FindingsResponse(**findings)

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError as re_err:
        raise HTTPException(status_code=500, detail=str(re_err))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@app.on_event("startup")
def on_startup():
    """Create tables if they don't exist and seed lookup data."""
    # Import all models so SQLAlchemy knows about every table
    import app.models  # noqa — ensures all models are registered with Base

    # Run column migrations FIRST — for existing tables that need new columns
    _migrate_columns()

    # Now create any tables that don't exist yet (new deployments)
    Base.metadata.create_all(bind=engine)
    _seed_lookups()
    _backfill_columns()


def _migrate_columns():
    """Add columns to existing tables that were added after initial deployment.
    Must run BEFORE create_all so queries on new columns don't fail."""
    from sqlalchemy import text

    migration_stmts = [
        "ALTER TABLE applications ADD COLUMN IF NOT EXISTS extraction_locked BOOLEAN DEFAULT FALSE",
        "ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE",
        "ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
        "ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_by_id INTEGER",
        "ALTER TABLE applications ADD COLUMN IF NOT EXISTS delete_reason TEXT",
        "ALTER TABLE applications ADD COLUMN IF NOT EXISTS form_extraction_data JSONB",
        "ALTER TABLE applications ADD COLUMN IF NOT EXISTS title_extraction_data JSONB",
    ]

    # Use engine directly (not ORM session) for DDL
    try:
        with engine.connect() as conn:
            # Check if applications table exists first
            result = conn.execute(text(
                "SELECT 1 FROM information_schema.tables WHERE table_name='applications'"
            ))
            if not result.fetchone():
                print("  ℹ applications table doesn't exist yet — skipping migrations")
                return

            for stmt in migration_stmts:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception as e:
                    print(f"  ⚠ Migration: {e}")
                    conn.rollback()

            # Backfill NULLs
            try:
                conn.execute(text("UPDATE applications SET is_deleted = FALSE WHERE is_deleted IS NULL"))
                conn.commit()
                print("  ✓ Column migrations complete")
            except Exception:
                conn.rollback()

            # ── Assessment rule updates ──
            try:
                # Update da_pathway rules (R-014): check Building Application + Site Plan documents
                # Delete old da_pathway rules and insert new ones
                result = conn.execute(text(
                    "SELECT COUNT(*) FROM assessment_rules ar "
                    "JOIN assessment_items ai ON ar.item_id = ai.id "
                    "WHERE ai.code = 'da_pathway' AND ar.source = 'app'"
                ))
                old_count = result.scalar() or 0
                if old_count > 0:
                    conn.execute(text(
                        "DELETE FROM assessment_rules WHERE item_id IN "
                        "(SELECT id FROM assessment_items WHERE code = 'da_pathway')"
                    ))
                    # Get the item id
                    result = conn.execute(text("SELECT id FROM assessment_items WHERE code = 'da_pathway'"))
                    row = result.fetchone()
                    if row:
                        iid = row[0]
                        conn.execute(text(
                            "INSERT INTO assessment_rules (item_id, priority, source, field, operator, value, result, confidence, reason_template, is_active) VALUES "
                            "(:iid, 0, 'doc', 'Building Application', 'not_exists', NULL, 'pass', 0.9, 'No Building Application — standalone crossover application (R-014)', TRUE),"
                            "(:iid2, 1, 'doc', 'Site Plan', 'exists', NULL, 'pass', 0.85, 'Building Application and Site Plan both present — DA pathway confirmed (R-014)', TRUE),"
                            "(:iid3, 9, 'doc', 'Building Application', 'exists', NULL, 'review', 0.7, 'Building Application uploaded but no Site Plan — site plan required for assessment (R-014)', TRUE)"
                        ), {"iid": iid, "iid2": iid, "iid3": iid})
                    conn.commit()
                    print("  ✓ da_pathway rules updated (R-014)")
            except Exception as e:
                print(f"  ⚠ da_pathway rule update: {e}")
                try:
                    conn.rollback()
                except Exception:
                    pass
    except Exception as e:
        print(f"  ⚠ Migration error (non-fatal): {e}")


def _backfill_columns():
    """Backfill NULL values for columns added after initial deployment."""
    from app.core.database import SessionLocal
    from app.models.user import User
    from sqlalchemy import text

    db = SessionLocal()
    try:
        n1 = db.query(User).filter(User.auth_provider == None).update({"auth_provider": "local"})
        n2 = db.query(User).filter(User.must_change_password == None).update({"must_change_password": False})
        if n1 or n2:
            db.commit()
            if n1: print(f"  ✓ Backfilled auth_provider='local' on {n1} users")
            if n2: print(f"  ✓ Backfilled must_change_password=False on {n2} users")
    except Exception as e:
        print(f"  ⚠ Backfill error: {e}")
        db.rollback()
    finally:
        db.close()


def _seed_lookups():
    """Ensure roles, departments, and site_settings tables have data."""
    from app.core.database import SessionLocal
    from app.models.lookup import Role, Department
    from app.models.site_settings import SiteSetting

    db = SessionLocal()
    try:
        if db.query(Role).count() == 0:
            db.add_all([
                Role(code="admin", label="Administrator", icon="🛡️", color="#e74c3c", permissions=["all"], sort_order=1),
                Role(code="manager", label="Manager", icon="👔", color="#2980b9", permissions=["view_all", "assign", "approve", "refer", "reject", "report"], sort_order=2),
                Role(code="engineer", label="Engineer", icon="🔧", color="#27ae60", permissions=["view_assigned", "assess", "note", "inspect"], sort_order=3),
                Role(code="inspector", label="Inspector", icon="🔍", color="#8e44ad", permissions=["view_assigned", "inspect", "note", "photo"], sort_order=4),
                Role(code="viewer", label="Viewer", icon="👁", color="#7f8c8d", permissions=["view_all"], sort_order=5),
            ])
            db.commit()
            print("  ✓ Auto-seeded roles")

        if db.query(Department).count() == 0:
            db.add_all([
                Department(code="asset_services", label="Asset Services", sort_order=1),
                Department(code="engineering", label="Engineering", sort_order=2),
                Department(code="planning", label="Planning & Development", sort_order=3),
                Department(code="parks", label="Parks & Environment", sort_order=4),
                Department(code="compliance", label="Compliance", sort_order=5),
                Department(code="customer_service", label="Customer Service", sort_order=6),
            ])
            db.commit()
            print("  ✓ Auto-seeded departments")

        if db.query(SiteSetting).count() == 0:
            from app.api.site_settings import DEFAULTS
            for key, value, cat, label, public in DEFAULTS:
                db.add(SiteSetting(key=key, value=value, category=cat, label=label, is_public=public))
            db.commit()
            print(f"  ✓ Auto-seeded {len(DEFAULTS)} site settings")
    except Exception as e:
        print(f"  ⚠ Lookup seed error: {e}")
        db.rollback()
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "3.1.0"}

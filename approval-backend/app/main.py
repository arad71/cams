from fastapi import FastAPI, UploadFile, File, Query, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import engine, Base
from app.api import auth, users, applications, assessments, sight_distance, extract_app_form, lookups

from app.schemas.ai import FindingsResponse, ErrorResponse
from app.services.ai_analyser import analyse_document, GUIDELINE

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    version="3.1.0",
    description="City of Kalamunda — Crossover Approval System Backend API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


origins = [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

# CORS
app.add_middleware(
    CORSMiddleware,
    # allow_origins=settings.cors_origins_list,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(applications.router, prefix="/api")
app.include_router(assessments.router, prefix="/api")
app.include_router(sight_distance.router, prefix="/api")
app.include_router(extract_app_form.router, prefix="/api")
app.include_router(lookups.router, prefix="/api")


@app.get("/ai/guideline")
def ai_guideline():
    return GUIDELINE

@app.post("/ai/analyse", response_model=FindingsResponse | ErrorResponse)
async def ai_analyse(
    file: UploadFile = File(..., description="PDF or image (.pdf/.jpg/.jpeg/.png)"),
    model: str = Query(default=settings.AI_MODEL_DEFAULT, description="Claude vision-capable model"),
    api_key_query: str | None = Query(default=None, alias="api_key"),
    api_key_header: str | None = Header(default=None, alias="X-Anthropic-Api-Key"),
    # current_user: dict = Depends(get_current_user),  # ⟵ uncomment to protect route
):
    # We accept any content-type; detection happens in service; it returns a clean error for bad bytes.
    api_key = api_key_query or api_key_header or settings.ANTHROPIC_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing Anthropic API key. Provide ?api_key=..., header 'X-Anthropic-Api-Key', or set ANTHROPIC_API_KEY env var.")

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
    Base.metadata.create_all(bind=engine)
    _seed_lookups()
    _backfill_columns()


def _backfill_columns():
    """Backfill NULL values for columns added after initial deployment."""
    from app.core.database import SessionLocal
    from app.models.user import User

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
    """Ensure roles and departments tables have data."""
    from app.core.database import SessionLocal
    from app.models.lookup import Role, Department

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
    except Exception as e:
        print(f"  ⚠ Lookup seed error: {e}")
        db.rollback()
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "3.1.0"}

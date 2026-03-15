from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import engine, Base
from app.api import auth, users, applications, assessments

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    version="3.1.0",
    description="City of Kalamunda — Crossover Approval System Backend API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(applications.router, prefix="/api")
app.include_router(assessments.router, prefix="/api")


@app.on_event("startup")
def on_startup():
    """Create tables if they don't exist (dev only — use Alembic in prod)."""
    if settings.DEBUG:
        Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "3.1.0"}

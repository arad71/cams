from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import engine, Base
from app.api import auth, applications, reference

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    description="City of Kalamunda — Public Crossover Application Portal API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(applications.router, prefix="/api")
app.include_router(reference.router, prefix="/api")


@app.on_event("startup")
def on_startup():
    if settings.DEBUG:
        Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "2.0.0"}

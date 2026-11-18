"""
Regression tests for the four security fixes:
  1. /ai/analyse requires login
  2. Only admin/manager change status; viewers/inspectors can't edit; engineers only their own cases
  3. /sight-distances requires login (writes: admin) and /extract-local-ocr requires login
  4. Production seed creates no demo accounts; one superadmin that must change password

Needs a throwaway PostgreSQL database (the models use JSONB). ALL TABLES ARE DROPPED.
    export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cams_test
    pytest approval-backend/tests -q
"""
import os

import pytest

if "DATABASE_URL" not in os.environ:
    pytest.skip("Set DATABASE_URL to a throwaway Postgres database", allow_module_level=True)

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import Base, engine, SessionLocal
from app.core.auth import create_access_token, verify_password
import app.models  # noqa: F401  registers every table
from app.models.user import User
from app.models.application import Application
from app import seed
from app.main import app as fastapi_app

settings = get_settings()


def _reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def _run_seed(demo: bool, password: str = ""):
    settings.SEED_DEMO_DATA = demo
    settings.INITIAL_ADMIN_PASSWORD = password
    seed.run_seed()


# ─── 4. Seeding ──────────────────────────────────────────

def test_production_seed_creates_only_one_superadmin_with_given_password():
    _reset_db()
    _run_seed(demo=False, password="Initial-Pass-123")
    db = SessionLocal()
    try:
        users = db.query(User).all()
        assert len(users) == 1
        admin = users[0]
        assert admin.role == "superadmin"
        assert admin.email == settings.INITIAL_ADMIN_EMAIL.lower()
        assert admin.must_change_password is True
        assert verify_password("Initial-Pass-123", admin.hashed_password)
        assert not verify_password("superpassword123", admin.hashed_password)
        assert db.query(Application).count() == 0
    finally:
        db.close()


def test_production_seed_generates_random_password_when_none_given(capsys):
    _reset_db()
    _run_seed(demo=False)
    out = capsys.readouterr().out
    assert "Temporary password (shown once):" in out
    generated = out.split("Temporary password (shown once):")[1].split()[0]
    db = SessionLocal()
    try:
        admin = db.query(User).one()
        assert verify_password(generated, admin.hashed_password)
    finally:
        db.close()


def test_production_seed_is_idempotent():
    _reset_db()
    _run_seed(demo=False, password="Initial-Pass-123")
    _run_seed(demo=False, password="Something-Else")
    db = SessionLocal()
    try:
        assert db.query(User).count() == 1
    finally:
        db.close()


# ─── API tests run on the demo dataset ──────────────────

@pytest.fixture(scope="module")
def demo():
    _reset_db()
    _run_seed(demo=True)
    db = SessionLocal()
    try:
        users = {u.email.split("@")[0]: u for u in db.query(User).all()}
        assert {"admin", "manager", "engineer", "engineer2", "viewer"} <= users.keys()
        # an inspector user for the role tests
        insp = User(name="Inspector", email="inspector@council.wa.gov.au", initials="IN",
                    hashed_password="x", role="inspector", department="Compliance")
        db.add(insp)
        db.commit()
        users["inspector"] = insp
        eng = users["engineer"]
        mine = db.query(Application).filter(Application.officer_id == eng.id).first()
        other = db.query(Application).filter(
            (Application.officer_id != eng.id) | (Application.officer_id == None)  # noqa: E711
        ).first()
        assert mine and other, "demo seed should have assigned and unassigned cases"
        tokens = {k: create_access_token({"sub": str(u.id), "role": u.role}) for k, u in users.items()}
        yield {"tokens": tokens, "mine": (mine.id, mine.status), "other": other.id}
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    return TestClient(fastapi_app)


def auth(demo, who):
    return {"Authorization": f"Bearer {demo['tokens'][who]}"}


# 1. AI endpoint
def test_ai_analyse_requires_login(client, demo):
    r = client.post("/ai/analyse", files={"file": ("x.png", b"\x89PNG", "image/png")})
    assert r.status_code == 401


def test_ai_analyse_ignores_api_key_query_param(client, demo):
    r = client.post("/ai/analyse?api_key=sk-test", files={"file": ("x.png", b"\x89PNG", "image/png")})
    assert r.status_code == 401


# 2. Application updates
def test_viewer_cannot_change_status(client, demo):
    r = client.patch(f"/api/applications/{demo['other']}", json={"status": "approved"}, headers=auth(demo, "viewer"))
    assert r.status_code == 403


def test_inspector_cannot_change_status(client, demo):
    r = client.patch(f"/api/applications/{demo['other']}", json={"status": "approved"}, headers=auth(demo, "inspector"))
    assert r.status_code == 403


def test_engineer_cannot_edit_unassigned_case(client, demo):
    db = SessionLocal()
    try:
        before = db.get(Application, demo["other"]).crossover_width
    finally:
        db.close()
    new_width = (before or 0) + 1.25
    r = client.patch(f"/api/applications/{demo['other']}", json={"crossover_width": new_width}, headers=auth(demo, "engineer"))
    assert r.status_code == 403
    # The change must not have been saved (the old code saved it, then 403'd on the re-read)
    db = SessionLocal()
    try:
        assert db.get(Application, demo["other"]).crossover_width == before
    finally:
        db.close()


def test_engineer_cannot_change_status_on_own_case(client, demo):
    app_id, _ = demo["mine"]
    r = client.patch(f"/api/applications/{app_id}", json={"status": "approved"}, headers=auth(demo, "engineer"))
    assert r.status_code == 403


def test_engineer_can_save_own_case_echoing_current_status(client, demo):
    # The frontend's full-form save always sends the current status; that must still work.
    app_id, current_status = demo["mine"]
    r = client.patch(f"/api/applications/{app_id}",
                     json={"status": current_status, "checklist_data": {"a": True}},
                     headers=auth(demo, "engineer"))
    assert r.status_code == 200, r.text


def test_manager_can_change_status(client, demo):
    r = client.patch(f"/api/applications/{demo['other']}", json={"status": "on_hold"}, headers=auth(demo, "manager"))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "on_hold"


# 3. Sight distances + OCR
def test_sight_distances_require_login(client, demo):
    assert client.get("/api/sight-distances/").status_code == 401
    assert client.post("/api/sight-distances/", json={"speed": 90, "abs_min": 1, "ssd_min": 2}).status_code == 401
    assert client.delete("/api/sight-distances/1").status_code == 401


def test_sight_distances_read_any_user_write_admin_only(client, demo):
    assert client.get("/api/sight-distances/", headers=auth(demo, "viewer")).status_code == 200
    body = {"speed": 95, "abs_min": 100, "ssd_min": 120}
    assert client.post("/api/sight-distances/", json=body, headers=auth(demo, "engineer")).status_code == 403
    r = client.post("/api/sight-distances/", json=body, headers=auth(demo, "admin"))
    assert r.status_code == 201, r.text
    row_id = r.json()["id"]
    assert client.patch(f"/api/sight-distances/{row_id}", json={"abs_min": 1}, headers=auth(demo, "manager")).status_code == 403
    assert client.delete(f"/api/sight-distances/{row_id}", headers=auth(demo, "viewer")).status_code == 403
    assert client.delete(f"/api/sight-distances/{row_id}", headers=auth(demo, "admin")).status_code == 204


def test_extract_local_ocr_requires_login(client, demo):
    r = client.post("/api/extract-local-ocr", files={"file": ("x.pdf", b"%PDF", "application/pdf")})
    assert r.status_code == 401

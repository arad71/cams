"""
Applicant portal security tests: upload type/size/status checks, message
ownership, and unique reference numbers under concurrent creates.

Needs a throwaway PostgreSQL database. ALL TABLES ARE DROPPED.
    export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cams_applicant_test
    pytest applicant-backend/tests -q
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

if "DATABASE_URL" not in os.environ:
    pytest.skip("Set DATABASE_URL to a throwaway Postgres database", allow_module_level=True)

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import Base, engine, SessionLocal
from app.core.auth import create_access_token, hash_password
import app.models  # noqa: F401
from app.models.applicant import Applicant
from app.models.application import ApplicationMessage
from app.main import app as fastapi_app

settings = get_settings()

PDF = b"%PDF-1.4 test"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 10


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    settings.UPLOAD_DIR = str(tmp_path_factory.mktemp("uploads"))
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        people = {}
        for name in ("alice", "bob"):
            a = Applicant(email=f"{name}@example.com", full_name=name.title(), hashed_password=hash_password("pw"))
            db.add(a)
            db.commit()
            people[name] = {"id": a.id, "headers": {"Authorization": f"Bearer {create_access_token({'sub': str(a.id)})}"}}
        yield people
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    return TestClient(fastapi_app)


def _new_app(client, who):
    r = client.post("/api/applications/", json={}, headers=who["headers"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _upload(client, who, app_id, name, content):
    return client.post(f"/api/applications/{app_id}/documents", headers=who["headers"],
                       data={"category": "site_plan"}, files={"file": (name, content)})


def test_valid_pdf_and_png_upload(client, world):
    app_id = _new_app(client, world["alice"])
    assert _upload(client, world["alice"], app_id, "plan.pdf", PDF).status_code == 201
    assert _upload(client, world["alice"], app_id, "photo.png", PNG).status_code == 201


def test_disallowed_extension_rejected(client, world):
    app_id = _new_app(client, world["alice"])
    assert _upload(client, world["alice"], app_id, "evil.html", b"<script>").status_code == 400
    assert _upload(client, world["alice"], app_id, "run.exe", b"MZ\x90\x00").status_code == 400


def test_mismatched_contents_rejected(client, world):
    app_id = _new_app(client, world["alice"])
    assert _upload(client, world["alice"], app_id, "fake.pdf", b"<html>not a pdf</html>").status_code == 400


def test_oversized_upload_rejected(client, world, monkeypatch):
    monkeypatch.setattr(settings, "MAX_FILE_SIZE_MB", 1)
    app_id = _new_app(client, world["alice"])
    big = PDF + b"0" * (1024 * 1024)
    assert _upload(client, world["alice"], app_id, "big.pdf", big).status_code == 413


def test_upload_blocked_after_submission(client, world):
    from app.models.application import CrossoverApplication
    app_id = _new_app(client, world["alice"])
    db = SessionLocal()
    try:
        db.get(CrossoverApplication, app_id).status = "submitted"
        db.commit()
    finally:
        db.close()
    assert _upload(client, world["alice"], app_id, "late.pdf", PDF).status_code == 400


def test_cannot_mark_someone_elses_message_read(client, world):
    app_id = _new_app(client, world["alice"])
    db = SessionLocal()
    try:
        msg = ApplicationMessage(application_id=app_id, sender_type="officer", body="hi")
        db.add(msg)
        db.commit()
        msg_id = msg.id
    finally:
        db.close()
    r = client.patch(f"/api/applications/{app_id}/messages/{msg_id}/read", headers=world["bob"]["headers"])
    assert r.status_code == 403
    db = SessionLocal()
    try:
        assert db.get(ApplicationMessage, msg_id).is_read is False
    finally:
        db.close()
    r = client.patch(f"/api/applications/{app_id}/messages/{msg_id}/read", headers=world["alice"]["headers"])
    assert r.status_code == 200


def test_concurrent_creates_get_unique_refs(client, world):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: client.post("/api/applications/", json={}, headers=world["bob"]["headers"]),
                                range(16)))
    assert all(r.status_code == 201 for r in results), [r.text for r in results if r.status_code != 201][:2]
    refs = [r.json()["ref_number"] for r in results]
    assert len(set(refs)) == len(refs)

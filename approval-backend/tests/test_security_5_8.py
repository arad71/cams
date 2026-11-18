"""
Regression tests for security items 5–8 and the functional fixes:
  5. Microsoft (Entra) ID tokens are verified: signature, audience, issuer, tenant
  6. Only a superadmin can grant or manage the superadmin role
  7. CORS follows the CORS_ORIGINS setting
  8. Read-only media tokens for document/photo URLs; failed-login throttling
  +  Reference numbers stay unique under concurrent creates

Needs a throwaway PostgreSQL database (the models use JSONB). ALL TABLES ARE DROPPED.
    export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cams_test
    pytest approval-backend/tests -q
"""
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

if "DATABASE_URL" not in os.environ:
    pytest.skip("Set DATABASE_URL to a throwaway Postgres database", allow_module_level=True)

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import Base, engine, SessionLocal
from app.core.auth import create_access_token, create_media_token, hash_password
import app.models  # noqa: F401
import app.core.entra as entra
from app.models.user import User
from app.models.application import Application, Document, Inspection
from app import seed
from app.main import app as fastapi_app

settings = get_settings()
TENANT = "11111111-2222-3333-4444-555555555555"
CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(scope="module")
def world():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    settings.SEED_DEMO_DATA = True
    settings.INITIAL_ADMIN_PASSWORD = ""
    seed.run_seed()
    db = SessionLocal()
    try:
        users = {u.email.split("@")[0]: u for u in db.query(User).all()}
        tokens = {k: create_access_token({"sub": str(u.id), "role": u.role}) for k, u in users.items()}
        ids = {k: u.id for k, u in users.items()}
        app_row = db.query(Application).first()
        yield {"tokens": tokens, "ids": ids, "app_id": app_row.id}
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    return TestClient(fastapi_app)


def auth(world, who):
    return {"Authorization": f"Bearer {world['tokens'][who]}"}


# ─── 5. Entra ID token verification ─────────────────────

def _rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture()
def entra_env(monkeypatch):
    """Configure Entra, serve a JWKS for one key, and fake Microsoft's token endpoint."""
    key = _rsa_key()
    kid = "test-kid"
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk.update({"kid": kid, "use": "sig", "alg": "RS256"})

    monkeypatch.setattr(settings, "ENTRA_ENABLED", True)
    monkeypatch.setattr(settings, "ENTRA_TENANT_ID", TENANT)
    monkeypatch.setattr(settings, "ENTRA_CLIENT_ID", CLIENT)
    monkeypatch.setattr(settings, "ENTRA_CLIENT_SECRET", "secret")
    monkeypatch.setattr(settings, "ENTRA_AUTO_CREATE_USER", True)
    entra._jwks_cache.clear()

    state = {"id_token": None}

    def fake_get(url, **kw):
        assert url == entra._jwks_url(TENANT)
        return httpx.Response(200, json={"keys": [jwk]}, request=httpx.Request("GET", url))

    def fake_post(url, **kw):
        return httpx.Response(200, json={"id_token": state["id_token"], "access_token": "x"},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "get", fake_get)
    monkeypatch.setattr(httpx, "post", fake_post)

    def make_token(signing_key=key, tid=TENANT, aud=CLIENT, oid=None, email=None, iss=None, kid_=kid):
        now = int(time.time())
        claims = {
            "aud": aud, "tid": tid, "iss": iss or f"https://login.microsoftonline.com/{tid}/v2.0",
            "iat": now, "nbf": now, "exp": now + 600,
            "oid": oid or str(uuid.uuid4()),
            "preferred_username": email or f"sso-{uuid.uuid4().hex[:6]}@council.wa.gov.au",
            "name": "Sso User",
        }
        return jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": kid_})

    state["make"] = make_token
    return state


def _exchange(client, state, token):
    state["id_token"] = token
    return client.post("/api/auth/entra/token", params={"code": "c", "redirect_uri": "https://x/"})


def test_entra_valid_token_signs_in(client, world, entra_env):
    r = _exchange(client, entra_env, entra_env["make"]())
    assert r.status_code == 200, r.text
    assert r.json()["media_token"]


def test_entra_rejects_forged_signature(client, world, entra_env):
    forged = entra_env["make"](signing_key=_rsa_key())  # same kid, wrong key
    assert _exchange(client, entra_env, forged).status_code == 401


def test_entra_rejects_unsigned_token(client, world, entra_env):
    now = int(time.time())
    unsigned = jwt.encode({"aud": CLIENT, "tid": TENANT, "oid": "x", "exp": now + 600,
                           "iss": f"https://login.microsoftonline.com/{TENANT}/v2.0",
                           "preferred_username": "admin@council.wa.gov.au"}, None, algorithm="none")
    assert _exchange(client, entra_env, unsigned).status_code == 401


def test_entra_rejects_other_tenant(client, world, entra_env):
    other = "99999999-8888-7777-6666-555555555555"
    assert _exchange(client, entra_env, entra_env["make"](tid=other)).status_code == 401


def test_entra_rejects_wrong_audience(client, world, entra_env):
    assert _exchange(client, entra_env, entra_env["make"](aud="some-other-app")).status_code == 401


def test_entra_rejects_multi_tenant_config(client, world, entra_env, monkeypatch):
    monkeypatch.setattr(settings, "ENTRA_TENANT_ID", "common")
    assert _exchange(client, entra_env, entra_env["make"]()).status_code == 401


def test_entra_will_not_relink_account_bound_to_another_identity(client, world, entra_env):
    email = f"linked-{uuid.uuid4().hex[:6]}@council.wa.gov.au"
    r = _exchange(client, entra_env, entra_env["make"](email=email))
    assert r.status_code == 200
    # A different Microsoft identity presenting the same username is refused
    r = _exchange(client, entra_env, entra_env["make"](email=email, oid=str(uuid.uuid4())))
    assert r.status_code == 403


def test_entra_placeholder_config_is_treated_as_disabled(client, world, monkeypatch):
    monkeypatch.setattr(settings, "ENTRA_ENABLED", True)
    monkeypatch.setattr(settings, "ENTRA_TENANT_ID", "CHANGE_ME")
    monkeypatch.setattr(settings, "ENTRA_CLIENT_ID", "CHANGE_ME")
    monkeypatch.setattr(settings, "ENTRA_CLIENT_SECRET", "CHANGE_ME")
    assert client.get("/api/auth/config").json()["entra_enabled"] is False
    r = client.post("/api/auth/entra/token", params={"code": "c", "redirect_uri": "https://x/"})
    assert r.status_code == 400


# ─── 6. superadmin role guard ───────────────────────────

def test_admin_cannot_create_superadmin(client, world):
    body = {"name": "Evil", "email": f"e{uuid.uuid4().hex[:6]}@x.au", "role": "superadmin", "password": "Pw-123456"}
    assert client.post("/api/users/", json=body, headers=auth(world, "admin")).status_code == 403


def test_admin_cannot_promote_self_to_superadmin(client, world):
    r = client.patch(f"/api/users/{world['ids']['admin']}", json={"role": "superadmin"}, headers=auth(world, "admin"))
    assert r.status_code == 403


def test_admin_cannot_modify_or_delete_superadmin(client, world):
    sid = world["ids"]["superadmin"]
    assert client.patch(f"/api/users/{sid}", json={"password": "Taken-Over-1"}, headers=auth(world, "admin")).status_code == 403
    assert client.delete(f"/api/users/{sid}", headers=auth(world, "admin")).status_code == 403


def test_unknown_role_rejected(client, world):
    body = {"name": "X", "email": f"x{uuid.uuid4().hex[:6]}@x.au", "role": "god", "password": "Pw-123456"}
    assert client.post("/api/users/", json=body, headers=auth(world, "admin")).status_code == 400


def test_superadmin_can_create_superadmin(client, world):
    body = {"name": "Second Super", "email": f"s{uuid.uuid4().hex[:6]}@x.au", "role": "superadmin", "password": "Pw-123456"}
    assert client.post("/api/users/", json=body, headers=auth(world, "superadmin")).status_code == 201


def test_admin_can_still_manage_normal_users(client, world):
    body = {"name": "New Eng", "email": f"n{uuid.uuid4().hex[:6]}@x.au", "role": "engineer", "password": "Pw-123456"}
    r = client.post("/api/users/", json=body, headers=auth(world, "admin"))
    assert r.status_code == 201
    uid = r.json()["id"]
    assert client.patch(f"/api/users/{uid}", json={"role": "manager"}, headers=auth(world, "admin")).status_code == 200


def test_superadmin_role_code_is_reserved(client, world):
    body = {"code": "superadmin", "label": "Sneaky"}
    assert client.post("/api/lookups/roles", json=body, headers=auth(world, "admin")).status_code == 400


# ─── 7. CORS ────────────────────────────────────────────

def test_cors_only_allows_configured_origins(client, world):
    allowed = settings.cors_origins_list[0]
    pre = {"Access-Control-Request-Method": "GET"}
    ok = client.options("/api/health", headers={"Origin": allowed, **pre})
    assert ok.headers.get("access-control-allow-origin") in (allowed, "*")
    if "*" not in settings.cors_origins_list:
        bad = client.options("/api/health", headers={"Origin": "https://evil.example", **pre})
        assert "access-control-allow-origin" not in bad.headers


# ─── 8a. media tokens ───────────────────────────────────

@pytest.fixture(scope="module")
def stored_doc(world, tmp_path_factory):
    path = tmp_path_factory.mktemp("docs") / "plan.pdf"
    path.write_bytes(b"%PDF-1.4 test")
    db = SessionLocal()
    try:
        doc = Document(application_id=world["app_id"], name="plan.pdf", file_type="pdf", file_path=str(path))
        db.add(doc)
        db.commit()
        return doc.id
    finally:
        db.close()


def test_login_returns_media_token(client, world):
    r = client.post("/api/auth/login", data={"username": "viewer@council.wa.gov.au", "password": "viewer123"})
    assert r.status_code == 200, r.text
    assert r.json()["media_token"]


def test_media_token_cannot_call_the_api(client, world):
    media = create_media_token(world["ids"]["admin"])
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {media}"}).status_code == 401
    assert client.get("/api/users/", headers={"Authorization": f"Bearer {media}"}).status_code == 401


def test_document_file_requires_media_token(client, world, stored_doc):
    url = f"/api/applications/{world['app_id']}/documents/{stored_doc}/file"
    assert client.get(url).status_code == 401
    # The full API token is no longer accepted in URLs
    assert client.get(url, params={"token": world["tokens"]["viewer"]}).status_code == 401
    media = create_media_token(world["ids"]["viewer"])
    r = client.get(url, params={"token": media})
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


def test_media_token_endpoint(client, world):
    r = client.post("/api/auth/media-token", headers=auth(world, "viewer"))
    assert r.status_code == 200 and r.json()["media_token"]


def test_inspection_photo_needs_media_token_and_known_filename(client, world):
    upload_dir = Path("/app/uploads/inspections") if Path("/app").exists() else Path("uploads/inspections")
    upload_dir.mkdir(parents=True, exist_ok=True)
    fname = f"insp_test_{uuid.uuid4().hex[:6]}.jpg"
    (upload_dir / fname).write_bytes(b"\xff\xd8\xff photo")
    stray = f"insp_other_{uuid.uuid4().hex[:6]}.jpg"
    (upload_dir / stray).write_bytes(b"\xff\xd8\xff other")
    db = SessionLocal()
    try:
        insp = Inspection(application_id=world["app_id"], photos=[{"id": "p1", "filename": fname}])
        db.add(insp)
        db.commit()
        insp_id = insp.id
    finally:
        db.close()
    base = f"/api/applications/{world['app_id']}/inspections/{insp_id}/photos"
    media = create_media_token(world["ids"]["viewer"])
    assert client.get(f"{base}/{fname}").status_code == 401
    assert client.get(f"{base}/{fname}", params={"token": media}).status_code == 200
    # A file that exists on disk but isn't one of this inspection's photos is not served
    assert client.get(f"{base}/{stray}", params={"token": media}).status_code == 404


# ─── 8b. login throttling ───────────────────────────────

def test_login_locks_after_repeated_failures(client, world):
    email = f"throttle-{uuid.uuid4().hex[:6]}@council.wa.gov.au"
    db = SessionLocal()
    try:
        db.add(User(name="T", email=email, initials="T", hashed_password=hash_password("Right-Pass-1"), role="viewer"))
        db.commit()
    finally:
        db.close()
    for _ in range(5):
        assert client.post("/api/auth/login", data={"username": email, "password": "wrong"}).status_code == 401
    # Even the right password is refused while locked
    r = client.post("/api/auth/login", data={"username": email, "password": "Right-Pass-1"})
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_login_email_is_case_insensitive(client, world):
    r = client.post("/api/auth/login", data={"username": "Manager@Council.WA.gov.au", "password": "manager123"})
    assert r.status_code == 200


# ─── Reference numbers under concurrency ────────────────

def test_concurrent_creates_get_unique_refs(client, world):
    def create(i):
        return client.post("/api/applications/", json={"owner_name": f"Owner {i}", "property_address": f"{i} Test St"},
                           headers=auth(world, "manager"))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(create, range(16)))
    assert all(r.status_code == 201 for r in results), [r.text for r in results if r.status_code != 201][:2]
    refs = [r.json()["ref_number"] for r in results]
    assert len(set(refs)) == len(refs)


# ─── Missing-import regression (documents.py used joinedload without importing it) ──

def test_document_list_works(client, world, stored_doc):
    r = client.get(f"/api/applications/{world['app_id']}/documents", headers=auth(world, "manager"))
    assert r.status_code == 200, r.text
    assert any(d["id"] == stored_doc for d in r.json())

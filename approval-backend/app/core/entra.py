"""
Microsoft Entra ID (Azure AD) ID-token verification.

The ID token returned from the code exchange is verified before any of its
claims are trusted:
  * signature, against the tenant's published signing keys (JWKS)
  * audience  == ENTRA_CLIENT_ID
  * issuer    == https://login.microsoftonline.com/<tenant>/v2.0
  * tid       == ENTRA_TENANT_ID (so only the council's own tenant can sign in)
  * expiry / not-before

ENTRA_TENANT_ID must be the tenant's GUID (Directory ID), not a domain name
and not "common" / "organizations" / "consumers", which would admit any tenant.
"""
import time
import threading

import httpx
import jwt
from jwt import PyJWTError as JWTError

MULTI_TENANT_ALIASES = {"common", "organizations", "consumers"}
_JWKS_TTL_SECONDS = 6 * 60 * 60

_jwks_cache: dict[str, tuple[float, dict]] = {}
_jwks_lock = threading.Lock()


class EntraTokenError(Exception):
    """The ID token could not be verified; the message is safe to show."""


def _jwks_url(tenant: str) -> str:
    return f"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"


def _get_jwks(tenant: str, force: bool = False) -> dict:
    with _jwks_lock:
        cached = _jwks_cache.get(tenant)
        if cached and not force and time.time() - cached[0] < _JWKS_TTL_SECONDS:
            return cached[1]
    try:
        resp = httpx.get(_jwks_url(tenant), timeout=10)
        resp.raise_for_status()
        jwks = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        raise EntraTokenError(f"Could not fetch Microsoft signing keys: {e}") from e
    with _jwks_lock:
        _jwks_cache[tenant] = (time.time(), jwks)
    return jwks


def _find_key(jwks: dict, kid: str | None) -> dict | None:
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def verify_id_token(id_token: str, tenant_id: str, client_id: str) -> dict:
    """Verify a Microsoft ID token and return its claims, or raise EntraTokenError."""
    if not tenant_id or tenant_id.lower() in MULTI_TENANT_ALIASES:
        raise EntraTokenError(
            "ENTRA_TENANT_ID must be the council's tenant ID, not a multi-tenant alias"
        )
    if not client_id:
        raise EntraTokenError("ENTRA_CLIENT_ID is not set")

    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as e:
        raise EntraTokenError("Malformed id_token") from e
    if header.get("alg") != "RS256":
        raise EntraTokenError("Unexpected id_token signing algorithm")

    kid = header.get("kid")
    key = _find_key(_get_jwks(tenant_id), kid)
    if key is None:
        # Microsoft rotates keys; refresh once before giving up
        key = _find_key(_get_jwks(tenant_id, force=True), kid)
    if key is None:
        raise EntraTokenError("id_token signed with an unknown key")

    try:
        claims = jwt.decode(
            id_token,
            jwt.PyJWK(key).key,
            algorithms=["RS256"],
            audience=client_id,
            options={"require": ["exp", "aud", "iss", "tid"]},
        )
    except JWTError as e:
        raise EntraTokenError(f"id_token failed verification: {e}") from e

    tid = claims.get("tid")
    if not tid:
        raise EntraTokenError("id_token has no tenant (tid) claim")
    expected_issuer = f"https://login.microsoftonline.com/{tid}/v2.0"
    if claims.get("iss") != expected_issuer:
        raise EntraTokenError("id_token issuer does not match its tenant")
    if tid.lower() != tenant_id.lower():
        raise EntraTokenError("Microsoft account is not from the council's tenant")
    return claims

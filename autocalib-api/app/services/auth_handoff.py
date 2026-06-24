"""Single-use handoff codes: Cocopilot Firebase session → Autocalib custom token."""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from app.services.b2b_geography import b2b_base_url
from app.services.b2b_http import get_b2b_http_client
from app.services.firebase_admin_client import (
    create_firebase_custom_token,
    firebase_admin_enabled,
    verify_firebase_id_token,
)

logger = logging.getLogger(__name__)

HANDOFF_TTL_SEC = 60.0


@dataclass
class _HandoffEntry:
    custom_token: str
    expires_at: float


_store: dict[str, _HandoffEntry] = {}
_rate_buckets: dict[str, list[float]] = {}
_RATE_LIMIT_WINDOW_SEC = 60.0
_RATE_LIMIT_MAX = 20


def _prune_expired(now: float | None = None) -> None:
    ts = now if now is not None else time.monotonic()
    expired = [code for code, entry in _store.items() if entry.expires_at <= ts]
    for code in expired:
        _store.pop(code, None)


def _check_rate_limit(client_key: str) -> None:
    now = time.monotonic()
    bucket = _rate_buckets.setdefault(client_key, [])
    bucket[:] = [t for t in bucket if now - t < _RATE_LIMIT_WINDOW_SEC]
    if len(bucket) >= _RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many handoff requests")
    bucket.append(now)


async def _fetch_b2b_user_profile(uid: str, bearer_token: str) -> dict[str, Any]:
    url = f"{b2b_base_url()}/users/{uid}"
    resp = await get_b2b_http_client().get(
        url,
        headers={"Authorization": f"Bearer {bearer_token}"},
    )
    resp.raise_for_status()
    payload = resp.json()
    results = payload.get("results")
    if not isinstance(results, dict):
        raise HTTPException(status_code=502, detail="Invalid B2B user profile response")
    return results


async def create_handoff_code(id_token: str, *, client_key: str = "default") -> str:
    """Verify staff Firebase user and return a one-time handoff code."""
    if not firebase_admin_enabled():
        raise HTTPException(
            status_code=503,
            detail="Auth handoff unavailable (Firebase Admin not configured)",
        )

    _check_rate_limit(client_key)
    _prune_expired()

    try:
        decoded = verify_firebase_id_token(id_token)
    except Exception as exc:
        logger.warning("Handoff rejected: invalid Firebase token (%s)", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Invalid Firebase token") from exc

    uid = str(decoded.get("uid") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid Firebase token (missing uid)")

    try:
        profile = await _fetch_b2b_user_profile(uid, id_token)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("B2B profile lookup failed during handoff")
        raise HTTPException(status_code=502, detail="B2B user profile unavailable") from exc

    if not profile.get("is_staff"):
        raise HTTPException(status_code=403, detail="Autocalib is reserved for staff accounts")

    custom_token = create_firebase_custom_token(uid)
    code = secrets.token_urlsafe(32)
    _store[code] = _HandoffEntry(
        custom_token=custom_token,
        expires_at=time.monotonic() + HANDOFF_TTL_SEC,
    )
    logger.info("Auth handoff code issued for uid=%r", uid)
    return code


def exchange_handoff_code(code: str) -> str:
    """Return a Firebase custom token for a valid handoff code (single use)."""
    raw = code.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Missing handoff code")

    _prune_expired()
    entry = _store.pop(raw, None)
    if entry is None or entry.expires_at <= time.monotonic():
        raise HTTPException(status_code=404, detail="Handoff code expired or invalid")

    return entry.custom_token

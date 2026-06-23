"""Thin async HTTP client for the Cocoparks ops API.

Source endpoint: ``GET {COCOPARKS_PROD_URL}/cocopilot/get-cocospots-status``
returns a pandas-shaped JSON (each column is a dict keyed by row index).
We normalize it once and cache the result for ``CACHE_TTL_SECONDS`` so
listing clients / devices doesn't hammer the upstream service.
"""

from __future__ import annotations

import asyncio
import logging
import os
import ssl
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 300  # 5 min — devices change rarely
HTTP_TIMEOUT_SECONDS = 120.0  # upstream is slow, mirror reference timeout


class CocoparksApiError(RuntimeError):
    """Raised when the Cocoparks ops API is unreachable or misconfigured."""


class CocoparksApiClient:
    """Fetches the cocospot inventory and exposes it as flat lists.

    Single instance per process (see :func:`get_client` below). Thread-safe
    via an asyncio lock guarding the cache refresh.
    """

    def __init__(self, base_url: str, *, verify_ssl: bool = False) -> None:
        if not base_url:
            raise CocoparksApiError(
                "COCOPARKS_PROD_URL is not set — cannot reach the ops API"
            )
        self._base_url = base_url.rstrip("/")
        self._verify_ssl = verify_ssl
        self._cache: list[dict[str, Any]] | None = None
        self._cache_at: float = 0.0
        self._lock = asyncio.Lock()

    async def list_devices(self, *, force: bool = False) -> list[dict[str, Any]]:
        """Return every device row, refreshing the cache when stale."""
        now = time.monotonic()
        if (
            not force
            and self._cache is not None
            and now - self._cache_at < CACHE_TTL_SECONDS
        ):
            return self._cache

        async with self._lock:
            now = time.monotonic()
            if (
                not force
                and self._cache is not None
                and now - self._cache_at < CACHE_TTL_SECONDS
            ):
                return self._cache

            url = f"{self._base_url}/cocopilot/get-cocospots-status"
            logger.info("Fetching cocospot inventory: %s", url)
            try:
                async with httpx.AsyncClient(
                    timeout=HTTP_TIMEOUT_SECONDS, verify=self._verify_ssl
                ) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    payload = response.json()
            except httpx.HTTPError as exc:
                raise CocoparksApiError(
                    f"Cocoparks ops API request failed: {exc}"
                ) from exc

            devices = _normalize_pandas_payload(payload)
            self._cache = devices
            self._cache_at = time.monotonic()
            logger.info("Cocospot inventory cached: %d devices", len(devices))
            return devices


def _normalize_pandas_payload(payload: Any) -> list[dict[str, Any]]:
    """Convert pandas-style ``{col: {row_idx: value}}`` JSON to list-of-dicts."""
    if isinstance(payload, list):
        return [dict(row) for row in payload]

    if isinstance(payload, dict) and "did" in payload:
        keys = list(payload.keys())
        # Row indexes are stringified ints — sort numerically for stable order.
        try:
            row_indexes = sorted(payload["did"].keys(), key=lambda s: int(s))
        except (TypeError, ValueError):
            row_indexes = list(payload["did"].keys())

        rows: list[dict[str, Any]] = []
        for idx in row_indexes:
            row = {key: payload[key].get(idx) for key in keys}
            rows.append(row)
        return rows

    raise CocoparksApiError(
        f"Unexpected cocospot inventory payload shape: {type(payload).__name__}"
    )


_singleton: CocoparksApiClient | None = None


def get_client() -> CocoparksApiClient:
    """Return the process-wide HTTP client, building it on first call."""
    global _singleton
    if _singleton is None:
        base_url = os.getenv("COCOPARKS_PROD_URL", "").strip()
        verify_env = os.getenv("COCOPARKS_PROD_VERIFY_SSL", "false").strip().lower()
        verify_ssl = verify_env in ("1", "true", "yes")
        _singleton = CocoparksApiClient(base_url, verify_ssl=verify_ssl)
    return _singleton


# Suppress noisy InsecureRequestWarning when we deliberately disable verify
ssl._create_default_https_context = ssl._create_unverified_context  # noqa: SLF001

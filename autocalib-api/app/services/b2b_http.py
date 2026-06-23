"""Shared httpx client for backend-b2b (connection reuse across requests)."""

from __future__ import annotations

import httpx

HTTP_TIMEOUT = 120.0

_shared_client: httpx.AsyncClient | None = None


def get_b2b_http_client() -> httpx.AsyncClient:
    """Return a process-wide async HTTP client for B2B calls."""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    return _shared_client


async def close_b2b_http_client() -> None:
    global _shared_client
    if _shared_client is not None and not _shared_client.is_closed:
        await _shared_client.aclose()
    _shared_client = None

"""In-memory cache for B2B slot catalog GETs (global or per ``client_id``)."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

DEFAULT_TTL_SEC = 90.0
GLOBAL_SCOPE = "__global__"


class B2bSlotsCache:
    """TTL cache keyed by scope (global catalog vs one B2B client id)."""

    def __init__(self, ttl_sec: float | None = None) -> None:
        self._ttl = ttl_sec if ttl_sec is not None else float(
            os.environ.get("B2B_SLOTS_CACHE_TTL_SEC", DEFAULT_TTL_SEC),
        )
        self._lock = asyncio.Lock()
        self._records: dict[str, list[dict[str, Any]]] = {}
        self._fetched_at: dict[str, float] = {}

    async def get_records(
        self,
        fetcher: Callable[[], Awaitable[list[dict[str, Any]]]],
        *,
        scope: str = GLOBAL_SCOPE,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        """Return cached records for ``scope`` or call ``fetcher`` on miss / expiry."""
        if force_refresh:
            self.invalidate(scope)

        now = time.monotonic()
        cached = self._records.get(scope)
        if cached is not None and now - self._fetched_at.get(scope, 0.0) < self._ttl:
            return cached

        async with self._lock:
            now = time.monotonic()
            cached = self._records.get(scope)
            if cached is not None and now - self._fetched_at.get(scope, 0.0) < self._ttl:
                return cached
            records = await fetcher()
            self._records[scope] = records
            self._fetched_at[scope] = time.monotonic()
            logger.info(
                "B2B slots cached scope=%r: %d record(s), ttl=%.0fs",
                scope,
                len(records),
                self._ttl,
            )
            return records

    def invalidate(self, scope: str | None = None) -> None:
        """Drop one scope or the whole cache after PUT/POST."""
        if scope is None:
            self._records.clear()
            self._fetched_at.clear()
            return
        self._records.pop(scope, None)
        self._fetched_at.pop(scope, None)


b2b_slots_cache = B2bSlotsCache()

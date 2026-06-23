"""Tests for B2B slots catalog cache."""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.services.b2b_slots_cache import B2bSlotsCache, GLOBAL_SCOPE  # noqa: E402


def test_cache_returns_same_records_without_refetch() -> None:
    async def run() -> None:
        cache = B2bSlotsCache(ttl_sec=60.0)
        calls = 0

        async def fetcher() -> list[dict]:
            nonlocal calls
            calls += 1
            return [{"slot_id": "a"}]

        first = await cache.get_records(fetcher)
        second = await cache.get_records(fetcher)
        assert first == second
        assert calls == 1

    asyncio.run(run())


def test_invalidate_forces_refetch() -> None:
    async def run() -> None:
        cache = B2bSlotsCache(ttl_sec=60.0)
        calls = 0

        async def fetcher() -> list[dict]:
            nonlocal calls
            calls += 1
            return [{"slot_id": str(calls)}]

        await cache.get_records(fetcher)
        cache.invalidate()
        second = await cache.get_records(fetcher)
        assert second == [{"slot_id": "2"}]
        assert calls == 2

    asyncio.run(run())


def test_ttl_expiry_refetches() -> None:
    async def run() -> None:
        cache = B2bSlotsCache(ttl_sec=0.05)
        calls = 0

        async def fetcher() -> list[dict]:
            nonlocal calls
            calls += 1
            return [{"slot_id": str(calls)}]

        await cache.get_records(fetcher)
        await asyncio.sleep(0.06)
        second = await cache.get_records(fetcher)
        assert second == [{"slot_id": "2"}]

    asyncio.run(run())


def test_scoped_invalidate_does_not_clear_other_scopes() -> None:
    async def run() -> None:
        cache = B2bSlotsCache(ttl_sec=60.0)
        global_calls = 0
        client_calls = 0

        async def global_fetcher() -> list[dict]:
            nonlocal global_calls
            global_calls += 1
            return [{"slot_id": f"g{global_calls}"}]

        async def client_fetcher() -> list[dict]:
            nonlocal client_calls
            client_calls += 1
            return [{"slot_id": f"c{client_calls}"}]

        await cache.get_records(global_fetcher, scope=GLOBAL_SCOPE)
        await cache.get_records(client_fetcher, scope="client-a")
        cache.invalidate("client-a")
        await cache.get_records(global_fetcher, scope=GLOBAL_SCOPE)
        client_second = await cache.get_records(client_fetcher, scope="client-a")
        assert client_second == [{"slot_id": "c2"}]
        assert global_calls == 1
        assert client_calls == 2

    asyncio.run(run())

"""B2B client roster for fast GET /api/v1/clients."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.services import b2b_clients  # noqa: E402


def test_fetch_roster_from_api(monkeypatch: pytest.MonkeyPatch) -> None:
    fid = "laRY4KfKshV4ud3V4weJ"
    monkeypatch.setenv("B2B_STAFF_UID", "staff-test-uid")
    monkeypatch.delenv("B2B_CLIENT_ID_MAP", raising=False)
    monkeypatch.setattr(b2b_clients, "load_client_id_map", lambda: {})

    async def _fake_api() -> list[dict]:
        return [{"client_id": fid, "display_name": "Demo City"}]

    monkeypatch.setattr(b2b_clients, "_fetch_b2b_clients_from_api", _fake_api)
    b2b_clients._roster = []
    b2b_clients._roster_cache_at = 0.0

    roster = asyncio.run(b2b_clients.fetch_b2b_client_roster(force_refresh=True))
    assert len(roster) == 1
    assert roster[0]["client_id"] == fid
    assert roster[0]["display_name"] == "Demo City"


def test_fetch_roster_merges_env_map(monkeypatch: pytest.MonkeyPatch) -> None:
    env_id = "AbCdEfGhIjKlMnOpQrStUv"
    api_id = "laRY4KfKshV4ud3V4weJ"
    monkeypatch.setenv("B2B_STAFF_UID", "staff-test-uid")
    monkeypatch.setenv(
        "B2B_CLIENT_ID_MAP",
        json.dumps({"Env Only Client": env_id}),
    )

    async def _fake_api() -> list[dict]:
        return [{"client_id": api_id, "display_name": "API Client"}]

    monkeypatch.setattr(b2b_clients, "_fetch_b2b_clients_from_api", _fake_api)
    b2b_clients._roster = []
    b2b_clients._roster_cache_at = 0.0

    roster = asyncio.run(b2b_clients.fetch_b2b_client_roster(force_refresh=True))
    ids = {row["client_id"] for row in roster}
    assert env_id in ids
    assert api_id in ids

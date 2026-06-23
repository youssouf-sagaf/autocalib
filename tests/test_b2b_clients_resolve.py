"""B2B client registry resolution for Save sync."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.services import b2b_clients  # noqa: E402


def test_resolve_for_sync_uses_b2b_registry_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fid = "CdzMnD6isCm4JPsVRbhk"
    monkeypatch.delenv("B2B_CLIENT_ID_MAP", raising=False)

    async def _fake_index(*, force_refresh: bool = False) -> dict[str, str]:
        return {"demo city": fid}

    monkeypatch.setattr(b2b_clients, "get_b2b_client_name_index", _fake_index)

    b2b_id, warn = asyncio.run(b2b_clients.resolve_b2b_client_id_for_sync("Demo City"))
    assert b2b_id == fid
    assert warn is None


def test_resolve_display_name_matches_underscore_alias(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fid = "CdzMnD6isCm4JPsVRbhk"
    monkeypatch.delenv("B2B_CLIENT_ID_MAP", raising=False)

    async def _fake_index(*, force_refresh: bool = False) -> dict[str, str]:
        index: dict[str, str] = {}
        b2b_clients._register_client_in_index(index, "demo_city", fid)
        return index

    monkeypatch.setattr(b2b_clients, "get_b2b_client_name_index", _fake_index)

    b2b_id, warn = asyncio.run(b2b_clients.resolve_b2b_client_id_for_sync("Demo City"))
    assert b2b_id == fid
    assert warn is None


def test_resolve_for_sync_prefers_env_map(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fid = "AbCdEfGhIjKlMnOpQrSt"
    monkeypatch.setenv(
        "B2B_CLIENT_ID_MAP",
        json.dumps({"Demo City": fid}),
    )

    async def _fake_index(*, force_refresh: bool = False) -> dict[str, str]:
        return {"demo city": "OtherId123456789012"}

    monkeypatch.setattr(b2b_clients, "get_b2b_client_name_index", _fake_index)

    b2b_id, warn = asyncio.run(b2b_clients.resolve_b2b_client_id_for_sync("Demo City"))
    assert b2b_id == fid
    assert warn is None


def test_resolve_for_sync_uses_display_name_when_client_id_is_ops_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fid = "CdzMnD6isCm4JPsVRbhk"
    monkeypatch.delenv("B2B_CLIENT_ID_MAP", raising=False)
    monkeypatch.setattr(
        "autoabsmap.export.b2b_client.load_client_id_map",
        lambda: {},
    )

    async def _fake_index(*, force_refresh: bool = False) -> dict[str, str]:
        return {"sens demo": fid}

    monkeypatch.setattr(b2b_clients, "get_b2b_client_name_index", _fake_index)

    b2b_id, warn = asyncio.run(
        b2b_clients.resolve_b2b_client_id_for_sync("SENS", "SENS DEMO"),
    )
    assert b2b_id == fid
    assert warn is None


def test_resolve_for_sync_warns_when_no_b2b_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("B2B_CLIENT_ID_MAP", raising=False)

    async def _fake_index(*, force_refresh: bool = False) -> dict[str, str]:
        return {}

    monkeypatch.setattr(b2b_clients, "get_b2b_client_name_index", _fake_index)

    b2b_id, warn = asyncio.run(
        b2b_clients.resolve_b2b_client_id_for_sync("Unknown City", None),
    )
    assert b2b_id is None
    assert warn is not None
    assert "unallocated" in warn.lower()

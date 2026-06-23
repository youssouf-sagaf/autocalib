"""B2B client id resolution (display name vs Firestore id)."""

from __future__ import annotations

import json

import pytest

from autoabsmap.export.b2b_client import (
    is_b2b_firestore_client_id,
    resolve_b2b_client_id,
)


def test_firestore_id_accepted() -> None:
    fid = "CdzMnD6isCm4JPsVRbhk"
    assert is_b2b_firestore_client_id(fid)
    b2b_id, warn = resolve_b2b_client_id(fid)
    assert b2b_id == fid
    assert warn is None


def test_display_name_omits_client_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("B2B_CLIENT_ID_MAP", raising=False)
    monkeypatch.setenv("B2B_CLIENT_ID_MAP_FILE", "/nonexistent/b2b_client_id_map.json")
    b2b_id, warn = resolve_b2b_client_id("Demo City")
    assert b2b_id is None
    assert warn is None


def test_committed_map_resolves_livry_gargan(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("B2B_CLIENT_ID_MAP", raising=False)
    monkeypatch.delenv("B2B_CLIENT_ID_MAP_FILE", raising=False)
    b2b_id, warn = resolve_b2b_client_id("LIVRY GARGAN")
    assert b2b_id == "vRy2sRVIUu7vkHbbpH03"
    assert warn is None


def test_env_map_resolves_display_name(monkeypatch: pytest.MonkeyPatch) -> None:
    fid = "CdzMnD6isCm4JPsVRbhk"
    monkeypatch.setenv(
        "B2B_CLIENT_ID_MAP",
        json.dumps({"Demo City": fid}),
    )
    b2b_id, warn = resolve_b2b_client_id("Demo City")
    assert b2b_id == fid
    assert warn is None


def test_env_map_resolves_normalized_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    fid = "laRY4KfKshV4ud3V4weJ"
    monkeypatch.setenv(
        "B2B_CLIENT_ID_MAP",
        json.dumps({"demo_city": fid}),
    )
    b2b_id, warn = resolve_b2b_client_id("Demo City")
    assert b2b_id == fid
    assert warn is None

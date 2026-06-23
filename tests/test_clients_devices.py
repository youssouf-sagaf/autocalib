"""Device listing matches ops inventory cities to B2B roster labels."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.routes.clients import (  # noqa: E402
    _device_matches_client_request,
    _resolve_target_client_for_devices,
)
from app.services import b2b_clients  # noqa: E402


def _index_with(*pairs: tuple[str, str]) -> dict[str, str]:
    index: dict[str, str] = {}
    for label, cid in pairs:
        b2b_clients._register_client_in_index(index, label, cid)
    return index


def test_device_match_by_b2b_id_when_ops_city_is_short_alias() -> None:
    fid = "abc123def456ghi789"
    index = _index_with(("AMP", fid))
    target_b2b_id, target_city_norm = _resolve_target_client_for_devices(
        fid,
        "AÉROPORT MARSEILLE PROVENCE",
        index,
    )
    assert target_b2b_id == fid
    assert _device_matches_client_request(
        "AMP",
        target_b2b_id=target_b2b_id,
        target_city_norm=target_city_norm,
        name_index=index,
    )


def test_device_match_by_normalized_city_label() -> None:
    index: dict[str, str] = {}
    target_b2b_id, target_city_norm = _resolve_target_client_for_devices(
        "",
        "LIVRY GARGAN",
        index,
    )
    assert target_b2b_id == ""
    assert target_city_norm == "livry gargan"
    assert _device_matches_client_request(
        "LIVRY_GARGAN",
        target_b2b_id=target_b2b_id,
        target_city_norm=target_city_norm,
        name_index=index,
    )


def test_device_no_match_for_different_client() -> None:
    fid_a = "abc123def456ghi789"
    fid_b = "xyz987wvu654tsr321"
    index = _index_with(("GENAS", fid_a), ("SENS", fid_b))
    target_b2b_id, target_city_norm = _resolve_target_client_for_devices(
        fid_b,
        "SENS",
        index,
    )
    assert not _device_matches_client_request(
        "GENAS",
        target_b2b_id=target_b2b_id,
        target_city_norm=target_city_norm,
        name_index=index,
    )

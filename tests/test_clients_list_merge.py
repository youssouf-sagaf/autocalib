"""Client directory merges B2B roster with ops inventory cities."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.routes.clients import ClientSummary, _merge_b2b_roster_with_ops  # noqa: E402


def test_merge_includes_b2b_only_and_ops_only_cities() -> None:
    roster = [
        {"client_id": "vRy2sRVIUu7vkHbbpH03", "display_name": "LIVRY GARGAN"},
        {"client_id": "mhiCCoODY8H0jOCkgwqc", "display_name": "SENS"},
    ]
    ops = [
        ClientSummary(client_id="", display_name="GENAS", device_count=25),
        ClientSummary(client_id="", display_name="LIVRY GARGAN", device_count=3),
    ]
    merged = _merge_b2b_roster_with_ops(roster, ops)
    names = {c.display_name for c in merged}
    assert "LIVRY GARGAN" in names
    assert "SENS" in names
    assert "GENAS" in names
    livry = next(c for c in merged if c.display_name == "LIVRY GARGAN")
    assert livry.client_id == "vRy2sRVIUu7vkHbbpH03"
    assert livry.device_count == 3
    genas = next(c for c in merged if c.display_name == "GENAS")
    assert genas.client_id == ""
    assert genas.device_count == 25


def test_merge_propagates_b2b_location_and_zoom() -> None:
    roster = [
        {
            "client_id": "CdzMnD6isCm4JPsVRbhk",
            "display_name": "SAINT-DENIS",
            "location": {"lat": -20.882, "lng": 55.450},
            "zoom_level": 14,
        },
    ]
    ops = [
        ClientSummary(
            client_id="",
            display_name="SAINT-DENIS",
            device_count=2,
        ),
    ]
    merged = _merge_b2b_roster_with_ops(roster, ops)
    saint_denis = next(c for c in merged if c.display_name == "SAINT-DENIS")
    assert saint_denis.client_id == "CdzMnD6isCm4JPsVRbhk"
    assert saint_denis.device_count == 2
    assert saint_denis.location is not None
    assert saint_denis.location.lat == -20.882
    assert saint_denis.location.lng == 55.450
    assert saint_denis.zoom_level == 14

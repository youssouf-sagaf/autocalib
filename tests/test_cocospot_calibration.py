"""Cocospot calibration proxy — DB percent coords ↔ pixel CalibBbox."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))

from app.calib_models import CalibrationSaveRequest, DeviceCalibBbox  # noqa: E402
from app.services.cocospot_calibration import (  # noqa: E402
    build_calibration_post_payload,
    normalized_bbox_to_pixels,
    pixel_bbox_to_normalized,
    static_data_to_device_calibration,
)


def test_static_data_to_device_calibration_converts_percent_bboxes() -> None:
    static_data = {
        "characteristics": {"image_width": 1000, "image_height": 500},
        "calibration": {
            "bboxes": {
                "slotA": [0.1, 0.2, 0.3, 0.4],
                "slotB": [0.5, 0.1, 0.7, 0.3],
            },
            "slots": {"slotA": {"lat": 48.1, "lng": 2.3, "slot_type": "standard"}},
            "street_name": "Rue Test",
            "nb_slots": 2,
        },
    }
    result = static_data_to_device_calibration("dev-1", static_data)
    assert result.device_id == "dev-1"
    assert result.image_width == 1000
    assert result.image_height == 500
    assert result.street_name == "Rue Test"
    assert len(result.bboxes) == 2
    first = next(b for b in result.bboxes if b.slot_id == "slotA")
    assert first.x == pytest.approx(100.0)
    assert first.y == pytest.approx(100.0)
    assert first.width == pytest.approx(200.0)
    assert first.height == pytest.approx(100.0)
    assert first.center_x == pytest.approx(200.0)
    assert first.center_y == pytest.approx(150.0)


def test_pixel_bbox_roundtrip() -> None:
    bbox = DeviceCalibBbox(
        spot_id=1,
        slot_id="slotA",
        center_x=200.0,
        center_y=150.0,
        x=100.0,
        y=100.0,
        width=200.0,
        height=100.0,
        n_frames=1,
        confidence=1.0,
    )
    norm = pixel_bbox_to_normalized(bbox, 1000, 500)
    assert norm == pytest.approx([0.1, 0.2, 0.3, 0.4])


def test_build_calibration_post_payload_merge() -> None:
    existing = {
        "calibration": {
            "bboxes": {"oldSlot": [0.0, 0.0, 0.1, 0.1]},
            "slots": {"oldSlot": {"lat": 1.0, "lng": 2.0, "slot_type": "standard"}},
            "polygon": [],
            "front_marker": {},
            "street_name": "Old Street",
        },
    }
    request = CalibrationSaveRequest(
        bboxes=[
            DeviceCalibBbox(
                spot_id=2,
                slot_id="newSlot",
                center_x=500.0,
                center_y=250.0,
                x=400.0,
                y=200.0,
                width=200.0,
                height=100.0,
                n_frames=1,
                confidence=0.9,
            ),
        ],
        slots={"newSlot": {"lat": 48.5, "lng": 2.4, "slot_type": "standard"}},
        image_width=1000,
        image_height=500,
        reset=False,
        street_name="New Street",
    )
    payload = build_calibration_post_payload("dev-1", existing, request)
    calib = payload["calibration"]
    assert "oldSlot" in calib["bboxes"]
    assert "newSlot" in calib["bboxes"]
    assert calib["slots"]["oldSlot"]["lat"] == 1.0
    assert calib["slots"]["newSlot"]["lat"] == 48.5
    assert calib["street_name"] == "New Street"
    assert calib["device_id"] == "dev-1"


def test_build_calibration_post_payload_drops_orphan_spot_id_keys() -> None:
    """Pairing rekey: spot_id-only entry is removed when slot_id is set."""
    existing = {
        "calibration": {
            "bboxes": {
                "3": [0.1, 0.2, 0.3, 0.4],
                "otherSlot": [0.0, 0.0, 0.1, 0.1],
            },
            "slots": {"stale": {"lat": 1.0, "lng": 2.0, "slot_type": "standard"}},
        },
    }
    request = CalibrationSaveRequest(
        bboxes=[
            DeviceCalibBbox(
                spot_id=3,
                slot_id="prodSlot",
                center_x=200.0,
                center_y=150.0,
                x=100.0,
                y=100.0,
                width=200.0,
                height=100.0,
                n_frames=1,
                confidence=1.0,
            ),
        ],
        slots={"prodSlot": {"lat": 48.5, "lng": 2.4, "slot_type": "standard"}},
        image_width=1000,
        image_height=500,
        replace_slots=True,
    )
    payload = build_calibration_post_payload("dev-1", existing, request)
    calib = payload["calibration"]
    assert "3" not in calib["bboxes"]
    assert "prodSlot" in calib["bboxes"]
    assert "otherSlot" in calib["bboxes"]
    assert calib["slots"] == {"prodSlot": {"lat": 48.5, "lng": 2.4, "slot_type": "standard"}}


def test_pixel_bbox_rotated_eight_coords_roundtrip() -> None:
    bbox = DeviceCalibBbox(
        spot_id=1,
        slot_id="slotA",
        center_x=200.0,
        center_y=150.0,
        x=100.0,
        y=100.0,
        width=200.0,
        height=100.0,
        n_frames=1,
        confidence=1.0,
        rotation=15.0,
    )
    norm = pixel_bbox_to_normalized(bbox, 1000, 500, rotation=15.0)
    assert len(norm) == 8
    cx, cy, x, y, w, h, rot = normalized_bbox_to_pixels(norm, 1000, 500)
    assert rot == pytest.approx(15.0, abs=0.5)
    assert w == pytest.approx(200.0, rel=0.05)
    assert h == pytest.approx(100.0, rel=0.05)
    assert len(norm) == 8


def test_build_calibration_post_payload_reset_drops_deleted_bboxes_and_slots() -> None:
    existing = {
        "calibration": {
            "bboxes": {
                "keepSlot": [0.1, 0.2, 0.3, 0.4],
                "goneSlot": [0.0, 0.0, 0.1, 0.1],
            },
            "slots": {
                "keepSlot": {"lat": 48.0, "lng": 2.0, "slot_type": "standard"},
                "goneSlot": {"lat": 49.0, "lng": 3.0, "slot_type": "standard"},
            },
        },
    }
    request = CalibrationSaveRequest(
        bboxes=[
            DeviceCalibBbox(
                spot_id=1,
                slot_id="keepSlot",
                center_x=200.0,
                center_y=150.0,
                x=100.0,
                y=100.0,
                width=200.0,
                height=100.0,
                n_frames=1,
                confidence=1.0,
            ),
        ],
        slots={"keepSlot": {"lat": 48.0, "lng": 2.0, "slot_type": "standard"}},
        image_width=1000,
        image_height=500,
        reset=True,
    )
    payload = build_calibration_post_payload("dev-1", existing, request)
    calib = payload["calibration"]
    assert list(calib["bboxes"]) == ["keepSlot"]
    assert list(calib["slots"]) == ["keepSlot"]


def test_build_calibration_post_payload_reset() -> None:
    existing = {
        "calibration": {
            "bboxes": {"oldSlot": [0.0, 0.0, 0.1, 0.1]},
            "slots": {"oldSlot": {"lat": 1.0, "lng": 2.0, "slot_type": "standard"}},
        },
    }
    request = CalibrationSaveRequest(
        bboxes=[
            DeviceCalibBbox(
                spot_id=1,
                slot_id="onlySlot",
                center_x=100.0,
                center_y=50.0,
                x=80.0,
                y=40.0,
                width=40.0,
                height=20.0,
                n_frames=1,
                confidence=1.0,
            ),
        ],
        image_width=1000,
        image_height=500,
        reset=True,
    )
    payload = build_calibration_post_payload("dev-1", existing, request)
    calib = payload["calibration"]
    assert list(calib["bboxes"]) == ["onlySlot"]
    assert calib["slots"] == {}

"""Tests for parkable-mask gating and occupancy hooks (no YOLO weights required)."""

from __future__ import annotations

import numpy as np
import pytest
from shapely.geometry import box as shapely_box

from absolutemap_gen.detection import (
    DetectionBox,
    DetectionResult,
    box_passes_parkable_mask,
    detections_to_serializable_dict,
    slot_occupied_by_vehicles,
)
from absolutemap_gen.snap_validate import occupancy_flags_for_slots


def test_box_passes_centroid_inside() -> None:
    mask = np.zeros((20, 30), dtype=np.uint8)
    mask[5:15, 10:20] = 255
    assert box_passes_parkable_mask(10, 5, 20, 15, mask, mode="centroid", min_area_fraction=0.5)


def test_box_passes_centroid_outside() -> None:
    mask = np.zeros((20, 30), dtype=np.uint8)
    mask[5:15, 10:20] = 255
    assert not box_passes_parkable_mask(1, 1, 3, 3, mask, mode="centroid", min_area_fraction=0.5)


def test_box_passes_area_fraction_half() -> None:
    mask = np.zeros((10, 10), dtype=np.uint8)
    mask[0:10, 0:5] = 255
    # Box 10x10 covering full image: half overlaps mask
    assert box_passes_parkable_mask(
        0, 0, 10, 10, mask, mode="area_fraction", min_area_fraction=0.5
    )
    assert not box_passes_parkable_mask(
        0, 0, 10, 10, mask, mode="area_fraction", min_area_fraction=0.51
    )


def test_slot_occupied_by_vehicles_iou() -> None:
    slot = shapely_box(0, 0, 10, 20)
    vehicles = [
        DetectionBox(2, 2, 8, 18, 0.9, 0, in_parkable_mask=True),
    ]
    assert slot_occupied_by_vehicles(slot, vehicles, min_iou=0.05)


def test_slot_occupied_respects_in_mask_flag() -> None:
    slot = shapely_box(0, 0, 10, 10)
    vehicles = [
        DetectionBox(1, 1, 9, 9, 0.9, 0, in_parkable_mask=False),
    ]
    assert not slot_occupied_by_vehicles(slot, vehicles, use_in_mask_only=True)
    assert slot_occupied_by_vehicles(slot, vehicles, use_in_mask_only=False)


def test_detections_to_serializable_dict() -> None:
    res = DetectionResult(
        boxes=[
            DetectionBox(0, 0, 1, 1, 0.5, 2, in_parkable_mask=True),
        ],
        image_height=10,
        image_width=20,
    )
    d = detections_to_serializable_dict(res)
    assert d["stage"] == "03_detection"
    assert d["schema_version"] == "1"
    assert d["image_height"] == 10
    assert d["image_width"] == 20
    assert len(d["detections"]) == 1
    assert d["detections"][0]["xyxy"] == [0.0, 0.0, 1.0, 1.0]
    assert d["detections"][0]["in_parkable_mask"] is True


def test_detection_box_invalid_confidence() -> None:
    with pytest.raises(ValueError):
        DetectionBox(0, 0, 1, 1, 1.5, 0)


def test_occupancy_flags_for_slots() -> None:
    slots = [shapely_box(0, 0, 5, 5), shapely_box(100, 100, 105, 105)]
    vehicles = [DetectionBox(1, 1, 4, 4, 0.9, 0, in_parkable_mask=True)]
    flags = occupancy_flags_for_slots(slots, vehicles, min_iou=0.05)
    assert flags[0] is True
    assert flags[1] is False

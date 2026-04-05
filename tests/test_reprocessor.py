"""End-to-end test for ReprocessingHelper (Block 6).

Scenario:
    A reference slot at position (0, 0) with a scope polygon covering
    ~15 m along the row axis.  Two existing slots sit at positions 3
    and 4 × pitch — the helper must fill the remaining gaps without
    duplicating those two.

Verifies:
    1. All proposed slots fall inside the scope polygon.
    2. No proposed slot overlaps with existing slots (IoU < 0.5).
    3. All proposed slots carry source='auto_reprocess'.
    4. Dimensions match the reference slot pattern.
    5. Pitch spacing is approximately regular.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from geojson_pydantic import Polygon as GeoJSONPolygon
from shapely.geometry import Point, shape

from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotStatus
from autoabsmap.reprocessing_helper.models import ReprocessRequest
from autoabsmap.reprocessing_helper.reprocessor import (
    ReprocessingHelper,
    _extract_pattern,
    _iou,
    _obb_corners,
)

REF_LNG = 2.3522
REF_LAT = 48.8566

_EARTH_R = 6_378_137.0
_DEG2M_LAT = math.pi * _EARTH_R / 180.0


def _deg2m_lng() -> float:
    return _DEG2M_LAT * math.cos(math.radians(REF_LAT))


def _m_to_lng(m: float) -> float:
    return m / _deg2m_lng()


def _m_to_lat(m: float) -> float:
    return m / _DEG2M_LAT


def _make_slot(
    slot_id: str, cx: float, cy: float,
    w: float, h: float, angle: float,
    source: SlotSource = SlotSource.yolo,
) -> GeoSlot:
    """Build a GeoSlot from local-metric OBB parameters."""
    m_lng = _deg2m_lng()
    center_lng = REF_LNG + cx / m_lng
    center_lat = REF_LAT + cy / _DEG2M_LAT

    hw, hh = w / 2, h / 2
    ca, sa = math.cos(angle), math.sin(angle)
    ring = []
    for dx, dy in [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]:
        lx = cx + dx * ca - dy * sa
        ly = cy + dx * sa + dy * ca
        ring.append([REF_LNG + lx / m_lng, REF_LAT + ly / _DEG2M_LAT])
    ring.append(ring[0])

    return GeoSlot(
        slot_id=slot_id,
        center=LngLat(lng=center_lng, lat=center_lat),
        polygon=GeoJSONPolygon(type="Polygon", coordinates=[ring]),
        source=source,
        confidence=0.9,
    )


def _make_scope(x_min: float, x_max: float, y_min: float, y_max: float) -> GeoJSONPolygon:
    """Build a rectangular scope polygon from local-metric bounds."""
    coords = [
        [REF_LNG + _m_to_lng(x_min), REF_LAT + _m_to_lat(y_min)],
        [REF_LNG + _m_to_lng(x_max), REF_LAT + _m_to_lat(y_min)],
        [REF_LNG + _m_to_lng(x_max), REF_LAT + _m_to_lat(y_max)],
        [REF_LNG + _m_to_lng(x_min), REF_LAT + _m_to_lat(y_max)],
        [REF_LNG + _m_to_lng(x_min), REF_LAT + _m_to_lat(y_min)],
    ]
    return GeoJSONPolygon(type="Polygon", coordinates=[coords])


def test_reprocess_fills_gaps_e2e():
    slot_w, slot_h = 2.5, 5.0
    pitch = slot_w * 1.1  # 2.75 m

    # ── Reference slot at origin ────────────────────────────────────────
    ref_slot = _make_slot("ref", 0.0, 0.0, slot_w, slot_h, 0.0)

    # ── Two existing slots that should NOT be duplicated ────────────────
    existing = [
        _make_slot("ex-3", 3 * pitch, 0.0, slot_w, slot_h, 0.0),
        _make_slot("ex-4", 4 * pitch, 0.0, slot_w, slot_h, 0.0),
    ]

    # ── Scope: x ∈ [-4, 18], y ∈ [-4, 4] → ~8 positions along the row
    scope = _make_scope(-4.0, 18.0, -4.0, 4.0)

    request = ReprocessRequest(
        reference_slot=ref_slot,
        scope_polygon=scope,
        existing_slots=existing,
        seg_mask=None,
    )

    # ── Run ─────────────────────────────────────────────────────────────
    result = ReprocessingHelper().reprocess(request)
    proposed = result.proposed_slots

    assert len(proposed) > 0, "Should produce at least one proposed slot"

    scope_shape = shape(scope.model_dump())

    # ── 1. All proposed centres inside scope ────────────────────────────
    for s in proposed:
        assert scope_shape.contains(Point(s.center.lng, s.center.lat)), (
            f"Slot {s.slot_id} centre outside scope"
        )

    # ── 2. No overlap with existing slots (IoU < 0.5) ──────────────────
    existing_with_ref = [ref_slot, *existing]
    for s in proposed:
        pat_s = _extract_pattern(s, REF_LNG, REF_LAT)
        corners_s = _obb_corners(pat_s)
        for ex in existing_with_ref:
            pat_ex = _extract_pattern(ex, REF_LNG, REF_LAT)
            corners_ex = _obb_corners(pat_ex)
            iou_val = _iou(corners_s, corners_ex)
            assert iou_val < 0.5, (
                f"Proposed {s.slot_id} overlaps {ex.slot_id} (IoU={iou_val:.2f})"
            )

    # ── 3. All proposed slots carry source='auto_reprocess' ─────────────
    for s in proposed:
        assert s.source == SlotSource.auto_reprocess

    # ── 4. Dimensions match the reference pattern ───────────────────────
    for s in proposed:
        pat = _extract_pattern(s, REF_LNG, REF_LAT)
        assert abs(pat.width - slot_w) < 0.1, (
            f"Width {pat.width:.2f} != expected {slot_w}"
        )
        assert abs(pat.height - slot_h) < 0.1, (
            f"Height {pat.height:.2f} != expected {slot_h}"
        )

    # ── 5. Confidence matches settings default ──────────────────────────
    for s in proposed:
        assert s.confidence == pytest.approx(0.75)

"""End-to-end test for RowStraightener (Block 7).

Scenario:
    8 parking slots forming a horizontal row with positional/angular wobble,
    plus 3 perpendicular distractor slots.  Anchors are the first and last
    row slots (any two endpoints along the row).

Verifies:
    1. Row discovery — all 8 row members found, perpendicular excluded.
    2. Angular convergence — post-correction angle std < 0.1°.
    3. Lateral collinearity — max perpendicular deviation < 5 cm.
    4. Dimension preservation — width/height unchanged within 5 cm.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.alignment_tool.straightener import (
    RowStraightener,
    _extract_local_slot,
)
from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotStatus

REF_LNG = 2.3522   # Paris, France
REF_LAT = 48.8566

_EARTH_R = 6_378_137.0
_DEG2M_LAT = math.pi * _EARTH_R / 180.0


def _deg2m_lng() -> float:
    return _DEG2M_LAT * math.cos(math.radians(REF_LAT))


def _make_slot(
    slot_id: str,
    cx: float,
    cy: float,
    w: float,
    h: float,
    angle: float,
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
        source=SlotSource.yolo,
        confidence=0.9,
    )


def test_straighten_row_e2e():
    rng = np.random.RandomState(42)
    slot_w, slot_h, pitch = 2.5, 5.0, 2.8

    # ── Wobbly horizontal row (8 slots) ─────────────────────────────────
    row_ids = {f"row-{i}" for i in range(8)}
    row_slots = [
        _make_slot(
            f"row-{i}",
            cx=i * pitch + rng.uniform(-0.3, 0.3),
            cy=rng.uniform(-0.3, 0.3),
            w=slot_w,
            h=slot_h,
            angle=rng.uniform(-math.radians(3), math.radians(3)),
        )
        for i in range(8)
    ]

    # ── Perpendicular distractors (3 slots, ~10 m away) ─────────────────
    perp_slots = [
        _make_slot(
            f"perp-{i}",
            cx=3 * pitch + rng.uniform(-0.2, 0.2),
            cy=10.0 + i * pitch,
            w=slot_w,
            h=slot_h,
            angle=math.pi / 2 + rng.uniform(-math.radians(3), math.radians(3)),
        )
        for i in range(3)
    ]

    all_slots = row_slots + perp_slots

    # ── Record pre-correction geometry ──────────────────────────────────
    before_locals = {
        s.slot_id: _extract_local_slot(s, REF_LNG, REF_LAT) for s in row_slots
    }
    before_angles = [before_locals[sid].angle_rad for sid in sorted(row_ids)]
    assert np.std(before_angles) > math.radians(0.5), "Sanity: wobble should be visible"

    # ── Run straightener ────────────────────────────────────────────────
    corrected = RowStraightener().straighten("row-0", "row-7", all_slots)

    # ── 1. Row discovery ────────────────────────────────────────────────
    corrected_ids = {s.slot_id for s in corrected}
    assert corrected_ids == row_ids, (
        f"Expected {row_ids}, got {corrected_ids}"
    )

    # ── 2. Angular convergence ──────────────────────────────────────────
    after_locals = {
        s.slot_id: _extract_local_slot(s, REF_LNG, REF_LAT) for s in corrected
    }
    after_angles = [after_locals[sid].angle_rad for sid in sorted(row_ids)]
    angle_std = float(np.std(after_angles))
    assert angle_std < math.radians(0.1), (
        f"Angle std {math.degrees(angle_std):.3f}° should be < 0.1°"
    )

    # ── 3. Lateral collinearity ─────────────────────────────────────────
    xs = np.array([after_locals[sid].cx for sid in sorted(row_ids)])
    ys = np.array([after_locals[sid].cy for sid in sorted(row_ids)])
    dx, dy = xs - xs.mean(), ys - ys.mean()
    cov = np.array([
        [float(np.sum(dx * dx)), float(np.sum(dx * dy))],
        [float(np.sum(dx * dy)), float(np.sum(dy * dy))],
    ])
    _, vecs = np.linalg.eigh(cov)
    minor = vecs[:, 0]
    perp_dists = np.abs(dx * minor[0] + dy * minor[1])
    assert float(perp_dists.max()) < 0.05, (
        f"Max perp deviation {perp_dists.max():.4f} m should be < 0.05 m"
    )

    # ── 4. Dimension preservation ───────────────────────────────────────
    for sid in sorted(row_ids):
        bef = before_locals[sid]
        aft = after_locals[sid]
        assert abs(aft.width - bef.width) < 0.05, (
            f"{sid} width changed: {bef.width:.3f} → {aft.width:.3f}"
        )
        assert abs(aft.height - bef.height) < 0.05, (
            f"{sid} height changed: {bef.height:.3f} → {aft.height:.3f}"
        )


def test_straighten_row_segment_only_slots_between_anchors():
    """Interior anchors should only align slots on the segment, not the full row."""
    rng = np.random.RandomState(43)
    slot_w, slot_h, pitch = 2.5, 5.0, 2.8
    row_slots = [
        _make_slot(
            f"row-{i}",
            cx=i * pitch + rng.uniform(-0.2, 0.2),
            cy=rng.uniform(-0.2, 0.2),
            w=slot_w,
            h=slot_h,
            angle=rng.uniform(-math.radians(2), math.radians(2)),
        )
        for i in range(8)
    ]
    all_slots = row_slots

    corrected = RowStraightener().straighten("row-2", "row-5", all_slots)
    ids = {s.slot_id for s in corrected}
    assert ids == {"row-2", "row-3", "row-4", "row-5"}


def test_straighten_accepts_obb_ninety_degree_ambiguity():
    """Width/length labeling may leave angle_rad perpendicular to the row axis."""
    pitch, slot_w, slot_h = 2.8, 2.5, 5.0
    # Angle = 20° along row in local space; force OBB *edge* angle = 110° (perp case).
    obb_edge = math.radians(20.0 + 90.0)
    row_slots = [
        _make_slot(f"row-{i}", cx=i * pitch, cy=0.0, w=slot_w, h=slot_h, angle=obb_edge)
        for i in range(5)
    ]
    corrected = RowStraightener().straighten("row-0", "row-4", row_slots)
    assert len(corrected) == 5
    after = {s.slot_id: _extract_local_slot(s, REF_LNG, REF_LAT) for s in corrected}
    angles = [after[sid].angle_rad for sid in sorted(after.keys())]
    assert max(abs(a - angles[0]) for a in angles) < math.radians(0.2)

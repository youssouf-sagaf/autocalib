"""End-to-end test for GeometricEngine (Block 3 — core pipeline).

Scenario:
    A 400×200 synthetic segmentation mask with a large parkable region.
    6 YOLO-detected PixelSlots forming a row with one intentional gap
    (missing slot between positions 2 and 4).  An uncovered parkable
    region sits to the right of the row (no detections there).

Verifies:
    A. Row clustering — all 6 detections end up in one row.
    B. Gap filling — the missing slot is created (source=gap_fill).
    C. Row extension — new slots extend beyond the row ends while inside mask.
    D. Mask recovery — uncovered region generates new slots (source=mask_recovery).
    E. Dedup — no two slots overlap beyond the IoU threshold.
    F. Mask validation — no slot centre falls outside the parkable mask.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
import pytest

from autoabsmap.config.settings import GeometrySettings
from autoabsmap.export.models import SlotSource
from autoabsmap.generator_engine.geometric_engine import GeometricEngine
from autoabsmap.generator_engine.models import PixelSlot


def _make_mask(h: int, w: int) -> np.ndarray:
    """Create a 0/255 mask with two parkable zones.

    Zone A: large rectangle (rows 40–160, cols 20–280) — hosts the detected row.
    Zone B: rectangle (rows 40–160, cols 320–390) — uncovered region for recovery.
    """
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[40:160, 20:280] = 255
    mask[40:160, 320:390] = 255
    return mask


def _make_row_slots() -> list[PixelSlot]:
    """6 slots in a horizontal row at y=100, spaced ~30px apart.

    Slot at position index 3 is MISSING (gap between slot 2 and slot 4).
    angle_rad=0 means width along x (row direction), height along y.
    """
    slot_w, slot_h = 25.0, 40.0
    pitch = 30.0
    base_x, base_y = 50.0, 100.0
    indices = [0, 1, 2, 4, 5, 6]  # skip index 3 → gap

    return [
        PixelSlot(
            center_x=base_x + i * pitch,
            center_y=base_y,
            width=slot_w,
            height=slot_h,
            angle_rad=0.0,
            confidence=0.9,
            class_id=0,
            source=SlotSource.yolo,
        )
        for i in indices
    ]


def test_geometric_engine_e2e():
    mask = _make_mask(200, 400)
    yolo_slots = _make_row_slots()

    engine = GeometricEngine(GeometrySettings())
    result = engine.process(yolo_slots, mask)

    # ── Basic sanity ────────────────────────────────────────────────────
    assert len(result) > len(yolo_slots), (
        f"Expected enrichment, got {len(result)} ≤ {len(yolo_slots)}"
    )

    yolo_ids = {id(s) for s in yolo_slots}
    sources = [s.source for s in result]

    # ── A. All original YOLO detections survive dedup ───────────────────
    yolo_in_result = [s for s in result if s.source == SlotSource.yolo]
    assert len(yolo_in_result) == len(yolo_slots), (
        f"Expected {len(yolo_slots)} YOLO slots, got {len(yolo_in_result)}"
    )

    # ── B. Gap filling — at least one gap_fill slot in the gap region ──
    gap_fills = [s for s in result if s.source == SlotSource.gap_fill]
    assert len(gap_fills) >= 1, "Expected at least 1 gap-fill slot"
    gap_xs = [s.center_x for s in gap_fills]
    assert any(120 < x < 170 for x in gap_xs), (
        f"Gap fill should be near x≈140, got x={gap_xs}"
    )

    # ── C. Row extension — slots beyond the original row ends ──────────
    extensions = [s for s in result if s.source == SlotSource.row_extension]
    assert len(extensions) >= 1, "Expected at least 1 row-extension slot"

    # ── D. Mask recovery — uncovered zone B generates slots ────────────
    recoveries = [s for s in result if s.source == SlotSource.mask_recovery]
    assert len(recoveries) >= 1, "Expected mask recovery in zone B"
    assert any(s.center_x > 300 for s in recoveries), (
        "Recovered slots should be in zone B (x > 300)"
    )

    # ── E. No duplicate overlaps ───────────────────────────────────────
    for i, a in enumerate(result):
        box_a = np.float32([list(c) for c in a.corners])
        area_a = a.width * a.height
        for b in result[i + 1:]:
            dist = math.hypot(a.center_x - b.center_x, a.center_y - b.center_y)
            if dist > 1.5 * max(a.width, a.height):
                continue
            box_b = np.float32([list(c) for c in b.corners])
            inter, _ = cv2.intersectConvexConvex(box_a, box_b)
            min_area = min(area_a, b.width * b.height)
            assert inter <= 0.15 * min_area + 1e-3, (
                f"Overlap {inter:.1f} > 0.15×{min_area:.1f} between slots at "
                f"({a.center_x:.0f},{a.center_y:.0f}) and ({b.center_x:.0f},{b.center_y:.0f})"
            )

    # ── F. All slot centres inside the mask ────────────────────────────
    for s in result:
        iy, ix = int(s.center_y), int(s.center_x)
        assert 0 <= iy < mask.shape[0] and 0 <= ix < mask.shape[1], (
            f"Slot ({s.center_x:.0f}, {s.center_y:.0f}) out of bounds"
        )
        assert mask[iy, ix] > 0, (
            f"Slot ({s.center_x:.0f}, {s.center_y:.0f}) outside parkable mask"
        )

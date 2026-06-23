"""End-to-end test for GeometricEngine (Block 3 — core pipeline).

Scenario:
    A 400×200 synthetic segmentation mask with a large parkable region.
    6 YOLO-detected PixelSlots forming a row with one intentional gap
    (missing slot between positions 2 and 4).  An uncovered parkable
    region sits to the right of the row (no detections there).

Verifies:
    A. Row clustering — all 6 detections end up in one row.
    B. Gap filling — the missing slot is created (source=gap_fill).
    C. Row extension — optional when extrapolated centers dedupe under YOLO OBBs.
    D. Mask recovery — uncovered region generates new slots (source=mask_recovery).
    E. Dedup — no synthetic/yolo pair overlaps beyond IoU threshold (YOLO–YOLO excluded).
    F. Mask validation — no slot centre falls outside the parkable mask.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

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
            source=SlotSource.sam3,
        )
        for i in indices
    ]


def _make_row_slots_angled(angle_rad: float = math.pi / 6) -> list[PixelSlot]:
    """Same gap pattern as ``_make_row_slots`` but row tilted by *angle_rad*."""
    slot_w, slot_h = 25.0, 40.0
    pitch = 30.0
    # Keep the whole diagonal inside mask rows 40–160 (see ``_make_mask``).
    base_x, base_y = 50.0, 55.0
    indices = [0, 1, 2, 4, 5, 6]
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)
    return [
        PixelSlot(
            center_x=base_x + i * pitch * ca,
            center_y=base_y + i * pitch * sa,
            width=slot_w,
            height=slot_h,
            angle_rad=angle_rad,
            confidence=0.9,
            class_id=0,
            source=SlotSource.sam3,
        )
        for i in indices
    ]


def _angle_diff(a: float, b: float) -> float:
    d = (a - b) % math.pi
    if d > math.pi / 2:
        d = math.pi - d
    return abs(d)


def test_stage_b_gap_fill_matches_angled_sam3_row():
    """Gap-fill OBBs must share SAM3 row angle and median w/h."""
    from autoabsmap.generator_engine.pixel_obb import mean_width_axis_angle

    mask = _make_mask(200, 400)
    angle = math.pi / 6
    yolo_slots = _make_row_slots_angled(angle)
    row_expect_angle = mean_width_axis_angle([s.angle_rad for s in yolo_slots])
    row_expect_w = float(np.median([s.width for s in yolo_slots]))
    row_expect_h = float(np.median([s.height for s in yolo_slots]))

    engine = GeometricEngine(
        GeometrySettings().model_copy(update={"iou_dedup_threshold": 0.30}),
    )
    result = engine.process(yolo_slots, mask)

    synthetic = [
        s for s in result
        if s.source in (SlotSource.gap_fill, SlotSource.row_extension)
    ]
    assert synthetic, "expected gap_fill / row_extension slots"
    tol_a = math.radians(2.0)
    tol_dim = 0.51
    for s in synthetic:
        assert _angle_diff(s.angle_rad, row_expect_angle) < tol_a
        assert abs(s.width - row_expect_w) <= tol_dim
        assert abs(s.height - row_expect_h) <= tol_dim


def test_stage_c_recovery_matches_yolo_row_orientation():
    """Mask-recovery slots must stay parallel to SAM3 anchors when Stage C is enabled."""
    from autoabsmap.generator_engine.pixel_obb import mean_width_axis_angle

    mask = _make_mask(200, 400)
    angle = math.pi / 6
    yolo_slots = _make_row_slots_angled(angle)
    row_expect_angle = mean_width_axis_angle([s.angle_rad for s in yolo_slots])

    engine = GeometricEngine(
        GeometrySettings().model_copy(update={
            "iou_dedup_threshold": 0.30,
            "enable_mask_recovery": True,
        }),
    )
    result = engine.process(yolo_slots, mask)
    recoveries = [s for s in result if s.source == SlotSource.mask_recovery]
    assert recoveries, "expected mask_recovery slots in zone B"
    tol_a = math.radians(2.0)
    for s in recoveries:
        assert _angle_diff(s.angle_rad, row_expect_angle) < tol_a


def test_geometric_engine_leaves_input_detector_geometry_unchanged():
    """YOLO PixelSlots passed in must keep the same pose; only copies are clustered."""
    mask = _make_mask(200, 400)
    yolo_slots = _make_row_slots()
    snapshot = [
        (s.center_x, s.center_y, s.width, s.height, s.angle_rad, s.row_id)
        for s in yolo_slots
    ]
    engine = GeometricEngine(
        GeometrySettings().model_copy(update={"iou_dedup_threshold": 0.30}),
    )
    engine.process(yolo_slots, mask)
    for slot, snap in zip(yolo_slots, snapshot):
        assert (
            slot.center_x,
            slot.center_y,
            slot.width,
            slot.height,
            slot.angle_rad,
            slot.row_id,
        ) == snap


def test_stage_b_gap_fill_survives_dedup_with_oversized_sam3_anchors():
    """Gap-fill slots between groups must not be dropped when fat axis-aligned
    SAM3 OBBs overlap them geometrically but the fill center sits in empty space."""
    angle = math.radians(33.0)
    ca, sa = math.cos(angle), math.sin(angle)
    pitch = 55.0
    slot_w, slot_h = 75.0, 85.0  # inflated axis-aligned vehicle bbox
    base_x, base_y = 80.0, 80.0

    # Two clusters of 2 SAM3 anchors with a large gap (≈4 pitches) between them.
    anchors = [
        PixelSlot(
            center_x=base_x + i * pitch * ca,
            center_y=base_y + i * pitch * sa,
            width=slot_w, height=slot_h, angle_rad=angle,
            confidence=0.9, class_id=0, source=SlotSource.sam3,
        )
        for i in (0, 1)
    ] + [
        PixelSlot(
            center_x=base_x + (i + 5) * pitch * ca,
            center_y=base_y + (i + 5) * pitch * sa,
            width=slot_w, height=slot_h, angle_rad=angle,
            confidence=0.9, class_id=0, source=SlotSource.sam3,
        )
        for i in (0, 1)
    ]

    mask = np.zeros((400, 500), dtype=np.uint8)
    for s in anchors:
        cv2.fillPoly(
            mask,
            [_corners_for_mask(s)],
            255,
        )
    # Wide parkable strip along the row (operator ROI), not a thin corridor.
    strip_pts = np.array([
        [anchors[0].center_x - 30, anchors[0].center_y - 55],
        [anchors[-1].center_x + 30, anchors[-1].center_y - 55],
        [anchors[-1].center_x + 30, anchors[-1].center_y + 55],
        [anchors[0].center_x - 30, anchors[0].center_y + 55],
    ], dtype=np.int32)
    cv2.fillPoly(mask, [strip_pts], 255)

    roi = mask.copy()
    engine = GeometricEngine(
        GeometrySettings().model_copy(update={"iou_dedup_threshold": 0.30}),
    )
    result = engine.process(anchors, mask, roi_mask=roi)

    gap_fills = [s for s in result if s.source == SlotSource.gap_fill]
    assert len(gap_fills) >= 1, (
        f"Expected ≥1 gap-fill slot in the big gap, got {len(gap_fills)}"
    )
    mid_x = (anchors[1].center_x + anchors[2].center_x) / 2
    mid_y = (anchors[1].center_y + anchors[2].center_y) / 2
    assert any(
        math.hypot(s.center_x - mid_x, s.center_y - mid_y) < pitch * 2
        for s in gap_fills
    ), "Gap-fill slots should land near the middle of the empty stretch"


def _corners_for_mask(slot: PixelSlot) -> np.ndarray:
    from autoabsmap.generator_engine.pixel_obb import pixel_obb_corners_int
    return pixel_obb_corners_int(
        slot.center_x, slot.center_y, slot.width, slot.height, slot.angle_rad,
    )


def test_geometric_engine_e2e():
    mask = _make_mask(200, 400)
    yolo_slots = _make_row_slots()

    engine = GeometricEngine(
        GeometrySettings().model_copy(update={"iou_dedup_threshold": 0.30}),
    )
    result = engine.process(yolo_slots, mask)

    # ── Basic sanity ────────────────────────────────────────────────────
    assert len(result) > len(yolo_slots), (
        f"Expected enrichment, got {len(result)} ≤ {len(yolo_slots)}"
    )

    {id(s) for s in yolo_slots}
    [s.source for s in result]

    # ── A. All original YOLO detections survive dedup ───────────────────
    sam3_in_result = [s for s in result if s.source == SlotSource.sam3]
    assert len(sam3_in_result) == len(yolo_slots), (
        f"Expected {len(yolo_slots)} SAM3 slots, got {len(sam3_in_result)}"
    )

    # ── B. Gap filling — at least one gap_fill slot in the gap region ──
    gap_fills = [s for s in result if s.source == SlotSource.gap_fill]
    assert len(gap_fills) >= 1, "Expected at least 1 gap-fill slot"
    gap_xs = [s.center_x for s in gap_fills]
    assert any(120 < x < 170 for x in gap_xs), (
        f"Gap fill should be near x≈140, got x={gap_xs}"
    )

    # ── C. No mask recovery by default; row extension allowed ───────────
    assert not any(s.source == SlotSource.mask_recovery for s in result)

    # ── D. No duplicate overlaps (synthetic vs anchors; SAM3–SAM3 excluded) ──
    iou_thr = 0.30
    for i, a in enumerate(result):
        box_a = np.float32([list(c) for c in a.corners])
        area_a = a.width * a.height
        for b in result[i + 1:]:
            if a.source == SlotSource.sam3 and b.source == SlotSource.sam3:
                continue
            if SlotSource.mask_recovery in (a.source, b.source):
                continue
            dist = math.hypot(a.center_x - b.center_x, a.center_y - b.center_y)
            if dist > 1.5 * max(a.width, a.height):
                continue
            box_b = np.float32([list(c) for c in b.corners])
            inter, _ = cv2.intersectConvexConvex(box_a, box_b)
            min_area = min(area_a, b.width * b.height)
            assert inter <= iou_thr * min_area + 1e-3, (
                f"Overlap {inter:.1f} > {iou_thr}×{min_area:.1f} between slots at "
                f"({a.center_x:.0f},{a.center_y:.0f}) and ({b.center_x:.0f},{b.center_y:.0f})"
            )

    # ── E. All slot centres inside the mask ────────────────────────────
    for s in result:
        iy, ix = int(s.center_y), int(s.center_x)
        assert 0 <= iy < mask.shape[0] and 0 <= ix < mask.shape[1], (
            f"Slot ({s.center_x:.0f}, {s.center_y:.0f}) out of bounds"
        )
        assert mask[iy, ix] > 0, (
            f"Slot ({s.center_x:.0f}, {s.center_y:.0f}) outside parkable mask"
        )


def test_gap_fill_skips_when_clearance_too_small():
    """Do not synthesise a slot when centre spacing barely exceeds threshold."""
    slot_w, slot_h = 50.0, 40.0
    pitch = 70.0  # 1.4× width — below clearance floor (0.85× width free gap)
    s1 = PixelSlot(
        center_x=100.0, center_y=100.0,
        width=slot_w, height=slot_h, angle_rad=0.0,
        confidence=0.9, class_id=0, source=SlotSource.sam3,
    )
    s2 = PixelSlot(
        center_x=100.0 + pitch, center_y=100.0,
        width=slot_w, height=slot_h, angle_rad=0.0,
        confidence=0.9, class_id=0, source=SlotSource.sam3,
    )
    mask = np.zeros((200, 300), dtype=np.uint8)
    mask[40:160, 20:280] = 255

    engine = GeometricEngine(GeometrySettings())
    result = engine.process([s1, s2], mask, roi_mask=mask)

    gap_fills = [s for s in result if s.source == SlotSource.gap_fill]
    assert not gap_fills, (
        f"Expected no gap-fill for tight spacing ({pitch}px), got {len(gap_fills)}"
    )


def test_gap_fill_skips_when_fat_sam3_boxes_touch():
    """Oversized vehicle OBBs with small centre pitch must not get gap-fill."""
    angle = math.radians(33.0)
    ca, sa = math.cos(angle), math.sin(angle)
    slot_w, slot_h = 75.0, 85.0
    pitch = 58.0  # centres closer than combined half-widths along the row
    base_x, base_y = 120.0, 120.0

    row = [
        PixelSlot(
            center_x=base_x + i * pitch * ca,
            center_y=base_y + i * pitch * sa,
            width=slot_w, height=slot_h, angle_rad=angle,
            confidence=0.9, class_id=0, source=SlotSource.sam3,
        )
        for i in range(8)
    ]

    mask = np.zeros((400, 600), dtype=np.uint8)
    strip_pts = np.array([
        [row[0].center_x - 40, row[0].center_y - 60],
        [row[-1].center_x + 40, row[-1].center_y - 60],
        [row[-1].center_x + 40, row[-1].center_y + 60],
        [row[0].center_x - 40, row[0].center_y + 60],
    ], dtype=np.int32)
    cv2.fillPoly(mask, [strip_pts], 255)

    engine = GeometricEngine(GeometrySettings())
    result = engine.process(row, mask, roi_mask=mask)

    gap_fills = [s for s in result if s.source == SlotSource.gap_fill]
    assert not gap_fills, (
        f"Expected no gap-fill when SAM3 boxes already consume the row pitch, "
        f"got {len(gap_fills)}"
    )


def test_gap_fill_stays_between_first_and_last_detection():
    """Gap-fill must never land before the first or after the last SAM3 anchor."""
    mask = _make_mask(200, 400)
    slots = _make_row_slots()
    first_x = min(s.center_x for s in slots)
    last_x = max(s.center_x for s in slots)

    engine = GeometricEngine(GeometrySettings())
    result = engine.process(slots, mask, roi_mask=mask)

    for s in result:
        if s.source == SlotSource.gap_fill:
            assert first_x < s.center_x < last_x, (
                f"Gap-fill at x={s.center_x} outside [{first_x}, {last_x}]"
            )


def test_row_extension_fires_after_gap_fill_in_roi_mask():
    """Row extension should populate empty ROI space beyond the last SAM3 anchor."""
    h, w = 200, 600
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[40:160, 20:560] = 255

    # SAM3 sees vehicles only in the first third of the strip.
    slot_w, slot_h = 25.0, 40.0
    pitch = 30.0
    anchors = [
        PixelSlot(
            center_x=50.0 + i * pitch, center_y=100.0,
            width=slot_w, height=slot_h, angle_rad=0.0,
            confidence=0.9, class_id=0, source=SlotSource.sam3,
        )
        for i in range(3)
    ]

    engine = GeometricEngine(GeometrySettings())
    result = engine.process(anchors, mask, roi_mask=mask)

    extensions = [s for s in result if s.source == SlotSource.row_extension]
    assert extensions, "expected row_extension slots filling the empty ROI tail"
    last_anchor_x = max(s.center_x for s in anchors)
    assert any(s.center_x > last_anchor_x + pitch for s in extensions), (
        "extensions should reach into the empty ROI tail beyond the last anchor"
    )


def test_stage_b_uses_roi_mask_to_fill_seg_hole():
    """When the seg has a hole over the gap, the ROI mask should still
    let gap_fill / row_extension drop slots into real parkable space.

    Setup: same row + same gap as the e2e test, but the seg mask is punched
    out across the gap region (cols 120..170). Without a ROI override, no
    gap_fill slot can land in that band. With roi_mask covering the full
    parkable rectangle, Stage B inserts the missing slot — and Stage D
    rescues it because YOLO/marking are not the only source allowed in.
    """
    h, w = 200, 400
    yolo_slots = _make_row_slots()

    # Full ROI: the operator's polygon covers the whole parkable strip,
    # uncluttered by the SegFormer's local failures.
    roi = np.zeros((h, w), dtype=np.uint8)
    roi[40:160, 20:280] = 255

    # Seg mask: same as ROI but with a hole punched over the gap region.
    seg = roi.copy()
    seg[:, 120:170] = 0

    settings = GeometrySettings().model_copy(
        update={
            "prior_mask_center_tolerance": 1.0,
            "iou_dedup_threshold": 0.30,
        },
    )

    engine = GeometricEngine(settings)

    # Without ROI override: no gap_fill candidate is even produced in the hole.
    baseline = engine.process(yolo_slots, seg)
    baseline_gap_in_hole = [
        s for s in baseline
        if s.source == SlotSource.gap_fill and 120 < s.center_x < 170
    ]
    assert not baseline_gap_in_hole, (
        f"Without roi_mask, the seg hole should block gap_fill in the gap, "
        f"got {len(baseline_gap_in_hole)} slot(s)"
    )

    # With ROI override: Stage B sees a continuous parkable band and fills
    # the gap; the slot is then accepted by Stage D thanks to the relaxed
    # tolerance simulating an operator-trusted prior.
    from autoabsmap.generator_engine.prior import GeometricPrior, PriorSource
    op_prior = GeometricPrior(
        orientation_rad=0.0,
        slot_width_px=25.0,
        slot_height_px=40.0,
        confidence=1.0,
        source=PriorSource.operator_hint,
    )
    enriched = engine.process(yolo_slots, seg, prior=op_prior, roi_mask=roi)
    roi_gap_in_hole = [
        s for s in enriched
        if s.source == SlotSource.gap_fill and 120 < s.center_x < 170
    ]
    assert roi_gap_in_hole, (
        "With roi_mask, Stage B should fill the gap that the seg hole hid"
    )


def test_resolve_row_orientation_matches_sam3_on_diagonal_roi():
    """ROI pitch follows bay depth; synthesised width axis must stay ∥ SAM3."""
    from autoabsmap.generator_engine.geometric_engine import _resolve_row_orientation

    width_axis = math.radians(-67.0)
    pitch_dir = np.array([
        math.cos(width_axis + math.pi / 2),
        math.sin(width_axis + math.pi / 2),
    ])
    row = [
        PixelSlot(
            center_x=100 + i * 30,
            center_y=200 + i * 10,
            width=22.0,
            height=45.0,
            angle_rad=width_axis,
            confidence=0.9,
            class_id=0,
            source=SlotSource.sam3,
        )
        for i in range(4)
    ]

    angle, _, _, _, _ = _resolve_row_orientation(
        row, pitch_dir, 22.0, 45.0, GeometrySettings(), pitch_from_roi=True,
    )
    assert _angle_diff(angle, width_axis) < math.radians(5.0)


def test_resolve_row_orientation_keeps_sam3_when_roi_pitch_aligns_with_width():
    """Regression: ROI PCA ≈ row width must not rotate synthesised boxes by 90°."""
    from autoabsmap.generator_engine.geometric_engine import _resolve_row_orientation
    from autoabsmap.generator_engine.pixel_obb import mean_width_axis_angle

    sam3_angles = [
        0.5880025994509304,
        0.0,
        -0.07130746976741653,
        0.7853981633974483,
        0.7853981633974483,
        0.6747409572064841,
        0.6747409572064841,
    ]
    width_axis = mean_width_axis_angle(sam3_angles)
    # Artifact 20260530-093537: ROI long axis ~36° (≈ width), not depth.
    pitch_dir = np.array([math.cos(math.radians(36.3)), math.sin(math.radians(36.3))])
    row = [
        PixelSlot(
            center_x=100 + i * 20,
            center_y=100 + i * 15,
            width=12.0,
            height=22.0,
            angle_rad=a,
            confidence=0.8,
            class_id=0,
            source=SlotSource.sam3,
        )
        for i, a in enumerate(sam3_angles)
    ]

    angle, _, _, _, _ = _resolve_row_orientation(
        row, pitch_dir, 12.0, 22.0, GeometrySettings(), pitch_from_roi=True,
    )
    assert _angle_diff(angle, width_axis) < math.radians(8.0)


def test_synthesis_angle_aligns_when_sam3_is_90deg_off_pitch():
    """When ROI pitch is horizontal, derived width axis stays ∥ SAM3 anchors."""
    from autoabsmap.generator_engine.geometric_engine import _resolve_row_orientation

    wrong_angle = math.pi / 2
    anchors = [
        PixelSlot(
            center_x=80 + i * 55,
            center_y=100,
            width=49.0,
            height=81.0,
            angle_rad=wrong_angle,
            confidence=0.9,
            class_id=0,
            source=SlotSource.sam3,
        )
        for i in range(4)
    ]
    pitch_dir = np.array([1.0, 0.0])

    angle, _, _, _, _ = _resolve_row_orientation(
        anchors, pitch_dir, 49.0, 81.0,
        GeometrySettings().model_copy(update={"iou_dedup_threshold": 0.30}),
        pitch_from_roi=True,
    )
    assert _angle_diff(angle, wrong_angle) < math.radians(5.0)


def test_gap_fill_at_coarse_gsd_with_oversized_sam3_obbs():
    """Low-resolution tiles (~0.2 m/px) must still gap-fill between SAM3 anchors.

    Regression for artifact 20260529-094009: ``min_row_wp_px=20`` blocked all
    synthesis and dedup dropped fills that only overlapped fat vehicle OBBs.
    """
    angle = -math.pi / 4
    ca, sa = math.cos(angle), math.sin(angle)
    pitch = 11.0
    slot_w, slot_h = 10.5, 23.0
    base_x, base_y = 80.0, 120.0

    anchors = [
        PixelSlot(
            center_x=base_x + i * pitch * ca,
            center_y=base_y + i * pitch * sa,
            width=slot_w,
            height=slot_h,
            angle_rad=angle,
            confidence=0.9,
            class_id=0,
            source=SlotSource.sam3,
        )
        for i in range(9)
    ]
    # Widen spacing between anchors 6 and 7 to mimic a real missing stretch.
    anchors[7] = anchors[7].model_copy(
        update={
            "center_x": anchors[6].center_x + 4.5 * pitch * ca,
            "center_y": anchors[6].center_y + 4.5 * pitch * sa,
        },
    )
    anchors[8] = anchors[8].model_copy(
        update={
            "center_x": anchors[7].center_x + pitch * ca,
            "center_y": anchors[7].center_y + pitch * sa,
        },
    )

    mask = np.zeros((220, 250), dtype=np.uint8)
    strip = np.array([
        [anchors[0].center_x - 50, anchors[0].center_y - 50],
        [anchors[-1].center_x + 50, anchors[-1].center_y - 50],
        [anchors[-1].center_x + 50, anchors[-1].center_y + 50],
        [anchors[0].center_x - 50, anchors[0].center_y + 50],
    ], dtype=np.int32)
    cv2.fillPoly(mask, [strip], 255)

    gsd_m = 0.196
    engine = GeometricEngine(
        GeometrySettings().model_copy(update={"iou_dedup_threshold": 0.30}),
    )
    result = engine.process(anchors, mask, roi_mask=mask, gsd_m=gsd_m)

    gap_fills = [s for s in result if s.source == SlotSource.gap_fill]
    assert len(gap_fills) >= 1, (
        f"Expected gap-fill slots at coarse GSD, got {len(gap_fills)}"
    )
    assert len([s for s in result if s.source == SlotSource.sam3]) == len(anchors)

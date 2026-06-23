"""Golden parity: geometric engine vs captured baselines in pixel space.

Compares ``center_px`` from ``export.geojson`` features to enriched engine
centroids (Hungarian matching). Requires ``segmentation_mask_refined.npy``.

Cases with an empty export (zero-slot edge baseline) are skipped until a
dedicated empty-parking policy is pinned.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest
from pydantic import BaseModel, Field
from scipy.optimize import linear_sum_assignment

from autoabsmap.config.settings import GeometrySettings
from autoabsmap.export.models import SlotSource
from autoabsmap.generator_engine.geometric_engine import GeometricEngine
from autoabsmap.generator_engine.models import PixelSlot


class ParityThresholds(BaseModel):
    """Hungarian match on ``center_px`` — recall-first (do not lose baseline slots)."""

    max_center_px: float = Field(default=28.0, ge=1.0)
    baseline_recall_min: float = Field(default=0.78, ge=0.0, le=1.0)
    """``matched / len(baseline)`` must reach this (allows extra outputs)."""


GOLDEN_ROOT = Path(__file__).resolve().parent / "golden"
CASE_DIRS = sorted(p for p in GOLDEN_ROOT.glob("case_*") if p.is_dir())


def _load_detections_raw(path: Path) -> list[PixelSlot]:
    data = json.loads(path.read_text())
    out: list[PixelSlot] = []
    for spot in data.get("spots", []):
        cx, cy = spot["center_xy"]
        out.append(
            PixelSlot(
                center_x=float(cx),
                center_y=float(cy),
                width=float(spot["width"]),
                height=float(spot["height"]),
                angle_rad=float(spot["angle_rad"]),
                confidence=float(spot["confidence"]),
                class_id=int(spot.get("class_id", 0)),
                source=SlotSource.sam3,
            ),
        )
    return out


def _baseline_centers_px(export_path: Path) -> list[tuple[float, float]]:
    data = json.loads(export_path.read_text())
    out: list[tuple[float, float]] = []
    for f in data.get("features", []):
        cp = f.get("properties", {}).get("center_px")
        if cp and len(cp) == 2:
            out.append((float(cp[0]), float(cp[1])))
    return out


def _hungarian_pixel_match(
    baseline_xy: list[tuple[float, float]],
    slots: list[PixelSlot],
    thr: ParityThresholds,
) -> tuple[int, int, int]:
    """Return matched, len(baseline), len(actual)."""
    nb, na = len(baseline_xy), len(slots)
    if nb == 0 or na == 0:
        return 0, nb, na
    big = 1e9
    cost = np.full((nb, na), big, dtype=np.float64)
    for i, (bx, by) in enumerate(baseline_xy):
        for j, s in enumerate(slots):
            d = math.hypot(s.center_x - bx, s.center_y - by)
            if d <= thr.max_center_px:
                cost[i, j] = d
    row_ind, col_ind = linear_sum_assignment(cost)
    matched = int(sum(1 for i, j in zip(row_ind, col_ind) if cost[i, j] < big - 1))
    return matched, nb, na


@pytest.mark.parametrize("case_dir", CASE_DIRS, ids=[p.name for p in CASE_DIRS])
def test_golden_parity_engine_vs_export(case_dir: Path) -> None:
    mask_path = case_dir / "segmentation_mask_refined.npy"
    raw_path = case_dir / "detections_raw.json"
    export_path = case_dir / "export.geojson"
    if not mask_path.exists():
        pytest.skip(f"No mask at {mask_path} — run capture_golden_files.py first")
    if not raw_path.exists() or not export_path.exists():
        pytest.skip("Missing detections or export")

    baseline_xy = _baseline_centers_px(export_path)
    if not baseline_xy:
        pytest.skip(f"{case_dir.name}: empty or center_px-free export baseline")

    mask = np.load(mask_path)
    slots = _load_detections_raw(raw_path)
    # Golden baselines were captured against the original R&D defaults
    # (row_axis_factor=4.0, max_extension_steps=25). Production settings were
    # later raised to better handle large multi-row ROIs (see
    # ``GeometrySettings`` docstrings). We pin the legacy values here so this
    # regression test keeps validating engine logic independently of the
    # production-tuning knobs.
    legacy_settings = GeometrySettings(
        row_axis_factor=4.0,
        max_extension_steps=25,
    )
    engine = GeometricEngine(legacy_settings)
    enriched = engine.process(slots, mask.astype(np.uint8))

    thr = ParityThresholds()
    matched, nb, na = _hungarian_pixel_match(baseline_xy, enriched, thr)
    assert nb > 0
    recall = matched / nb
    assert recall >= thr.baseline_recall_min, (
        f"{case_dir.name}: center match recall {matched}/{nb}={recall:.3f} "
        f"(actual_slots={na}, max_center_px={thr.max_center_px})"
    )

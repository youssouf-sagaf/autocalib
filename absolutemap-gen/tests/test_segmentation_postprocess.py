"""Tests for parkable mask postprocessing (no U-Net weights required)."""

from __future__ import annotations

import numpy as np
import pytest

from absolutemap_gen.config import SegmentationSettings
from absolutemap_gen.segmentation import (
    UNetParkableSegmenter,
    fill_small_holes,
    postprocess_parkable_mask,
    refined_mask_to_multipolygon,
)


def _solid_square_with_hole(side: int = 100, hole: int = 10) -> np.ndarray:
    m = np.zeros((side, side), dtype=np.uint8)
    m[:] = 255
    c0 = (side - hole) // 2
    m[c0 : c0 + hole, c0 : c0 + hole] = 0
    return m


def test_fill_small_holes_closes_center_gap() -> None:
    m = _solid_square_with_hole(100, 10)
    assert m[50, 50] == 0
    filled = fill_small_holes(m, max_hole_area_px=200)
    assert filled[50, 50] == 255


def test_fill_small_holes_respects_max_area() -> None:
    m = _solid_square_with_hole(100, 10)
    hole_area = 10 * 10
    not_filled = fill_small_holes(m, max_hole_area_px=max(1, hole_area - 1))
    assert not_filled[50, 50] == 0


def test_postprocess_preserves_large_blob() -> None:
    m = np.zeros((64, 64), dtype=np.uint8)
    m[16:48, 16:48] = 255
    settings = SegmentationSettings(
        unet_checkpoint_path=None,
        morph_close_kernel=3,
        morph_open_kernel=3,
        max_hole_area_px=100,
        simplify_tolerance_px=1.0,
        min_polygon_area_px=50.0,
    )
    out = postprocess_parkable_mask(m, settings)
    assert out.shape == m.shape
    assert out.dtype == np.uint8
    assert np.sum(out > 0) > 0


def test_segmenter_raises_without_checkpoint() -> None:
    settings = SegmentationSettings(unet_checkpoint_path=None)
    with pytest.raises(ValueError, match="checkpoint path"):
        UNetParkableSegmenter(settings)


def test_refined_mask_to_multipolygon_returns_polygon() -> None:
    m = np.zeros((32, 32), dtype=np.uint8)
    m[8:24, 8:24] = 255
    geom = refined_mask_to_multipolygon(m)
    assert geom is not None
    assert geom.area > 0

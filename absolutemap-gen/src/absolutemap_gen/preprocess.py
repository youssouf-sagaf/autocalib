"""RGB assembly and optional normalization for CV and VLM stages."""

from __future__ import annotations

import numpy as np

__all__ = [
    "bands_chw_to_rgb_uint8",
    "rgb_hwc_to_chw_float01",
    "rgb_hwc_percentile_stretch",
]


def bands_chw_to_rgb_uint8(
    bands: np.ndarray,
    *,
    nodata: float | None = None,
) -> np.ndarray:
    """Convert a (C, H, W) raster stack to (H, W, 3) uint8 RGB.

    Band selection: 1 band → grayscale triple; 2 bands → R, G, blue from G;
    3 bands → RGB; 4+ bands → first three (drop alpha / extras).

    Non-uint8 data is linearly scaled to 0–255 using the finite min/max
    per channel (after optional nodata masking). uint8 is passed through
    unchanged aside from nodata masking.

    Args:
        bands: Array of shape (count, height, width).
        nodata: If set, pixels where any selected band equals this value
            are forced to zero in the output (after scaling).

    Returns:
        Array of shape (height, width, 3), dtype uint8.
    """
    if bands.ndim != 3:
        raise ValueError(f"Expected CHW array with 3 dimensions, got shape {bands.shape}")

    count = int(bands.shape[0])
    if count < 1:
        raise ValueError("bands must have at least one channel")

    if count == 1:
        rgb_chw = np.repeat(bands[:1], 3, axis=0)
    elif count == 2:
        b0, b1 = bands[0:1], bands[1:2]
        rgb_chw = np.concatenate([b0, b1, b1], axis=0)
    elif count == 3:
        rgb_chw = bands[:3].copy()
    else:
        rgb_chw = bands[:3].copy()

    valid_mask = _valid_mask_for_bands(bands, nodata, count)
    rgb_chw = _scale_channels_to_uint8(rgb_chw, valid_mask=valid_mask)

    rgb_hwc = np.transpose(rgb_chw, (1, 2, 0))

    if valid_mask is not None:
        rgb_hwc = rgb_hwc.copy()
        rgb_hwc[~valid_mask] = 0

    return rgb_hwc


def _valid_mask_for_bands(
    bands: np.ndarray,
    nodata: float | None,
    count: int,
) -> np.ndarray | None:
    """Return (H, W) bool mask: True where pixels are valid for scaling/output."""
    if nodata is None:
        return None
    if count == 1:
        return ~np.isclose(bands[0], nodata)
    if count == 2:
        return ~(np.isclose(bands[0], nodata) | np.isclose(bands[1], nodata))
    return ~np.any(np.isclose(bands[:3], nodata), axis=0)


def _scale_channels_to_uint8(
    rgb_chw: np.ndarray,
    *,
    valid_mask: np.ndarray | None,
) -> np.ndarray:
    """Scale each channel to uint8; identity if already uint8."""
    if rgb_chw.dtype == np.uint8:
        return rgb_chw

    out = np.empty_like(rgb_chw, dtype=np.uint8)
    for c in range(rgb_chw.shape[0]):
        plane = rgb_chw[c].astype(np.float64, copy=False)
        finite = np.isfinite(plane)
        if valid_mask is not None:
            finite = finite & valid_mask
        if not np.any(finite):
            out[c] = 0
            continue
        lo = float(np.min(plane[finite]))
        hi = float(np.max(plane[finite]))
        if hi <= lo:
            out[c] = np.where(finite, int(np.clip(lo, 0, 255)), 0).astype(np.uint8)
            continue

        if np.issubdtype(rgb_chw.dtype, np.floating) and hi <= 1.0 + 1e-6 and lo >= -1e-6:
            scaled = np.clip(plane, 0.0, 1.0) * 255.0
        else:
            scaled = (plane - lo) / (hi - lo) * 255.0

        channel_u8 = np.where(finite, np.clip(np.round(scaled), 0, 255), 0).astype(np.uint8)
        out[c] = channel_u8
    return out


def rgb_hwc_to_chw_float01(rgb_hwc: np.ndarray) -> np.ndarray:
    """Convert (H, W, 3) uint8 RGB to (3, H, W) float32 in [0, 1]."""
    if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
        raise ValueError(f"Expected HWC RGB with 3 channels, got shape {rgb_hwc.shape}")

    f = rgb_hwc.astype(np.float32) / 255.0
    return np.transpose(f, (2, 0, 1))


def rgb_hwc_percentile_stretch(
    rgb_hwc: np.ndarray,
    *,
    low_pct: float = 2.0,
    high_pct: float = 98.0,
) -> np.ndarray:
    """Per-channel percentile stretch for uint8 RGB; returns uint8 HWC.

    Useful for display or VLM when the dynamic range is compressed.
    """
    if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
        raise ValueError(f"Expected HWC RGB, got shape {rgb_hwc.shape}")

    out = np.empty_like(rgb_hwc, dtype=np.uint8)
    for c in range(3):
        plane = rgb_hwc[:, :, c].astype(np.float64)
        lo = np.percentile(plane, low_pct)
        hi = np.percentile(plane, high_pct)
        if hi <= lo:
            out[:, :, c] = plane.astype(np.uint8)
            continue
        scaled = (plane - lo) / (hi - lo) * 255.0
        out[:, :, c] = np.clip(np.round(scaled), 0, 255).astype(np.uint8)
    return out

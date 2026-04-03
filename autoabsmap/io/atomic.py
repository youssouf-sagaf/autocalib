"""Atomic file writes — single implementation, no duplicates.

All JSON and GeoTIFF writes go through these functions to avoid partial files
on crash or interrupt.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

__all__ = ["write_json_atomic", "write_geotiff"]


def write_json_atomic(path: str | Path, obj: Any, *, indent: int = 2) -> None:
    """Write JSON atomically (temp file + rename)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(obj, indent=indent, allow_nan=False, ensure_ascii=False)
    tmp = p.with_name(f"{p.name}.tmp.{os.getpid()}")
    try:
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(p)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    logger.debug("Wrote %s (%d bytes)", p, len(payload))


def write_geotiff(
    path: str | Path,
    rgb_hwc: np.ndarray,
    *,
    affine_coeffs: tuple[float, float, float, float, float, float],
    crs_epsg: int,
) -> None:
    """Write a 3-band uint8 GeoTIFF with georeferencing."""
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import Affine

    if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
        raise ValueError(f"rgb_hwc must be (H, W, 3), got {rgb_hwc.shape}")
    if rgb_hwc.dtype != np.uint8:
        raise ValueError(f"rgb_hwc must be uint8, got {rgb_hwc.dtype}")

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    h, w = int(rgb_hwc.shape[0]), int(rgb_hwc.shape[1])
    transform = Affine(*affine_coeffs)
    crs = CRS.from_epsg(crs_epsg)

    chw = np.transpose(rgb_hwc, (2, 0, 1))
    with rasterio.open(
        p,
        "w",
        driver="GTiff",
        width=w,
        height=h,
        count=3,
        dtype="uint8",
        transform=transform,
        crs=crs,
        photometric="RGB",
    ) as dst:
        dst.write(chw)
    logger.debug("Wrote GeoTIFF %s (%dx%d)", p, w, h)

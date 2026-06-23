"""Extract a fixed-size tile from RGB imagery (center crop, borders discarded)."""

from __future__ import annotations

from typing import Any

import numpy as np


def split_into_tiles(
    rgb: np.ndarray,
    tile_size_px: int = 1024,
    overlap_ratio: float = 0.2,
) -> list[tuple[np.ndarray, int, int, dict[str, Any]]]:
    """Return a single ``(tile_rgb, offset_x, offset_y, meta)`` centered on the image.

    Images larger than *tile_size_px* are center-cropped; edges are discarded.
    Smaller images are zero-padded to *tile_size_px*.
    *overlap_ratio* is kept for API compatibility but unused.
    """
    del overlap_ratio  # unused — center crop replaces overlapping tile grid

    if rgb.ndim != 3 or rgb.shape[2] not in (3, 4):
        raise ValueError(f"Expected HxWxC RGB, got {rgb.shape}")

    h, w = rgb.shape[:2]
    x_start = max(0, (w - tile_size_px) // 2)
    y_start = max(0, (h - tile_size_px) // 2)
    x_end = min(w, x_start + tile_size_px)
    y_end = min(h, y_start + tile_size_px)

    crop = rgb[y_start:y_end, x_start:x_end, :3].copy()
    ch, cw = crop.shape[:2]
    if ch < tile_size_px or cw < tile_size_px:
        padded = np.zeros((tile_size_px, tile_size_px, 3), dtype=np.uint8)
        padded[:ch, :cw] = crop
        crop = padded

    meta: dict[str, Any] = {
        "full_width": w,
        "full_height": h,
        "crop_x": x_start,
        "crop_y": y_start,
        "crop_width": x_end - x_start,
        "crop_height": y_end - y_start,
        "crop_mode": "center",
        "tile_index": 0,
        "num_tiles": 1,
    }
    return [(crop, x_start, y_start, meta)]

"""Vectorize pixel-space slot OBBs into GeoJSON overlays (WGS84).

This is the outbound CRS gate for overlay geometry — pixel coordinates are
converted to native-CRS via the raster's affine, then reprojected to
EPSG:4326 for API/frontend consumption.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.transform import Affine

logger = logging.getLogger(__name__)

__all__ = ["pixel_slots_to_overlay_fc"]


def _pixel_to_native(
    pts: np.ndarray,
    aff: Affine,
) -> np.ndarray:
    """Transform Nx2 pixel coords to native CRS via affine (vectorized)."""
    x = aff.a * pts[:, 0] + aff.b * pts[:, 1] + aff.c
    y = aff.d * pts[:, 0] + aff.e * pts[:, 1] + aff.f
    return np.column_stack([x, y])


def pixel_slots_to_overlay_fc(
    slots: list,
    affine: tuple[float, float, float, float, float, float],
    crs_epsg: int,
) -> dict[str, Any]:
    """Convert PixelSlots to a GeoJSON FeatureCollection for map overlays.

    Uses ``PixelSlot.corners`` — identical convention to GeoJSON export
    (width-axis ``angle_rad``).
    """
    from autoabsmap.generator_engine.models import PixelSlot  # avoid circular

    aff = Affine(*affine)
    transformer: Transformer | None = None
    if crs_epsg != 4326:
        transformer = Transformer.from_crs(
            CRS.from_epsg(crs_epsg), CRS.from_epsg(4326), always_xy=True,
        )

    features: list[dict[str, Any]] = []
    for slot in slots:
        slot: PixelSlot
        pixel_corners = slot.corners

        native = _pixel_to_native(
            np.array(pixel_corners, dtype=np.float64), aff,
        )

        if transformer is not None:
            xs, ys = transformer.transform(native[:, 0], native[:, 1])
            wgs84 = np.column_stack([xs, ys])
        else:
            wgs84 = native

        coords = wgs84.tolist()
        coords.append(coords[0])

        cx_n = aff.a * slot.center_x + aff.b * slot.center_y + aff.c
        cy_n = aff.d * slot.center_x + aff.e * slot.center_y + aff.f
        if transformer is not None:
            lng, lat = transformer.transform(cx_n, cy_n)
        else:
            lng, lat = cx_n, cy_n

        features.append({
            "type": "Feature",
            "properties": {
                "source": slot.source.value,
                "confidence": slot.confidence,
                "center_lng": lng,
                "center_lat": lat,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
        })

    logger.info("Slot overlay: %d OBBs vectorized", len(features))
    return {"type": "FeatureCollection", "features": features}

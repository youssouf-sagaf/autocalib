"""Vectorize a binary segmentation mask into GeoJSON polygons (WGS84).

This is the outbound CRS gate for segmentation geometry — mask pixels
are converted to native-CRS polygons via the raster's affine, then
reprojected to EPSG:4326 for API/frontend consumption.

Uses OpenCV contours with Gaussian pre-smoothing for faithful boundary
tracing (avoids the staircase artifacts of pixel-edge vectorization).
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.transform import Affine

logger = logging.getLogger(__name__)

__all__ = ["vectorize_mask", "pixel_slots_to_overlay_fc"]

MIN_CONTOUR_AREA_PX = 100


def _pixel_to_native(
    pts: np.ndarray,
    aff: Affine,
) -> np.ndarray:
    """Transform Nx2 pixel coords to native CRS via affine (vectorized)."""
    x = aff.a * pts[:, 0] + aff.b * pts[:, 1] + aff.c
    y = aff.d * pts[:, 0] + aff.e * pts[:, 1] + aff.f
    return np.column_stack([x, y])


def _contour_to_ring(
    contour: np.ndarray,
    aff: Affine,
    transformer: Transformer | None,
) -> list[list[float]]:
    """Convert a single cv2 contour (Nx1x2) to a GeoJSON ring in WGS84."""
    pts = contour.reshape(-1, 2).astype(np.float64)
    native = _pixel_to_native(pts, aff)
    if transformer is not None:
        xs, ys = transformer.transform(native[:, 0], native[:, 1])
        coords = np.column_stack([xs, ys])
    else:
        coords = native
    ring = coords.tolist()
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def vectorize_mask(
    mask: np.ndarray,
    affine: tuple[float, float, float, float, float, float],
    crs_epsg: int,
    gsd_m: float = 0.05,
) -> dict[str, Any]:
    """Convert a binary uint8 mask (0/255) to a GeoJSON FeatureCollection in WGS84.

    Pipeline:
      1. Gaussian blur (kernel ≈ 5 px) to smooth jagged pixel edges
      2. Re-threshold to binary
      3. cv2.findContours with hierarchy (outer + holes)
      4. cv2.approxPolyDP for controlled simplification
      5. Affine → native CRS → WGS84 reprojection
    """
    aff = Affine(*affine)

    blur_k = max(3, int(round(5 * (gsd_m / 0.05))) | 1)
    smoothed = cv2.GaussianBlur(mask, (blur_k, blur_k), 0)
    _, binary = cv2.threshold(smoothed, 127, 255, cv2.THRESH_BINARY)

    contours, hierarchy = cv2.findContours(
        binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE,
    )

    if not contours or hierarchy is None:
        logger.info("Mask vectorization: no parkable pixels found")
        return {"type": "FeatureCollection", "features": []}

    epsilon_px = max(1.0, 2.0 * (gsd_m / 0.05))

    transformer: Transformer | None = None
    if crs_epsg != 4326:
        transformer = Transformer.from_crs(
            CRS.from_epsg(crs_epsg), CRS.from_epsg(4326), always_xy=True,
        )

    hier = hierarchy[0]
    features: list[dict[str, Any]] = []

    idx = 0
    while idx >= 0:
        contour = contours[idx]
        if cv2.contourArea(contour) < MIN_CONTOUR_AREA_PX:
            idx = hier[idx][0]
            continue

        approx = cv2.approxPolyDP(contour, epsilon_px, closed=True)
        if len(approx) < 3:
            idx = hier[idx][0]
            continue

        outer_ring = _contour_to_ring(approx, aff, transformer)
        rings = [outer_ring]

        child = hier[idx][2]
        while child >= 0:
            hole_contour = contours[child]
            if cv2.contourArea(hole_contour) >= MIN_CONTOUR_AREA_PX:
                hole_approx = cv2.approxPolyDP(hole_contour, epsilon_px, closed=True)
                if len(hole_approx) >= 3:
                    rings.append(_contour_to_ring(hole_approx, aff, transformer))
            child = hier[child][0]

        features.append({
            "type": "Feature",
            "properties": {"layer": "segmentation_mask"},
            "geometry": {"type": "Polygon", "coordinates": rings},
        })

        idx = hier[idx][0]

    logger.info(
        "Mask vectorization: %d polygon(s) from %d contours",
        len(features), len(contours),
    )

    return {"type": "FeatureCollection", "features": features}


def pixel_slots_to_overlay_fc(
    slots: list,
    affine: tuple[float, float, float, float, float, float],
    crs_epsg: int,
) -> dict[str, Any]:
    """Convert PixelSlots to a GeoJSON FeatureCollection for map overlays.

    Uses ``PixelSlot.corners`` directly — no export-angle rotation — so the
    overlay polygons match the pipeline's internal OBB geometry exactly.
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

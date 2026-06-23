"""Canonical GeoRasterSlice model — the universal raster container.

Carries pixels, CRS, affine transform, bounds, and the *computed* ground
sampling distance.  No read/write I/O here — imagery providers build
GeoRasterSlice directly from downloaded bytes.
"""

from __future__ import annotations

import logging
import math

import numpy as np
from pydantic import BaseModel, ConfigDict, field_validator
from rasterio.crs import CRS
from rasterio.transform import Affine

logger = logging.getLogger(__name__)

__all__ = [
    "BBox",
    "GeoRasterSlice",
    "compute_gsd_m",
]


class BBox(BaseModel):
    """Axis-aligned bounding box (minx, miny, maxx, maxy)."""

    west: float
    south: float
    east: float
    north: float

    model_config = ConfigDict(frozen=True)


class GeoRasterSlice(BaseModel):
    """Georeferenced raster tile — the universal raster container.

    ``gsd_m`` is computed from the affine transform, never from config.
    """

    pixels: np.ndarray
    """H x W x C uint8 array (RGB or RGBA)."""
    crs_epsg: int
    """EPSG code of the native CRS (e.g. 3857, 2154, 32631)."""
    affine: tuple[float, float, float, float, float, float]
    """Rasterio-style affine coefficients (a, b, c, d, e, f)."""
    bounds_native: BBox
    """Bounding box in the native CRS (metres for projected CRSes)."""
    bounds_wgs84: BBox
    """Bounding box in EPSG:4326 (for API / display)."""
    gsd_m: float
    """Actual ground sampling distance computed from the affine transform."""

    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)

    @field_validator("pixels")
    @classmethod
    def _validate_pixels(cls, v: np.ndarray) -> np.ndarray:
        if v.ndim != 3 or v.shape[2] not in (3, 4):
            raise ValueError(f"pixels must be HxWx(3|4), got shape {v.shape}")
        if v.dtype != np.uint8:
            raise ValueError(f"pixels must be uint8, got {v.dtype}")
        return v

    @property
    def height(self) -> int:
        return int(self.pixels.shape[0])

    @property
    def width(self) -> int:
        return int(self.pixels.shape[1])

    @property
    def rasterio_affine(self) -> Affine:
        return Affine(*self.affine)


def compute_gsd_m(
    transform: Affine,
    crs: CRS,
    lat_hint: float | None = None,
) -> float:
    """Estimate ground sampling distance (metres/pixel) from the affine and CRS."""
    pixel_dx = abs(transform.a)
    pixel_dy = abs(transform.e)

    epsg = crs.to_epsg()
    if epsg == 4326:
        lat = lat_hint if lat_hint is not None else abs(transform.f)
        m_per_deg_lat = 111_320.0
        m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
        return (pixel_dx * m_per_deg_lon + pixel_dy * m_per_deg_lat) / 2.0

    if crs.is_projected:
        factor = crs.linear_units_factor[1] if crs.linear_units_factor else 1.0
        return ((pixel_dx + pixel_dy) / 2.0) * factor

    raise ValueError(f"Cannot compute GSD for CRS {crs}")



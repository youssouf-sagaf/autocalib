"""GeoTIFF read/crop and the canonical GeoRasterSlice model.

``GeoRasterSlice`` is the single raster container used across the entire
pipeline.  It carries pixels, CRS, affine transform, bounds, and the
*computed* ground sampling distance — no implicit assumptions.
"""

from __future__ import annotations

import logging
import math
from typing import Sequence

import numpy as np
import rasterio
from pydantic import BaseModel, ConfigDict, field_validator
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.windows import Window, from_bounds

logger = logging.getLogger(__name__)

__all__ = [
    "BBox",
    "GeoRasterSlice",
    "read_geotiff",
    "crop_by_bounds",
    "crop_by_pixels",
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


def _bands_chw_to_rgb_uint8(
    chw: np.ndarray,
    nodata: float | None = None,
) -> np.ndarray:
    """Convert (C, H, W) rasterio bands to (H, W, 3) uint8 RGB."""
    if chw.ndim != 3:
        raise ValueError(f"Expected 3D CHW array, got shape {chw.shape}")
    c = chw.shape[0]
    if c == 1:
        band = chw[0]
    elif c >= 3:
        band = chw[:3]
    else:
        band = chw
    hwc = np.moveaxis(band, 0, -1) if band.ndim == 3 else band[..., np.newaxis]
    if hwc.shape[2] == 1:
        hwc = np.repeat(hwc, 3, axis=2)
    if hwc.dtype != np.uint8:
        if np.issubdtype(hwc.dtype, np.floating):
            hwc = np.clip(hwc * 255, 0, 255).astype(np.uint8)
        else:
            hwc = np.clip(hwc, 0, 255).astype(np.uint8)
    return hwc


def _bounds_to_wgs84(
    bounds: tuple[float, float, float, float],
    crs: CRS,
) -> BBox:
    """Reproject native bounds to WGS84."""
    minx, miny, maxx, maxy = bounds
    if crs.to_epsg() == 4326:
        return BBox(west=minx, south=miny, east=maxx, north=maxy)
    from pyproj import Transformer

    t = Transformer.from_crs(crs, CRS.from_epsg(4326), always_xy=True)
    lon_min, lat_min = t.transform(minx, miny)
    lon_max, lat_max = t.transform(maxx, maxy)
    return BBox(west=lon_min, south=lat_min, east=lon_max, north=lat_max)


def _slice_from_dataset(
    src: rasterio.io.DatasetReader,
    window: Window,
    bands: Sequence[int] | None = None,
) -> GeoRasterSlice:
    """Read a window from an open rasterio dataset into a GeoRasterSlice."""
    window = window.intersection(Window(0, 0, src.width, src.height))
    if window.width == 0 or window.height == 0:
        raise ValueError("Window is empty or does not intersect the raster")

    transform = src.window_transform(window)
    crs = src.crs

    indices = list(bands) if bands else list(range(1, min(src.count + 1, 4)))
    arrays = [src.read(i, window=window) for i in indices]
    chw = np.stack(arrays, axis=0)
    nodata_val = src.nodatavals[0] if src.nodatavals else None
    rgb_hwc = _bands_chw_to_rgb_uint8(chw, nodata=nodata_val)

    h, w = int(rgb_hwc.shape[0]), int(rgb_hwc.shape[1])
    gsd = compute_gsd_m(transform, crs)
    native_bounds = rasterio.transform.array_bounds(h, w, transform)
    wgs84_bounds = _bounds_to_wgs84(native_bounds, crs)

    return GeoRasterSlice(
        pixels=rgb_hwc,
        crs_epsg=crs.to_epsg() or 0,
        affine=tuple(transform)[:6],
        bounds_native=BBox(
            west=native_bounds[0],
            south=native_bounds[1],
            east=native_bounds[2],
            north=native_bounds[3],
        ),
        bounds_wgs84=wgs84_bounds,
        gsd_m=gsd,
    )


def read_geotiff(path: str | Path) -> GeoRasterSlice:
    """Read a full GeoTIFF into a GeoRasterSlice."""
    from pathlib import Path as _P

    p = _P(path).resolve()
    with rasterio.open(p) as src:
        window = Window(0, 0, src.width, src.height)
        return _slice_from_dataset(src, window)


def crop_by_bounds(
    path: str | Path,
    west: float,
    south: float,
    east: float,
    north: float,
) -> GeoRasterSlice:
    """Crop a GeoTIFF using world coordinates in the raster CRS."""
    from pathlib import Path as _P

    with rasterio.open(_P(path).resolve()) as src:
        window = from_bounds(west, south, east, north, transform=src.transform)
        return _slice_from_dataset(src, window)


def crop_by_pixels(
    path: str | Path,
    col_off: int,
    row_off: int,
    width: int,
    height: int,
) -> GeoRasterSlice:
    """Crop a GeoTIFF using pixel offsets."""
    from pathlib import Path as _P

    with rasterio.open(_P(path).resolve()) as src:
        window = Window(col_off, row_off, width, height)
        return _slice_from_dataset(src, window)

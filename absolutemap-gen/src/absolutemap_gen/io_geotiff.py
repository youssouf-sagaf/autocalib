"""GeoTIFF I/O with rasterio: open, crop by window or bounds, preserve CRS and transform."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO, Sequence, Union

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.windows import Window, from_bounds

from absolutemap_gen.preprocess import bands_chw_to_rgb_uint8

if TYPE_CHECKING:
    from shapely.geometry.base import BaseGeometry

__all__ = [
    "GeoRasterSlice",
    "read_geotiff_rgb",
    "crop_geotiff_by_pixels",
    "crop_geotiff_by_bounds",
    "crop_geotiff_by_geometry",
    "crop_dataset_to_slice",
]

# (minx, miny, maxx, maxy) in the dataset CRS — same convention as Shapely bounds.
BoundsLike = tuple[float, float, float, float]


@dataclass(frozen=True)
class GeoRasterSlice:
    """Cropped RGB tile with georeferencing aligned to the crop pixels.

    ``rgb`` uses an HWC layout (height, width, 3) and uint8 dtype for OpenCV-style
    downstream stages. Geographic alignment uses ``transform`` and ``crs`` for
    the cropped raster (pixel (0,0) is the northwest corner of the crop).
    """

    rgb: np.ndarray
    transform: Affine
    crs: CRS
    width: int
    height: int
    nodata: float | None

    def __post_init__(self) -> None:
        if self.rgb.ndim != 3 or self.rgb.shape[2] != 3:
            raise ValueError("rgb must have shape (H, W, 3)")
        if self.rgb.dtype != np.uint8:
            raise ValueError("rgb must be uint8")
        if self.height != int(self.rgb.shape[0]) or self.width != int(self.rgb.shape[1]):
            raise ValueError("rgb spatial dimensions must match height and width")


def read_geotiff_rgb(
    path: Union[str, Path, BinaryIO],
    *,
    bands: Sequence[int] | None = None,
) -> tuple[np.ndarray, Affine, CRS, float | None]:
    """Read a full raster as RGB HWC uint8 without cropping.

    Returns:
        rgb_hwc, transform, crs, nodata (first band nodata if any).
    """
    with rasterio.open(path) as src:
        window = Window(0, 0, src.width, src.height)
        return _read_window_rgb(src, window, bands=bands)


def crop_geotiff_by_pixels(
    path: Union[str, Path, BinaryIO],
    *,
    col_off: int,
    row_off: int,
    width: int,
    height: int,
    bands: Sequence[int] | None = None,
    padding: bool = False,
) -> GeoRasterSlice:
    """Crop using pixel indices (column offset, row offset, width, height).

    The window is intersected with the raster extent so the result is always
    fully inside the source unless ``padding`` is True (rasterio padded reads).

    Args:
        path: GeoTIFF path or file-like object accepted by ``rasterio.open``.
        col_off: Left column of the window (0-based).
        row_off: Top row of the window (0-based).
        width: Window width in pixels.
        height: Window height in pixels.
        bands: 1-based band indices to read; default first three (or fewer).
        padding: If True, allow partial windows and pad outside the raster.
    """
    window = Window(col_off, row_off, width, height)
    with rasterio.open(path) as src:
        if not padding:
            inner = window.intersection(Window(0, 0, src.width, src.height))
            if inner.width == 0 or inner.height == 0:
                raise ValueError("Crop window does not intersect the raster")
            window = inner
        return crop_dataset_to_slice(src, window, bands=bands, padding=padding)


def crop_geotiff_by_bounds(
    path: Union[str, Path, BinaryIO],
    bounds: BoundsLike,
    *,
    bands: Sequence[int] | None = None,
) -> GeoRasterSlice:
    """Crop using world coordinates (minx, miny, maxx, maxy) in the raster CRS.

    This matches :meth:`shapely.geometry.base.BaseGeometry.bounds` ordering.
    """
    minx, miny, maxx, maxy = bounds
    if maxx <= minx or maxy <= miny:
        raise ValueError("bounds must have positive width and height in CRS units")

    with rasterio.open(path) as src:
        if src.transform.is_identity:
            raise ValueError("Dataset has no geotransform; cannot crop by bounds")
        window = from_bounds(minx, miny, maxx, maxy, transform=src.transform)
        window = window.intersection(Window(0, 0, src.width, src.height))
        if window.width == 0 or window.height == 0:
            raise ValueError("Bounds do not intersect the raster footprint")
        return crop_dataset_to_slice(src, window, bands=bands, padding=False)


def crop_geotiff_by_geometry(
    path: Union[str, Path, BinaryIO],
    geometry: "BaseGeometry",
    *,
    bands: Sequence[int] | None = None,
) -> GeoRasterSlice:
    """Crop using the axis-aligned bounds of a Shapely geometry (in the raster CRS)."""
    b = geometry.bounds
    return crop_geotiff_by_bounds(path, (b[0], b[1], b[2], b[3]), bands=bands)


def crop_dataset_to_slice(
    src: rasterio.io.DatasetReader,
    window: Window,
    *,
    bands: Sequence[int] | None = None,
    padding: bool = False,
) -> GeoRasterSlice:
    """Crop an open dataset to a :class:`GeoRasterSlice` with correct transform."""
    if not padding:
        window = window.intersection(Window(0, 0, src.width, src.height))
    if window.width == 0 or window.height == 0:
        raise ValueError("Window is empty")

    transform = src.window_transform(window)
    nodata = _first_band_nodata(src, bands)

    indices = _resolve_band_indices(src, bands)
    arrays = []
    for idx in indices:
        band = src.read(
            idx,
            window=window,
            boundless=padding,
            fill_value=nodata if nodata is not None else 0,
        )
        arrays.append(band)
    stack = np.stack(arrays, axis=0)
    rgb_hwc = bands_chw_to_rgb_uint8(stack, nodata=nodata)

    h, w = int(rgb_hwc.shape[0]), int(rgb_hwc.shape[1])
    return GeoRasterSlice(
        rgb=rgb_hwc,
        transform=transform,
        crs=src.crs,
        width=w,
        height=h,
        nodata=nodata,
    )


def _read_window_rgb(
    src: rasterio.io.DatasetReader,
    window: Window,
    *,
    bands: Sequence[int] | None,
) -> tuple[np.ndarray, Affine, CRS, float | None]:
    slice_ = crop_dataset_to_slice(src, window, bands=bands, padding=False)
    return slice_.rgb, slice_.transform, slice_.crs, slice_.nodata


def _first_band_nodata(
    src: rasterio.io.DatasetReader,
    bands: Sequence[int] | None,
) -> float | None:
    idx = 1 if not bands else int(bands[0])
    vals = src.nodatavals
    if not vals or idx < 1 or idx > len(vals):
        return None
    v = vals[idx - 1]
    return None if v is None else float(v)


def _resolve_band_indices(
    src: rasterio.io.DatasetReader,
    bands: Sequence[int] | None,
) -> list[int]:
    if bands is not None:
        out = [int(b) for b in bands]
        for b in out:
            if b < 1 or b > src.count:
                raise ValueError(f"Band index {b} out of range (1..{src.count})")
        return out
    if src.count >= 3:
        return [1, 2, 3]
    return list(range(1, src.count + 1))

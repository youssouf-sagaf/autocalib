"""Tests for GeoTIFF crop georeferencing and RGB assembly."""

from __future__ import annotations

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.windows import Window
from shapely.geometry import box

from absolutemap_gen.io_geotiff import (
    crop_dataset_to_slice,
    crop_geotiff_by_bounds,
    crop_geotiff_by_geometry,
    crop_geotiff_by_pixels,
)
from absolutemap_gen.preprocess import bands_chw_to_rgb_uint8, rgb_hwc_to_chw_float01


def _in_memory_rgb_raster(
    *,
    width: int = 20,
    height: int = 10,
    transform=None,
) -> MemoryFile:
    data = np.zeros((3, height, width), dtype=np.uint8)
    data[0] = 10
    data[1] = 20
    data[2] = 30
    data[:, 2:5, 3:8] = np.array([100, 110, 120], dtype=np.uint8).reshape(3, 1, 1)
    if transform is None:
        transform = from_origin(2.0, 49.1, 0.001, 0.001)
    profile = {
        "driver": "GTiff",
        "width": width,
        "height": height,
        "count": 3,
        "dtype": "uint8",
        "crs": "EPSG:4326",
        "transform": transform,
    }
    mem = MemoryFile()
    with mem.open(**profile) as dst:
        dst.write(data)
    return mem


def test_crop_pixel_window_transform_matches_rasterio() -> None:
    mem = _in_memory_rgb_raster()
    with mem.open() as src:
        window = Window(3, 2, 5, 4)
        expected = src.window_transform(window)
        sl = crop_dataset_to_slice(src, window)
    assert sl.rgb.shape == (4, 5, 3)
    assert sl.width == 5 and sl.height == 4
    for a, b in zip(sl.transform, expected):
        assert abs(a - b) < 1e-9


def test_crop_bounds_matches_pixel_crop() -> None:
    mem = _in_memory_rgb_raster()
    with mem.open() as src:
        window = Window(3, 2, 5, 4)
        bounds = rasterio.windows.bounds(window, src.transform)
        sl_win = crop_dataset_to_slice(src, window)
    sl_bounds = crop_geotiff_by_bounds(mem, bounds)
    assert np.array_equal(sl_win.rgb, sl_bounds.rgb)
    for a, b in zip(sl_win.transform, sl_bounds.transform):
        assert abs(a - b) < 1e-9


def test_crop_geotiff_by_geometry_uses_shapely_bounds() -> None:
    mem = _in_memory_rgb_raster()
    with mem.open() as src:
        window = Window(3, 2, 5, 4)
        b = rasterio.windows.bounds(window, src.transform)
        sl_bounds = crop_geotiff_by_bounds(mem, b)
    geom = box(b[0], b[1], b[2], b[3])
    sl_geom = crop_geotiff_by_geometry(mem, geom)
    assert np.array_equal(sl_bounds.rgb, sl_geom.rgb)


def test_grayscale_single_band_tripled() -> None:
    h, w = 4, 4
    plane = np.full((1, h, w), 42, dtype=np.uint8)
    rgb = bands_chw_to_rgb_uint8(plane)
    assert rgb.shape == (h, w, 3)
    assert np.all(rgb == 42)


def test_rgb_hwc_to_chw_float01() -> None:
    rgb = np.zeros((2, 2, 3), dtype=np.uint8)
    rgb[..., 0] = 255
    chw = rgb_hwc_to_chw_float01(rgb)
    assert chw.shape == (3, 2, 2)
    assert chw[0, 0, 0] == 1.0 and chw[1, 0, 0] == 0.0


def test_crop_geotiff_by_pixels_path_api() -> None:
    mem = _in_memory_rgb_raster()
    sl = crop_geotiff_by_pixels(mem, col_off=3, row_off=2, width=5, height=4)
    assert sl.rgb.shape == (4, 5, 3)

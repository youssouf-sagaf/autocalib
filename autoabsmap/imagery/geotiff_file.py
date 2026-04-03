"""GeoTiffFileProvider — local file, for offline testing / replay.

Implements the ImageryProvider protocol by reading a local GeoTIFF file.
Useful for golden-file parity tests and offline development.
"""

from __future__ import annotations

import logging
from pathlib import Path

from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.io.geotiff import GeoRasterSlice, read_geotiff, crop_by_bounds

logger = logging.getLogger(__name__)

__all__ = ["GeoTiffFileProvider"]


class GeoTiffFileProvider:
    """Serve imagery from a local GeoTIFF file.

    Implements the ``ImageryProvider`` protocol. If the ROI falls within the
    file bounds, crops to the ROI; otherwise returns the full raster.
    """

    def __init__(self, file_path: str | Path) -> None:
        self._path = Path(file_path).resolve()
        if not self._path.is_file():
            raise FileNotFoundError(f"GeoTIFF not found: {self._path}")

    def fetch_geotiff(
        self,
        roi: GeoJSONPolygon,
        target_gsd_m: float,
    ) -> GeoRasterSlice:
        """Read the local GeoTIFF, optionally cropping to the ROI bounds."""
        coords = roi.coordinates[0]
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        west, east = min(lons), max(lons)
        south, north = min(lats), max(lats)

        try:
            raster = crop_by_bounds(self._path, west, south, east, north)
            logger.info(
                "GeoTiffFileProvider: cropped %s to ROI (%dx%d, GSD=%.4fm)",
                self._path.name, raster.width, raster.height, raster.gsd_m,
            )
        except (ValueError, Exception):
            raster = read_geotiff(self._path)
            logger.info(
                "GeoTiffFileProvider: loaded full %s (%dx%d, GSD=%.4fm)",
                self._path.name, raster.width, raster.height, raster.gsd_m,
            )

        return raster

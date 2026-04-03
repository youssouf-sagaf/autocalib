"""ImageryProvider protocol — the only contract the pipeline depends on.

Adding a new provider (Google Aerial, S3, local GeoTIFF) requires zero
changes to the pipeline — implement this protocol and inject it.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from geojson_pydantic import Polygon as GeoJSONPolygon

from absmap.io.geotiff import GeoRasterSlice

__all__ = ["ImageryProvider"]


@runtime_checkable
class ImageryProvider(Protocol):
    """Fetch a high-resolution raster for a given region of interest.

    - *roi* is always WGS84 (EPSG:4326).
    - The provider reprojects to its native metric CRS internally.
    - *target_gsd_m* is a hint (e.g. 0.15 for Mapbox, 0.20 for IGN);
      the actual GSD is in the returned ``GeoRasterSlice.gsd_m``.
    - Concrete implementations may subdivide the ROI into tiles and stitch —
      the pipeline always receives a single ``GeoRasterSlice``.
    """

    def fetch_geotiff(
        self,
        roi: GeoJSONPolygon,
        target_gsd_m: float,
    ) -> GeoRasterSlice: ...

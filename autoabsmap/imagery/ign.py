"""IgnImageryProvider — IGN Géoportail WMTS (multi-layer).

Free, anonymous tile service since 2023 (``data.geopf.fr``). Tiles are
256-px Web Mercator JPEG/PNG, addressed by integer ``(z, x, y)`` via the
WMTS KVP profile — identical math to a slippy-map XYZ source, so the
shared ``_xyz`` helper does the stitching.

The provider is layer-agnostic: the layer / format / max-zoom triplet is
either taken from settings (default = "best available" composite) or
overridden per-instance via the constructor. The named presets below let
the API expose a flat ``imagery_source`` enum instead of leaking WMTS
identifiers into the wire contract.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from geojson_pydantic import Polygon as GeoJSONPolygon

from autoabsmap.config.settings import ImagerySettings
from autoabsmap.imagery._xyz import fetch_xyz_geotiff, http_get_with_retry
from autoabsmap.io.geotiff import GeoRasterSlice

logger = logging.getLogger(__name__)

__all__ = ["IgnImageryProvider", "IgnLayerPreset", "IGN_LAYER_PRESETS"]


@dataclass(frozen=True)
class IgnLayerPreset:
    """A named IGN WMTS layer with its companion format and max zoom."""

    layer: str
    format: str  # "image/jpeg" or "image/png"
    max_zoom: int


# Curated set of recent layers chosen with the operator in mind:
#   - "current"      : composite "best available" — fastest update cadence
#   - "pleiades-2026": Pléiades satellite 2026 (most recent date, FR métro only)
IGN_LAYER_PRESETS: dict[str, IgnLayerPreset] = {
    "current": IgnLayerPreset(
        layer="ORTHOIMAGERY.ORTHOPHOTOS",
        format="image/jpeg",
        max_zoom=19,
    ),
    "pleiades-2026": IgnLayerPreset(
        layer="ORTHOIMAGERY.ORTHO-SAT.PLEIADES.2026",
        format="image/png",
        max_zoom=18,
    ),
}


class IgnImageryProvider:
    """Fetch IGN orthophoto imagery via the Géoportail WMTS endpoint.

    ``layer`` / ``format`` / ``max_zoom`` default to ``settings.ign_*`` but
    each can be overridden per-instance — the API layer instantiates one
    provider per ``IGN_LAYER_PRESETS`` key.
    """

    def __init__(
        self,
        settings: ImagerySettings,
        *,
        layer: str | None = None,
        format: str | None = None,
        max_zoom: int | None = None,
    ) -> None:
        self._settings = settings
        self._layer = layer or settings.ign_layer
        self._format = format or settings.ign_format
        self._max_zoom = max_zoom if max_zoom is not None else settings.ign_max_zoom

    def fetch_geotiff(
        self,
        roi: GeoJSONPolygon,
        target_gsd_m: float,
    ) -> GeoRasterSlice:
        s = self._settings
        layer = self._layer
        fmt = self._format

        def _fetch_tile(z: int, x: int, y: int) -> bytes:
            url = (
                f"{s.ign_base_url}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
                f"&LAYER={layer}&TILEMATRIXSET=PM&TILEMATRIX={z}"
                f"&TILEROW={y}&TILECOL={x}&FORMAT={fmt}&STYLE={s.ign_style}"
            )
            return http_get_with_retry(
                url,
                headers={"User-Agent": "autoabsmap/1.0"},
                timeout_s=s.xyz_timeout_s,
                max_retries=s.xyz_max_retries,
                backoff_s=s.xyz_retry_backoff_s,
            )

        return fetch_xyz_geotiff(
            roi, target_gsd_m, _fetch_tile,
            max_zoom=self._max_zoom, provider_name="ign",
        )

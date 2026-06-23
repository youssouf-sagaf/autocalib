"""Provider smoke tests — IGN presets + factory dispatch.

The IGN provider is exercised with a stubbed HTTP fetcher so the test
runs offline. Mapbox is covered by the existing R&D tests (network-gated)
and is only checked here at the factory-dispatch level.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pytest
from geojson_pydantic import Polygon as GeoJSONPolygon
from PIL import Image

from autoabsmap.config.settings import ImagerySettings
from autoabsmap.imagery import ign as ign_mod
from autoabsmap.imagery.ign import IGN_LAYER_PRESETS, IgnImageryProvider

# Add autocalib-api so we can import the factory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autocalib-api"))
from app.services.imagery_factory import (  # noqa: E402
    build_ign_provider,
    build_imagery_provider,
)


# ── Fixtures ─────────────────────────────────────────────────────────────

def _png_bytes(color: tuple[int, int, int] = (180, 200, 220)) -> bytes:
    """Generate a 256×256 solid-color PNG for the stub fetcher."""
    arr = np.zeros((256, 256, 3), dtype=np.uint8)
    arr[:, :] = color
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def small_roi() -> GeoJSONPolygon:
    # ~30m × 30m near Paris.
    return GeoJSONPolygon(
        type="Polygon",
        coordinates=[[
            [2.3500, 48.8560],
            [2.3504, 48.8560],
            [2.3504, 48.8563],
            [2.3500, 48.8563],
            [2.3500, 48.8560],
        ]],
    )


# ── Tests ────────────────────────────────────────────────────────────────

def test_ign_provider_default_layer_smoke(small_roi, monkeypatch):
    """Default IGN provider stitches WMTS tiles into a valid GeoRasterSlice."""
    calls: list[str] = []

    def fake_get(url: str, **_kwargs) -> bytes:
        calls.append(url)
        return _png_bytes()

    # ign.py does ``from _xyz import http_get_with_retry`` — patch the bound
    # name on the provider module, not on _xyz.
    monkeypatch.setattr(ign_mod, "http_get_with_retry", fake_get)

    s = ImagerySettings(provider="ign")
    p = IgnImageryProvider(s)
    raster = p.fetch_geotiff(small_roi, target_gsd_m=0.05)

    assert raster.crs_epsg == 4326
    assert raster.pixels.dtype == np.uint8
    assert raster.pixels.shape[2] == 3
    assert raster.gsd_m > 0
    assert calls
    assert all("data.geopf.fr" in url for url in calls)
    assert all("LAYER=ORTHOIMAGERY.ORTHOPHOTOS" in url for url in calls)


@pytest.mark.parametrize(
    "preset_name,expected_layer,expected_format",
    [
        ("current", "ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg"),
        ("pleiades-2026", "ORTHOIMAGERY.ORTHO-SAT.PLEIADES.2026", "image/png"),
    ],
)
def test_ign_preset_routes_to_correct_layer(
    small_roi, monkeypatch, preset_name, expected_layer, expected_format,
):
    """Each preset name should produce WMTS URLs targeting the right LAYER and FORMAT."""
    calls: list[str] = []

    def fake_get(url: str, **_kwargs) -> bytes:
        calls.append(url)
        return _png_bytes()

    monkeypatch.setattr(ign_mod, "http_get_with_retry", fake_get)

    provider = build_ign_provider(ImagerySettings(provider="ign"), preset_name)
    raster = provider.fetch_geotiff(small_roi, target_gsd_m=0.05)

    assert raster.pixels.shape[2] == 3
    assert calls, "expected at least one tile fetch"
    assert all(f"LAYER={expected_layer}" in url for url in calls)
    # Format is URL-encoded inside the URL ("image%2Fjpeg") OR plain — the
    # provider builds it raw, not encoded, so plain match is fine.
    assert all(f"FORMAT={expected_format}" in url for url in calls)


def test_ign_presets_constant_exposes_recent_layers():
    """Sanity check that the curated preset list matches the wire enum."""
    assert set(IGN_LAYER_PRESETS) == {"current", "pleiades-2026"}
    pleiades = IGN_LAYER_PRESETS["pleiades-2026"]
    assert pleiades.format == "image/png"
    assert pleiades.layer.endswith("PLEIADES.2026")


def test_factory_dispatches_to_ign():
    s = ImagerySettings(provider="ign")
    assert isinstance(build_imagery_provider(s), IgnImageryProvider)


def test_factory_rejects_unknown_provider():
    # pydantic Literal validation guards the public path; cover the manual
    # bypass path too in case settings are constructed via .model_construct.
    s = ImagerySettings.model_construct(provider="bing")
    with pytest.raises(ValueError, match="Unknown imagery provider"):
        build_imagery_provider(s)


def test_build_ign_provider_rejects_unknown_preset():
    with pytest.raises(ValueError, match="Unknown IGN layer preset"):
        build_ign_provider(ImagerySettings(provider="ign"), "nope-2099")


"""Imagery provider factory (mirrors autocalib-api pattern)."""

from __future__ import annotations

import logging

from autoabsmap.config.settings import ImagerySettings
from autoabsmap.imagery.ign import IgnImageryProvider
from autoabsmap.imagery.mapbox import MapboxImageryProvider
from autoabsmap.imagery.protocols import ImageryProvider

from app.config.settings import ImagerySource

logger = logging.getLogger(__name__)

_provider_cache: dict[str, ImageryProvider] = {}


def build_imagery_provider(settings: ImagerySettings) -> ImageryProvider:
    provider = settings.provider
    if provider == "mapbox":
        return MapboxImageryProvider(settings)
    if provider == "ign":
        return IgnImageryProvider(settings)
    raise ValueError(f"Unknown imagery provider: {provider!r}")


def build_ign_provider(settings: ImagerySettings, preset_name: str) -> IgnImageryProvider:
    from autoabsmap.imagery.ign import IGN_LAYER_PRESETS

    if preset_name not in IGN_LAYER_PRESETS:
        raise ValueError(
            f"Unknown IGN layer preset: {preset_name!r} "
            f"(available: {sorted(IGN_LAYER_PRESETS)})"
        )
    preset = IGN_LAYER_PRESETS[preset_name]
    ign_settings = settings.model_copy(update={"provider": "ign"})
    return IgnImageryProvider(
        ign_settings,
        layer=preset.layer,
        format=preset.format,
        max_zoom=preset.max_zoom,
    )


def get_imagery_provider(source: ImagerySource, imagery_settings: ImagerySettings) -> ImageryProvider:
    if source in _provider_cache:
        return _provider_cache[source]

    if source == "mapbox":
        provider = build_imagery_provider(
            imagery_settings.model_copy(update={"provider": "mapbox"})
        )
    elif source.startswith("ign-"):
        preset_name = source[len("ign-") :]
        provider = build_ign_provider(imagery_settings, preset_name)
    else:
        raise ValueError(f"Unknown imagery source: {source!r}")

    _provider_cache[source] = provider
    logger.info("Imagery provider ready: %s", source)
    return provider

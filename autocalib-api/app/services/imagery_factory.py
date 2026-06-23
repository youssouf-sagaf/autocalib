"""Imagery provider factory — dispatches on settings.imagery.provider."""

from __future__ import annotations

import logging

from autoabsmap.config.settings import ImagerySettings
from autoabsmap.imagery.ign import IGN_LAYER_PRESETS, IgnImageryProvider
from autoabsmap.imagery.mapbox import MapboxImageryProvider
from autoabsmap.imagery.protocols import ImageryProvider

logger = logging.getLogger(__name__)

__all__ = [
    "build_imagery_provider",
    "build_imagery_provider_for_source",
    "build_ign_provider",
    "IGN_LAYER_PRESETS",
]


def build_imagery_provider(settings: ImagerySettings) -> ImageryProvider:
    """Instantiate the ImageryProvider matching ``settings.provider``.

    For IGN this returns the *default* (settings-configured) layer; named
    presets must be built via :func:`build_ign_provider`.
    """
    provider = settings.provider
    logger.info("Using %s imagery provider", provider)
    if provider == "mapbox":
        return MapboxImageryProvider(settings)
    if provider == "ign":
        return IgnImageryProvider(settings)
    raise ValueError(f"Unknown imagery provider: {provider!r}")


def build_ign_provider(
    settings: ImagerySettings,
    preset_name: str,
) -> IgnImageryProvider:
    """Build an IGN provider bound to the named layer preset."""
    if preset_name not in IGN_LAYER_PRESETS:
        raise ValueError(
            f"Unknown IGN layer preset: {preset_name!r} "
            f"(available: {sorted(IGN_LAYER_PRESETS)})"
        )
    preset = IGN_LAYER_PRESETS[preset_name]
    logger.info("Building IGN provider with preset %s → %s", preset_name, preset.layer)
    ign_settings = settings.model_copy(update={"provider": "ign"})
    return IgnImageryProvider(
        ign_settings,
        layer=preset.layer,
        format=preset.format,
        max_zoom=preset.max_zoom,
    )


def build_imagery_provider_for_source(
    source: str | None,
    settings: ImagerySettings,
) -> ImageryProvider:
    """Instantiate an ImageryProvider for a named source string.

    ``None`` uses ``settings.provider`` as the source name.
    """
    name = source or settings.provider
    if name == "mapbox":
        return build_imagery_provider(settings.model_copy(update={"provider": "mapbox"}))
    if name.startswith("ign-"):
        return build_ign_provider(settings, name[len("ign-") :])
    if name == "ign":
        return build_ign_provider(settings, "current")
    raise ValueError(f"Unknown imagery source: {name!r}")

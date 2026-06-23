"""Imagery providers — protocol + Mapbox / IGN implementations."""

from autoabsmap.imagery.ign import (
    IGN_LAYER_PRESETS,
    IgnImageryProvider,
    IgnLayerPreset,
)
from autoabsmap.imagery.mapbox import MapboxImageryProvider
from autoabsmap.imagery.protocols import ImageryProvider

__all__ = [
    "ImageryProvider",
    "MapboxImageryProvider",
    "IgnImageryProvider",
    "IgnLayerPreset",
    "IGN_LAYER_PRESETS",
]

"""Imagery provider factory — returns the correct impl from config.

Adding a new provider (Google Aerial, S3 bucket, ...) requires only a
new file in absmap/imagery/ and a branch here.
"""

from __future__ import annotations

import logging

from absmap.config.settings import ImagerySettings, ImagerySource
from absmap.imagery.ign import IGNImageryProvider
from absmap.imagery.mapbox import MapboxImageryProvider
from absmap.imagery.protocols import ImageryProvider

logger = logging.getLogger(__name__)

__all__ = ["build_imagery_provider"]


def build_imagery_provider(settings: ImagerySettings) -> ImageryProvider:
    """Instantiate the appropriate ImageryProvider from configuration."""
    if settings.source == ImagerySource.mapbox:
        logger.info("Using Mapbox imagery provider")
        return MapboxImageryProvider(settings)

    if settings.source == ImagerySource.ign:
        logger.info("Using IGN Géoplateforme imagery provider")
        return IGNImageryProvider(settings)

    raise ValueError(f"Unknown imagery source: {settings.source}")

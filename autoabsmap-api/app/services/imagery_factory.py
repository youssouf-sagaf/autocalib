"""Imagery provider factory — returns the correct impl from config.

Adding a new provider (Google Aerial, S3 bucket, ...) requires only a
new file in autoabsmap/imagery/ and a branch here.
"""

from __future__ import annotations

import logging

from autoabsmap.config.settings import ImagerySettings, ImagerySource
from autoabsmap.imagery.ign import IGNImageryProvider
from autoabsmap.imagery.mapbox import MapboxImageryProvider
from autoabsmap.imagery.protocols import ImageryProvider

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

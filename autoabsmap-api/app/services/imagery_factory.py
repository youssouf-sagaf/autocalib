"""Imagery provider factory — returns the Mapbox provider from config."""

from __future__ import annotations

import logging

from autoabsmap.config.settings import ImagerySettings
from autoabsmap.imagery.mapbox import MapboxImageryProvider
from autoabsmap.imagery.protocols import ImageryProvider

logger = logging.getLogger(__name__)

__all__ = ["build_imagery_provider"]


def build_imagery_provider(settings: ImagerySettings) -> ImageryProvider:
    """Instantiate the Mapbox ImageryProvider from configuration."""
    logger.info("Using Mapbox imagery provider")
    return MapboxImageryProvider(settings)

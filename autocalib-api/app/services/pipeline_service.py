"""Pipeline service — builds the ParkingSlotPipeline from config.

Single place where ML backends and imagery provider are instantiated.
The rest of the API only deals with orchestration and HTTP concerns.
Uses autoabsmap/generator_engine as the core pipeline.
"""

from __future__ import annotations

import logging
import os
import time

from autoabsmap.config.settings import PipelineSettings
from autoabsmap.imagery.protocols import ImageryProvider
from autoabsmap.ml.detection import Sam3VehicleDetector
from autoabsmap.generator_engine.runner import ParkingSlotPipeline
from app.services.imagery_factory import build_imagery_provider_for_source
from app.services.orchestrator import MultiCropOrchestrator

logger = logging.getLogger(__name__)

__all__ = [
    "build_pipeline",
    "build_orchestrator",
    "get_imagery_provider",
    "prewarm_ml_models",
    "prewarm_ml_models_enabled",
]

_pipeline_singleton: ParkingSlotPipeline | None = None
_settings_singleton: PipelineSettings | None = None
_provider_cache: dict[str, ImageryProvider] = {}


def get_settings() -> PipelineSettings:
    """Return cached PipelineSettings (loaded from env once)."""
    global _settings_singleton
    if _settings_singleton is None:
        _settings_singleton = PipelineSettings()
    return _settings_singleton


def get_imagery_provider(
    source: str | None = None,
    settings: PipelineSettings | None = None,
) -> ImageryProvider:
    """Return a cached ImageryProvider for *source*.

    Source values:
      ``"mapbox"``         → MapboxImageryProvider (server settings)
      ``"ign-<preset>"``   → IgnImageryProvider bound to the named layer
                             preset (e.g. ``"ign-current"``,
                             ``"ign-pleiades-2026"``)

    ``None`` (or any value not matching above) falls back to the
    server-configured default provider.
    """
    settings = settings or get_settings()
    name = source or settings.imagery.provider
    if name in _provider_cache:
        return _provider_cache[name]

    provider = build_imagery_provider_for_source(name, settings.imagery)
    _provider_cache[name] = provider
    return provider


def build_pipeline(settings: PipelineSettings | None = None) -> ParkingSlotPipeline:
    """Build or return the cached ParkingSlotPipeline singleton.

    ML models are lazy-loaded on first prediction, so construction is cheap.
    """
    global _pipeline_singleton
    if _pipeline_singleton is not None:
        return _pipeline_singleton

    settings = settings or get_settings()
    provider = get_imagery_provider(settings=settings)
    detector = Sam3VehicleDetector(settings.detection)

    _pipeline_singleton = ParkingSlotPipeline(
        imagery=provider,
        detector=detector,
        settings=settings,
    )
    logger.info("Built ParkingSlotPipeline (default imagery=%s)", settings.imagery.provider)
    return _pipeline_singleton


def build_orchestrator(settings: PipelineSettings | None = None) -> MultiCropOrchestrator:
    """Build a MultiCropOrchestrator wrapping the pipeline singleton."""
    pipeline = build_pipeline(settings)
    return MultiCropOrchestrator(pipeline)


def prewarm_ml_models_enabled() -> bool:
    return os.environ.get("PREWARM_ML_MODELS", "true").lower() not in ("0", "false", "no")


def prewarm_ml_models(settings: PipelineSettings | None = None) -> None:
    """Load SAM3 into memory (blocking — run via ``asyncio.to_thread``)."""
    if not prewarm_ml_models_enabled():
        logger.info("ML prewarm skipped (PREWARM_ML_MODELS=false)")
        return

    started = time.perf_counter()
    logger.info("ML prewarm starting (SAM3)...")
    pipeline = build_pipeline(settings)

    detector = pipeline._detector
    if hasattr(detector, "_ensure_model"):
        logger.info("Prewarming SAM3...")
        detector._ensure_model()

    elapsed = time.perf_counter() - started
    logger.info("ML prewarm complete in %.1fs", elapsed)

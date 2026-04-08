"""Pipeline service — builds the ParkingSlotPipeline from config.

Single place where ML backends and imagery provider are instantiated.
The rest of the API only deals with orchestration and HTTP concerns.
Uses autoabsmap/generator_engine as the core pipeline.
"""

from __future__ import annotations

import logging

from autoabsmap.config.settings import PipelineSettings
from autoabsmap.ml.detection import YoloObbDetector
from autoabsmap.ml.segmentation import SegFormerSegmenter
from autoabsmap.generator_engine.runner import ParkingSlotPipeline
from app.services.imagery_factory import build_imagery_provider
from app.services.orchestrator import MultiCropOrchestrator

logger = logging.getLogger(__name__)

__all__ = ["build_pipeline", "build_orchestrator"]

_pipeline_singleton: ParkingSlotPipeline | None = None
_settings_singleton: PipelineSettings | None = None


def get_settings() -> PipelineSettings:
    """Return cached PipelineSettings (loaded from env once)."""
    global _settings_singleton
    if _settings_singleton is None:
        _settings_singleton = PipelineSettings()
    return _settings_singleton


def build_pipeline(settings: PipelineSettings | None = None) -> ParkingSlotPipeline:
    """Build or return the cached ParkingSlotPipeline singleton.

    ML models are lazy-loaded on first prediction, so construction is cheap.
    """
    global _pipeline_singleton
    if _pipeline_singleton is not None:
        return _pipeline_singleton

    settings = settings or get_settings()
    provider = build_imagery_provider(settings.imagery)
    segmenter = SegFormerSegmenter(settings.segmentation)
    detector = YoloObbDetector(settings.detection)

    _pipeline_singleton = ParkingSlotPipeline(
        imagery=provider,
        segmenter=segmenter,
        detector=detector,
        settings=settings,
    )
    logger.info("Built ParkingSlotPipeline (imagery=mapbox)")
    return _pipeline_singleton


def build_orchestrator(settings: PipelineSettings | None = None) -> MultiCropOrchestrator:
    """Build a MultiCropOrchestrator wrapping the pipeline singleton."""
    pipeline = build_pipeline(settings)
    return MultiCropOrchestrator(pipeline)

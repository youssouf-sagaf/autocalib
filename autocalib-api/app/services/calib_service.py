"""Calib service — builds the BBoxCalibEngine singleton from config.

Mirrors pipeline_service.py for the absmap engine. ML model is
lazy-loaded on first detection, so construction is cheap.
"""

from __future__ import annotations

import logging
from pathlib import Path

from calib_gen.bbox_calib_engine.runner import BBoxCalibEngine
from calib_gen.config.settings import CalibSettings
from calib_gen.ml.detector import Detector, YoloDetector
from calib_gen.ml.sam3_detector import Sam3Detector

logger = logging.getLogger(__name__)

__all__ = ["build_calib_engine", "get_calib_settings"]

_settings_singleton: CalibSettings | None = None
_engine_singleton: BBoxCalibEngine | None = None

_DEFAULT_MODEL_DIR = Path(__file__).resolve().parent.parent.parent.parent / "calib_gen" / "models"


def get_calib_settings() -> CalibSettings:
    """Return cached CalibSettings (loaded from env once)."""
    global _settings_singleton
    if _settings_singleton is None:
        settings = CalibSettings()
        if settings.detector_backend == "yolo" and settings.yolo_model_path is None:
            model_path = _find_yolo_model(_DEFAULT_MODEL_DIR)
            if model_path:
                settings = settings.model_copy(update={"yolo_model_path": model_path})
        _settings_singleton = settings
    return _settings_singleton


def build_calib_engine(settings: CalibSettings | None = None) -> BBoxCalibEngine:
    """Build or return the cached BBoxCalibEngine singleton."""
    global _engine_singleton
    if _engine_singleton is not None:
        return _engine_singleton

    settings = settings or get_calib_settings()
    detector = _build_detector(settings)
    _engine_singleton = BBoxCalibEngine(detector=detector, settings=settings)
    logger.info("Built BBoxCalibEngine (detector_backend=%s)", settings.detector_backend)
    return _engine_singleton


def _build_detector(settings: CalibSettings) -> Detector:
    """Select YOLO or SAM3 from settings (``CALIB_DETECTOR_BACKEND``)."""
    backend = settings.detector_backend
    if backend == "yolo":
        return YoloDetector(
            model_path=settings.yolo_model_path,
            conf=settings.yolo_conf,
            iou=settings.yolo_iou,
        )
    if backend == "sam3":
        return Sam3Detector(
            model_id=settings.sam3_model_id,
            text_prompt=settings.sam3_text_prompt,
            threshold=settings.sam3_threshold,
            mask_threshold=settings.sam3_mask_threshold,
            device=settings.sam3_device,
            hf_token=settings.hf_token,
        )
    raise ValueError(
        f"Unsupported detector_backend={backend!r} — use 'yolo' or 'sam3'.",
    )


def _find_yolo_model(models_dir: Path) -> Path | None:
    """Return the first *.pt found in models_dir, or None."""
    if not models_dir.exists():
        return None
    pts = sorted(models_dir.glob("*.pt"))
    return pts[0] if pts else None

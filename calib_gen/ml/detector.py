"""Detector Protocol and YOLO implementation.

The pipeline is detector-agnostic: it only calls ``detect(image_bgr)``.
A second backend (SAM3, etc.) lives in ``sam3_detector`` — swap via
``CalibSettings.detector_backend`` / ``CALIB_DETECTOR_BACKEND``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Protocol, runtime_checkable

import numpy as np

from calib_gen.models.detection import Detection

logger = logging.getLogger(__name__)


@runtime_checkable
class Detector(Protocol):
    """Detector backend contract — stateless after construction."""

    def detect(self, image_bgr: np.ndarray) -> list[Detection]:
        """Run detection on a single BGR image and return bboxes."""
        ...


class YoloDetector:
    """Ultralytics YOLO detector — lazy-loads the model on first call."""

    def __init__(
        self,
        model_path: Path | None = None,
        conf: float = 0.25,
        iou: float = 0.45,
    ) -> None:
        self._model_path = model_path
        self._conf = conf
        self._iou = iou
        self._model = None
        self._class_names: dict[int, str] = {}

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        if self._model_path is None or not self._model_path.exists():
            raise FileNotFoundError(
                f"YOLO model not found at {self._model_path}. "
                "Set CALIB_YOLO_MODEL_PATH or place a .pt in calib_gen/models/."
            )
        from ultralytics import YOLO

        self._model = YOLO(str(self._model_path))
        self._class_names = self._model.names
        logger.info(
            "Loaded YOLO from %s — classes: %s",
            self._model_path.name, self._class_names,
        )

    def detect(self, image_bgr: np.ndarray) -> list[Detection]:
        """Run YOLO prediction on a single BGR frame."""
        self._ensure_model()
        results = self._model.predict(
            source=image_bgr,
            conf=self._conf,
            iou=self._iou,
            verbose=False,
        )
        detections: list[Detection] = []
        if results and results[0].boxes is not None:
            boxes = results[0].boxes
            for j in range(len(boxes)):
                x1, y1, x2, y2 = boxes.xyxy[j].cpu().numpy().tolist()
                conf = float(boxes.conf[j].cpu())
                cls = int(boxes.cls[j].cpu())
                detections.append(Detection(
                    x=x1, y=y1,
                    width=x2 - x1, height=y2 - y1,
                    confidence=conf,
                    label=cls,
                    class_name=self._class_names.get(cls, f"cls_{cls}"),
                ))
        return detections

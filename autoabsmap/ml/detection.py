"""YoloObbDetector — implements the Detector protocol.

Fixes from R&D:
- Removes dead ``result_on_mask`` parameter
- Replaces ``assert`` in hot path with proper error
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from autoabsmap.config.settings import DetectionSettings
from autoabsmap.ml.models import DetectionResult, SpotDetection

logger = logging.getLogger(__name__)

__all__ = ["YoloObbDetector"]


def _resolve_ultralytics_device(preference: str | None) -> int | str:
    import torch

    if preference and preference.lower() not in ("", "auto"):
        p = preference.lower()
        if p == "cuda" or p.startswith("cuda:"):
            return 0 if p == "cuda" else preference
        if p == "mps" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        if p == "cpu":
            return "cpu"
    if torch.cuda.is_available():
        return 0
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class YoloObbDetector:
    """YOLO-OBB model for oriented parking spot detection (empty / occupied).

    Implements the ``Detector`` protocol.
    """

    def __init__(self, settings: DetectionSettings) -> None:
        if not settings.yolo_weights_path:
            raise ValueError(
                "YOLO weights path is missing. "
                "Set YOLO_YOLO_WEIGHTS_PATH in the environment."
            )
        self._settings = settings
        self._model = None

    def _lazy_load(self) -> None:
        if self._model is not None:
            return
        try:
            from ultralytics import YOLO
        except ImportError as e:
            raise ImportError(
                "ultralytics is required for YOLO-OBB detection. "
                "Install with: pip install ultralytics"
            ) from e
        self._model = YOLO(self._settings.yolo_weights_path)
        logger.info("Loaded YOLO-OBB from %s", self._settings.yolo_weights_path)

    def predict(
        self,
        rgb_hwc: np.ndarray,
        *,
        parkable_mask: np.ndarray | None = None,
    ) -> DetectionResult:
        if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
            raise ValueError(f"Expected (H, W, 3) uint8, got shape {rgb_hwc.shape}")

        self._lazy_load()
        if self._model is None:
            raise RuntimeError("YOLO model failed to load")

        h, w = int(rgb_hwc.shape[0]), int(rgb_hwc.shape[1])
        bgr = cv2.cvtColor(rgb_hwc, cv2.COLOR_RGB2BGR)
        device = _resolve_ultralytics_device(self._settings.device_preference)

        results = self._model.predict(
            source=bgr,
            conf=self._settings.conf_threshold,
            iou=self._settings.iou_nms_threshold,
            device=device,
            verbose=False,
        )

        spots: list[SpotDetection] = []
        if results and results[0].obb is not None and len(results[0].obb) > 0:
            obb = results[0].obb
            xywhr = obb.xywhr.cpu().numpy()
            confs = obb.conf.cpu().numpy()
            classes = obb.cls.cpu().numpy().astype(int)

            for i in range(len(xywhr)):
                cx, cy, bw, bh, angle = xywhr[i]

                if parkable_mask is not None:
                    ix, iy = int(round(cx)), int(round(cy))
                    if ix < 0 or ix >= w or iy < 0 or iy >= h:
                        continue
                    if parkable_mask[iy, ix] <= 0:
                        continue

                spots.append(SpotDetection(
                    center_x=float(cx),
                    center_y=float(cy),
                    width=float(bw),
                    height=float(bh),
                    angle_rad=float(angle),
                    confidence=float(confs[i]),
                    class_id=int(classes[i]),
                    occupied=int(classes[i]) == 1,
                ))

        spots.sort(key=lambda s: s.confidence, reverse=True)
        return DetectionResult(spots=spots, image_height=h, image_width=w)

"""YOLO-OBB parking spot detection: oriented bounding boxes with empty/occupied classification."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from absolutemap_gen.config import DetectionSettings

__all__ = [
    "SpotDetection",
    "SpotDetectionResult",
    "YoloObbSpotDetector",
    "spot_detections_to_serializable_dict",
    "annotate_spot_detections_overlay",
]


@dataclass(frozen=True)
class SpotDetection:
    """One oriented parking spot from a YOLO-OBB model."""

    center_x: float
    center_y: float
    width: float
    height: float
    angle_rad: float
    confidence: float
    class_id: int
    occupied: bool
    source: str = "yolo"

    @property
    def corners(self) -> list[tuple[float, float]]:
        """Four corners of the oriented bounding box in pixel space."""
        hw, hh = self.width / 2.0, self.height / 2.0
        ct, st = math.cos(self.angle_rad), math.sin(self.angle_rad)
        offsets = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        return [
            (self.center_x + dx * ct - dy * st,
             self.center_y + dx * st + dy * ct)
            for dx, dy in offsets
        ]


@dataclass
class SpotDetectionResult:
    """YOLO-OBB parking spot detection output."""

    spots: list[SpotDetection]
    image_height: int
    image_width: int
    class_names: dict[int, str] = field(
        default_factory=lambda: {0: "empty_slot", 1: "occupied_slot"},
    )

    @property
    def num_occupied(self) -> int:
        return sum(1 for s in self.spots if s.occupied)

    @property
    def num_empty(self) -> int:
        return sum(1 for s in self.spots if not s.occupied)


def _resolve_ultralytics_device(preference: str | None) -> int | str:
    """Map a torch-style device hint to an Ultralytics ``device`` argument."""
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


class YoloObbSpotDetector:
    """YOLO-OBB model that directly detects oriented parking spots (empty / occupied)."""

    def __init__(self, settings: DetectionSettings) -> None:
        if not settings.yolo_spots_weights_path:
            raise ValueError(
                "YOLO_SPOTS_WEIGHTS_PATH is missing. Set it in .env or pass a "
                "DetectionSettings with yolo_spots_weights_path set."
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
                "ultralytics is required for YOLO-OBB detection. Install with: "
                "pip install 'absolutemap-gen[detection]'"
            ) from e
        self._model = YOLO(self._settings.yolo_spots_weights_path)

    def predict(
        self,
        rgb_hwc: np.ndarray,
        *,
        conf: float | None = None,
        iou: float | None = None,
        parkable_mask_uint8: np.ndarray | None = None,
    ) -> SpotDetectionResult:
        """Run YOLO-OBB on an RGB image. Optionally filter by parkable mask.

        Args:
            rgb_hwc: (H, W, 3) uint8 RGB array.
            conf: Override confidence threshold.
            iou: Override IoU NMS threshold.
            parkable_mask_uint8: Optional (H, W) mask. Spots whose center falls
                                 outside the mask are discarded.
        """
        if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
            raise ValueError(f"Expected HWC RGB uint8, got shape {rgb_hwc.shape}")

        self._lazy_load()
        assert self._model is not None

        h, w = int(rgb_hwc.shape[0]), int(rgb_hwc.shape[1])
        bgr = cv2.cvtColor(rgb_hwc, cv2.COLOR_RGB2BGR)
        device = _resolve_ultralytics_device(self._settings.device_preference)
        c = self._settings.conf_threshold if conf is None else conf
        iou_t = self._settings.iou_nms_threshold if iou is None else iou

        results = self._model.predict(
            source=bgr, conf=c, iou=iou_t, device=device, verbose=False,
        )

        spots: list[SpotDetection] = []
        if results and results[0].obb is not None and len(results[0].obb) > 0:
            obb = results[0].obb
            xywhr = obb.xywhr.cpu().numpy()
            confs = obb.conf.cpu().numpy()
            classes = obb.cls.cpu().numpy().astype(int)

            for i in range(len(xywhr)):
                cx, cy, bw, bh, angle = xywhr[i]

                if parkable_mask_uint8 is not None:
                    ix, iy = int(round(cx)), int(round(cy))
                    if ix < 0 or ix >= w or iy < 0 or iy >= h:
                        continue
                    if parkable_mask_uint8[iy, ix] <= 0:
                        continue

                occupied = int(classes[i]) == 1  # 0=empty_slot, 1=occupied_slot
                spots.append(SpotDetection(
                    center_x=float(cx),
                    center_y=float(cy),
                    width=float(bw),
                    height=float(bh),
                    angle_rad=float(angle),
                    confidence=float(confs[i]),
                    class_id=int(classes[i]),
                    occupied=occupied,
                ))

        spots.sort(key=lambda s: s.confidence, reverse=True)
        return SpotDetectionResult(spots=spots, image_height=h, image_width=w)


def spot_detections_to_serializable_dict(result: SpotDetectionResult) -> dict[str, Any]:
    """Build a JSON-friendly dict for the ``03_detection`` stage."""
    return {
        "stage": "03_detection",
        "schema_version": "2",
        "mode": "yolo_obb_spots",
        "image_height": result.image_height,
        "image_width": result.image_width,
        "class_names": result.class_names,
        "num_spots": len(result.spots),
        "num_occupied": result.num_occupied,
        "num_empty": result.num_empty,
        "spots": [
            {
                "center_xy": [round(s.center_x, 2), round(s.center_y, 2)],
                "width": round(s.width, 2),
                "height": round(s.height, 2),
                "angle_rad": round(s.angle_rad, 4),
                "confidence": round(s.confidence, 4),
                "class_id": s.class_id,
                "occupied": s.occupied,
                "source": s.source,
            }
            for s in result.spots
        ],
    }


def annotate_spot_detections_overlay(
    rgb_hwc: np.ndarray,
    result: SpotDetectionResult,
    *,
    result_on_mask: SpotDetectionResult | None = None,
    occupied_color: tuple[int, int, int] = (0, 200, 0),
    empty_color: tuple[int, int, int] = (255, 180, 0),
    center_color: tuple[int, int, int] = (255, 0, 0),
    thickness: int = 2,
    center_radius: int = 4,
) -> np.ndarray:
    """Draw oriented spot rectangles and centers on an RGB image copy."""
    canvas = rgb_hwc.copy()
    for s in result.spots:
        color = occupied_color if s.occupied else empty_color
        corners = s.corners
        pts = np.array(
            [[int(round(x)), int(round(y))] for x, y in corners],
            dtype=np.int32,
        ).reshape((-1, 1, 2))
        cv2.polylines(canvas, [pts], True, color, thickness, cv2.LINE_AA)
        cx_i, cy_i = int(round(s.center_x)), int(round(s.center_y))
        cv2.circle(canvas, (cx_i, cy_i), center_radius, center_color, -1, cv2.LINE_AA)
    return canvas

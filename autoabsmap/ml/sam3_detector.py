"""SAM3 text-prompt vehicle detection — per-instance mask OBBs for slot anchoring.

Adapted from ``calib_gen/ml/sam3_detector.py`` for the autoabsmap ``Detector``
protocol. Each vehicle is fit with an oriented bbox from its SAM3 instance mask;
empty slots are completed downstream by the geometric engine (gap-fill).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np
from PIL import Image

from autoabsmap.config.settings import DetectionSettings
from autoabsmap.ml.mask_obb import instance_mask_to_obb
from autoabsmap.ml.models import DetectionResult, SpotDetection

logger = logging.getLogger(__name__)

__all__ = ["Sam3VehicleDetector"]


def _resolve_huggingface_token(explicit: str | None = None) -> str | None:
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    for key in (
        "HF_TOKEN",
        "HUGGINGFACE_HUB_TOKEN",
        "HUGGING_FACE_HUB_TOKEN",
        "SAM3_HF_TOKEN",
        "CALIB_HF_TOKEN",
    ):
        value = os.environ.get(key)
        if value and str(value).strip():
            return str(value).strip()
    return None


def _resolve_device(preference: str | None) -> str:
    import torch

    if preference and preference.lower() not in ("", "auto"):
        p = preference.lower()
        if p == "cuda" or p.startswith("cuda:"):
            return preference if p.startswith("cuda:") else "cuda"
        if p == "mps" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        if p == "cpu":
            return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _to_score_array(scores: Any) -> np.ndarray | None:
    if scores is None:
        return None
    if hasattr(scores, "detach"):
        scores = scores.detach().cpu().float().numpy()
    arr = np.asarray(scores, dtype=np.float64).ravel()
    return arr if arr.size else None


def _to_box_xyxy(box: Any) -> tuple[float, float, float, float] | None:
    if box is None:
        return None
    if hasattr(box, "detach"):
        box = box.detach().cpu().float().numpy()
    arr = np.asarray(box, dtype=np.float64).ravel()
    if arr.size < 4:
        return None
    return float(arr[0]), float(arr[1]), float(arr[2]), float(arr[3])


def _instance_mask(masks_raw: Any, index: int) -> np.ndarray | None:
    if masks_raw is None:
        return None
    if hasattr(masks_raw, "detach"):
        masks_raw = masks_raw.detach().cpu().numpy()
    arr = np.asarray(masks_raw)
    if arr.ndim == 3 and index < arr.shape[0]:
        return arr[index]
    return None


class Sam3VehicleDetector:
    """SAM3 open-vocabulary detector — one oriented OBB per vehicle instance mask."""

    def __init__(self, settings: DetectionSettings) -> None:
        self._settings = settings
        self._model = None
        self._processor = None
        self._resolved_device: str | None = None

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        try:
            import torch
            from transformers import Sam3Model, Sam3Processor
        except ImportError as exc:
            raise ImportError(
                "Sam3VehicleDetector needs PyTorch and transformers with "
                "Sam3Model / Sam3Processor (pip install -U 'transformers[torch]' ≥ ~5.5). "
                f"Original error: {exc}"
            ) from exc

        resolved = _resolve_device(self._settings.device_preference)
        self._resolved_device = resolved
        token = _resolve_huggingface_token(self._settings.hf_token)
        load_kw: dict[str, str] = {}
        if token:
            load_kw["token"] = token

        model_id = self._settings.sam3_model_id
        logger.info(
            "Loading SAM3 %s on %s (text prompt=%r)",
            model_id,
            resolved,
            self._settings.text_prompt,
        )
        self._processor = Sam3Processor.from_pretrained(model_id, **load_kw)
        self._model = Sam3Model.from_pretrained(model_id, **load_kw).to(resolved)
        self._model.eval()

    def predict(
        self,
        rgb_hwc: np.ndarray,
        *,
        parkable_mask: np.ndarray | None = None,
    ) -> DetectionResult:
        """Run SAM3; return per-vehicle OBBs derived from instance masks."""
        if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
            raise ValueError(f"Expected (H, W, 3) uint8, got shape {rgb_hwc.shape}")

        self._ensure_model()
        import torch

        h, w = int(rgb_hwc.shape[0]), int(rgb_hwc.shape[1])
        if rgb_hwc.size == 0:
            return DetectionResult(spots=[], image_height=h, image_width=w)

        pil = Image.fromarray(rgb_hwc)
        device = self._resolved_device or "cpu"
        inputs = self._processor(
            images=pil,
            text=self._settings.text_prompt,
            return_tensors="pt",
        ).to(device)

        with torch.no_grad():
            outputs = self._model(**inputs)

        orig = inputs.get("original_sizes")
        if orig is None:
            raise RuntimeError("SAM3 processor did not set original_sizes on inputs")

        batch = self._processor.post_process_instance_segmentation(
            outputs,
            threshold=self._settings.threshold,
            mask_threshold=self._settings.mask_threshold,
            target_sizes=orig.tolist(),
        )
        results = batch[0]
        boxes_raw = results.get("boxes")
        if boxes_raw is None:
            return DetectionResult(spots=[], image_height=h, image_width=w)

        masks_raw = results.get("masks")
        scores_arr = _to_score_array(results.get("scores"))
        min_points = self._settings.mask_pca_min_points
        spots: list[SpotDetection] = []

        def _append_instance(i: int, xyxy: tuple[float, float, float, float]) -> None:
            cx, cy, slot_w, slot_h, angle_rad, is_fallback = instance_mask_to_obb(
                _instance_mask(masks_raw, i),
                xyxy,
                min_points=min_points,
            )
            if slot_w < 1.0 or slot_h < 1.0:
                return
            if parkable_mask is not None:
                ix, iy = int(round(cx)), int(round(cy))
                if ix < 0 or ix >= w or iy < 0 or iy >= h:
                    return
                if parkable_mask[iy, ix] <= 0:
                    return
            if scores_arr is not None and i < len(scores_arr):
                conf = float(scores_arr[i])
            else:
                conf = float(self._settings.threshold)
            spots.append(
                SpotDetection(
                    center_x=cx,
                    center_y=cy,
                    width=slot_w,
                    height=slot_h,
                    angle_rad=angle_rad,
                    confidence=conf,
                    class_id=0,
                    is_fallback=is_fallback,
                ),
            )

        if hasattr(boxes_raw, "shape") and len(getattr(boxes_raw, "shape", ())) >= 2:
            for i in range(int(boxes_raw.shape[0])):
                xyxy = _to_box_xyxy(boxes_raw[i])
                if xyxy is not None:
                    _append_instance(i, xyxy)
        else:
            try:
                boxes_list = list(boxes_raw)
            except TypeError:
                boxes_list = []
            for i, raw in enumerate(boxes_list):
                xyxy = _to_box_xyxy(raw)
                if xyxy is not None:
                    _append_instance(i, xyxy)

        spots.sort(key=lambda s: s.confidence, reverse=True)
        return DetectionResult(spots=spots, image_height=h, image_width=w)

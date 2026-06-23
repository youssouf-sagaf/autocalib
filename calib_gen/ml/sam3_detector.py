"""SAM3 (Segment Anything Model 3) — text-prompted instances → ``Detection`` bboxes.

Requires a recent ``transformers`` with ``Sam3Model`` / ``Sam3Processor``
(typically 5.5+; see Hugging Face `model_doc/sam3`). Uses the same
``Detection`` contract as :class:`YoloDetector` so the calib pipeline is unchanged.

Gated checkpoints require a token. Use ``HF_TOKEN`` or ``HUGGINGFACE_HUB_TOKEN``
in the environment, or ``CALIB_HF_TOKEN`` via ``CalibSettings`` — it is passed
explicitly to ``from_pretrained`` so downloads work in Docker and uvicorn.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import cv2
import numpy as np
from PIL import Image

from calib_gen.models.detection import Detection

logger = logging.getLogger(__name__)


def resolve_huggingface_token(explicit: str | None = None) -> str | None:
    """Return a non-empty HF token for gated models.

    Priority: explicit override (from ``CalibSettings.hf_token``), then standard
    env vars Hugging Face libraries honor.
    """
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    for key in (
        "HF_TOKEN",
        "HUGGINGFACE_HUB_TOKEN",
        "HUGGING_FACE_HUB_TOKEN",
        "CALIB_HF_TOKEN",
    ):
        v = os.environ.get(key)
        if v and str(v).strip():
            return str(v).strip()
    return None


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


class Sam3Detector:
    """Open-vocabulary detector via SAM3 text prompt; outputs axis-aligned bboxes."""

    def __init__(
        self,
        model_id: str = "facebook/sam3",
        text_prompt: str = "car",
        threshold: float = 0.5,
        mask_threshold: float = 0.5,
        device: str | None = None,
        hf_token: str | None = None,
    ) -> None:
        self._model_id = model_id
        self._text_prompt = text_prompt.strip()
        self._threshold = threshold
        self._mask_threshold = mask_threshold
        self._device = device
        self._hf_token = hf_token
        self._model = None
        self._processor = None
        self._resolved_device: str | None = None

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        try:
            import torch
            from transformers import Sam3Model, Sam3Processor
        except ImportError as e:
            raise ImportError(
                "Sam3Detector needs PyTorch and a recent transformers release with "
                "Sam3Model / Sam3Processor (pip install -U 'transformers[torch]' ≥ ~5.5). "
                f"Original error: {e}"
            ) from e

        resolved = self._device
        if resolved is None or resolved == "":
            resolved = "cuda" if torch.cuda.is_available() else "cpu"
        self._resolved_device = resolved

        logger.info(
            "Loading SAM3 %s on %s (text prompt=%r)",
            self._model_id,
            resolved,
            self._text_prompt,
        )
        tok = resolve_huggingface_token(self._hf_token)
        load_kw: dict[str, str] = {}
        if tok:
            load_kw["token"] = tok
        self._processor = Sam3Processor.from_pretrained(self._model_id, **load_kw)
        self._model = Sam3Model.from_pretrained(self._model_id, **load_kw).to(resolved)
        self._model.eval()

    def _concept_class_name(self) -> str:
        """Single label for ``keep_classes`` / ``exclude_classes`` filters."""
        p = self._text_prompt.strip()
        if not p:
            return "object"
        return p.split(",")[0].strip().lower()

    def detect(self, image_bgr: np.ndarray) -> list[Detection]:
        """Run SAM3 with the configured text prompt; return pixel-space bboxes."""
        self._ensure_model()
        import torch

        if image_bgr.size == 0:
            return []

        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        device = self._resolved_device or "cpu"

        inputs = self._processor(
            images=pil,
            text=self._text_prompt,
            return_tensors="pt",
        ).to(device)

        with torch.no_grad():
            outputs = self._model(**inputs)

        orig = inputs.get("original_sizes")
        if orig is None:
            raise RuntimeError("SAM3 processor did not set original_sizes on inputs")

        batch = self._processor.post_process_instance_segmentation(
            outputs,
            threshold=self._threshold,
            mask_threshold=self._mask_threshold,
            target_sizes=orig.tolist(),
        )
        results = batch[0]
        boxes_raw = results.get("boxes")
        if boxes_raw is None:
            return []

        detections: list[Detection] = []
        scores_arr = _to_score_array(results.get("scores"))
        concept = self._concept_class_name()

        if hasattr(boxes_raw, "shape") and len(getattr(boxes_raw, "shape", ())) >= 2:
            n = int(boxes_raw.shape[0])
            for i in range(n):
                xyxy = _to_box_xyxy(boxes_raw[i])
                if xyxy is None:
                    continue
                x1, y1, x2, y2 = xyxy
                w = max(x2 - x1, 0.0)
                h = max(y2 - y1, 0.0)
                if w < 1.0 or h < 1.0:
                    continue
                if scores_arr is not None and i < len(scores_arr):
                    conf = float(scores_arr[i])
                else:
                    conf = float(self._threshold)
                detections.append(
                    Detection(
                        x=x1,
                        y=y1,
                        width=w,
                        height=h,
                        confidence=conf,
                        label=0,
                        class_name=concept,
                    ),
                )
            return detections

        try:
            boxes_list = list(boxes_raw)
        except TypeError:
            return []

        if not boxes_list:
            return []

        for i, br in enumerate(boxes_list):
            xyxy = _to_box_xyxy(br)
            if xyxy is None:
                continue
            x1, y1, x2, y2 = xyxy
            w = max(x2 - x1, 0.0)
            h = max(y2 - y1, 0.0)
            if w < 1.0 or h < 1.0:
                continue
            if scores_arr is not None and i < len(scores_arr):
                conf = float(scores_arr[i])
            else:
                conf = float(self._threshold)
            detections.append(
                Detection(
                    x=x1,
                    y=y1,
                    width=w,
                    height=h,
                    confidence=conf,
                    label=0,
                    class_name=concept,
                ),
            )
        return detections

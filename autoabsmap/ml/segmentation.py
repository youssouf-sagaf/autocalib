"""SegFormerSegmenter — implements the Segmenter protocol."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from autoabsmap.config.settings import SegmentationSettings
from autoabsmap.generator_engine.postprocess import postprocess_parkable_mask
from autoabsmap.ml.models import SegmentationOutput

logger = logging.getLogger(__name__)

__all__ = ["SegFormerSegmenter"]


def _resolve_torch_device(preference: str | None) -> "torch.device":
    import torch

    if preference and preference.lower() not in ("", "auto"):
        return torch.device(preference)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class SegFormerSegmenter:
    """Binary SegFormer segmentation: background (0) vs parkable (1).

    Expects a local HuggingFace-format directory (``config.json`` +
    ``preprocessor_config.json`` + model weights).
    """

    def __init__(self, settings: SegmentationSettings) -> None:
        if not settings.segformer_checkpoint_dir:
            raise ValueError(
                "SegFormer checkpoint directory is missing. "
                "Set SEG_SEGFORMER_CHECKPOINT_DIR in the environment."
            )
        self._ckpt_dir = Path(settings.segformer_checkpoint_dir).resolve()
        self._settings = settings
        self._device = _resolve_torch_device(settings.device_preference)
        self._model = None
        self._processor = None

    def _lazy_load(self) -> None:
        if self._model is not None:
            return
        from transformers import AutoImageProcessor, SegformerForSemanticSegmentation

        if not self._ckpt_dir.is_dir():
            raise FileNotFoundError(f"SegFormer checkpoint not found: {self._ckpt_dir}")
        if not (self._ckpt_dir / "config.json").is_file():
            raise FileNotFoundError(f"Missing config.json in: {self._ckpt_dir}")

        self._processor = AutoImageProcessor.from_pretrained(self._ckpt_dir)
        self._model = SegformerForSemanticSegmentation.from_pretrained(self._ckpt_dir)
        self._model.to(self._device)
        self._model.eval()
        logger.info("Loaded SegFormer from %s (device=%s)", self._ckpt_dir, self._device)

    def predict(self, rgb_hwc: np.ndarray) -> SegmentationOutput:
        """Run SegFormer inference + post-processing."""
        raw = self._predict_mask_raw(rgb_hwc)
        refined = postprocess_parkable_mask(raw, self._settings)
        return SegmentationOutput(mask_raw=raw, mask_refined=refined)

    def _predict_mask_raw(self, rgb_hwc: np.ndarray) -> np.ndarray:
        import torch
        import torch.nn.functional as F
        from PIL import Image

        if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
            raise ValueError(f"Expected (H, W, 3) uint8, got shape {rgb_hwc.shape}")

        self._lazy_load()
        h_orig, w_orig = rgb_hwc.shape[:2]
        image = Image.fromarray(rgb_hwc, mode="RGB")
        inputs = self._processor(images=image, return_tensors="pt").to(self._device)

        with torch.inference_mode():
            logits = self._model(**inputs).logits
            up = F.interpolate(logits, size=(h_orig, w_orig), mode="bilinear", align_corners=False)
            pred = up.argmax(dim=1).squeeze(0).cpu().numpy()

        return (pred * 255).astype(np.uint8)

"""Semantic segmentation (SegFormer): binary parkable mask and postprocessing."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np
from PIL import Image
from shapely.geometry import Polygon
from shapely.ops import unary_union

from absolutemap_gen.config import SegmentationSettings

if TYPE_CHECKING:
    from shapely.geometry.base import BaseGeometry

__all__ = [
    "SegmentationOutput",
    "SegFormerParkableSegmenter",
    "overlay_parkable_mask_on_rgb",
    "postprocess_parkable_mask",
    "refined_mask_to_multipolygon",
]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SegmentationOutput:
    """Binary parkable masks aligned with input RGB pixels (H, W)."""

    mask_raw: np.ndarray
    mask_refined: np.ndarray

    def __post_init__(self) -> None:
        for name, arr in (("mask_raw", self.mask_raw), ("mask_refined", self.mask_refined)):
            if arr.ndim != 2:
                raise ValueError(f"{name} must be 2D, got shape {arr.shape}")
            if arr.dtype != np.uint8:
                raise ValueError(f"{name} must be uint8, got {arr.dtype}")


def _ensure_odd_kernel(size: int) -> int:
    k = max(1, int(size))
    if k % 2 == 0:
        k += 1
    return k


def _morph_close_open(mask_uint8: np.ndarray, close_ksize: int, open_ksize: int) -> np.ndarray:
    """Apply binary close then open on a 0/255 uint8 mask."""
    m = (mask_uint8 > 0).astype(np.uint8)
    if close_ksize >= 1:
        kc = _ensure_odd_kernel(close_ksize)
        kernel_c = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kc, kc))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel_c)
    if open_ksize >= 1:
        ko = _ensure_odd_kernel(open_ksize)
        kernel_o = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ko, ko))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel_o)
    return (m * 255).astype(np.uint8)


def fill_small_holes(mask_uint8: np.ndarray, max_hole_area_px: int) -> np.ndarray:
    """Fill interior holes whose area (in pixels) is at most ``max_hole_area_px``.

    Uses OpenCV ``RETR_CCOMP``: contours with a parent are hole boundaries of a
    foreground component.
    """
    if max_hole_area_px <= 0:
        return mask_uint8

    m = (mask_uint8 > 0).astype(np.uint8)
    contours, hierarchy = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None or len(contours) == 0:
        return mask_uint8

    out = m.copy()
    h0 = hierarchy[0]
    for i, h in enumerate(h0):
        parent = int(h[3])
        if parent < 0:
            continue
        area = cv2.contourArea(contours[i])
        if area <= float(max_hole_area_px):
            cv2.drawContours(out, contours, i, 1, thickness=cv2.FILLED)
    return (out * 255).astype(np.uint8)


def simplify_mask_boundary(
    mask_uint8: np.ndarray,
    *,
    tolerance_px: float,
    min_polygon_area_px: float,
) -> np.ndarray:
    """Rebuild a 0/255 mask from external contours after Shapely simplification."""
    if tolerance_px <= 0:
        return mask_uint8

    m = (mask_uint8 > 0).astype(np.uint8)
    h, w = m.shape
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return np.zeros((h, w), dtype=np.uint8)

    polys: list[Polygon] = []
    for cnt in contours:
        if len(cnt) < 3:
            continue
        pts = cnt.reshape(-1, 2).astype(np.float64)
        if pts[0, 0] != pts[-1, 0] or pts[0, 1] != pts[-1, 1]:
            pts = np.vstack([pts, pts[0:1]])
        try:
            poly = Polygon(pts)
        except Exception:
            continue
        if poly.is_empty or poly.area < min_polygon_area_px:
            continue
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or not isinstance(poly, Polygon):
            continue
        simplified = poly.simplify(tolerance_px, preserve_topology=True)
        if simplified.is_empty:
            continue
        if isinstance(simplified, Polygon) and simplified.area >= min_polygon_area_px:
            polys.append(simplified)
        elif simplified.geom_type == "MultiPolygon":
            for g in simplified.geoms:
                if isinstance(g, Polygon) and g.area >= min_polygon_area_px:
                    polys.append(g)

    if not polys:
        return np.zeros((h, w), dtype=np.uint8)

    canvas = np.zeros((h, w), dtype=np.uint8)
    for poly in polys:
        ext = np.array(poly.exterior.coords, dtype=np.int32)
        if ext.shape[0] < 3:
            continue
        cv2.fillPoly(canvas, [ext], 255)
        for interior in poly.interiors:
            hole = np.array(interior.coords, dtype=np.int32)
            if hole.shape[0] >= 3:
                cv2.fillPoly(canvas, [hole], 0)
    return canvas


def overlay_parkable_mask_on_rgb(
    rgb_hwc: np.ndarray,
    mask_uint8: np.ndarray,
    *,
    alpha: float = 0.45,
    tint_rgb: tuple[int, int, int] = (0, 220, 120),
) -> np.ndarray:
    """Tint *rgb_hwc* with *tint_rgb* wherever *mask_uint8* > 0 (for visualization).

    Args:
        rgb_hwc: RGB image (H, W, 3), uint8.
        mask_uint8: Binary mask (H, W), parkable pixels > 0.
        alpha: Blend strength in [0, 1] over parkable pixels.
        tint_rgb: Overlay colour (R, G, B).

    Returns:
        RGB uint8 array, same shape as *rgb_hwc*.
    """
    if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
        raise ValueError(f"rgb_hwc must be HWC RGB, got shape {rgb_hwc.shape}")
    if mask_uint8.ndim != 2:
        raise ValueError(f"mask must be 2D, got shape {mask_uint8.shape}")
    if rgb_hwc.shape[:2] != mask_uint8.shape:
        raise ValueError(
            f"rgb_hwc and mask shape mismatch: {rgb_hwc.shape[:2]} vs {mask_uint8.shape}"
        )
    a = float(np.clip(alpha, 0.0, 1.0))
    base = rgb_hwc.astype(np.float32)
    tint = np.array(tint_rgb, dtype=np.float32).reshape(1, 1, 3)
    blended = base * (1.0 - a) + tint * a
    parkable = (mask_uint8 > 0)[..., np.newaxis]
    out = np.where(parkable, blended, base)
    return np.clip(out, 0, 255).astype(np.uint8)


def postprocess_parkable_mask(
    mask_uint8: np.ndarray,
    settings: SegmentationSettings,
) -> np.ndarray:
    """Close/open, fill small holes, then simplify external boundaries.

    Args:
        mask_uint8: Binary mask (0 background, 255 parkable), shape (H, W).
        settings: Kernel sizes and tolerances from :class:`SegmentationSettings`.

    Returns:
        Refined mask, uint8 0/255, same shape as input.
    """
    if mask_uint8.ndim != 2:
        raise ValueError(f"mask must be 2D, got shape {mask_uint8.shape}")
    work = mask_uint8.astype(np.uint8, copy=True)
    work = _morph_close_open(work, settings.morph_close_kernel, settings.morph_open_kernel)
    work = fill_small_holes(work, settings.max_hole_area_px)
    work = simplify_mask_boundary(
        work,
        tolerance_px=settings.simplify_tolerance_px,
        min_polygon_area_px=settings.min_polygon_area_px,
    )
    return work


def refined_mask_to_multipolygon(mask_uint8: np.ndarray) -> "BaseGeometry | None":
    """Convert a refined 0/255 mask to a (Multi)Polygon in pixel (x, y) = (col, row) space."""
    m = (mask_uint8 > 0).astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polys: list[Polygon] = []
    for cnt in contours:
        if len(cnt) < 3:
            continue
        pts = cnt.reshape(-1, 2)
        try:
            p = Polygon(pts)
        except Exception:
            continue
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_empty:
            continue
        if isinstance(p, Polygon):
            polys.append(p)
        elif p.geom_type == "MultiPolygon":
            polys.extend(g for g in p.geoms if isinstance(g, Polygon) and not g.is_empty)
    if not polys:
        return None
    u = unary_union(polys)
    return u


def _resolve_torch_device(preference: str | None) -> "torch.device":
    import torch

    if preference and preference.lower() not in ("", "auto"):
        return torch.device(preference)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ---------------------------------------------------------------------------
# SegFormer (Hugging Face Transformers)
# ---------------------------------------------------------------------------


class SegFormerParkableSegmenter:
    """Binary SegFormer segmentation: background (0) vs parkable (1).

    Expects a local directory in Hugging Face format (``from_pretrained``):
    ``config.json``, ``preprocessor_config.json``, and model weights
    (e.g. ``model.safetensors``).
    """

    def __init__(
        self,
        settings: SegmentationSettings,
        *,
        checkpoint_dir: str | Path | None = None,
    ) -> None:
        raw = checkpoint_dir if checkpoint_dir is not None else settings.segformer_checkpoint_dir
        if not raw:
            raise ValueError(
                "SegFormer checkpoint directory is missing. Set SEGFORMER_CHECKPOINT_DIR in .env "
                "or pass checkpoint_dir= (Hugging Face model folder)."
            )
        self._checkpoint_dir = Path(raw).resolve()
        self._settings = settings
        self._device = _resolve_torch_device(settings.device_preference)
        self._model = None
        self._processor = None

    def _lazy_load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoImageProcessor, SegformerForSemanticSegmentation

        if not self._checkpoint_dir.is_dir():
            raise FileNotFoundError(f"SegFormer checkpoint directory not found: {self._checkpoint_dir}")
        cfg = self._checkpoint_dir / "config.json"
        if not cfg.is_file():
            raise FileNotFoundError(f"Missing config.json in SegFormer checkpoint dir: {self._checkpoint_dir}")

        self._processor = AutoImageProcessor.from_pretrained(self._checkpoint_dir)
        self._model = SegformerForSemanticSegmentation.from_pretrained(self._checkpoint_dir)
        self._model.to(self._device)
        self._model.eval()
        logger.info(
            "Loaded SegFormer from %s (device=%s)",
            self._checkpoint_dir,
            self._device,
        )

    def predict_mask_raw(self, rgb_hwc: np.ndarray) -> np.ndarray:
        """Run inference; return uint8 parkable mask 0/255, same H x W as ``rgb_hwc``."""
        import torch
        import torch.nn.functional as F

        if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
            raise ValueError(f"Expected HWC RGB uint8, got shape {rgb_hwc.shape}")
        if rgb_hwc.dtype != np.uint8:
            raise ValueError(f"Expected uint8 RGB, got dtype {rgb_hwc.dtype}")

        self._lazy_load()
        assert self._model is not None and self._processor is not None

        original_h, original_w = rgb_hwc.shape[:2]
        image = Image.fromarray(rgb_hwc, mode="RGB")
        inputs = self._processor(images=image, return_tensors="pt")
        inputs = inputs.to(self._device)

        with torch.inference_mode():
            logits = self._model(**inputs).logits
            up = F.interpolate(
                logits,
                size=(original_h, original_w),
                mode="bilinear",
                align_corners=False,
            )
            pred = up.argmax(dim=1).squeeze(0).cpu().numpy()

        return (pred * 255).astype(np.uint8)

    def predict(self, rgb_hwc: np.ndarray) -> SegmentationOutput:
        """Raw SegFormer mask plus postprocessed (morphology + simplification) mask."""
        raw = self.predict_mask_raw(rgb_hwc)
        refined = postprocess_parkable_mask(raw, self._settings)
        return SegmentationOutput(mask_raw=raw, mask_refined=refined)

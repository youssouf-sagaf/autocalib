"""Semantic segmentation (U-Net / APKLOT): binary parkable mask and postprocessing."""

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
    "UNetParkableSegmenter",
    "generate_mask_from_labels",
    "find_label_file",
    "postprocess_parkable_mask",
    "refined_mask_to_multipolygon",
]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Label-based mask generation (YOLO polygon annotations → binary mask)
# ---------------------------------------------------------------------------

def find_label_file(labels_dir: Path, stem: str) -> Path | None:
    """Find a YOLO segmentation label file matching *stem* in *labels_dir*.

    Supports both direct names (``<stem>.txt``) and Roboflow-hashed names
    (``<stem>_png.rf.<hash>.txt``).  Returns the first match or ``None``.
    """
    direct = labels_dir / f"{stem}.txt"
    if direct.is_file():
        return direct
    candidates = sorted(labels_dir.glob(f"{stem}*.txt"))
    return candidates[0] if candidates else None


def generate_mask_from_labels(label_path: Path, height: int, width: int) -> np.ndarray:
    """Convert a YOLO segmentation label file into a binary mask.

    Each line in the label file has the format:
    ``class_id  x1 y1  x2 y2  ...  xN yN``
    where coordinates are normalised to [0, 1].

    All polygons are drawn as filled regions regardless of ``class_id``
    (class 0 = parkable area in Daniel's annotation convention).

    Returns:
        uint8 mask (H, W), 0 = background, 255 = parkable.
    """
    mask = np.zeros((height, width), dtype=np.uint8)
    with open(label_path) as fh:
        for line in fh:
            parts = line.strip().split()
            if len(parts) < 7:
                continue
            coords = list(map(float, parts[1:]))
            pts = np.array(
                [[int(coords[i] * width), int(coords[i + 1] * height)]
                 for i in range(0, len(coords), 2)],
                dtype=np.int32,
            )
            cv2.fillPoly(mask, [pts], 255)
    return mask


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
# U-Net architecture (must match the training checkpoint)
# ---------------------------------------------------------------------------

def _build_unet_modules() -> tuple[type, type, type, type]:
    """Lazily import torch and define U-Net building blocks.

    Returns ``(ConvBlock, DownBlock, UpBlock, UNet)`` classes backed by torch.nn.
    """
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class ConvBlock(nn.Module):
        def __init__(self, in_channels: int, out_channels: int) -> None:
            super().__init__()
            self.block = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(True),
                nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(True),
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return self.block(x)

    class DownBlock(nn.Module):
        def __init__(self, in_channels: int, out_channels: int) -> None:
            super().__init__()
            self.conv = ConvBlock(in_channels, out_channels)
            self.pool = nn.MaxPool2d(2)

        def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
            skip = self.conv(x)
            return self.pool(skip), skip

    class UpBlock(nn.Module):
        def __init__(self, in_channels: int, out_channels: int) -> None:
            super().__init__()
            self.up = nn.Upsample(scale_factor=2, mode="bilinear", align_corners=False)
            self.conv = ConvBlock(in_channels, out_channels)

        def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
            x = self.up(x)
            if x.shape != skip.shape:
                x = F.pad(x, [0, skip.shape[3] - x.shape[3], 0, skip.shape[2] - x.shape[2]])
            return self.conv(torch.cat([skip, x], dim=1))

    class UNet(nn.Module):
        def __init__(self, in_channels: int = 3, num_classes: int = 2, base_filters: int = 32) -> None:
            super().__init__()
            f = base_filters
            self.down1 = DownBlock(in_channels, f)
            self.down2 = DownBlock(f, f * 2)
            self.down3 = DownBlock(f * 2, f * 4)
            self.down4 = DownBlock(f * 4, f * 8)
            self.bottleneck = ConvBlock(f * 8, f * 16)
            self.up4 = UpBlock(f * 16 + f * 8, f * 8)
            self.up3 = UpBlock(f * 8 + f * 4, f * 4)
            self.up2 = UpBlock(f * 4 + f * 2, f * 2)
            self.up1 = UpBlock(f * 2 + f, f)
            self.head = nn.Conv2d(f, num_classes, 1)

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            x, s1 = self.down1(x)
            x, s2 = self.down2(x)
            x, s3 = self.down3(x)
            x, s4 = self.down4(x)
            x = self.bottleneck(x)
            x = self.up4(x, s4)
            x = self.up3(x, s3)
            x = self.up2(x, s2)
            x = self.up1(x, s1)
            return self.head(x)

    return ConvBlock, DownBlock, UpBlock, UNet


# Colab checkpoints used abbreviated layer names — remap to the full names.
_COLAB_KEY_MAP = {
    "d1.": "down1.",
    "d2.": "down2.",
    "d3.": "down3.",
    "d4.": "down4.",
    "bn.": "bottleneck.",
    "u4.": "up4.",
    "u3.": "up3.",
    "u2.": "up2.",
    "u1.": "up1.",
}


def _remap_state_dict(state: dict) -> dict:
    remapped = {}
    for key, value in state.items():
        new_key = key
        for old_prefix, new_prefix in _COLAB_KEY_MAP.items():
            if key.startswith(old_prefix):
                new_key = new_prefix + key[len(old_prefix):]
                break
        remapped[new_key] = value
    return remapped


# ImageNet normalisation (same as training pipeline)
_IMAGE_MEAN = [0.485, 0.456, 0.406]
_IMAGE_STD = [0.229, 0.224, 0.225]


class UNetParkableSegmenter:
    """U-Net binary segmentation: background (0) vs parkable (1)."""

    def __init__(
        self,
        settings: SegmentationSettings,
        *,
        checkpoint_path: str | None = None,
    ) -> None:
        ckpt = checkpoint_path if checkpoint_path is not None else settings.unet_checkpoint_path
        if not ckpt:
            raise ValueError(
                "U-Net checkpoint path is missing. Set UNET_CHECKPOINT_PATH or pass checkpoint_path=."
            )
        self._checkpoint_path = Path(ckpt)
        self._input_size = settings.unet_input_size
        self._settings = settings
        self._device = _resolve_torch_device(settings.device_preference)
        self._model = None

    def _lazy_load(self) -> None:
        if self._model is not None:
            return
        import torch

        _, _, _, UNet = _build_unet_modules()

        ckpt = torch.load(self._checkpoint_path, map_location=self._device, weights_only=False)
        state = ckpt["state_dict"] if "state_dict" in ckpt else ckpt
        state = _remap_state_dict(state)

        head_weight = state.get("head.weight")
        base_filters = head_weight.shape[1] if head_weight is not None else 32

        self._model = UNet(in_channels=3, num_classes=2, base_filters=base_filters)
        self._model.load_state_dict(state, strict=True)
        self._model.to(self._device)
        self._model.eval()
        logger.info(
            "Loaded U-Net from %s (base_filters=%d, device=%s)",
            self._checkpoint_path,
            base_filters,
            self._device,
        )

    def predict_mask_raw(self, rgb_hwc: np.ndarray) -> np.ndarray:
        """Run inference; return uint8 parkable mask 0/255, same H x W as ``rgb_hwc``."""
        import torch
        from torchvision import transforms as T

        if rgb_hwc.ndim != 3 or rgb_hwc.shape[2] != 3:
            raise ValueError(f"Expected HWC RGB uint8, got shape {rgb_hwc.shape}")
        if rgb_hwc.dtype != np.uint8:
            raise ValueError(f"Expected uint8 RGB, got dtype {rgb_hwc.dtype}")

        self._lazy_load()
        assert self._model is not None

        original_h, original_w = rgb_hwc.shape[:2]
        size = self._input_size

        image = Image.fromarray(rgb_hwc, mode="RGB").resize((size, size), Image.BILINEAR)
        tensor = T.Normalize(mean=_IMAGE_MEAN, std=_IMAGE_STD)(T.ToTensor()(image))
        tensor = tensor.unsqueeze(0).to(self._device)

        with torch.inference_mode():
            logits = self._model(tensor)                        # [1, 2, size, size]
            pred = logits.argmax(dim=1)[0].cpu().numpy()        # [size, size]

        pred_resized = np.array(
            Image.fromarray((pred * 255).astype(np.uint8)).resize(
                (original_w, original_h), Image.NEAREST
            )
        )
        return pred_resized

    def predict(self, rgb_hwc: np.ndarray) -> SegmentationOutput:
        """Raw U-Net mask plus postprocessed (morphology + simplification) mask."""
        raw = self.predict_mask_raw(rgb_hwc)
        refined = postprocess_parkable_mask(raw, self._settings)
        return SegmentationOutput(mask_raw=raw, mask_refined=refined)

"""Paths, device, model identifiers, and detection settings for the pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "PACKAGE_ROOT",
    "load_dotenv_if_present",
    "SegmentationSettings",
    "segmentation_settings_from_env",
    "DetectionSettings",
    "detection_settings_from_env",
]


def _package_root() -> Path:
    """Directory that contains ``pyproject.toml`` (``absolutemap-gen/``)."""
    return Path(__file__).resolve().parents[2]


PACKAGE_ROOT = _package_root()


def load_dotenv_if_present() -> None:
    """Load ``absolutemap-gen/.env`` if ``python-dotenv`` is installed."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    env_path = PACKAGE_ROOT / ".env"
    if env_path.is_file():
        load_dotenv(env_path)


@dataclass(frozen=True)
class SegmentationSettings:
    """U-Net APKLOT binary segmentation and mask postprocessing."""

    unet_checkpoint_path: str | None
    """Path to the trained U-Net ``.pth`` checkpoint (local file)."""
    unet_input_size: int = 256
    """Square resolution fed to the U-Net (must match training, typically 256)."""
    device_preference: str | None = None
    morph_close_kernel: int = 5
    morph_open_kernel: int = 3
    max_hole_area_px: int = 500
    simplify_tolerance_px: float = 2.0
    min_polygon_area_px: float = 100.0

    def __post_init__(self) -> None:
        if self.unet_input_size < 32:
            raise ValueError("unet_input_size must be >= 32")
        if self.morph_close_kernel < 1 or self.morph_open_kernel < 1:
            raise ValueError("Morphology kernel sizes must be >= 1")
        if self.morph_close_kernel % 2 == 0 or self.morph_open_kernel % 2 == 0:
            raise ValueError("Morphology kernel sizes should be odd for symmetric anchors")
        if self.max_hole_area_px < 0:
            raise ValueError("max_hole_area_px must be non-negative")
        if self.simplify_tolerance_px < 0:
            raise ValueError("simplify_tolerance_px must be non-negative")


def segmentation_settings_from_env(*, require_checkpoint: bool = False) -> SegmentationSettings:
    """Build settings from environment (after optional ``.env`` load).

    Args:
        require_checkpoint: If True, raises when ``UNET_CHECKPOINT_PATH`` is unset.
    """
    load_dotenv_if_present()
    ckpt_path = os.environ.get("UNET_CHECKPOINT_PATH", "").strip() or None
    if require_checkpoint and not ckpt_path:
        raise ValueError(
            "UNET_CHECKPOINT_PATH is not set. Add it to absolutemap-gen/.env with a "
            "local path to the trained U-Net .pth checkpoint "
            "(e.g. artifacts/best_unet_apklot.pth)."
        )
    device_pref = os.environ.get("SEGMENTATION_DEVICE", "").strip() or None
    input_size_raw = os.environ.get("UNET_INPUT_SIZE", "256").strip()
    return SegmentationSettings(
        unet_checkpoint_path=ckpt_path,
        unet_input_size=int(input_size_raw) if input_size_raw else 256,
        device_preference=device_pref,
    )


@dataclass(frozen=True)
class DetectionSettings:
    """YOLO-OBB parking spot detection settings."""

    yolo_spots_weights_path: str | None
    """YOLO-OBB model for direct parking spot detection (2 classes: empty_slot / occupied_slot)."""
    conf_threshold: float = 0.15
    iou_nms_threshold: float = 0.30
    device_preference: str | None = None

    def __post_init__(self) -> None:
        if not 0.0 <= self.conf_threshold <= 1.0:
            raise ValueError("conf_threshold must be in [0, 1]")
        if not 0.0 <= self.iou_nms_threshold <= 1.0:
            raise ValueError("iou_nms_threshold must be in [0, 1]")


def detection_settings_from_env(*, require_weights: bool = False) -> DetectionSettings:
    """Build detection settings from the environment (after optional ``.env`` load).

    Args:
        require_weights: If True, raises when ``YOLO_SPOTS_WEIGHTS_PATH`` is unset.
    """
    load_dotenv_if_present()
    spots_weights = os.environ.get("YOLO_SPOTS_WEIGHTS_PATH", "").strip() or None
    if require_weights and not spots_weights:
        raise ValueError(
            "YOLO_SPOTS_WEIGHTS_PATH is not set. Add it to absolutemap-gen/.env "
            "(e.g. artifacts/parking_spots_best.pt)."
        )
    conf_s = os.environ.get("YOLO_CONF_THRESHOLD", "0.25").strip()
    iou_s = os.environ.get("YOLO_IOU_NMS_THRESHOLD", "0.45").strip()
    device_pref = os.environ.get("DETECTION_DEVICE", "").strip() or None
    return DetectionSettings(
        yolo_spots_weights_path=spots_weights,
        conf_threshold=float(conf_s),
        iou_nms_threshold=float(iou_s),
        device_preference=device_pref,
    )

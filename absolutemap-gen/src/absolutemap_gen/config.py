"""Paths, device, model identifiers, and detection settings for the pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

__all__ = [
    "PACKAGE_ROOT",
    "load_dotenv_if_present",
    "ImageSource",
    "ImageSourceSettings",
    "image_source_settings_from_env",
    "default_segformer_checkpoint_dir",
    "SegmentationSettings",
    "segmentation_settings_from_env",
    "DetectionSettings",
    "detection_settings_from_env",
]

ImageSource = Literal["mapbox", "ign"]


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
class ImageSourceSettings:
    """Which imagery provider to use for satellite/ortho image acquisition."""

    source: ImageSource = "mapbox"
    """``"mapbox"`` (default) or ``"ign"`` (Géoplateforme BD ORTHO, free, France only)."""
    ign_layer: str = "ORTHOIMAGERY.ORTHOPHOTOS"
    """WMS layer name for the IGN Géoplateforme service."""
    ign_image_format: str = "image/jpeg"
    """Image format requested from the IGN WMS-Raster service."""
    ign_default_radius_m: float = 32.0
    """Half-side (metres) of the square captured around each centre point for IGN.

    With 1280 px this yields ~0.05 m/px, matching the Mapbox zoom-20 ground footprint.
    """

    def __post_init__(self) -> None:
        if self.source not in ("mapbox", "ign"):
            raise ValueError(
                f"IMAGE_SOURCE must be 'mapbox' or 'ign', got {self.source!r}"
            )
        if self.ign_default_radius_m <= 0:
            raise ValueError("ign_default_radius_m must be positive")


def image_source_settings_from_env() -> ImageSourceSettings:
    """Build image-source settings from the environment."""
    load_dotenv_if_present()
    source_raw = os.environ.get("IMAGE_SOURCE", "mapbox").strip().lower()
    layer = os.environ.get("IGN_LAYER", "ORTHOIMAGERY.ORTHOPHOTOS").strip()
    fmt = os.environ.get("IGN_IMAGE_FORMAT", "image/jpeg").strip()
    radius_s = os.environ.get("IGN_DEFAULT_RADIUS_M", "128.0").strip()
    return ImageSourceSettings(
        source=source_raw,  # type: ignore[arg-type]
        ign_layer=layer,
        ign_image_format=fmt,
        ign_default_radius_m=float(radius_s),
    )


def default_segformer_checkpoint_dir() -> Path:
    """Hugging Face–style folder (``config.json``, ``preprocessor_config.json``, weights)."""
    return PACKAGE_ROOT / "artifacts" / "checkpoints" / "segformer-b2-parkable-best"


@dataclass(frozen=True)
class SegmentationSettings:
    """SegFormer binary segmentation (Hugging Face checkpoint dir) and mask postprocessing."""

    segformer_checkpoint_dir: str | None = None
    """Directory with a fine-tuned ``SegformerForSemanticSegmentation`` (local path)."""
    device_preference: str | None = None
    morph_close_kernel: int = 5
    morph_open_kernel: int = 3
    max_hole_area_px: int = 500
    simplify_tolerance_px: float = 2.0
    min_polygon_area_px: float = 100.0

    def __post_init__(self) -> None:
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
        require_checkpoint: If True, raises when the SegFormer checkpoint directory is missing
            or invalid (no ``config.json``).
    """
    load_dotenv_if_present()
    env_dir = os.environ.get("SEGFORMER_CHECKPOINT_DIR", "").strip() or None
    if env_dir:
        ckpt_dir = Path(env_dir)
        if not ckpt_dir.is_absolute():
            ckpt_dir = (PACKAGE_ROOT / ckpt_dir).resolve()
        else:
            ckpt_dir = ckpt_dir.resolve()
        ckpt_str = str(ckpt_dir)
    else:
        ckpt_dir = default_segformer_checkpoint_dir()
        ckpt_str = str(ckpt_dir.resolve())

    if require_checkpoint:
        if not ckpt_dir.is_dir():
            raise ValueError(
                f"SegFormer checkpoint directory does not exist: {ckpt_dir}. "
                "Set SEGFORMER_CHECKPOINT_DIR in absolutemap-gen/.env or place a fine-tuned "
                "model under artifacts/checkpoints/ (see default_segformer_checkpoint_dir())."
            )
        if not (ckpt_dir / "config.json").is_file():
            raise ValueError(
                f"Invalid SegFormer checkpoint directory (missing config.json): {ckpt_dir}"
            )

    device_pref = os.environ.get("SEGMENTATION_DEVICE", "").strip() or None
    return SegmentationSettings(
        segformer_checkpoint_dir=ckpt_str,
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

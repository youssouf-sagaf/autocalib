"""Pydantic BaseSettings for every configurable subsystem.

All defaults are extracted from the R&D ``absolutemap-gen`` codebase so the
clean rewrite starts with **identical** behavior.  Each magic number from
``geometric_engine.py``, ``config.py``, and ``segmentation.py`` is surfaced as
a named, documented field.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


# ---------------------------------------------------------------------------
# Imagery
# ---------------------------------------------------------------------------

class ImagerySource(str, Enum):
    mapbox = "mapbox"
    ign = "ign"


class ImagerySettings(BaseSettings):
    """Imagery provider selection and provider-specific knobs."""

    source: ImagerySource = ImagerySource.mapbox

    # Mapbox
    mapbox_access_token: str = ""
    mapbox_style_owner: str = "mapbox"
    mapbox_style_id: str = "satellite-v9"
    mapbox_timeout_s: float = 60.0
    mapbox_max_retries: int = 3
    mapbox_retry_backoff_s: float = 1.0

    # IGN Géoplateforme (free, no key)
    ign_layer: str = "ORTHOIMAGERY.ORTHOPHOTOS"
    ign_image_format: str = "image/jpeg"
    ign_default_radius_m: float = 32.0
    ign_timeout_s: float = 90.0
    ign_max_retries: int = 3
    ign_retry_backoff_s: float = 2.0

    # Common
    default_image_width: int = 1280
    default_image_height: int = 1280
    target_gsd_m: float = 0.05
    """Desired ground sampling distance (metres/pixel). Actual GSD comes from
    the returned GeoRasterSlice — this is a hint for zoom / radius selection."""

    model_config = {"env_prefix": "IMAGERY_"}


# ---------------------------------------------------------------------------
# SegFormer segmentation
# ---------------------------------------------------------------------------

class SegmentationSettings(BaseSettings):
    """SegFormer binary segmentation and mask post-processing."""

    segformer_checkpoint_dir: str | None = None
    """Local HuggingFace-format directory (config.json + weights)."""
    device_preference: str | None = None
    """``"cuda"``, ``"mps"``, ``"cpu"``, or None (auto-detect)."""

    # Mask morphology (from R&D segmentation.py defaults)
    morph_close_kernel: int = 5
    morph_open_kernel: int = 3
    max_hole_area_px: int = 500
    simplify_tolerance_px: float = 2.0
    min_polygon_area_px: float = 100.0

    @field_validator("morph_close_kernel", "morph_open_kernel")
    @classmethod
    def _odd_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Morphology kernel size must be >= 1")
        if v % 2 == 0:
            raise ValueError("Morphology kernel size must be odd")
        return v

    model_config = {"env_prefix": "SEG_"}


# ---------------------------------------------------------------------------
# YOLO-OBB detection
# ---------------------------------------------------------------------------

class DetectionSettings(BaseSettings):
    """YOLO-OBB parking spot detection (2 classes: empty / occupied)."""

    yolo_weights_path: str | None = None
    conf_threshold: float = Field(default=0.25, ge=0.0, le=1.0)
    iou_nms_threshold: float = Field(default=0.45, ge=0.0, le=1.0)
    device_preference: str | None = None

    model_config = {"env_prefix": "YOLO_"}


# ---------------------------------------------------------------------------
# Geometric engine
# ---------------------------------------------------------------------------

class GeometrySettings(BaseSettings):
    """Every tunable constant from the R&D ``GeometricEngine``.

    Defaults reproduce **identical** behavior to the R&D code.  Each field
    replaces a magic number; the doc-string records where the original value
    lived.
    """

    # ── Stage A — Row clustering ─────────────────────────────────────────
    angle_tolerance_deg: float = 25.0
    """Max angle difference (degrees) for two spots to be in the same row.
    R&D: ``math.radians(25)`` in ``cluster_into_rows``."""

    row_normal_factor: float = 0.8
    """Projection onto the row normal must be < factor × avg_height.
    R&D: ``proj_norm < 0.8 * avg_h``."""

    row_axis_factor: float = 4.0
    """Projection onto the row axis must be < factor × avg_width.
    R&D: ``proj_axis < 4.0 * avg_w``."""

    # ── Stage B — Gap filling + row extension ────────────────────────────
    gap_fill_threshold: float = 1.5
    """Gap filling triggers when projected distance > factor × row_width_px.
    R&D: ``dist_proj > 1.5 * row_wp``."""

    gap_fill_confidence: float = 0.75
    """Confidence assigned to gap-filled spots.  R&D: hardcoded ``0.75``."""

    extension_confidence: float = 0.75
    """Confidence assigned to row-extended spots.  R&D: hardcoded ``0.75``."""

    max_extension_steps: int = 25
    """Max iterations per direction when extrapolating a row.
    R&D: ``for _ in range(25)``."""

    dt_threshold_fraction: float = 0.25
    """Propagation stops when distance-transform value < fraction × row_depth_px.
    R&D: ``self.dt_threshold_fraction = 0.25``."""

    # ── Stage C — Uncovered mask region recovery ─────────────────────────
    coverage_width_factor: float = 1.5
    """Width expansion for the coverage map.
    R&D: ``expanded_w = spot.width * 1.5``."""

    coverage_height_factor: float = 1.2
    """Height expansion for the coverage map.
    R&D: ``expanded_h = spot.height * 1.2``."""

    min_island_area_factor: float = 1.5
    """Minimum uncovered region area = factor × (median_width × median_height).
    R&D: ``area < 1.5 * global_wp * global_hp``."""

    min_island_dt_factor: float = 0.25
    """Min distance-transform peak = factor × median_height for island viability.
    R&D: ``max_val < 0.25 * global_hp``."""

    recovery_confidence: float = 0.65
    """Confidence assigned to mask-recovery spots.  R&D: hardcoded ``0.65``."""

    max_recovery_steps: int = 50
    """Max propagation iterations per direction in island filling.
    R&D: ``for _ in range(50)``."""

    pca_min_points: int = 10
    """Minimum non-zero mask pixels for PCA orientation.
    R&D: ``if len(xs) < 10: return 0.0``."""

    # ── Stage D — Deduplication and mask validation ──────────────────────
    dedup_distance_factor: float = 1.5
    """Quick rejection: skip IoU if centroid distance > factor × max(w, h).
    R&D: ``dist < 1.5 * max(spot.width, spot.height)``."""

    iou_dedup_threshold: float = 0.15
    """Polygon intersection fraction above which the lower-priority spot is
    discarded.  R&D: ``intersect_area > 0.15 * min(spot_area, k_spot_area)``."""

    model_config = {"env_prefix": "GEOMETRY_"}


# ---------------------------------------------------------------------------
# Pipeline-level settings (aggregates the above)
# ---------------------------------------------------------------------------

class PipelineSettings(BaseSettings):
    """Top-level pipeline configuration — aggregates all subsystem settings."""

    imagery: ImagerySettings = Field(default_factory=ImagerySettings)
    segmentation: SegmentationSettings = Field(default_factory=SegmentationSettings)
    detection: DetectionSettings = Field(default_factory=DetectionSettings)
    geometry: GeometrySettings = Field(default_factory=GeometrySettings)

    model_config = {"env_prefix": "ABSMAP_"}

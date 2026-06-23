"""CalibSettings — all tunables for the bbox calib pipeline.

Loaded from environment variables (``CALIB_`` prefix) via Pydantic
``BaseSettings``.

**Detector backends:** ``yolo`` (``.pt`` checkpoint, **default**) or ``sam3`` (Hugging Face,
gated models). Switch with ``CALIB_DETECTOR_BACKEND`` and optional ``CALIB_SAM3_*`` fields below.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings

DetectorBackend = Literal["yolo", "sam3"]


class GeometrySettings(BaseSettings):
    """Tunable numeric parameters for cleaning, dedup, and fusion."""

    model_config = {"env_prefix": "CALIB_GEOM_"}

    area_mad_factor: float = 2.5
    min_aspect_ratio: float = 0.3
    max_aspect_ratio: float = 3.5
    containment_threshold: float = 0.75
    center_offset_frac: float = 0.3

    # Cross-cam ORB+RANSAC dedup
    enable_feature_dedup: bool = True
    overlap_zone_frac: float = 0.50
    feature_dedup_seam_y_frac: float = 0.50
    feature_dedup_seam_area_ratio: float = 0.40
    orb_nfeatures: int = 1500
    orb_edge_threshold: int = 10
    orb_fast_threshold: int = 7
    feature_dedup_min_keypoints: int = 4
    feature_dedup_lowe_ratio: float = 0.75
    feature_dedup_min_matches: int = 4
    feature_dedup_ransac_threshold: float = 5.0
    feature_dedup_min_inliers: int = 4

    # Fusion
    dedup_eps_frac: float = 0.5
    dedup_min_frames: int = 2

    # Calib bbox output size (px)
    calib_bbox_size: float = 10.0


class CalibSettings(BaseSettings):
    """Root settings for the bbox calib generator engine."""

    model_config = {"env_prefix": "CALIB_"}

    # S3 source
    s3_bucket: str = "cocospot-images"
    aws_region: str = "eu-west-3"

    # Frame selection
    top_n_frames: int = 10
    daytime_only: bool = True
    day_start_utc: int = 5
    day_end_utc: int = 17
    max_age_days: int = 90

    # Detector — default ``yolo``; set ``CALIB_DETECTOR_BACKEND=sam3`` for SAM3 (HF token required)
    detector_backend: DetectorBackend = "yolo"

    @field_validator("detector_backend", mode="before")
    @classmethod
    def _normalize_detector_backend(cls, v: object) -> str:
        if isinstance(v, str):
            return v.strip().lower()
        return v  # type: ignore[return-value]

    yolo_model_path: Optional[Path] = None
    yolo_conf: float = 0.25
    yolo_iou: float = 0.45

    # SAM3 (when ``detector_backend == "sam3"``) — see ``calib_gen.ml.sam3_detector``
    sam3_model_id: str = "facebook/sam3"
    sam3_text_prompt: str = "car"
    sam3_threshold: float = 0.5
    sam3_mask_threshold: float = 0.5
    sam3_device: Optional[str] = None
    #: Hugging Face token for gated SAM3 checkpoints; env ``CALIB_HF_TOKEN``.
    #: ``HF_TOKEN`` / ``HUGGINGFACE_HUB_TOKEN`` are also read at load time from the process env.
    hf_token: Optional[str] = None

    keep_classes: Optional[list[str]] = None
    exclude_classes: list[str] = Field(default_factory=list)

    # Cache
    use_detection_cache: bool = True
    cache_dir: Path = Path("/tmp/calib_gen_cache")

    # Geometry tunables
    geometry: GeometrySettings = Field(default_factory=GeometrySettings)

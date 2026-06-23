"""Pydantic BaseSettings for every configurable subsystem.

All defaults are extracted from the R&D ``absolutemap-gen`` codebase so the
clean rewrite starts with **identical** behavior.  Each magic number from
``geometric_engine.py``, ``config.py``, and ``segmentation.py`` is surfaced as
a named, documented field.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


# ---------------------------------------------------------------------------
# Imagery
# ---------------------------------------------------------------------------

class ImagerySettings(BaseSettings):
    """Imagery provider knobs (Mapbox / IGN Géoportail)."""

    provider: Literal["mapbox", "ign"] = "mapbox"
    """Active imagery source. Switched per-session via the API/frontend."""

    mapbox_access_token: str = ""
    mapbox_style_owner: str = "mapbox"
    mapbox_style_id: str = "satellite-v9"
    mapbox_timeout_s: float = 60.0
    mapbox_max_retries: int = 3
    mapbox_retry_backoff_s: float = 1.0

    # IGN Géoportail WMTS (free, no key since 2023). Default layer is the
    # "best available" composite; per-job overrides are passed through
    # ``IgnImageryProvider`` constructor so settings stay immutable.
    ign_base_url: str = "https://data.geopf.fr/wmts"
    ign_layer: str = "ORTHOIMAGERY.ORTHOPHOTOS"
    ign_format: str = "image/jpeg"
    ign_style: str = "normal"
    ign_max_zoom: int = 19

    # Common HTTP knobs for XYZ-style providers (IGN).
    xyz_timeout_s: float = 30.0
    xyz_max_retries: int = 3
    xyz_retry_backoff_s: float = 0.5

    target_gsd_m: float = 0.05
    """Desired ground sampling distance (metres/pixel). Actual GSD comes from
    the returned GeoRasterSlice — this is a hint for zoom / radius selection."""

    soft_cap_m: float = 100.0
    """Acceptable single-image ROI side length (metres). Mapbox clamps to
    1280 px so above ``MAX_TILE_PX * target_gsd_m`` (~64 m at 0.05 m/px) the
    GSD degrades. We tolerate that degradation up to ``soft_cap_m`` (default
    100 m → ~0.078 m/px) without raising a warning; beyond that the ROI is
    flagged as problematic and should be auto-tiled."""

    auto_tile: bool = False
    """When ``True``, the orchestrator splits ROIs larger than the Mapbox
    image cap (~64 m at 0.05 m/px) into overlapping tiles and merges the
    per-tile slot lists. When ``False`` (default), the ROI is fetched as a
    single image — Mapbox clamps the image to 1280 px so the effective GSD
    degrades on very large ROIs (e.g. ~0.06 m/px on a 75 m × 54 m parking).
    Trade-off: single coherent pass vs higher resolution on edge slivers."""

    model_config = {"env_prefix": "IMAGERY_"}


# ---------------------------------------------------------------------------
# SAM3 vehicle detection
# ---------------------------------------------------------------------------

class DetectionSettings(BaseSettings):
    """SAM3 text-prompt vehicle detection — anchors occupied slots for completion."""

    sam3_model_id: str = "facebook/sam3"
    text_prompt: str = "car"
    threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    mask_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    mask_pca_min_points: int = 10
    """Minimum foreground pixels in a SAM3 instance mask for ``minAreaRect`` OBB."""
    min_detection_width_m: float = 1.5
    """Reject SAM3 anchors whose OBB short side is below this length (metres).

    At ``0.05 m/px`` this is ``30 px`` — real vehicles in recent runs cluster
    around ``45–55 px`` wide while mask sliver false positives sit at ``11–20 px``.
    GSD-aware conversion keeps the gate valid when imagery is fetched at lower
    resolution on large ROIs."""
    device_preference: str | None = None
    hf_token: str | None = None
    """Hugging Face token for gated SAM3 checkpoints. Set ``SAM3_HF_TOKEN`` in ``.env``
    (also accepts ``HF_TOKEN`` / ``HUGGINGFACE_HUB_TOKEN`` as fallbacks)."""

    model_config = {"env_prefix": "SAM3_"}


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

    row_axis_factor: float = 15.0
    """Maximum along-row centre-to-centre distance between two SAM3 anchors
    to still consider them part of the same row, expressed as a multiple of
    ``avg_width``. With ``avg_width ≈ 53 px`` (≈ 2.6 m), a factor of 15 spans
    ≈ 800 px (≈ 40 m), enough to bridge ~10 consecutive empty stalls in a
    sparsely occupied row. Lower values (R&D default was 4.0 → ~10 m) splits
    long rows into multiple "fake rows" whenever a stretch of empty stalls
    exceeds 4 widths, breaking gap-fill consistency.

    Transitivity in union-find means anchors only need to chain pairwise, so
    raising this does not blindly merge unrelated rows: the perpendicular
    constraint (``row_normal_factor``) still gates inclusion."""

    # ── Stage B — Gap filling + row extension ────────────────────────────
    gap_fill_threshold: float = 1.5
    """Gap filling triggers when projected distance > factor × row_width_px.
    R&D: ``dist_proj > 1.5 * row_wp``."""

    gap_fill_confidence: float = 0.75
    """Confidence assigned to gap-filled spots.  R&D: hardcoded ``0.75``."""

    gap_fill_min_clearance_factor: float = 0.85
    """Minimum free space along the row axis (× ``row_wp_fill``) between two
    anchor centres before inserting a gap-fill slot. Prevents synthesising a
    full-width box when centre spacing is only slightly above
    ``gap_fill_threshold`` (e.g. 1.5× width → ~0.5× width of real gap)."""

    gap_fill_max_anchor_iou: float = 0.12
    """Skip a gap-fill candidate when its OBB intersection with either endpoint
    SAM3 anchor exceeds this fraction of the smaller box area. Applied at
    synthesis time so orange boxes never sit on top of green detections."""

    extension_confidence: float = 0.75
    """Confidence assigned to row-extended spots.  R&D: hardcoded ``0.75``."""

    max_extension_steps: int = 50
    """Max iterations per direction when extrapolating a row beyond its
    outermost SAM3 anchor. With a typical slot width of ~53 px (~2.6 m at
    0.05 m/px), 50 steps cover ≈ 2 650 px (~130 m), which exceeds the diagonal
    of any single Mapbox tile (max 1 280 px) and the project's 100 m soft cap
    per ROI. R&D default of 25 only covered ~66 m, truncating extension on
    long rows in large ROIs."""

    min_anchors_for_extension: int = 2
    """Do not row-extend a cluster with fewer SAM3 anchors — single spurious
    detections otherwise spawn long chains of micro-slots."""

    min_row_wp_m: float = 1.0
    """Skip gap-fill / extension when the row pitch width is narrower than
    this floor (metres). At ``target_gsd_m=0.05`` this is ≈20 px — the same
    cutoff as the legacy ``min_row_wp_px`` default — and scales down at coarser
    GSD (e.g. ≈5 px at 0.20 m/px) so low-resolution tiles still synthesise."""

    min_row_wp_px: float = 20.0
    """Fallback pitch floor (px) when ``gsd_m`` is not passed to the geometric
    engine (unit tests). Prefer ``min_row_wp_m`` in production."""

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

    enable_mask_recovery: bool = False
    """When False, Stage C is skipped — synthesis is gap-fill only between SAM3 anchors."""

    pca_min_points: int = 10
    """Minimum non-zero mask pixels for PCA orientation.
    R&D: ``if len(xs) < 10: return 0.0``."""

    roi_axis_min_eigval_ratio: float = 4.0
    """Minimum (λ₁ / λ₂) of the ROI mask covariance for the dominant axis to be
    used as the row-pitch direction in stages B and C. ≈ aspect-ratio² of the
    ROI footprint — 4.0 is met by any reasonably elongated strip (≥ ~2:1) and
    rejects square-ish ROIs where no clear long axis exists. When the ratio is
    below this floor (or the mask is too sparse for PCA), stages B and C fall
    back to the detection row vector / slot-width direction as before."""

    default_slot_w_m: float = 2.5
    """Fallback slot width (m) when no detections or markings supply scale."""

    default_slot_h_m: float = 5.0
    """Fallback slot depth (m) when no detections or markings supply scale."""

    prior_mask_center_tolerance: float = 0.0
    """Off-mask tolerance for slot acceptance when the prior is *operator-trusted*
    (``operator_hint``). Distance to the nearest foreground pixel must be
    ≤ factor × prior.slot_width_px. Set to 0 to keep the strict on-mask gate
    everywhere else (default — avoids spurious recovery slots when the segmenter
    leaves gaps between mask blobs)."""

    min_anchors_for_recovery: int = 3
    """Minimum number of SAM3 vehicle anchors required before Stage C (mask recovery)
    is allowed to fire when the prior is not *trusted*. Below this threshold the
    median-based slot gabarit is unreliable — see ``_recover_uncovered``."""

    recovery_min_prior_confidence: float = 0.55
    """Skip Stage C when the active prior's confidence is below this floor
    AND it does not originate from a human-trusted source. Prevents mass
    recovery when detections are sparse and the segmenter is the only weak signal."""

    # ── Stage D — Deduplication and mask validation ──────────────────────
    dedup_distance_factor: float = 1.5
    """Quick rejection: skip IoU if centroid distance > factor × max(w, h).
    R&D: ``dist < 1.5 * max(spot.width, spot.height)``."""

    iou_dedup_threshold: float = 0.15
    """Polygon intersection fraction above which the lower-priority spot is
    discarded.  R&D: ``intersect_area > 0.15 * min(spot_area, k_spot_area)``."""

    model_config = {"env_prefix": "GEOMETRY_"}


class FusionSettings(BaseSettings):
    """Thresholds for prior selection (SAM3 vs mask PCA vs defaults)."""

    sam3_min_confidence: float = 0.25
    mask_min_confidence: float = 0.2
    """Minimum mask-coverage confidence to accept PCA-based prior."""

    model_config = {"env_prefix": "FUSION_"}


# ---------------------------------------------------------------------------
# Alignment tool (RowStraightener)
# ---------------------------------------------------------------------------

class AlignmentSettings(BaseSettings):
    """RowStraightener (two-anchor segment) — corridor and angle gate.

    Only these fields are read by ``alignment_tool/straightener.py``. The
    pre-refactor straightener used KNN median direction, an axial walk, and
    env-tunable gap/pitch limits; those knobs (``neighbor_count``,
    ``max_gap_factor``, ``pitch_tolerance_factor``, ``max_gap_steps``,
    ``rolling_alpha``) were removed: along-axis extent is computed inline from
    anchor distance and average width, not from settings.
    """

    corridor_width_factor: float = 1.65
    """Half-width of the perpendicular corridor = factor × max(anchor widths)."""

    angle_tolerance_deg: float = 42.0
    """Max deviation (degrees) for OBB axis vs row axis, modulo 90°."""

    manual_angle_tolerance_deg: float = 65.0
    """Looser axis gate for ``source=manual`` slots (extend / clone row)."""

    manual_corridor_width_factor: float = 2.2
    """Perpendicular corridor half-width for manual slots = factor × anchor width."""

    endpoint_pad_width_factor: float = 0.4
    """Along-axis slack (× mean anchor width) at segment ends — not beyond A/B."""

    model_config = {"env_prefix": "ALIGN_"}


# ---------------------------------------------------------------------------
# Reprocessing helper
# ---------------------------------------------------------------------------

class ReprocessingSettings(BaseSettings):
    """ReprocessingHelper auto-fill parameters."""

    iou_dedup_threshold: float = 0.5
    """Proposed slot discarded when IoU with any existing slot exceeds this."""

    max_row_slots: int = 50
    """Safety limit: max candidates per direction in a single row."""

    parallel_row_search: bool = True
    """Try filling adjacent parallel rows within the scope."""

    max_parallel_rows: int = 3
    """Max number of parallel rows to try on each side of the reference row."""

    pitch_fallback_factor: float = 1.1
    """When no angle-compatible neighbor exists, pitch = factor × slot width."""

    reprocess_confidence: float = 0.75
    """Confidence assigned to auto-reprocessed slots."""

    model_config = {"env_prefix": "REPROC_"}


# ---------------------------------------------------------------------------
# Pipeline-level settings (aggregates the above)
# ---------------------------------------------------------------------------

class PipelineSettings(BaseSettings):
    """Top-level pipeline configuration — aggregates all subsystem settings."""

    imagery: ImagerySettings = Field(default_factory=ImagerySettings)
    detection: DetectionSettings = Field(default_factory=DetectionSettings)
    geometry: GeometrySettings = Field(default_factory=GeometrySettings)
    fusion: FusionSettings = Field(default_factory=FusionSettings)
    alignment: AlignmentSettings = Field(default_factory=AlignmentSettings)
    reprocessing: ReprocessingSettings = Field(default_factory=ReprocessingSettings)

    debug_artifacts: bool = False
    """Save per-stage debug images under ``autoabsmap/artifacts/``."""

    model_config = {"env_prefix": "ABSMAP_"}

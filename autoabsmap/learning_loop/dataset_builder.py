"""DatasetBuilder — transforms captured sessions into training-ready datasets.

Separates SegFormer signals from YOLO-OBB signals because their
learning paths are distinct.

**Segmentation signals** come from edits that reveal mask quality:

- Manual adds in mask-excluded areas → False Negative (seg missed this zone)
- Manual deletes in mask-included areas → False Positive (seg over-covered)
- Difficulty tags feed hard-case curriculum
- ``final_output.geojson`` geometry → corrected mask targets (pseudo-mask)

**Detection signals** come from edits that reveal detector quality:

- Manual adds → FN (missed detection)
- Manual deletes → FP (false detection / hard negative)
- Manual geometry modifications → OBB regression correction targets
- Reprocess accepted/rejected proposals → additional FN/pattern evidence
- Align corrections → geometric regression targets
- ``source`` attribution localises errors by generation path
"""

from __future__ import annotations

import json
import logging
import math
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import BaseModel, Field

from autoabsmap.export.models import GeoSlot, SlotSource
from autoabsmap.io.atomic import write_json_atomic
from autoabsmap.learning_loop.capture import SessionStore
from autoabsmap.learning_loop.models import (
    CropMeta,
    EditEventType,
    SessionTrace,
)

logger = logging.getLogger(__name__)

__all__ = [
    "SegmentationTrainingSet",
    "DetectionTrainingSet",
    "DatasetStats",
    "DatasetBuilder",
]


# ------------------------------------------------------------------
# Statistics
# ------------------------------------------------------------------

class DatasetStats(BaseModel):
    """Breakdown of a training set for quick analysis."""

    total_samples: int = 0
    by_signal_type: dict[str, int] = Field(default_factory=dict)
    by_source: dict[str, int] = Field(default_factory=dict)
    by_difficulty_tag: dict[str, int] = Field(default_factory=dict)
    sessions_with_signals: int = 0
    sessions_without_signals: int = 0


# ------------------------------------------------------------------
# Output models
# ------------------------------------------------------------------

class SegmentationTrainingSet(BaseModel):
    """Training-ready dataset for SegFormer retraining.

    Each sample dict has keys:

    - ``session_id``: str
    - ``signal_type``: ``"fn"`` | ``"fp"`` | ``"pseudo_mask"``
    - ``slot``: serialised GeoSlot | None (the add/delete that revealed the error)
    - ``crop_index``: int | None (which crop's mask was involved)
    - ``mask_path``: str | None (path to the per-crop seg mask .npy)
    - ``pseudo_mask_path``: str | None (path to the generated pseudo-mask .npy)
    - ``difficulty_tags``: list[str]
    """

    samples: list[dict[str, Any]]
    session_count: int
    stats: DatasetStats = Field(default_factory=DatasetStats)


class DetectionTrainingSet(BaseModel):
    """Training-ready dataset for YOLO-OBB retraining.

    Each sample dict has keys:

    - ``session_id``: str
    - ``signal_type``: ``"fn"`` | ``"fp"`` | ``"correction"`` | ``"reprocess_fn"``
      | ``"align_correction"``
    - ``original_source``: str (SlotSource of the involved slot)
    - ``slot_before``: serialised GeoSlot | None
    - ``slot_after``: serialised GeoSlot | None
    - ``difficulty_tags``: list[str]
    """

    samples: list[dict[str, Any]]
    session_count: int
    stats: DatasetStats = Field(default_factory=DatasetStats)


# ------------------------------------------------------------------
# Loaded crop context (internal)
# ------------------------------------------------------------------

class _CropContext:
    """Pre-loaded per-crop artifacts for efficient repeated lookups."""

    __slots__ = ("index", "meta", "mask", "mask_path")

    def __init__(
        self,
        index: int,
        meta: CropMeta | None,
        mask: np.ndarray | None,
        mask_path: str | None,
    ) -> None:
        self.index = index
        self.meta = meta
        self.mask = mask
        self.mask_path = mask_path

    def contains_wgs84(self, lng: float, lat: float) -> bool:
        """Check whether a WGS84 point falls inside this crop's bounds."""
        if self.meta is None:
            return False
        return (
            self.meta.bounds_wgs84_west <= lng <= self.meta.bounds_wgs84_east
            and self.meta.bounds_wgs84_south <= lat <= self.meta.bounds_wgs84_north
        )


# ------------------------------------------------------------------
# Builder
# ------------------------------------------------------------------

class DatasetBuilder:
    """Build training datasets from captured operator sessions.

    Uses a :class:`SessionStore` to read session artifacts (masks, edit traces,
    baseline/final slots) from the filesystem.
    """

    def __init__(self, store: SessionStore) -> None:
        self._store = store

    # ------------------------------------------------------------------
    # Public — segmentation
    # ------------------------------------------------------------------

    def build_segmentation_dataset(
        self,
        sessions: list[Path],
    ) -> SegmentationTrainingSet:
        """Extract segmentation FN/FP signals from operator sessions.

        **FN signal**: operator added a slot whose centre falls *outside* the
        segmentation mask — the mask missed a parkable zone.

        **FP signal**: operator deleted a pipeline-generated slot whose centre
        falls *inside* the segmentation mask — the mask over-covered.

        **Pseudo-mask**: for each crop that has a mask and final slots, a
        corrected binary mask is produced by painting the final slot polygons
        onto the mask.  This serves as corrected training target for SegFormer.

        When the per-crop mask is not available the edit is still recorded
        (with ``mask_path=None``) because the add/delete itself is evidence.
        """
        samples: list[dict[str, Any]] = []
        signal_sessions = 0
        no_signal_sessions = 0

        for session_dir in sessions:
            session_id = session_dir.name
            try:
                trace = self._store.load(session_id)
            except Exception as exc:
                logger.warning("Skipping session %s: %s", session_id, exc)
                continue

            tags = [t.value for t in trace.difficulty_tags]
            crops = self._load_crop_contexts(session_id)
            session_sample_count = 0

            # ---- FN / FP signals from edit events ----
            for event in trace.edit_events:
                if event.type == EditEventType.add:
                    for slot in event.after:
                        ctx = _find_crop_for_slot(slot, crops)
                        if ctx is not None and ctx.mask is not None and ctx.meta is not None:
                            inside = _slot_inside_mask(slot, ctx.mask, ctx.meta)
                            if inside is None:
                                continue  # cannot determine — skip signal (#4)
                            if inside:
                                continue  # added inside mask — not a seg FN
                        samples.append({
                            "session_id": session_id,
                            "signal_type": "fn",
                            "slot": slot.model_dump(),
                            "crop_index": ctx.index if ctx else None,
                            "mask_path": ctx.mask_path if ctx else None,
                            "pseudo_mask_path": None,
                            "difficulty_tags": tags,
                        })
                        session_sample_count += 1

                elif event.type in (EditEventType.delete, EditEventType.bulk_delete):
                    for slot in event.before:
                        if slot.source == SlotSource.manual:
                            continue  # operator deleting their own manual add
                        ctx = _find_crop_for_slot(slot, crops)
                        if ctx is not None and ctx.mask is not None and ctx.meta is not None:
                            inside = _slot_inside_mask(slot, ctx.mask, ctx.meta)
                            if inside is None:
                                continue  # cannot determine — skip signal (#4)
                            if not inside:
                                continue  # deleted outside mask — not a seg FP
                        samples.append({
                            "session_id": session_id,
                            "signal_type": "fp",
                            "slot": slot.model_dump(),
                            "crop_index": ctx.index if ctx else None,
                            "mask_path": ctx.mask_path if ctx else None,
                            "pseudo_mask_path": None,
                            "difficulty_tags": tags,
                        })
                        session_sample_count += 1

            # ---- Pseudo-mask per crop ----
            for ctx in crops:
                if ctx.mask is None or ctx.meta is None:
                    continue
                pseudo = _generate_pseudo_mask(trace.final_slots, ctx.mask, ctx.meta)
                if pseudo is not None:
                    pseudo_path = (
                        self._store._base / session_id / "per_crop"
                        / str(ctx.index) / "pseudo_mask.npy"
                    )
                    np.save(pseudo_path, pseudo)
                    samples.append({
                        "session_id": session_id,
                        "signal_type": "pseudo_mask",
                        "slot": None,
                        "crop_index": ctx.index,
                        "mask_path": ctx.mask_path,
                        "pseudo_mask_path": str(pseudo_path),
                        "difficulty_tags": tags,
                    })
                    session_sample_count += 1

            if session_sample_count > 0:
                signal_sessions += 1
            else:
                no_signal_sessions += 1

        stats = _compute_stats(samples, signal_sessions, no_signal_sessions)
        logger.info(
            "Built segmentation dataset: %d samples from %d sessions "
            "(%d with signals)",
            len(samples), len(sessions), signal_sessions,
        )
        return SegmentationTrainingSet(
            samples=samples,
            session_count=len(sessions),
            stats=stats,
        )

    # ------------------------------------------------------------------
    # Public — detection
    # ------------------------------------------------------------------

    def build_detection_dataset(
        self,
        sessions: list[Path],
    ) -> DetectionTrainingSet:
        """Extract detection FN/FP/correction signals from operator sessions.

        **FN signal** (manual add): operator placed a slot the detector missed.

        **FP signal** (manual delete): operator removed a false detection.

        **Correction signal** (modify): operator adjusted centre/angle/size of
        a detected slot — provides OBB regression correction targets.

        **Reprocess FN** (accepted reprocess proposals): slots the pipeline
        missed in an area, requiring the operator to use the reprocessing tool.

        **Align correction** (straighten events): geometric correction targets
        where the pipeline produced misaligned rows.

        The ``original_source`` field enables error localisation by generation
        path (e.g. ``row_extension`` failing more than ``yolo`` → geometry bug,
        not model bug).
        """
        samples: list[dict[str, Any]] = []
        signal_sessions = 0
        no_signal_sessions = 0

        for session_dir in sessions:
            session_id = session_dir.name
            try:
                trace = self._store.load(session_id)
            except Exception as exc:
                logger.warning("Skipping session %s: %s", session_id, exc)
                continue

            tags = [t.value for t in trace.difficulty_tags]
            session_sample_count = 0

            # ---- Edit event signals ----
            for event in trace.edit_events:
                if event.type == EditEventType.add:
                    for slot in event.after:
                        samples.append({
                            "session_id": session_id,
                            "signal_type": "fn",
                            "original_source": slot.source.value,
                            "slot_before": None,
                            "slot_after": slot.model_dump(),
                            "difficulty_tags": tags,
                        })
                        session_sample_count += 1

                elif event.type in (EditEventType.delete, EditEventType.bulk_delete):
                    for slot in event.before:
                        if slot.source == SlotSource.manual:
                            continue  # operator deleting their own manual add (#6)
                        samples.append({
                            "session_id": session_id,
                            "signal_type": "fp",
                            "original_source": slot.source.value,
                            "slot_before": slot.model_dump(),
                            "slot_after": None,
                            "difficulty_tags": tags,
                        })
                        session_sample_count += 1

                elif event.type == EditEventType.modify:
                    for before, after in zip(event.before, event.after):
                        samples.append({
                            "session_id": session_id,
                            "signal_type": "correction",
                            "original_source": before.source.value,
                            "slot_before": before.model_dump(),
                            "slot_after": after.model_dump(),
                            "difficulty_tags": tags,
                        })
                        session_sample_count += 1

                elif event.type == EditEventType.align:
                    for before, after in zip(event.before, event.after):
                        samples.append({
                            "session_id": session_id,
                            "signal_type": "align_correction",
                            "original_source": before.source.value,
                            "slot_before": before.model_dump(),
                            "slot_after": after.model_dump(),
                            "difficulty_tags": tags,
                        })
                        session_sample_count += 1

            # ---- Reprocess signals ----
            for step in trace.reprocessed_steps:
                for slot in step.accepted:
                    samples.append({
                        "session_id": session_id,
                        "signal_type": "reprocess_fn",
                        "original_source": slot.source.value,
                        "slot_before": None,
                        "slot_after": slot.model_dump(),
                        "difficulty_tags": tags,
                    })
                    session_sample_count += 1

            if session_sample_count > 0:
                signal_sessions += 1
            else:
                no_signal_sessions += 1

        stats = _compute_stats(samples, signal_sessions, no_signal_sessions)
        logger.info(
            "Built detection dataset: %d samples from %d sessions "
            "(%d with signals)",
            len(samples), len(sessions), signal_sessions,
        )
        return DetectionTrainingSet(
            samples=samples,
            session_count=len(sessions),
            stats=stats,
        )

    # ------------------------------------------------------------------
    # Public — export to disk
    # ------------------------------------------------------------------

    def export_to_disk(
        self,
        dataset: SegmentationTrainingSet | DetectionTrainingSet,
        output_dir: Path,
    ) -> Path:
        """Materialise a dataset as a directory with manifest + samples.

        Layout::

            output_dir/
                manifest.json        # index: stats + list of sample paths
                samples/
                    000000.json
                    000001.json
                    ...

        Returns the path to ``manifest.json``.
        """
        output_dir = Path(output_dir)
        samples_dir = output_dir / "samples"
        samples_dir.mkdir(parents=True, exist_ok=True)

        sample_paths: list[str] = []
        for i, sample in enumerate(dataset.samples):
            fname = f"{i:06d}.json"
            write_json_atomic(samples_dir / fname, sample)
            sample_paths.append(f"samples/{fname}")

        manifest = {
            "session_count": dataset.session_count,
            "total_samples": len(dataset.samples),
            "stats": dataset.stats.model_dump(),
            "sample_files": sample_paths,
        }
        manifest_path = output_dir / "manifest.json"
        write_json_atomic(manifest_path, manifest)

        logger.info(
            "Exported dataset to %s: %d samples", output_dir, len(dataset.samples),
        )
        return manifest_path

    # ------------------------------------------------------------------
    # Internal — crop context loading
    # ------------------------------------------------------------------

    def _load_crop_contexts(self, session_id: str) -> list[_CropContext]:
        """Load all per-crop contexts (meta + mask) for a session."""
        n = self._store.crop_count(session_id)
        contexts: list[_CropContext] = []
        for i in range(n):
            meta = self._store.load_crop_meta(session_id, i)
            mask = self._store.load_crop_mask(session_id, i)
            mask_path: str | None = None
            if mask is not None:
                mask_path = str(
                    self._store._base / session_id / "per_crop" / str(i)
                    / "segmentation_mask.npy"
                )
            contexts.append(_CropContext(
                index=i, meta=meta, mask=mask, mask_path=mask_path,
            ))
        return contexts


# ------------------------------------------------------------------
# Spatial helpers
# ------------------------------------------------------------------

def _find_crop_for_slot(
    slot: GeoSlot,
    crops: list[_CropContext],
) -> _CropContext | None:
    """Find which crop a slot's centre falls into.

    Returns the first crop whose WGS84 bounds contain the slot's centre, or
    ``None`` if no such crop exists.  No fallback to an unrelated crop is
    performed — an unattributable slot is recorded without crop context so
    callers never compare it against a mask it does not belong to (#5).
    """
    lng, lat = slot.center.lng, slot.center.lat
    for ctx in crops:
        if ctx.contains_wgs84(lng, lat):
            return ctx
    return None


def _slot_inside_mask(
    slot: GeoSlot,
    mask: np.ndarray,
    meta: CropMeta,
) -> bool | None:
    """Check whether a GeoSlot's centre falls inside a segmentation mask.

    Uses the per-crop affine + CRS to convert WGS84 → pixel, then checks
    the mask value.  Mask convention: 0 = background, 255 = parkable.

    Returns ``None`` when the verdict is indeterminate — either the WGS84 →
    pixel transform failed (broken affine / pyproj error) or the computed
    pixel lands outside the mask raster.  Callers treat ``None`` as "skip
    this signal" (see #4) so broken transforms no longer silently flip
    add/delete classifications.
    """
    px, py = _wgs84_to_pixel(slot.center.lng, slot.center.lat, meta)
    if px is None:
        return None  # cannot determine — caller skips the signal
    h, w = mask.shape[:2]
    row, col = int(round(py)), int(round(px))
    if 0 <= row < h and 0 <= col < w:
        return bool(mask[row, col] > 0)
    return None  # pixel outside crop raster — unknown, caller skips


def _wgs84_to_pixel(
    lng: float,
    lat: float,
    meta: CropMeta,
) -> tuple[float | None, float | None]:
    """Convert WGS84 coordinates to pixel coordinates via the crop's affine.

    Returns ``(px, py)`` in pixel space, or ``(None, None)`` if the transform
    cannot be applied (e.g. CRS requires pyproj but it fails).
    """
    a, b, c, d, e, f = meta.affine

    if meta.crs_epsg == 4326:
        # Affine is directly in degrees — invert: pixel = inv(affine) * (lng, lat)
        native_x, native_y = lng, lat
    else:
        # Reproject WGS84 → native CRS
        try:
            from pyproj import Transformer
            from rasterio.crs import CRS

            t = Transformer.from_crs(
                CRS.from_epsg(4326), CRS.from_epsg(meta.crs_epsg), always_xy=True,
            )
            native_x, native_y = t.transform(lng, lat)
        except Exception:
            return None, None

    # Invert the affine: [x, y] = A * [col, row] + [c, f]
    #   col = (x - c) / a   (when b == 0)
    #   row = (y - f) / e   (when d == 0)
    # General case: solve [a b; d e] * [col; row] = [x-c; y-f]
    det = a * e - b * d
    if abs(det) < 1e-12:
        return None, None
    px = (e * (native_x - c) - b * (native_y - f)) / det
    py = (a * (native_y - f) - d * (native_x - c)) / det
    return px, py


# ------------------------------------------------------------------
# Pseudo-mask generation
# ------------------------------------------------------------------

def _generate_pseudo_mask(
    final_slots: list[GeoSlot],
    original_mask: np.ndarray,
    meta: CropMeta,
) -> np.ndarray | None:
    """Generate a corrected binary mask from the final (operator-validated) slots.

    The returned mask is the **union** of (original mask) ∪ (final slot polygons)
    rasterised onto the same grid.  This fills in parkable zones the segmentation
    model missed — i.e. corrects **false negatives** only.

    **Limitation (#7)**: this is FN-only correction by design.  Regions that the
    original mask flagged as parkable but that contain no operator-validated slot
    are **not** removed, so false-positive mask areas persist in the pseudo
    target.  Training SegFormer on this signal will push recall up but cannot
    teach it to shrink over-covered zones.  A stricter correction scheme would
    have to subtract non-slot parkable regions; that trade-off is deferred.

    Returns ``None`` if no slots fall within this crop.
    """
    h, w = original_mask.shape[:2]
    pseudo = original_mask.copy()
    painted = False

    for slot in final_slots:
        coords = slot.polygon.coordinates[0]  # outer ring
        pixel_points = []
        for coord in coords:
            lng, lat = coord[0], coord[1]
            px, py = _wgs84_to_pixel(lng, lat, meta)
            if px is None:
                break
            pixel_points.append((int(round(px)), int(round(py))))
        else:
            if len(pixel_points) >= 3:
                _fill_polygon(pseudo, pixel_points, value=255)
                painted = True

    return pseudo if painted else None


def _fill_polygon(
    mask: np.ndarray,
    points: list[tuple[int, int]],
    value: int = 255,
) -> None:
    """Fill a polygon onto a 2D mask using scanline (no OpenCV dependency).

    Points are (col, row) tuples.  Uses a simple edge-list scanline approach.
    """
    if len(points) < 3:
        return
    h, w = mask.shape[:2]
    # Find row range
    rows = [p[1] for p in points]
    min_row = max(0, min(rows))
    max_row = min(h - 1, max(rows))

    edges = list(zip(points, points[1:] + [points[0]]))

    for row in range(min_row, max_row + 1):
        intersections: list[float] = []
        for (x0, y0), (x1, y1) in edges:
            if y0 == y1:
                continue
            if (y0 <= row < y1) or (y1 <= row < y0):
                x_cross = x0 + (row - y0) * (x1 - x0) / (y1 - y0)
                intersections.append(x_cross)
        intersections.sort()
        for i in range(0, len(intersections) - 1, 2):
            col_start = max(0, int(math.ceil(intersections[i])))
            col_end = min(w - 1, int(math.floor(intersections[i + 1])))
            if col_start <= col_end:
                mask[row, col_start : col_end + 1] = value


# ------------------------------------------------------------------
# Stats computation
# ------------------------------------------------------------------

def _compute_stats(
    samples: list[dict[str, Any]],
    signal_sessions: int,
    no_signal_sessions: int,
) -> DatasetStats:
    """Aggregate sample-level statistics."""
    sig_counter: Counter[str] = Counter()
    src_counter: Counter[str] = Counter()
    tag_counter: Counter[str] = Counter()

    for s in samples:
        sig_counter[s.get("signal_type", "unknown")] += 1
        src = s.get("original_source")
        if src:
            src_counter[src] += 1
        for tag in s.get("difficulty_tags", []):
            tag_counter[tag] += 1

    return DatasetStats(
        total_samples=len(samples),
        by_signal_type=dict(sig_counter),
        by_source=dict(src_counter),
        by_difficulty_tag=dict(tag_counter),
        sessions_with_signals=signal_sessions,
        sessions_without_signals=no_signal_sessions,
    )

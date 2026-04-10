"""SessionStore — filesystem persistence for POC, swappable for Firestore.

Stores the full session trace as a directory of JSON/NDJSON files matching
the layout documented in the architecture (sessions/{session_id}/...).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotStatus
from autoabsmap.io.atomic import write_json_atomic
from autoabsmap.learning_loop.models import (
    CropMeta,
    DeltaSummary,
    DifficultyTag,
    EditEvent,
    ReprocessStep,
    SessionTrace,
)

logger = logging.getLogger(__name__)

__all__ = ["SessionStore"]


def _feature_to_geoslot(feature: dict[str, Any]) -> GeoSlot:
    """Reconstruct a GeoSlot from a GeoJSON Feature (inverse of geoslots_to_feature_collection)."""
    props = feature["properties"]
    return GeoSlot(
        slot_id=props["slot_id"],
        center=LngLat(lng=props["center_lng"], lat=props["center_lat"]),
        polygon=feature["geometry"],
        source=SlotSource(props["source"]),
        confidence=props["confidence"],
        status=SlotStatus(props["status"]),
    )


class SessionStore:
    """Filesystem-backed session persistence (POC).

    Directory layout per session matches the architecture doc::

        sessions/{session_id}/
            run_meta.json
            crops_geometry.geojson
            per_crop/{crop_index}/
                segmentation_mask.npy
                detection_raw.geojson
                post_processed.geojson
            baseline_merged.geojson
            edit_trace.ndjson
            reprocessed_steps.ndjson
            final_output.geojson
            difficulty_tags.json
            delta_summary.json
    """

    def __init__(self, base_dir: str | Path) -> None:
        self._base = Path(base_dir)

    # ------------------------------------------------------------------
    # Write — full session trace
    # ------------------------------------------------------------------

    def save(self, trace: SessionTrace) -> Path:
        """Persist a complete session trace to disk."""
        session_dir = self._base / trace.session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        write_json_atomic(
            session_dir / "run_meta.json",
            trace.run_meta.model_dump(),
        )

        crops_geojson = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": c.model_dump(), "properties": {}}
                for c in trace.crops
            ],
        }
        write_json_atomic(session_dir / "crops_geometry.geojson", crops_geojson)

        edit_trace_path = session_dir / "edit_trace.ndjson"
        with edit_trace_path.open("w", encoding="utf-8") as f:
            for event in trace.edit_events:
                f.write(event.model_dump_json() + "\n")

        reprocess_path = session_dir / "reprocessed_steps.ndjson"
        with reprocess_path.open("w", encoding="utf-8") as f:
            for step in trace.reprocessed_steps:
                f.write(step.model_dump_json() + "\n")

        from autoabsmap.export.geojson import geoslots_to_feature_collection

        write_json_atomic(
            session_dir / "final_output.geojson",
            geoslots_to_feature_collection(trace.final_slots),
        )

        if trace.baseline_slots:
            write_json_atomic(
                session_dir / "baseline_merged.geojson",
                geoslots_to_feature_collection(trace.baseline_slots),
            )

        write_json_atomic(
            session_dir / "difficulty_tags.json",
            {
                "tags": [t.value for t in trace.difficulty_tags],
                "other_note": trace.other_difficulty_note,
            },
        )

        write_json_atomic(
            session_dir / "delta_summary.json",
            trace.delta.model_dump(),
        )

        logger.info("Saved session %s to %s", trace.session_id, session_dir)
        return session_dir

    # ------------------------------------------------------------------
    # Write — per-crop pipeline artifacts (called by orchestrator)
    # ------------------------------------------------------------------

    def save_crop_artifacts(
        self,
        session_id: str,
        crop_index: int,
        *,
        seg_mask: np.ndarray | None = None,
        raw_slots: list[GeoSlot] | None = None,
        post_processed_slots: list[GeoSlot] | None = None,
        crop_meta: CropMeta | None = None,
        rgb_hwc: np.ndarray | None = None,
    ) -> Path:
        """Save per-crop pipeline artifacts (seg mask, raw detections, post-processed).

        Called by the orchestrator after each crop completes, before operator editing.
        ``crop_meta`` carries the raster affine + bounds needed by the dataset
        builder for precise WGS84 ↔ pixel mapping.
        When ``rgb_hwc`` is set (H×W×C uint8 RGB), writes ``rgb.png`` for retraining export.
        """
        from autoabsmap.export.geojson import geoslots_to_feature_collection

        crop_dir = self._base / session_id / "per_crop" / str(crop_index)
        crop_dir.mkdir(parents=True, exist_ok=True)

        if crop_meta is not None:
            write_json_atomic(crop_dir / "crop_meta.json", crop_meta.model_dump())

        if seg_mask is not None:
            np.save(crop_dir / "segmentation_mask.npy", seg_mask)

        if raw_slots is not None:
            write_json_atomic(
                crop_dir / "detection_raw.geojson",
                geoslots_to_feature_collection(raw_slots),
            )

        if post_processed_slots is not None:
            write_json_atomic(
                crop_dir / "post_processed.geojson",
                geoslots_to_feature_collection(post_processed_slots),
            )

        if rgb_hwc is not None:
            if rgb_hwc.dtype != np.uint8 or rgb_hwc.ndim != 3 or rgb_hwc.shape[2] not in (3, 4):
                logger.warning(
                    "rgb_hwc for session %s crop %s ignored — expected HxWx3|4 uint8",
                    session_id, crop_index,
                )
            else:
                bgr = cv2.cvtColor(rgb_hwc[:, :, :3], cv2.COLOR_RGB2BGR)
                cv2.imwrite(str(crop_dir / "rgb.png"), bgr)

        logger.debug(
            "Saved crop %d artifacts for session %s", crop_index, session_id,
        )
        return crop_dir

    # ------------------------------------------------------------------
    # Read — load session back from disk
    # ------------------------------------------------------------------

    def load(self, session_id: str) -> SessionTrace:
        """Load a persisted session trace from disk."""
        from autoabsmap.generator_engine.models import RunMeta

        session_dir = self._base / session_id
        if not session_dir.is_dir():
            raise FileNotFoundError(f"Session not found: {session_dir}")

        run_meta = RunMeta(**json.loads(
            (session_dir / "run_meta.json").read_text(encoding="utf-8"),
        ))

        crops_fc = json.loads(
            (session_dir / "crops_geometry.geojson").read_text(encoding="utf-8"),
        )
        crops = [f["geometry"] for f in crops_fc.get("features", [])]

        edit_events: list[EditEvent] = []
        edit_trace_path = session_dir / "edit_trace.ndjson"
        if edit_trace_path.exists():
            for line in edit_trace_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    edit_events.append(EditEvent.model_validate_json(line))

        reprocessed_steps: list[ReprocessStep] = []
        reprocess_path = session_dir / "reprocessed_steps.ndjson"
        if reprocess_path.exists():
            for line in reprocess_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    reprocessed_steps.append(ReprocessStep.model_validate_json(line))

        final_path = session_dir / "final_output.geojson"
        final_slots = self._load_geoslots(final_path)

        baseline_slots: list[GeoSlot] = []
        baseline_path = session_dir / "baseline_merged.geojson"
        if baseline_path.exists():
            baseline_slots = self._load_geoslots(baseline_path)

        tags_data = json.loads(
            (session_dir / "difficulty_tags.json").read_text(encoding="utf-8"),
        )
        difficulty_tags = [DifficultyTag(t) for t in tags_data.get("tags", [])]
        other_note = tags_data.get("other_note")

        delta = DeltaSummary(**json.loads(
            (session_dir / "delta_summary.json").read_text(encoding="utf-8"),
        ))

        return SessionTrace(
            session_id=session_id,
            run_meta=run_meta,
            crops=crops,
            edit_events=edit_events,
            reprocessed_steps=reprocessed_steps,
            final_slots=final_slots,
            baseline_slots=baseline_slots,
            difficulty_tags=difficulty_tags,
            other_difficulty_note=other_note,
            delta=delta,
        )

    def load_crop_mask(self, session_id: str, crop_index: int) -> np.ndarray | None:
        """Load a per-crop segmentation mask (or None if not saved)."""
        mask_path = (
            self._base / session_id / "per_crop" / str(crop_index)
            / "segmentation_mask.npy"
        )
        if not mask_path.exists():
            return None
        return np.load(mask_path)

    def load_crop_rgb_path(self, session_id: str, crop_index: int) -> Path | None:
        """Return path to ``rgb.png`` for this crop if present."""
        p = self._base / session_id / "per_crop" / str(crop_index) / "rgb.png"
        return p if p.is_file() else None

    def load_crop_meta(self, session_id: str, crop_index: int) -> CropMeta | None:
        """Load per-crop raster metadata (affine, CRS, bounds)."""
        meta_path = (
            self._base / session_id / "per_crop" / str(crop_index)
            / "crop_meta.json"
        )
        if not meta_path.exists():
            return None
        return CropMeta(**json.loads(meta_path.read_text(encoding="utf-8")))

    def load_crop_slots(
        self,
        session_id: str,
        crop_index: int,
        stage: str = "post_processed",
    ) -> list[GeoSlot]:
        """Load per-crop GeoSlots (``stage`` = 'detection_raw' or 'post_processed')."""
        path = (
            self._base / session_id / "per_crop" / str(crop_index)
            / f"{stage}.geojson"
        )
        return self._load_geoslots(path)

    # ------------------------------------------------------------------
    # Enumerate sessions
    # ------------------------------------------------------------------

    def list_sessions(self) -> list[str]:
        """Return sorted session IDs that have a valid delta_summary on disk."""
        if not self._base.is_dir():
            return []
        return sorted(
            d.name
            for d in self._base.iterdir()
            if d.is_dir() and (d / "delta_summary.json").exists()
        )

    def crop_count(self, session_id: str) -> int:
        """Return the number of per-crop artifact directories for a session."""
        per_crop = self._base / session_id / "per_crop"
        if not per_crop.is_dir():
            return 0
        return sum(1 for d in per_crop.iterdir() if d.is_dir())

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_geoslots(path: Path) -> list[GeoSlot]:
        """Load a list of GeoSlots from a GeoJSON FeatureCollection file."""
        if not path.exists():
            return []
        fc = json.loads(path.read_text(encoding="utf-8"))
        return [_feature_to_geoslot(f) for f in fc.get("features", [])]

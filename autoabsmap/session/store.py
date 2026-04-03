"""SessionStore — filesystem persistence for POC, swappable for Firestore.

Stores the full session trace as a directory of JSON/NDJSON files matching
the layout documented in the architecture (sessions/{session_id}/...).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from autoabsmap.io.atomic import write_json_atomic
from autoabsmap.session.models import SessionTrace

logger = logging.getLogger(__name__)

__all__ = ["SessionStore"]


class SessionStore:
    """Filesystem-backed session persistence (POC).

    Directory layout per session matches the architecture doc:
    ``sessions/{session_id}/run_meta.json``, ``edit_trace.ndjson``, etc.
    """

    def __init__(self, base_dir: str | Path) -> None:
        self._base = Path(base_dir)

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

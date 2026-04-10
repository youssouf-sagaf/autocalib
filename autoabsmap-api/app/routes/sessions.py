"""Session endpoints — save final slots + edit trace.

POST /api/v1/sessions/{session_id}/save -> persist + forward to B2B
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from autoabsmap.generator_engine.models import RunMeta
from autoabsmap.learning_loop.models import DeltaSummary, EditEventType, SessionTrace
from app.models import SaveRequest
from app.services.session_capture import learning_session_store as session_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


def _compute_delta(request: SaveRequest) -> DeltaSummary:
    """Compute delta summary from the edit trace."""
    additions = sum(1 for e in request.edit_events if e.type == EditEventType.add)
    deletions = sum(
        1 for e in request.edit_events
        if e.type in (EditEventType.delete, EditEventType.bulk_delete)
    )
    corrections = sum(1 for e in request.edit_events if e.type == EditEventType.modify)
    reprocess_calls = sum(1 for e in request.edit_events if e.type == EditEventType.reprocess)
    align_calls = sum(1 for e in request.edit_events if e.type == EditEventType.align)

    if request.edit_events:
        timestamps = [e.timestamp for e in request.edit_events]
        operator_time = max(timestamps) - min(timestamps)
    else:
        operator_time = 0.0

    return DeltaSummary(
        additions=additions,
        deletions=deletions,
        geometric_corrections=corrections,
        reprocess_calls=reprocess_calls,
        align_calls=align_calls,
        operator_time_sec=operator_time,
    )


@router.post("/{session_id}/save")
async def save_session(session_id: str, request: SaveRequest) -> dict:
    """Persist the complete session trace and forward to B2B.

    Steps:
    1. Compute delta summary from the edit trace
    2. Build SessionTrace and persist to filesystem
    3. Forward final slots to B2B API (PUT /geography/slots) — TODO
    """
    delta = _compute_delta(request)

    trace = SessionTrace(
        session_id=session_id,
        run_meta=RunMeta(),
        crops=[],
        edit_events=request.edit_events,
        reprocessed_steps=request.reprocessed_steps,
        final_slots=request.final_slots,
        baseline_slots=request.baseline_slots,
        difficulty_tags=request.difficulty_tags,
        other_difficulty_note=request.other_difficulty_note,
        delta=delta,
    )

    session_dir = session_store.save(trace)

    # TODO: forward to B2B API
    # async with httpx.AsyncClient() as client:
    #     await client.put(
    #         f"{B2B_URL}/geography/slots",
    #         json=geoslots_to_feature_collection(request.final_slots),
    #         headers={"Authorization": f"Bearer {jwt_token}"},
    #     )

    logger.info(
        "Session %s saved: %d slots, %d edits, delta=%s",
        session_id, len(request.final_slots), len(request.edit_events),
        delta.model_dump_json(),
    )

    saved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "ok": True,
        "session_id": session_id,
        "saved_at": saved_at,
        "saved_to": str(session_dir),
        "slot_count": len(request.final_slots),
        "delta": delta.model_dump(),
    }

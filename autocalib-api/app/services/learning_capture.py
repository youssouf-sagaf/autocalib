"""Learning-loop sidecar — local SessionTrace capture, independent of B2B."""

from __future__ import annotations

import logging

from autoabsmap.generator_engine.models import RunMeta
from autoabsmap.learning_loop.models import DeltaSummary, EditEventType, SessionTrace

from app.models import SlotsSaveRequest
from app.services.session_capture import learning_session_store as session_store

logger = logging.getLogger(__name__)


def compute_delta_from_events(edit_events: list) -> DeltaSummary:
    additions = sum(1 for e in edit_events if e.type == EditEventType.add)
    deletions = sum(
        1 for e in edit_events
        if e.type in (EditEventType.delete, EditEventType.bulk_delete)
    )
    corrections = sum(1 for e in edit_events if e.type == EditEventType.modify)
    reprocess_calls = sum(1 for e in edit_events if e.type == EditEventType.reprocess)
    align_calls = sum(1 for e in edit_events if e.type == EditEventType.align)

    if edit_events:
        timestamps = [e.timestamp for e in edit_events]
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


def capture_learning_trace_from_save_request(job_id: str, request: SlotsSaveRequest) -> None:
    """Persist a SessionTrace from a synchronous slots:save payload (sidecar)."""
    if not job_id or not request.edit_events:
        return
    delta = compute_delta_from_events(request.edit_events)
    trace = SessionTrace(
        session_id=job_id,
        run_meta=RunMeta(),
        crops=[],
        edit_events=request.edit_events,
        reprocessed_steps=request.reprocessed_steps,
        final_slots=request.slots,
        baseline_slots=request.baseline_slots,
        difficulty_tags=request.difficulty_tags,
        other_difficulty_note=request.other_difficulty_note,
        delta=delta,
    )
    session_dir = session_store.save(trace)
    logger.info(
        "Learning loop sidecar saved for job %s (%d dirty slots, %d edits) → %s",
        job_id,
        len(request.slots),
        len(request.edit_events),
        session_dir,
    )

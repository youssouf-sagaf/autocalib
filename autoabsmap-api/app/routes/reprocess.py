"""Reprocess endpoint — reference slot + scope -> proposed slots.

POST /api/v1/jobs/{id}/reprocess -> reprocessing_helper
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.models import JobStatus, ReprocessRequest as APIReprocessRequest
from app.services.job_store import job_store
from autoabsmap.reprocessing_helper.models import ReprocessRequest as DomainReprocessRequest
from autoabsmap.reprocessing_helper.reprocessor import ReprocessingHelper

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/jobs", tags=["reprocess"])

_helper = ReprocessingHelper()


@router.post("/{job_id}/reprocess")
async def reprocess_area(job_id: str, request: APIReprocessRequest) -> dict:
    """Resolve reference slot from job result, delegate to ReprocessingHelper."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != JobStatus.done:
        raise HTTPException(status_code=409, detail="Job must be done before reprocessing")

    result = await job_store.get_result(job_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"No result for job {job_id}")

    ref_slot = next(
        (s for s in result.slots if s.slot_id == request.reference_slot_id),
        None,
    )
    if not ref_slot:
        raise HTTPException(
            status_code=404,
            detail=f"Slot {request.reference_slot_id} not found in job result",
        )

    domain_request = DomainReprocessRequest(
        reference_slot=ref_slot,
        scope_polygon=request.scope_polygon,
        existing_slots=result.slots,
    )

    reprocess_result = _helper.reprocess(domain_request)

    logger.info(
        "Reprocess job %s: ref=%s, %d proposed slots",
        job_id, request.reference_slot_id, len(reprocess_result.proposed_slots),
    )

    return {
        "proposed_slots": [s.model_dump() for s in reprocess_result.proposed_slots],
    }

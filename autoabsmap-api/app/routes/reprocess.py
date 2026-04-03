"""Reprocess endpoint — reference slot + scope -> proposed slots.

POST /api/v1/jobs/{id}/reprocess -> reprocessing_helper
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.models import JobStatus, ReprocessRequest
from app.services.job_store import JobStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/jobs", tags=["reprocess"])

job_store = JobStore()


@router.post("/{job_id}/reprocess")
async def reprocess_area(job_id: str, request: ReprocessRequest) -> dict:
    """Reprocessing helper — reference slot + scope -> proposed slots.

    Calls ReprocessingHelper from autoabsmap/reprocessing_helper/.
    """
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != JobStatus.done:
        raise HTTPException(status_code=409, detail="Job must be done before reprocessing")

    # TODO: integrate ReprocessingHelper once fully implemented
    from autoabsmap.reprocessing_helper.reprocessor import ReprocessingHelper
    helper = ReprocessingHelper()
    logger.info("Reprocess request for job %s, ref slot %s", job_id, request.reference_slot_id)

    return {"proposed_slots": [], "message": "ReprocessingHelper pending full implementation"}

"""Straighten endpoint — two anchor slots define the row segment to align.

POST /api/v1/jobs/{id}/straighten -> alignment_tool
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.models import JobStatus, StraightenRequest
from app.services.job_store import job_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/jobs", tags=["straighten"])


@router.post("/{job_id}/straighten")
async def straighten_row(job_id: str, request: StraightenRequest) -> dict:
    """Align every slot on the row between the two anchor centroids."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != JobStatus.done:
        raise HTTPException(status_code=409, detail="Job must be done before straightening")

    result = await job_store.get_result(job_id)
    if not result:
        raise HTTPException(status_code=500, detail="Result missing")

    from autoabsmap.alignment_tool.straightener import RowStraightener

    straightener = RowStraightener()
    corrected = straightener.straighten(
        request.slot_id_a,
        request.slot_id_b,
        result.slots,
    )

    return {"proposed_slots": [s.model_dump() for s in corrected]}

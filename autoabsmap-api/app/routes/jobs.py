"""Job endpoints — submit, poll, result, stream.

POST /api/v1/jobs           -> submit multi-crop job -> job_id
GET  /api/v1/jobs/{id}      -> poll status + progress
GET  /api/v1/jobs/{id}/result -> merged GeoJSON + per-crop detail
GET  /api/v1/jobs/{id}/stream -> SSE progress stream
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.models import (
    JobRequest,
    JobResult,
    JobStatus,
    OrchestratorProgress,
    PipelineJob,
)
from app.services.job_store import JobStore
from app.services.pipeline_service import build_orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])

job_store = JobStore()

_sse_queues: dict[str, list[asyncio.Queue]] = {}


async def _run_job(job_id: str, request: JobRequest) -> None:
    """Background task: run orchestrator and update job store."""
    queues = _sse_queues.get(job_id, [])

    def on_progress(progress: OrchestratorProgress) -> None:
        asyncio.get_event_loop().call_soon_threadsafe(
            _broadcast_progress, job_id, progress,
        )

    def _broadcast_progress(jid: str, prog: OrchestratorProgress) -> None:
        for q in _sse_queues.get(jid, []):
            q.put_nowait(prog)

    try:
        await job_store.update_progress(
            job_id,
            OrchestratorProgress(crop_index=0, crop_total=len(request.crops), stage="starting", percent=0),
        )

        orchestrator = build_orchestrator()
        result = await orchestrator.run(request.crops, job_id, on_progress)
        await job_store.mark_done(job_id, result)

        for q in _sse_queues.get(job_id, []):
            q.put_nowait(None)

    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        await job_store.mark_failed(job_id, str(exc))
        for q in _sse_queues.get(job_id, []):
            q.put_nowait(None)


@router.post("", response_model=PipelineJob)
async def submit_job(request: JobRequest, background_tasks: BackgroundTasks) -> PipelineJob:
    """Submit a multi-crop job. Returns immediately with a job_id."""
    if not request.crops:
        raise HTTPException(status_code=422, detail="At least one crop is required")

    job_id = str(uuid.uuid4())
    job = await job_store.create(job_id)

    _sse_queues[job_id] = []
    background_tasks.add_task(_run_job, job_id, request)

    logger.info("Job %s submitted with %d crops", job_id, len(request.crops))
    return job


@router.get("/{job_id}", response_model=PipelineJob)
async def get_job(job_id: str) -> PipelineJob:
    """Poll job status and current progress."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


@router.get("/{job_id}/result", response_model=JobResult)
async def get_job_result(job_id: str) -> JobResult:
    """Get merged result (only available when status=done)."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != JobStatus.done:
        raise HTTPException(status_code=409, detail=f"Job is {job.status.value}, not done")

    result = await job_store.get_result(job_id)
    if not result:
        raise HTTPException(status_code=500, detail="Result missing for completed job")
    return result


@router.get("/{job_id}/stream")
async def stream_progress(job_id: str) -> EventSourceResponse:
    """SSE stream of OrchestratorProgress events for a running job."""
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    queue: asyncio.Queue = asyncio.Queue()
    if job_id not in _sse_queues:
        _sse_queues[job_id] = []
    _sse_queues[job_id].append(queue)

    async def event_generator():
        try:
            while True:
                msg = await queue.get()
                if msg is None:
                    yield {"event": "done", "data": "{}"}
                    break
                yield {
                    "event": "progress",
                    "data": msg.model_dump_json(),
                }
        finally:
            if job_id in _sse_queues:
                _sse_queues[job_id].remove(queue)
                if not _sse_queues[job_id]:
                    del _sse_queues[job_id]

    return EventSourceResponse(event_generator())

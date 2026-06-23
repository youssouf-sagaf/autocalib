"""Calib bbox generation endpoints.

POST /api/v1/calib/jobs           -> submit calib job -> job_id
GET  /api/v1/calib/jobs/{id}      -> poll status (debug only; production uses SSE)
GET  /api/v1/calib/jobs/{id}/result -> calib bboxes when done
GET  /api/v1/calib/jobs/{id}/stream -> SSE progress stream
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse

from app.calib_models import (
    CalibJob,
    CalibJobRequest,
    CalibJobResult,
    CalibJobStatus,
    CalibProgress,
)
from app.services.calib_job_store import calib_job_store
from app.services.calib_service import build_calib_engine
from calib_gen.bbox_calib_engine.models import BBoxCalibRequest, StageProgress

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/calib/jobs", tags=["calib"])

_sse_queues: dict[str, list[asyncio.Queue]] = {}


# ── Background runner ────────────────────────────────────────────────


async def _run_calib_job(job_id: str, request: CalibJobRequest) -> None:
    """Background task: run BBoxCalibEngine and update job state."""
    loop = asyncio.get_running_loop()

    def on_progress(sp: StageProgress) -> None:
        loop.call_soon_threadsafe(_broadcast_progress, job_id, sp)

    def _broadcast_progress(jid: str, sp: StageProgress) -> None:
        progress = CalibProgress(stage=sp.stage, percent=sp.percent)
        calib_job_store.update_sync(
            jid,
            status=CalibJobStatus.running,
            progress=progress,
        )
        for q in _sse_queues.get(jid, []):
            q.put_nowait(progress)

    try:
        logger.info("Calib job %s starting for device %s", job_id, request.device_id)

        engine = build_calib_engine()
        engine_request = BBoxCalibRequest(
            device_id=request.device_id,
            client=request.client,
            target_date=request.target_date,
            confidence_threshold=request.confidence_threshold,
            top_n_frames=request.top_n_frames,
        )

        result = await asyncio.to_thread(engine.run, engine_request, on_progress)

        job_result = CalibJobResult(
            job_id=job_id,
            device_id=result.device_id,
            calib_bboxes=result.calib_bboxes,
            frame_count=result.frame_count,
            total_detections=result.total_detections,
        )

        await calib_job_store.mark_done(
            job_id,
            job_result,
            [Path(p) for p in result.selected_frame_paths],
        )

        logger.info(
            "Calib job %s done — %d bboxes from %d frames",
            job_id,
            len(result.calib_bboxes),
            result.frame_count,
        )

        for q in _sse_queues.get(job_id, []):
            q.put_nowait(None)

    except Exception as exc:
        logger.exception("Calib job %s FAILED: %s", job_id, exc)
        await calib_job_store.mark_failed(job_id, str(exc))
        for q in _sse_queues.get(job_id, []):
            q.put_nowait("__FAILED__")


# ── Endpoints ────────────────────────────────────────────────────────


@router.post("", response_model=CalibJob)
async def submit_calib_job(
    request: CalibJobRequest,
    background_tasks: BackgroundTasks,
) -> CalibJob:
    """Submit a calib bbox generation job. Returns immediately with a job_id."""
    job_id = str(uuid.uuid4())

    job = await calib_job_store.create(job_id)

    _sse_queues[job_id] = []
    background_tasks.add_task(_run_calib_job, job_id, request)

    logger.info("Calib job %s submitted for device %s", job_id, request.device_id)
    return job


@router.get("/{job_id}", response_model=CalibJob)
async def get_calib_job(job_id: str) -> CalibJob:
    """Poll calib job status (debug / manual inspection only).

    The operator UI uses ``GET …/stream`` (SSE). Keep this route for scripts and
    troubleshooting when SSE is unavailable.
    """
    job = await calib_job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Calib job {job_id} not found")
    return job


@router.get("/{job_id}/result", response_model=CalibJobResult)
async def get_calib_job_result(job_id: str) -> CalibJobResult:
    """Get calib bboxes (only available when status=done)."""
    job = await calib_job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Calib job {job_id} not found")
    if job.status != CalibJobStatus.done:
        raise HTTPException(
            status_code=409,
            detail=f"Job is {job.status.value}, not done",
        )
    result = await calib_job_store.get_result(job_id)
    if not result:
        raise HTTPException(status_code=500, detail="Result missing for completed job")
    return result


@router.get("/{job_id}/stream")
async def stream_calib_progress(job_id: str) -> EventSourceResponse:
    """SSE stream of CalibProgress events for a running calib job."""
    job = await calib_job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Calib job {job_id} not found")

    queue: asyncio.Queue = asyncio.Queue()
    if job_id not in _sse_queues:
        _sse_queues[job_id] = []
    _sse_queues[job_id].append(queue)

    async def event_generator():
        try:
            current = await calib_job_store.get(job_id)
            if current and current.status == CalibJobStatus.done:
                yield {"event": "done", "data": "{}"}
                return
            if current and current.status == CalibJobStatus.failed:
                error_msg = current.error or "Pipeline failed"
                yield {"event": "failed", "data": error_msg}
                return

            while True:
                msg = await queue.get()
                if msg is None:
                    yield {"event": "done", "data": "{}"}
                    break
                if msg == "__FAILED__":
                    j = await calib_job_store.get(job_id)
                    error_msg = (j.error if j else None) or "Pipeline failed"
                    yield {"event": "failed", "data": error_msg}
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


@router.get("/{job_id}/frames/{frame_index}")
async def get_calib_frame(job_id: str, frame_index: int) -> FileResponse:
    """Serve a selected frame image by index (0-based)."""
    paths = calib_job_store.get_frame_paths(job_id)
    if not paths:
        raise HTTPException(status_code=404, detail=f"No frames for job {job_id}")
    if frame_index < 0 or frame_index >= len(paths):
        raise HTTPException(
            status_code=404,
            detail=f"Frame index {frame_index} out of range (0..{len(paths) - 1})",
        )
    path = paths[frame_index]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Frame file not found on disk")
    return FileResponse(path, media_type="image/jpeg")

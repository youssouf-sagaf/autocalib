"""In-memory job store for POC — swappable to Redis / Firestore.

Thread-safe via asyncio lock (single-process FastAPI with uvicorn).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.models import JobResult, JobStatus, OrchestratorProgress, PipelineJob

logger = logging.getLogger(__name__)

__all__ = ["JobStore"]


class JobStore:
    """In-memory dict-backed job store.

    Sufficient for the POC (single-process, no persistence across restarts).
    Swap to Redis or Firestore for production.
    """

    def __init__(self) -> None:
        self._jobs: dict[str, PipelineJob] = {}
        self._results: dict[str, JobResult] = {}
        self._lock = asyncio.Lock()

    async def create(self, job_id: str) -> PipelineJob:
        async with self._lock:
            job = PipelineJob(id=job_id, status=JobStatus.pending)
            self._jobs[job_id] = job
            return job

    async def get(self, job_id: str) -> PipelineJob | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def update_progress(self, job_id: str, progress: OrchestratorProgress) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                self._jobs[job_id] = job.model_copy(
                    update={"status": JobStatus.running, "progress": progress},
                )

    async def mark_done(self, job_id: str, result: JobResult) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                self._jobs[job_id] = job.model_copy(
                    update={"status": JobStatus.done, "progress": None},
                )
            self._results[job_id] = result

    async def mark_failed(self, job_id: str, error: str) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                self._jobs[job_id] = job.model_copy(
                    update={"status": JobStatus.failed, "error": error},
                )

    async def get_result(self, job_id: str) -> JobResult | None:
        async with self._lock:
            return self._results.get(job_id)


job_store = JobStore()

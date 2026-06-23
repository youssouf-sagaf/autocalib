"""In-memory calib job store — mirrors :mod:`job_store` for bbox calib jobs."""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.calib_models import CalibJob, CalibJobResult, CalibJobStatus, CalibProgress

__all__ = ["CalibJobStore", "calib_job_store"]


class CalibJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, CalibJob] = {}
        self._results: dict[str, CalibJobResult] = {}
        self._frame_paths: dict[str, list[Path]] = {}
        self._lock = asyncio.Lock()

    async def create(self, job_id: str) -> CalibJob:
        async with self._lock:
            job = CalibJob(id=job_id, status=CalibJobStatus.pending)
            self._jobs[job_id] = job
            return job

    async def get(self, job_id: str) -> CalibJob | None:
        async with self._lock:
            return self._jobs.get(job_id)

    def update_sync(self, job_id: str, **updates) -> None:
        """Thread-safe sync update (worker thread via ``call_soon_threadsafe``)."""
        job = self._jobs.get(job_id)
        if job:
            self._jobs[job_id] = job.model_copy(update=updates)

    async def mark_done(
        self,
        job_id: str,
        result: CalibJobResult,
        frame_paths: list[Path],
    ) -> None:
        async with self._lock:
            self._results[job_id] = result
            self._frame_paths[job_id] = frame_paths
            job = self._jobs.get(job_id)
            if job:
                self._jobs[job_id] = job.model_copy(
                    update={"status": CalibJobStatus.done, "progress": None},
                )

    async def mark_failed(self, job_id: str, error: str) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                self._jobs[job_id] = job.model_copy(
                    update={"status": CalibJobStatus.failed, "error": error},
                )

    async def get_result(self, job_id: str) -> CalibJobResult | None:
        async with self._lock:
            return self._results.get(job_id)

    def get_frame_paths(self, job_id: str) -> list[Path] | None:
        return self._frame_paths.get(job_id)


calib_job_store = CalibJobStore()

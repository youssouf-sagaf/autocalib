"""FastAPI application — thin wrapper over absmap.pipeline.

No ML logic here — only job lifecycle, SSE streaming, and CORS.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import jobs, sessions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
)

app = FastAPI(
    title="absmap-api",
    description="Parking slot extraction pipeline — FastAPI standalone service",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(sessions.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}

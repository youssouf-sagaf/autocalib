"""FastAPI application — thin wrapper over autoabsmap service engines.

No ML logic here — only job lifecycle, SSE streaming, and CORS.
In Docker, also serves the frontend static build at /.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routes import jobs, reprocess, straighten, sessions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
)

app = FastAPI(
    title="autoabsmap-api",
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
app.include_router(reprocess.router)
app.include_router(straighten.router)
app.include_router(sessions.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# Serve the Vite-built frontend if the dist/ folder exists (Docker build).
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "static"

if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """Catch-all: serve index.html for any non-API route (SPA routing)."""
        if full_path.startswith("api/") or full_path.startswith("health"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        file = FRONTEND_DIR / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND_DIR / "index.html")

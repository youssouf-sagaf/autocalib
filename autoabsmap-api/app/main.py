"""FastAPI application — thin wrapper over autoabsmap service engines.

No ML logic here — only job lifecycle, SSE streaming, and CORS.
In Docker, also serves the frontend static build at /.
"""

from __future__ import annotations

import logging
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routes import jobs, logs, reprocess, straighten, sessions

# ── Logging setup: console + file handlers ──

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s — %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATE_FORMAT)

def _add_file_handler(logger_name: str | None, filename: str, level: int = logging.DEBUG) -> None:
    handler = RotatingFileHandler(LOG_DIR / filename, maxBytes=5_000_000, backupCount=3)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT))
    logging.getLogger(logger_name).addHandler(handler)

_add_file_handler(None, "backend.log")
_add_file_handler("app.requests", "requests.log")

front_logger = logging.getLogger("app.frontend")
front_logger.propagate = False
_add_file_handler("app.frontend", "front.log", level=logging.DEBUG)

req_logger = logging.getLogger("app.requests")

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

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every HTTP request with method, path, status, and duration."""
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    req_logger.info(
        "%s %s → %d (%.0fms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


app.include_router(jobs.router)
app.include_router(reprocess.router)
app.include_router(straighten.router)
app.include_router(sessions.router)
app.include_router(logs.router)


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

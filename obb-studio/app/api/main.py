"""FastAPI entrypoint for OBB Studio."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.deps import get_cached_settings, get_store
from app.training.constants import yolo_model_display_name
from app.api.routes import (
    annotations,
    crops,
    datasets,
    evaluations,
    tiles,
    training,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_store()
    yield


def create_app() -> FastAPI:
    settings = get_cached_settings()
    app = FastAPI(title="OBB Studio API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(tiles.router, prefix="/api")
    app.include_router(crops.router, prefix="/api")
    app.include_router(annotations.router, prefix="/api")
    app.include_router(datasets.router, prefix="/api")
    app.include_router(training.router, prefix="/api")
    app.include_router(evaluations.router, prefix="/api")

    data_dir = settings.resolve_data_dir()

    @app.get("/static/{file_path:path}")
    def serve_data_file(file_path: str):
        if ".." in file_path or file_path.endswith(".db"):
            raise HTTPException(status_code=404, detail="Not found")
        target = (data_dir / file_path).resolve()
        if not str(target).startswith(str(data_dir.resolve())):
            raise HTTPException(status_code=404, detail="Not found")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(target)

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "data_dir": str(data_dir),
            "default_yolo_model": settings.default_yolo_model,
            "default_yolo_model_label": yolo_model_display_name(settings.default_yolo_model),
        }

    return app


app = create_app()


def main() -> None:
    import uvicorn

    settings = get_cached_settings()
    uvicorn.run(
        "app.api.main:app",
        host="0.0.0.0",
        port=settings.api_port,
        reload=False,
    )


if __name__ == "__main__":
    main()

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import get_cached_settings, get_store
from app.dataset.store import DatasetStore
from app.training.metrics_stream import latest_metrics, tail_results_csv
from app.training.registry import allocate_run_dir, results_csv_path
from app.training.runner import start_training_run

router = APIRouter(prefix="/training", tags=["training"])


class StartTrainingBody(BaseModel):
    data_yaml: str
    name: str | None = None
    model: str | None = None
    epochs: int = Field(default=50, ge=1)
    imgsz: int = 1024
    batch: int = 8
    device: str = ""


@router.get("/runs")
def list_runs(store: DatasetStore = Depends(get_store)):
    return store.list_runs()


@router.post("/runs")
def start_run(body: StartTrainingBody, store: DatasetStore = Depends(get_store)):
    settings = get_cached_settings()
    data_dir = settings.resolve_data_dir()
    data_yaml = Path(body.data_yaml)
    if not data_yaml.is_file():
        raise HTTPException(status_code=400, detail=f"data.yaml not found: {data_yaml}")

    config = body.model_dump()
    config["model"] = config.get("model") or settings.default_yolo_model

    run_dir = allocate_run_dir(data_dir, body.name)
    row = store.create_run(str(run_dir), config)
    start_training_run(row["id"], run_dir, data_yaml, store, config=config)
    return row


@router.get("/runs/{run_id}/metrics/latest")
def metrics_latest(run_id: str, store: DatasetStore = Depends(get_store)):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    csv_path = results_csv_path(Path(run["run_dir"]))
    m = latest_metrics(csv_path)
    return {"run_id": run_id, "metrics": m}


@router.get("/runs/{run_id}/metrics/stream")
def metrics_stream(run_id: str, store: DatasetStore = Depends(get_store)):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    csv_path = results_csv_path(Path(run["run_dir"]))

    def event_gen():
        for row in tail_results_csv(csv_path):
            store.insert_run_metric(
                run_id,
                metric_name="epoch_row",
                value=float(row.get("epoch", row.get("train/epoch", 0)) or 0),
                step=int(row.get("epoch", 0) or 0),
            )
            yield f"data: {json.dumps(row)}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")

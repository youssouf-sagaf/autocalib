"""Background Ultralytics YOLO training subprocess."""

from __future__ import annotations

import logging
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Callable

from app.dataset.store import DatasetStore
from app.training.constants import DEFAULT_YOLO_OBB_MODEL
from app.training.registry import rename_best_weights_with_timestamp, write_run_config

logger = logging.getLogger(__name__)


def _build_train_cmd(data_yaml: Path, run_dir: Path, overrides: dict[str, Any]) -> list[str]:
    model = str(overrides.get("model", DEFAULT_YOLO_OBB_MODEL))
    epochs = int(overrides.get("epochs", 50))
    imgsz = int(overrides.get("imgsz", 1024))
    batch = int(overrides.get("batch", 8))
    device = str(overrides.get("device", ""))

    script = f"""
from ultralytics import YOLO
m = YOLO({model!r})
kwargs = {{
    "data": {str(data_yaml)!r},
    "project": {str(run_dir.parent)!r},
    "name": {run_dir.name!r},
    "epochs": {epochs},
    "imgsz": {imgsz},
    "batch": {batch},
    "exist_ok": True,
}}
if {device!r}:
    kwargs["device"] = {device!r}
m.train(**kwargs)
"""
    return [sys.executable, "-c", script.strip()]


def start_training_run(
    run_id: str,
    run_dir: Path,
    data_yaml: Path,
    store: DatasetStore,
    config: dict[str, Any] | None = None,
    on_exit: Callable[[int], None] | None = None,
) -> threading.Thread:
    """Launch ``YOLO.train`` in a daemon thread; update run status in SQLite."""
    config = config or {}
    write_run_config(run_dir, config)
    store.update_run_status(run_id, "running")

    cmd = _build_train_cmd(data_yaml, run_dir, config)

    def _worker() -> None:
        logger.info("Starting training run %s", run_id)
        try:
            proc = subprocess.run(cmd, cwd=str(run_dir.parent), capture_output=True, text=True)
            if proc.returncode == 0:
                renamed = rename_best_weights_with_timestamp(run_dir)
                if renamed:
                    logger.info("Best weights saved as %s", renamed)
                store.update_run_status(run_id, "completed")
            else:
                store.update_run_status(run_id, "failed")
                logger.error("Training failed: %s", proc.stderr[-2000:])
            if on_exit:
                on_exit(proc.returncode)
        except Exception:
            store.update_run_status(run_id, "failed")
            logger.exception("Training thread crashed for run %s", run_id)
            if on_exit:
                on_exit(-1)

    thread = threading.Thread(target=_worker, name=f"yolo-train-{run_id[:8]}", daemon=True)
    thread.start()
    return thread

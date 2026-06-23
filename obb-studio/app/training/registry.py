"""Training run directory management."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def runs_root(data_dir: Path) -> Path:
    root = data_dir / "runs"
    root.mkdir(parents=True, exist_ok=True)
    return root


def allocate_run_dir(data_dir: Path, name: str | None = None) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    slug = name or "train"
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in slug)[:48]
    run_dir = runs_root(data_dir) / f"{stamp}_{safe}"
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "config.snapshot.json").write_text("{}", encoding="utf-8")
    return run_dir


def write_run_config(run_dir: Path, config: dict[str, Any]) -> None:
    path = run_dir / "config.snapshot.json"
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def results_csv_path(run_dir: Path) -> Path:
    # Ultralytics writes under train/weights/../results.csv or project/name/
    candidates = [
        run_dir / "results.csv",
        run_dir / "train" / "results.csv",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]


def find_best_weights(run_dir: Path) -> Path | None:
    """Return Ultralytics ``best.pt`` if present under a known run layout."""
    for candidate in (
        run_dir / "weights" / "best.pt",
        run_dir / "train" / "weights" / "best.pt",
    ):
        if candidate.is_file():
            return candidate
    return None


def rename_best_weights_with_timestamp(run_dir: Path) -> Path | None:
    """Rename ``best.pt`` to ``best_{UTC timestamp}.pt`` in the same directory."""
    best = find_best_weights(run_dir)
    if best is None:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = best.with_name(f"best_{stamp}.pt")
    best.rename(dest)
    return dest

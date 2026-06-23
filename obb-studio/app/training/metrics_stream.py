"""Tail Ultralytics results.csv and expose metrics for SSE streaming."""

from __future__ import annotations

import csv
import time
from pathlib import Path
from typing import Any, Iterator


def _parse_row(row: dict[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        key = k.strip()
        if not key:
            continue
        try:
            out[key] = float(v)
        except (TypeError, ValueError):
            out[key] = v
    return out


def tail_results_csv(
    csv_path: Path,
    *,
    poll_interval_s: float = 1.0,
    from_start: bool = False,
) -> Iterator[dict[str, Any]]:
    """Yield new metric rows as they appear in *csv_path*."""
    last_size = 0
    header: list[str] | None = None
    seen_rows = 0

    while True:
        if not csv_path.is_file():
            time.sleep(poll_interval_s)
            continue

        text = csv_path.read_text(encoding="utf-8", errors="replace")
        if not text.strip():
            time.sleep(poll_interval_s)
            continue

        lines = text.strip().splitlines()
        reader = csv.DictReader(lines)
        if reader.fieldnames:
            header = list(reader.fieldnames)
        rows = list(csv.DictReader(lines, fieldnames=header)) if header else []
        # Skip duplicate header row DictReader may include
        data_rows = [r for r in rows if r.get(header[0] if header else "") != (header[0] if header else "")]

        if from_start:
            start_idx = 0
        else:
            start_idx = seen_rows

        for row in data_rows[start_idx:]:
            parsed = _parse_row({k: (v or "") for k, v in row.items() if k})
            if parsed:
                yield parsed
        seen_rows = len(data_rows)
        last_size = csv_path.stat().st_size
        time.sleep(poll_interval_s)
        if csv_path.stat().st_size == last_size and seen_rows == len(data_rows):
            # still allow loop for long runs
            continue


def latest_metrics(csv_path: Path) -> dict[str, Any] | None:
    if not csv_path.is_file():
        return None
    lines = csv_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()
    if len(lines) < 2:
        return None
    reader = csv.DictReader(lines)
    rows = list(reader)
    if not rows:
        return None
    return _parse_row({k: (v or "") for k, v in rows[-1].items() if k})

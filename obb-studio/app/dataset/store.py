"""SQLite persistence for tiles, annotations, datasets, and training runs."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DatasetStore:
    """Lightweight SQLite store for OBB Studio artifacts."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS tiles (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    offset_x INTEGER NOT NULL DEFAULT 0,
                    offset_y INTEGER NOT NULL DEFAULT 0,
                    width_px INTEGER NOT NULL,
                    height_px INTEGER NOT NULL,
                    image_path TEXT NOT NULL,
                    meta_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_tiles_session ON tiles(session_id);

                CREATE TABLE IF NOT EXISTS annotations (
                    tile_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (tile_id) REFERENCES tiles(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS tile_flags (
                    tile_id TEXT NOT NULL,
                    flag TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tile_id, flag),
                    FOREIGN KEY (tile_id) REFERENCES tiles(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    export_path TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS dataset_tiles (
                    dataset_id TEXT NOT NULL,
                    tile_id TEXT NOT NULL,
                    PRIMARY KEY (dataset_id, tile_id),
                    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE,
                    FOREIGN KEY (tile_id) REFERENCES tiles(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    config_json TEXT NOT NULL DEFAULT '{}',
                    run_dir TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS run_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    step INTEGER,
                    metric_name TEXT NOT NULL,
                    value REAL NOT NULL,
                    recorded_at TEXT NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_run_metrics_run ON run_metrics(run_id);
                """
            )

    def create_tile(
        self,
        *,
        session_id: str,
        source: str,
        width_px: int,
        height_px: int,
        image_path: str,
        offset_x: int = 0,
        offset_y: int = 0,
        meta: dict[str, Any] | None = None,
        tile_id: str | None = None,
    ) -> dict[str, Any]:
        tid = tile_id or str(uuid.uuid4())
        row = {
            "id": tid,
            "session_id": session_id,
            "source": source,
            "offset_x": offset_x,
            "offset_y": offset_y,
            "width_px": width_px,
            "height_px": height_px,
            "image_path": image_path,
            "meta_json": json.dumps(meta or {}),
            "created_at": _utc_now(),
        }
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO tiles (
                    id, session_id, source, offset_x, offset_y,
                    width_px, height_px, image_path, meta_json, created_at
                ) VALUES (
                    :id, :session_id, :source, :offset_x, :offset_y,
                    :width_px, :height_px, :image_path, :meta_json, :created_at
                )
                """,
                row,
            )
        return self.get_tile(tid) or row

    def list_tiles(self, session_id: str | None = None) -> list[dict[str, Any]]:
        with self._conn() as conn:
            if session_id:
                cur = conn.execute(
                    "SELECT * FROM tiles WHERE session_id = ? ORDER BY created_at",
                    (session_id,),
                )
            else:
                cur = conn.execute("SELECT * FROM tiles ORDER BY created_at DESC")
            return [dict(r) for r in cur.fetchall()]

    def get_tile(self, tile_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            cur = conn.execute("SELECT * FROM tiles WHERE id = ?", (tile_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def upsert_annotations(self, tile_id: str, annotations: list[dict[str, Any]]) -> None:
        payload = json.dumps(annotations)
        now = _utc_now()
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO annotations (tile_id, payload_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(tile_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (tile_id, payload, now),
            )

    def get_annotations(self, tile_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            cur = conn.execute(
                "SELECT payload_json FROM annotations WHERE tile_id = ?",
                (tile_id,),
            )
            row = cur.fetchone()
            if not row:
                return []
            return json.loads(row["payload_json"])

    def set_tile_flag(self, tile_id: str, flag: str, value: str) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO tile_flags (tile_id, flag, value, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tile_id, flag) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (tile_id, flag, value, _utc_now()),
            )

    def get_tile_flags(self, tile_id: str) -> dict[str, str]:
        with self._conn() as conn:
            cur = conn.execute(
                "SELECT flag, value FROM tile_flags WHERE tile_id = ?",
                (tile_id,),
            )
            return {r["flag"]: r["value"] for r in cur.fetchall()}

    def create_dataset(self, name: str, tile_ids: list[str], export_path: str | None = None) -> dict[str, Any]:
        did = str(uuid.uuid4())
        created = _utc_now()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO datasets (id, name, export_path, created_at) VALUES (?, ?, ?, ?)",
                (did, name, export_path, created),
            )
            conn.executemany(
                "INSERT INTO dataset_tiles (dataset_id, tile_id) VALUES (?, ?)",
                [(did, tid) for tid in tile_ids],
            )
        return {"id": did, "name": name, "export_path": export_path, "created_at": created, "tile_ids": tile_ids}

    def list_datasets(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            cur = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC")
            out: list[dict[str, Any]] = []
            for row in cur.fetchall():
                d = dict(row)
                tcur = conn.execute(
                    "SELECT tile_id FROM dataset_tiles WHERE dataset_id = ?",
                    (d["id"],),
                )
                d["tile_ids"] = [r["tile_id"] for r in tcur.fetchall()]
                out.append(d)
            return out

    def create_run(self, run_dir: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
        rid = str(uuid.uuid4())
        now = _utc_now()
        cfg = json.dumps(config or {})
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO runs (id, status, config_json, run_dir, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (rid, "pending", cfg, run_dir, now, now),
            )
        return self.get_run(rid) or {"id": rid, "status": "pending", "run_dir": run_dir}

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            cur = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def update_run_status(self, run_id: str, status: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE runs SET status = ?, updated_at = ? WHERE id = ?",
                (status, _utc_now(), run_id),
            )

    def insert_run_metric(
        self,
        run_id: str,
        metric_name: str,
        value: float,
        step: int | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO run_metrics (run_id, step, metric_name, value, recorded_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (run_id, step, metric_name, value, _utc_now()),
            )

    def list_runs(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            cur = conn.execute("SELECT * FROM runs ORDER BY created_at DESC")
            return [dict(r) for r in cur.fetchall()]


    def set_dataset_export_path(self, dataset_id: str, export_path: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE datasets SET export_path = ? WHERE id = ?",
                (export_path, dataset_id),
            )

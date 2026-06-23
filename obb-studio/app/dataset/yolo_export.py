"""Export dataset snapshots to YOLO-OBB directory layout."""

from __future__ import annotations

import json
import random
import shutil
from pathlib import Path
from typing import Any

from app.annotations.models import ObbAnnotation
from app.config.settings import Settings, get_settings
from app.dataset.store import DatasetStore


def _split_sessions(session_ids: list[str], train_ratio: float, seed: int) -> tuple[set[str], set[str]]:
    rng = random.Random(seed)
    ids = list(dict.fromkeys(session_ids))
    rng.shuffle(ids)
    if not ids:
        return set(), set()
    if len(ids) == 1:
        return {ids[0]}, {ids[0]}
    k = int(len(ids) * train_ratio)
    k = max(1, min(k, len(ids) - 1))
    return set(ids[:k]), set(ids[k:])


def export_yolo_obb_snapshot(
    dataset_id: str,
    out_root: Path | None = None,
    *,
    settings: Settings | None = None,
    store: DatasetStore | None = None,
) -> dict[str, Any]:
    """Write train/val YOLO-OBB layout; background tiles get empty label files."""
    settings = settings or get_settings()
    data_dir = settings.resolve_data_dir()
    store = store or DatasetStore(data_dir / "obb_studio.db")
    store.init_db()

    datasets = [d for d in store.list_datasets() if d["id"] == dataset_id]
    if not datasets:
        raise ValueError(f"Dataset not found: {dataset_id}")
    ds = datasets[0]
    tile_ids: list[str] = ds.get("tile_ids") or []

    tiles = [store.get_tile(tid) for tid in tile_ids]
    tiles = [t for t in tiles if t is not None]
    session_ids = [t["session_id"] for t in tiles]
    train_sess, val_sess = _split_sessions(session_ids, settings.train_val_ratio, settings.train_val_seed)

    out_root = out_root or (data_dir / "exports" / dataset_id / "yolo_pack")
    for split in ("train", "val"):
        (out_root / split / "images").mkdir(parents=True, exist_ok=True)
        (out_root / split / "labels").mkdir(parents=True, exist_ok=True)

    counts = {"train_images": 0, "val_images": 0}
    manifest: list[dict[str, Any]] = []

    for tile in tiles:
        sid = tile["session_id"]
        in_train = sid in train_sess
        in_val = sid in val_sess
        splits = [s for s, ok in (("train", in_train), ("val", in_val)) if ok]
        if not splits:
            continue

        stem = f"{sid.replace('/', '_')}_{tile['id'][:8]}"
        src_img = data_dir / tile["image_path"]
        flags = store.get_tile_flags(tile["id"])
        is_background = flags.get("background") == "true"
        lines: list[str] = []
        if not is_background:
            raw_anns = store.get_annotations(tile["id"])
            for raw in raw_anns:
                ann = ObbAnnotation.model_validate(raw)
                ann.class_id = 0
                lines.append(ann.to_yolo_obb_line(tile["width_px"], tile["height_px"]))

        for split in splits:
            dest_img = out_root / split / "images" / f"{stem}.png"
            dest_lbl = out_root / split / "labels" / f"{stem}.txt"
            shutil.copy2(src_img, dest_img)
            dest_lbl.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
            counts[f"{split}_images"] += 1

        manifest.append({
            "stem": stem,
            "tile_id": tile["id"],
            "session_id": sid,
            "split": "+".join(splits),
            "num_boxes": len(lines),
        })

    data_yaml = (
        f"path: {out_root.resolve()}\n"
        "train: train/images\n"
        "val: val/images\n"
        "\n"
        "nc: 1\n"
        "names:\n"
        "  0: vehicle\n"
    )
    (out_root / "data.yaml").write_text(data_yaml, encoding="utf-8")
    report = {"yolo": counts, "manifest": manifest, "export_path": str(out_root)}
    (out_root / "export_manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    store.set_dataset_export_path(dataset_id, str(out_root))
    return report

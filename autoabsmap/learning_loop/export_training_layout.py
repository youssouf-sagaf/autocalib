"""Export captured sessions to Colab-style dataset layouts (SegFormer + YOLO OBB).

Run manually after sessions exist under ``SessionStore`` root, e.g.::

    python -m autoabsmap.learning_loop.export_training_layout \\
        --sessions-root ./sessions --out ./export_run --task both

Requires per-crop ``rgb.png`` (written by the API orchestrator after each tile).
Pseudo masks are generated via :class:`DatasetBuilder` when missing.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import random
import shutil
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from autoabsmap.export.models import GeoSlot, SlotStatus
from autoabsmap.io.atomic import write_json_atomic
from autoabsmap.learning_loop.capture import SessionStore
from autoabsmap.learning_loop.dataset_builder import DatasetBuilder, _wgs84_to_pixel

logger = logging.getLogger(__name__)


def _discover_sessions(store: SessionStore, require_rgb: bool) -> list[Path]:
    """Return sessions that are eligible for training-layout export.

    Gates on ``delta_summary.json`` so the export set matches
    :meth:`SessionStore.list_sessions` and every discovered session is
    guaranteed to ``load()`` cleanly (#15).  Without this gate the SegFormer
    branch would silently emit half-processed sessions that the YOLO branch
    rejects, producing inconsistent train/val layouts.
    """
    base: Path = store._base
    if not base.is_dir():
        return []
    out: list[Path] = []
    for d in sorted(base.iterdir()):
        if not d.is_dir():
            continue
        sid = d.name
        if not (d / "delta_summary.json").exists():
            continue  # not a fully saved session — skip (#15)
        n = store.crop_count(sid)
        if n == 0:
            continue
        if require_rgb and not any(store.load_crop_rgb_path(sid, i) for i in range(n)):
            continue
        out.append(d)
    return out


def _split_sessions(
    session_dirs: list[Path],
    train_ratio: float,
    seed: int,
) -> tuple[list[Path], list[Path]]:
    """Deterministic train/val split by session.

    Single-session case (#16): duplicates the sole session into both splits
    and logs a loud warning about the expected train/val leakage.  This keeps
    the Colab layout usable for smoke runs instead of silently emitting an
    empty val set.
    """
    rng = random.Random(seed)
    paths = list(session_dirs)
    rng.shuffle(paths)
    if not paths:
        return [], []
    if len(paths) == 1:
        logger.warning(
            "Only one session available — duplicating it into both train and "
            "val splits for smoke-run usability. Train/val leakage is expected; "
            "do not interpret val metrics as generalisation.",
        )
        return paths, paths
    k = int(len(paths) * train_ratio)
    k = max(1, min(k, len(paths) - 1))
    return paths[:k], paths[k:]


def _safe_stem(session_id: str, crop_index: int) -> str:
    return f"{session_id.replace('/', '_').replace(' ', '_')}_c{crop_index}"


def _mask_to_png_u8(arr: np.ndarray) -> np.ndarray:
    if arr.ndim != 2:
        raise ValueError(f"mask must be 2D, got {arr.shape}")
    return (arr > 127).astype(np.uint8) * 255


def _slot_status_to_yolo_class(slot: GeoSlot) -> int:
    """Map a GeoSlot status to a YOLO-OBB class id.

    Two-class mapping (#14): ``occupied`` → ``1``, everything else → ``0``
    (``empty_slot``).  ``SlotStatus.unknown`` is intentionally collapsed into
    ``empty_slot`` per current product decision — if the classifier starts
    mis-labelling these in practice, revisit by either (a) skipping
    ``unknown`` here or (b) introducing a third class in ``data.yaml``.
    """
    if slot.status == SlotStatus.occupied:
        return 1
    return 0


# Tolerance for rounding / edge-touching when normalising OBB corners (#13).
_OBB_NORMALIZE_TOL = 1e-3


def _slot_polygon_normalized_obb(
    slot: GeoSlot,
    meta: Any,
    width: int,
    height: int,
) -> list[float] | None:
    """Return 4-corner normalised OBB coordinates, or ``None`` to drop the slot.

    Drops (returns ``None``) any slot whose corners fall outside ``[0, 1]``
    beyond a small rounding tolerance (#13).  YOLO-OBB trainers silently
    misinterpret out-of-range coordinates, so it is safer to discard the
    label entirely than to clamp or leak bad supervision.
    """
    ring = slot.polygon.coordinates[0]
    normed: list[float] = []
    for coord in ring[:4]:
        lng, lat = float(coord[0]), float(coord[1])
        px, py = _wgs84_to_pixel(lng, lat, meta)
        if px is None:
            return None
        col_f = px / max(width, 1)
        row_f = py / max(height, 1)
        if (
            col_f < -_OBB_NORMALIZE_TOL
            or col_f > 1.0 + _OBB_NORMALIZE_TOL
            or row_f < -_OBB_NORMALIZE_TOL
            or row_f > 1.0 + _OBB_NORMALIZE_TOL
        ):
            return None  # corner outside image — drop the slot (#13)
        # Clamp the remaining epsilon so YOLO sees strictly [0, 1].
        col_f = min(1.0, max(0.0, col_f))
        row_f = min(1.0, max(0.0, row_f))
        normed.extend([col_f, row_f])
    return normed


def _slots_in_crop(
    slots: list[GeoSlot],
    meta: Any,
) -> list[GeoSlot]:
    out: list[GeoSlot] = []
    for s in slots:
        px, py = _wgs84_to_pixel(s.center.lng, s.center.lat, meta)
        if px is None:
            continue
        if 0 <= px < meta.image_width and 0 <= py < meta.image_height:
            out.append(s)
    return out


def export_segformer_layout(
    store: SessionStore,
    builder: DatasetBuilder,
    session_dirs: list[Path],
    out_root: Path,
    train_ratio: float,
    seed: int,
) -> dict[str, Any]:
    train_sess, val_sess = _split_sessions(session_dirs, train_ratio, seed)
    train_set = set(train_sess)
    val_set = set(val_sess)

    seg_set = builder.build_segmentation_dataset(session_dirs)
    logger.info(
        "SegFormer: dataset builder produced %d segmentation samples (pseudo masks on disk)",
        len(seg_set.samples),
    )

    images_dir = out_root / "images"
    masks_dir = out_root / "masks"
    images_dir.mkdir(parents=True, exist_ok=True)
    masks_dir.mkdir(parents=True, exist_ok=True)

    train_ids: list[str] = []
    val_ids: list[str] = []
    manifest_rows: list[dict[str, Any]] = []

    for session_dir in session_dirs:
        sid = session_dir.name
        in_train = session_dir in train_set
        in_val = session_dir in val_set
        n = store.crop_count(sid)
        for i in range(n):
            rgb_path = store.load_crop_rgb_path(sid, i)
            if rgb_path is None:
                continue
            meta = store.load_crop_meta(sid, i)
            if meta is None:
                continue
            crop_dir = store._base / sid / "per_crop" / str(i)
            pseudo_p = crop_dir / "pseudo_mask.npy"
            seg_p = crop_dir / "segmentation_mask.npy"

            if pseudo_p.exists():
                mask_arr = np.load(pseudo_p)
                mask_kind = "pseudo_mask"
            elif seg_p.exists():
                mask_arr = np.load(seg_p)
                mask_kind = "segmentation_mask"
            else:
                continue

            stem = _safe_stem(sid, i)
            img_dest = images_dir / f"{stem}.png"
            mask_dest = masks_dir / f"{stem}.png"
            shutil.copy2(rgb_path, img_dest)
            Image.fromarray(_mask_to_png_u8(mask_arr)).save(mask_dest)

            # Single-session smoke-run case (#16): a session may be in both
            # sets at once; emit the stem to every split it belongs to so the
            # val file is non-empty.
            if in_train:
                train_ids.append(stem)
            if in_val:
                val_ids.append(stem)

            if in_train and in_val:
                split_label = "train+val"
            elif in_train:
                split_label = "train"
            else:
                split_label = "val"

            manifest_rows.append({
                "stem": stem,
                "session_id": sid,
                "crop_index": i,
                "split": split_label,
                "mask_kind": mask_kind,
                "rgb_sha256": hashlib.sha256(rgb_path.read_bytes()).hexdigest(),
            })

    (out_root / "train.txt").write_text(
        "\n".join(sorted(train_ids)) + ("\n" if train_ids else ""),
        encoding="utf-8",
    )
    (out_root / "val.txt").write_text("\n".join(sorted(val_ids)) + ("\n" if val_ids else ""), encoding="utf-8")
    test_path = out_root / "test.txt"
    if not test_path.exists():
        test_path.write_text("")

    report = {"segformer": {"train": len(train_ids), "val": len(val_ids), "manifest": manifest_rows}}
    write_json_atomic(out_root / "export_manifest_segformer.json", report)
    return report


def export_yolo_layout(
    store: SessionStore,
    session_dirs: list[Path],
    out_root: Path,
    train_ratio: float,
    seed: int,
) -> dict[str, Any]:
    train_sess, val_sess = _split_sessions(session_dirs, train_ratio, seed)
    train_set = set(train_sess)
    val_set = set(val_sess)

    for split in ("train", "val"):
        (out_root / split / "images").mkdir(parents=True, exist_ok=True)
        (out_root / split / "labels").mkdir(parents=True, exist_ok=True)

    manifest_rows: list[dict[str, Any]] = []
    counts = {"train_images": 0, "val_images": 0}

    for session_dir in session_dirs:
        sid = session_dir.name
        in_train = session_dir in train_set
        in_val = session_dir in val_set
        # Splits the session belongs to (both in the single-session smoke case).
        splits = [s for s, flag in (("train", in_train), ("val", in_val)) if flag]
        if not splits:
            continue
        try:
            trace = store.load(sid)
        except Exception as exc:
            logger.warning("YOLO: skip session %s: %s", sid, exc)
            continue
        truth = trace.final_slots
        n = store.crop_count(sid)
        for i in range(n):
            rgb_path = store.load_crop_rgb_path(sid, i)
            if rgb_path is None:
                continue
            meta = store.load_crop_meta(sid, i)
            if meta is None:
                continue
            slots_here = _slots_in_crop(truth, meta)
            stem = _safe_stem(sid, i)

            lines: list[str] = []
            for slot in slots_here:
                norm = _slot_polygon_normalized_obb(
                    slot, meta, meta.image_width, meta.image_height,
                )
                if norm is None or len(norm) != 8:
                    continue
                cls = _slot_status_to_yolo_class(slot)
                line = " ".join([str(cls)] + [f"{x:.6f}" for x in norm])
                lines.append(line)

            for split in splits:
                img_dest = out_root / split / "images" / f"{stem}.png"
                lbl_dest = out_root / split / "labels" / f"{stem}.txt"
                shutil.copy2(rgb_path, img_dest)
                lbl_dest.write_text(
                    "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8",
                )
                counts[f"{split}_images"] += 1

            manifest_rows.append({
                "stem": stem,
                "session_id": sid,
                "crop_index": i,
                "split": "+".join(splits),
                "num_boxes": len(lines),
            })

    data_yaml = (
        f"path: {out_root.resolve()}\n"
        "train: train/images\n"
        "val: val/images\n"
        "\n"
        "nc: 2\n"
        "names:\n"
        "  0: empty_slot\n"
        "  1: occupied_slot\n"
    )
    (out_root / "data.yaml").write_text(data_yaml, encoding="utf-8")

    report = {"yolo": counts, "manifest": manifest_rows}
    write_json_atomic(out_root / "export_manifest_yolo.json", report)
    return report


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sessions-root", type=Path, default=Path("sessions"))
    p.add_argument("--out", type=Path, required=True)
    p.add_argument(
        "--task",
        choices=("segformer", "yolo", "both"),
        default="both",
    )
    p.add_argument("--train-ratio", type=float, default=0.85)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--include-sessions-without-rgb", action="store_true")
    args = p.parse_args()

    store = SessionStore(args.sessions_root)
    require_rgb = not args.include_sessions_without_rgb
    session_dirs = _discover_sessions(store, require_rgb=require_rgb)
    if not session_dirs:
        logger.error("No sessions found under %s (with rgb=%s)", args.sessions_root, require_rgb)
        raise SystemExit(1)

    args.out.mkdir(parents=True, exist_ok=True)
    builder = DatasetBuilder(store)
    combined: dict[str, Any] = {"sessions": [d.name for d in session_dirs]}

    if args.task in ("segformer", "both"):
        sg_root = args.out / "segformer_pack"
        sg_root.mkdir(parents=True, exist_ok=True)
        combined["segformer"] = export_segformer_layout(
            store, builder, session_dirs, sg_root, args.train_ratio, args.seed,
        )

    if args.task in ("yolo", "both"):
        y_root = args.out / "yolo_pack"
        y_root.mkdir(parents=True, exist_ok=True)
        combined["yolo"] = export_yolo_layout(
            store, session_dirs, y_root, args.train_ratio, args.seed,
        )

    write_json_atomic(args.out / "export_manifest.json", combined)
    logger.info("Wrote %s", args.out / "export_manifest.json")


if __name__ == "__main__":
    main()

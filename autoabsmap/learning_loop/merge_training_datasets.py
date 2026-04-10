"""Merge an incremental export into an existing Colab-style dataset.

Supports:

- **SegFormer** layout: ``images/``, ``masks/``, ``train.txt``, ``val.txt``
- **YOLO** layout: ``train/images``, ``train/labels``, ``val/images``, ``val/labels``, ``data.yaml``

Example::

    python -m autoabsmap.learning_loop.merge_training_datasets \\
        --task segformer --base ~/data/combined_dataset_segmentation \\
        --increment ./export_run/segformer_pack --collision-policy prefix
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import shutil
from pathlib import Path
from typing import Literal

from autoabsmap.io.atomic import write_json_atomic

logger = logging.getLogger(__name__)

CollisionPolicy = Literal["prefix", "skip"]


def _read_lines(p: Path) -> list[str]:
    if not p.exists():
        return []
    return [ln.strip() for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]


def _write_lines(p: Path, lines: list[str]) -> None:
    p.write_text("\n".join(sorted(set(lines))) + ("\n" if lines else ""), encoding="utf-8")


def merge_segformer(
    base: Path,
    increment: Path,
    *,
    collision_policy: CollisionPolicy,
    dry_run: bool,
) -> dict:
    report: dict = {"collisions": [], "added_train": 0, "added_val": 0, "skipped": 0}

    for name in ("images", "masks"):
        (base / name).mkdir(parents=True, exist_ok=True)

    inc_train = _read_lines(increment / "train.txt")
    inc_val = _read_lines(increment / "val.txt")

    base_train = set(_read_lines(base / "train.txt"))
    base_val = set(_read_lines(base / "val.txt"))

    def _process_list(stems: list[str], into_train: bool) -> list[str]:
        added: list[str] = []
        for stem in stems:
            stem_out = stem
            img_inc = increment / "images" / f"{stem}.png"
            if not img_inc.exists():
                logger.warning("Missing increment image for stem %s", stem)
                continue
            mask_inc = increment / "masks" / f"{stem}.png"
            if collision_policy == "skip":
                if (base / "images" / f"{stem}.png").exists():
                    report["skipped"] += 1
                    report["collisions"].append({"stem": stem, "action": "skip"})
                    continue
            elif collision_policy == "prefix":
                if (base / "images" / f"{stem}.png").exists():
                    suffix = hashlib.sha256(stem.encode()).hexdigest()[:8]
                    stem_out = f"{stem}_{suffix}"
                    report["collisions"].append({"stem": stem, "renamed_to": stem_out})

            if not dry_run:
                shutil.copy2(img_inc, base / "images" / f"{stem_out}.png")
                if mask_inc.exists():
                    shutil.copy2(mask_inc, base / "masks" / f"{stem_out}.png")
            added.append(stem_out)
            if into_train:
                report["added_train"] += 1
            else:
                report["added_val"] += 1
        return added

    new_train = _process_list(inc_train, True)
    new_val = _process_list(inc_val, False)

    merged_train = sorted(base_train | set(new_train))
    merged_val = sorted(base_val | set(new_val))

    if not dry_run:
        _write_lines(base / "train.txt", merged_train)
        _write_lines(base / "val.txt", merged_val)
        if not (base / "test.txt").exists():
            (base / "test.txt").write_text("", encoding="utf-8")

    return report


def merge_yolo(
    base: Path,
    increment: Path,
    *,
    collision_policy: CollisionPolicy,
    dry_run: bool,
) -> dict:
    report: dict = {"collisions": [], "copied": 0, "skipped": 0}
    for split in ("train", "val"):
        for sub in ("images", "labels"):
            (base / split / sub).mkdir(parents=True, exist_ok=True)

    for split in ("train", "val"):
        inc_img_dir = increment / split / "images"
        if not inc_img_dir.is_dir():
            continue
        for src_img in sorted(inc_img_dir.glob("*.png")):
            stem = src_img.stem
            dest_stem = stem
            if (base / split / "images" / f"{stem}.png").exists():
                if collision_policy == "skip":
                    report["skipped"] += 1
                    report["collisions"].append({"split": split, "stem": stem, "action": "skip"})
                    continue
                dest_stem = f"{stem}_{hashlib.sha256(stem.encode()).hexdigest()[:8]}"
                report["collisions"].append({"split": split, "stem": stem, "renamed_to": dest_stem})

            src_lbl = increment / split / "labels" / f"{stem}.txt"
            dest_img = base / split / "images" / f"{dest_stem}.png"
            dest_lbl = base / split / "labels" / f"{dest_stem}.txt"

            if not dry_run:
                shutil.copy2(src_img, dest_img)
                if src_lbl.exists():
                    shutil.copy2(src_lbl, dest_lbl)
                else:
                    dest_lbl.write_text("", encoding="utf-8")
            report["copied"] += 1

    inc_yaml = increment / "data.yaml"
    if inc_yaml.exists() and not dry_run:
        # Do not overwrite base data.yaml blindly; write sidecar for reference
        side = base / "data_increment_source.yaml"
        side.write_text(inc_yaml.read_text(encoding="utf-8"), encoding="utf-8")

    return report


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", type=Path, required=True, help="Existing dataset root")
    p.add_argument("--increment", type=Path, required=True, help="Export pack (segformer_pack or yolo_pack)")
    p.add_argument("--task", choices=("segformer", "yolo"), required=True)
    p.add_argument("--collision-policy", choices=("prefix", "skip"), default="prefix")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if args.task == "segformer":
        report = merge_segformer(
            args.base,
            args.increment,
            collision_policy=args.collision_policy,
            dry_run=args.dry_run,
        )
    else:
        report = merge_yolo(
            args.base,
            args.increment,
            collision_policy=args.collision_policy,
            dry_run=args.dry_run,
        )

    out = args.base / "merge_report.json"
    if not args.dry_run:
        write_json_atomic(out, {"task": args.task, "increment": str(args.increment), **report})
    logger.info("Merge report: %s", report)
    if not args.dry_run:
        logger.info("Wrote %s", out)


if __name__ == "__main__":
    main()

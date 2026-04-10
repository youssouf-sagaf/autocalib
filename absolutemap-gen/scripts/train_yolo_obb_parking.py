#!/usr/bin/env python3
"""Fine-tune Ultralytics YOLO OBB on the parking dataset (manual / local GPU).

Derived from ``notebooks/train_yolo_obb_parking.ipynb``. Expects a ``data.yaml``
produced by ``autoabsmap`` export + merge (``train/images``, ``val/images``,
matching ``labels``).

Example::

    python train_yolo_obb_parking.py --data /path/to/yolo_pack/data.yaml --model yolo26l-obb.pt
"""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        required=True,
        help="Path to data.yaml (dataset root with train/val images)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="yolo26l-obb.pt",
        help="Ultralytics OBB weights to start from",
    )
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--project", type=Path, default=Path("runs"))
    parser.add_argument("--name", type=str, default="parking_obb_yolo26l")
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.model)
    model.train(
        data=str(args.data.resolve()),
        epochs=args.epochs,
        patience=args.patience,
        imgsz=args.imgsz,
        batch=args.batch,
        lr0=0.001,
        lrf=0.01,
        weight_decay=0.0005,
        warmup_epochs=5,
        freeze=10,
        mosaic=0.5,
        mixup=0.0,
        copy_paste=0.0,
        scale=0.3,
        fliplr=0.5,
        flipud=0.5,
        degrees=15.0,
        translate=0.1,
        hsv_h=0.015,
        hsv_s=0.4,
        hsv_v=0.3,
        close_mosaic=10,
        project=str(args.project.resolve()),
        name=args.name,
        exist_ok=True,
        verbose=True,
    )


if __name__ == "__main__":
    main()

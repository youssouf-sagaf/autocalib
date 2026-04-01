#!/usr/bin/env python3
"""Visualize YOLO-OBB ground truth annotations overlaid on images.

Draws each OBB polygon in red (occupied) or green (empty) with a center dot.

Usage:
    python scripts/visualize_ground_truth.py
    python scripts/visualize_ground_truth.py --dataset data/parking-dataset-detection-yolo --split train
    python scripts/visualize_ground_truth.py --split val --out /tmp/gt_vis
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

CLASS_COLORS = {
    0: (50, 205, 50),   # empty_slot  → green (BGR)
    1: (0, 0, 255),     # occupied_slot → red (BGR)
}
CLASS_NAMES = {0: "empty", 1: "occupied"}


def parse_obb_label(label_path: Path, img_w: int, img_h: int) -> list[dict]:
    """Parse a YOLO-OBB label file into pixel-space polygons."""
    records = []
    for line in label_path.read_text().strip().splitlines():
        parts = line.split()
        cls_id = int(parts[0])
        coords = np.array(list(map(float, parts[1:])), dtype=np.float64).reshape(4, 2)
        coords[:, 0] *= img_w
        coords[:, 1] *= img_h
        records.append({"class_id": cls_id, "polygon": coords.astype(np.int32)})
    return records


def draw_ground_truth(image: np.ndarray, annotations: list[dict]) -> np.ndarray:
    """Draw OBB polygons and center dots on the image."""
    overlay = image.copy()
    for ann in annotations:
        color = CLASS_COLORS.get(ann["class_id"], (0, 0, 255))
        poly = ann["polygon"]

        cv2.fillPoly(overlay, [poly], color)
        cv2.polylines(image, [poly], isClosed=True, color=color, thickness=2)

        center = poly.mean(axis=0).astype(int)
        cv2.circle(image, tuple(center), 4, color, -1)
        cv2.circle(image, tuple(center), 4, (255, 255, 255), 1)

    alpha = 0.20
    cv2.addWeighted(overlay, alpha, image, 1 - alpha, 0, image)
    return image


def main() -> None:
    parser = argparse.ArgumentParser(description="Visualize YOLO-OBB ground truth.")
    parser.add_argument(
        "--dataset", type=Path, default="data/parking-dataset-detection-yolo",
        help="Root of the YOLO-OBB dataset",
    )
    parser.add_argument("--split", default="train", choices=["train", "val"], help="Split to visualize")
    parser.add_argument("--out", type=Path, default=None, help="Output dir (default: <dataset>/<split>/gt_vis)")
    args = parser.parse_args()

    img_dir = args.dataset / args.split / "images"
    lbl_dir = args.dataset / args.split / "labels"
    out_dir = args.out or (args.dataset / args.split / "gt_vis")
    out_dir.mkdir(parents=True, exist_ok=True)

    image_paths = sorted(img_dir.glob("*.png"))
    if not image_paths:
        print(f"No .png images found in {img_dir}")
        return

    for img_path in image_paths:
        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        image = cv2.imread(str(img_path))
        h, w = image.shape[:2]

        annotations = parse_obb_label(lbl_path, w, h) if lbl_path.exists() else []
        result = draw_ground_truth(image, annotations)

        n_empty = sum(1 for a in annotations if a["class_id"] == 0)
        n_occupied = sum(1 for a in annotations if a["class_id"] == 1)

        label_text = f"{img_path.stem}  |  {n_empty} empty  {n_occupied} occupied"
        cv2.putText(result, label_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 4)
        cv2.putText(result, label_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)

        out_path = out_dir / f"{img_path.stem}_gt.png"
        cv2.imwrite(str(out_path), result)
        print(f"  {img_path.stem}: {len(annotations)} boxes → {out_path.name}")

    print(f"\n{len(image_paths)} images visualized → {out_dir}")


if __name__ == "__main__":
    main()

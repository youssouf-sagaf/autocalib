"""Run a trained YOLO model on images and save annotated outputs.

Usage example:
    python scripts/run_vehicle_obb_inference.py \
        --model data/runs/20260525T120000Z_train/weights/best_20260525T121500Z.pt \
        --input-dir data/my_1000_images \
        --output-dir data/inference_results
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Run YOLO inference on a folder and save annotated images.",
    )
    parser.add_argument("--model", required=True, help="Path to .pt weights file.")
    parser.add_argument("--input-dir", required=True, help="Folder containing images.")
    parser.add_argument("--output-dir", required=True, help="Folder where outputs are written.")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.45, help="NMS IoU threshold.")
    parser.add_argument("--device", default=None, help="Device (cpu, mps, cuda:0, etc.).")
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Recursively scan input directory.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only the first N images (sorted by filename).",
    )
    return parser.parse_args()


def list_images(input_dir: Path, recursive: bool) -> list[Path]:
    """Return sorted image paths in input_dir."""
    iterator = input_dir.rglob("*") if recursive else input_dir.glob("*")
    images = [p for p in iterator if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES]
    return sorted(images)


def draw_result(image_bgr: np.ndarray, result) -> np.ndarray:
    """Draw OBB polygons when available, else axis-aligned boxes."""
    canvas = image_bgr.copy()

    if result.obb is not None and len(result.obb) > 0:
        polygons = result.obb.xyxyxyxy.cpu().numpy()
        confidences = result.obb.conf.cpu().numpy()

        for polygon, confidence in zip(polygons, confidences):
            points = np.round(polygon).astype(np.int32).reshape((-1, 1, 2))
            cv2.polylines(canvas, [points], isClosed=True, color=(0, 106, 255), thickness=2)

            anchor = tuple(points[0, 0])
            cv2.putText(
                canvas,
                f"{float(confidence):.2f}",
                anchor,
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 106, 255),
                1,
                cv2.LINE_AA,
            )
        return canvas

    if result.boxes is not None and len(result.boxes) > 0:
        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        for (x1, y1, x2, y2), confidence in zip(boxes, confidences):
            p1 = (int(round(x1)), int(round(y1)))
            p2 = (int(round(x2)), int(round(y2)))
            cv2.rectangle(canvas, p1, p2, (0, 106, 255), 2)
            cv2.putText(
                canvas,
                f"{float(confidence):.2f}",
                p1,
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 106, 255),
                1,
                cv2.LINE_AA,
            )

    return canvas


def run() -> int:
    """Execute folder inference and save annotated images."""
    args = parse_args()
    model_path = Path(args.model).expanduser().resolve()
    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not model_path.is_file():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if not input_dir.is_dir():
        raise NotADirectoryError(f"Input directory not found: {input_dir}")

    images = list_images(input_dir, recursive=args.recursive)
    if args.limit is not None and args.limit > 0:
        images = images[: args.limit]
    if not images:
        print(f"No images found in {input_dir}")
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(model_path))

    total = len(images)
    print(f"Running inference on {total} image(s)")
    print(f"Model: {model_path}")
    print(f"Input: {input_dir}")
    print(f"Output: {output_dir}")

    for index, image_path in enumerate(images, start=1):
        image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image_bgr is None:
            print(f"[{index}/{total}] skipped unreadable file: {image_path}")
            continue

        prediction = model.predict(
            source=image_bgr,
            conf=args.conf,
            iou=args.iou,
            device=args.device,
            verbose=False,
        )[0]
        annotated = draw_result(image_bgr, prediction)

        relative = image_path.relative_to(input_dir)
        destination = output_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(destination), annotated)
        print(f"[{index}/{total}] saved: {destination}")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())

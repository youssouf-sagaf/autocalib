"""Run SAM3 text-prompt vehicle detection on a folder of images.

Usage:
    PYTHONPATH=..:. ../.venv/bin/python scripts/run_sam3_vehicle_inference.py \
        --input-dir data \
        --output-dir tmp_sam3 \
        --limit 100 \
        --text-prompt "car" \
        --device mps
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from calib_gen.ml.sam3_detector import Sam3Detector

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run SAM3 vehicle detection on images and save annotated outputs.",
    )
    parser.add_argument("--input-dir", required=True, help="Folder containing images.")
    parser.add_argument("--output-dir", required=True, help="Folder for annotated images.")
    parser.add_argument(
        "--text-prompt",
        default="car",
        help='SAM3 text prompt (default: "car"). Try "vehicle" or "car".',
    )
    parser.add_argument("--threshold", type=float, default=0.5, help="Detection threshold.")
    parser.add_argument(
        "--mask-threshold",
        type=float,
        default=0.5,
        help="Mask binarization threshold.",
    )
    parser.add_argument(
        "--model-id",
        default="facebook/sam3",
        help="Hugging Face model id.",
    )
    parser.add_argument("--device", default=None, help="Device: mps, cpu, cuda:0, etc.")
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
    iterator = input_dir.rglob("*") if recursive else input_dir.glob("*")
    images = [p for p in iterator if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES]
    return sorted(images)


def draw_detections(image_bgr, detections) -> object:
    canvas = image_bgr.copy()
    for det in detections:
        x1 = int(round(det.x))
        y1 = int(round(det.y))
        x2 = int(round(det.x + det.width))
        y2 = int(round(det.y + det.height))
        cv2.rectangle(canvas, (x1, y1), (x2, y2), (0, 165, 255), 2)
        cv2.putText(
            canvas,
            f"{det.confidence:.2f}",
            (x1, max(y1 - 4, 12)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 165, 255),
            1,
            cv2.LINE_AA,
        )
    return canvas


def run() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not input_dir.is_dir():
        raise NotADirectoryError(f"Input directory not found: {input_dir}")

    images = list_images(input_dir, recursive=args.recursive)
    if args.limit is not None and args.limit > 0:
        images = images[: args.limit]
    if not images:
        print(f"No images found in {input_dir}")
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    detector = Sam3Detector(
        model_id=args.model_id,
        text_prompt=args.text_prompt,
        threshold=args.threshold,
        mask_threshold=args.mask_threshold,
        device=args.device,
    )

    total = len(images)
    print(f"Running SAM3 on {total} image(s)")
    print(f"Prompt: {args.text_prompt!r}")
    print(f"Model: {args.model_id}")
    print(f"Input: {input_dir}")
    print(f"Output: {output_dir}")

    total_boxes = 0
    for index, image_path in enumerate(images, start=1):
        image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image_bgr is None:
            print(f"[{index}/{total}] skipped unreadable file: {image_path}")
            continue

        detections = detector.detect(image_bgr)
        total_boxes += len(detections)
        annotated = draw_detections(image_bgr, detections)

        relative = image_path.relative_to(input_dir)
        destination = output_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(destination), annotated)
        print(f"[{index}/{total}] {len(detections)} box(es) -> {destination}")

    print(f"Done. Total detections: {total_boxes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())

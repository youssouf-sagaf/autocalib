"""Unzip COCO-seg export, duplicate the single image x2 per split, train YOLO-seg 5 epochs, predict."""
import json
import shutil
import zipfile
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO
from ultralytics.engine.results import Results

_ROOT = Path(__file__).resolve().parent.parent
_ZIP = _ROOT / "data/autocalib.coco-segmentation.zip"
_EXTRACT = _ROOT / "data/autocalib-coco-segmentation-extracted"
_YOLO_DATASET = _ROOT / "data/autocalib-seg-yolo-smoke"
_RUNS = _ROOT / "runs/seg-smoke"


def _annotations_to_yolo_lines(coco: dict, image_width: int, image_height: int) -> str:
    """Convert COCO polygon annotations to YOLO-seg lines (single class 0)."""
    lines: list[str] = []
    for ann in coco["annotations"]:
        if ann.get("iscrowd"):
            continue
        rings = ann.get("segmentation") or []
        if not rings:
            continue
        poly = rings[0]
        parts: list[str] = ["0"]
        for i in range(0, len(poly), 2):
            x = float(poly[i]) / image_width
            y = float(poly[i + 1]) / image_height
            parts.append(f"{x:.6f}")
            parts.append(f"{y:.6f}")
        lines.append(" ".join(parts))
    return "\n".join(lines)


def _save_thin_mask_outlines(result: Results, output_path: Path, line_thickness: int = 1) -> None:
    """Draw 1px anti-aliased mask contours only (no boxes, no labels, no filled overlay)."""
    image_bgr = result.orig_img.copy()
    masks = result.masks
    if masks is None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_path), image_bgr)
        return
    outline_bgr = (0, 255, 255)
    for polygon_xy in masks.xy:
        if polygon_xy is None or len(polygon_xy) < 2:
            continue
        points = np.asarray(polygon_xy, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(
            image_bgr,
            [points],
            isClosed=True,
            color=outline_bgr,
            thickness=line_thickness,
            lineType=cv2.LINE_AA,
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), image_bgr)


def main() -> None:
    if not _ZIP.is_file():
        raise FileNotFoundError(_ZIP)

    shutil.rmtree(_EXTRACT, ignore_errors=True)
    _EXTRACT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(_ZIP, "r") as zf:
        zf.extractall(_EXTRACT)

    train_dir = _EXTRACT / "train"
    coco_path = train_dir / "_annotations.coco.json"
    with open(coco_path, encoding="utf-8") as f:
        coco = json.load(f)

    img0 = coco["images"][0]
    width, height = int(img0["width"]), int(img0["height"])
    src_image = train_dir / img0["file_name"]
    if not src_image.is_file():
        raise FileNotFoundError(src_image)

    label_text = _annotations_to_yolo_lines(coco, width, height)

    shutil.rmtree(_YOLO_DATASET, ignore_errors=True)
    for split in ("train", "val", "test"):
        im_dir = _YOLO_DATASET / "images" / split
        lb_dir = _YOLO_DATASET / "labels" / split
        im_dir.mkdir(parents=True, exist_ok=True)
        lb_dir.mkdir(parents=True, exist_ok=True)
        for i in range(2):
            stem = f"map_dup_{split}_{i}"
            shutil.copy2(src_image, im_dir / f"{stem}.png")
            (lb_dir / f"{stem}.txt").write_text(label_text, encoding="utf-8")

    dataset_yaml = _YOLO_DATASET / "dataset.yaml"
    dataset_yaml.write_text(
        "\n".join(
            [
                f"path: {_YOLO_DATASET}",
                "train: images/train",
                "val: images/val",
                "test: images/test",
                "nc: 1",
                "names:",
                "  0: parking-spots",
                "",
            ]
        ),
        encoding="utf-8",
    )

    model = YOLO("yolov8n-seg.pt")
    model.train(
        data=str(dataset_yaml),
        epochs=5,
        imgsz=640,
        batch=2,
        project=str(_RUNS),
        name="train",
        exist_ok=True,
    )

    best_weights = _RUNS / "train/weights/best.pt"
    predict_out = _RUNS / "predict_thin" / f"{src_image.stem}_masks.jpg"
    seg_results = YOLO(str(best_weights)).predict(
        source=str(src_image),
        conf=0.01,
        imgsz=640,
        save=False,
        verbose=False,
    )
    _save_thin_mask_outlines(seg_results[0], predict_out)


if __name__ == "__main__":
    main()

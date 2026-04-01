"""YOLO inference: red boxes for car (0), motorcycle (1), van (2); save annotated image."""
from pathlib import Path

import cv2
from ultralytics import YOLO

_ROOT = Path(__file__).resolve().parent.parent
_MODEL = _ROOT / "models/best_child_continual_learning_d_20251208_031456_fp20918efd.pt"
_IMAGE = _ROOT / "images/map-sarda-gariga.png"
_OUT = _ROOT / "output/map-sarda-gariga_red_bboxes.png"
_TARGET_CLASSES = {0, 1, 2}  # car, motorcycle, van
_RED_BGR = (0, 0, 255)


if __name__ == "__main__":
    results = YOLO(_MODEL).predict(_IMAGE, save=False, verbose=False)
    image = results[0].orig_img.copy()
    for box in results[0].boxes:
        class_id = int(box.cls[0])
        if class_id not in _TARGET_CLASSES:
            continue
        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
        cv2.rectangle(image, (x1, y1), (x2, y2), _RED_BGR, 2)
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(_OUT), image)

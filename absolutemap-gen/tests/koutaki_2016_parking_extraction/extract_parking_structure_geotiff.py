#!/usr/bin/env python3
"""
Standalone pipeline inspired by Koutaki, Minamoto & Uchimura (2016),
"Extraction of parking lot structure from aerial image in urban areas".

Input: RGB GeoTIFF.
Vehicle step: Ultralytics YOLO-OBB by default (yolo26m-obb.pt, DOTA “vehicle”
classes: small/large vehicle).  Oriented bounding boxes (OBB) are preserved throughout:
templates are extracted by de-rotating each vehicle crop to its canonical upright
orientation, then NCC matching runs at the dominant OBB angle(s) so the stall search
respects the natural parking direction instead of relying on fixed 0°/90° passes.
Outputs: intermediate visualizations and JSON per step. Final lots: pixel summaries
and GeoJSON when CRS is available.

References: ICIC Vol. 12, No. 2, April 2016, pp. 371–383.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import cv2
import numpy as np
import rasterio
from rasterio.transform import from_bounds, xy

# Paper uses ~20 cm/pixel orthophoto; vehicle windows 14×32, parking templates 15×28.
REFERENCE_M_PER_PIXEL = 0.2

# COCO “car” for plain detection weights (e.g. yolo26m.pt).
YOLO_COCO_CLASS_CAR = 2
# DOTA 1.x OBB labels used by Ultralytics pretrained *-obb.pt models (aerial).
DOTA_CLASS_LARGE_VEHICLE = 9
DOTA_CLASS_SMALL_VEHICLE = 10
DOTA_VEHICLE_CLASSES = (DOTA_CLASS_LARGE_VEHICLE, DOTA_CLASS_SMALL_VEHICLE)

DEFAULT_YOLO_WEIGHTS = "yolo26m-obb.pt"


def yolo_weights_use_obb(weights: str) -> bool:
    """True if weights filename suggests an oriented-bounding-box checkpoint."""
    return "-obb" in Path(weights).name.lower()


def default_yolo_vehicle_class_ids(weights: str) -> list[int]:
    """Class IDs for “cars in aerial imagery”: DOTA vehicles for OBB, else COCO car."""
    if yolo_weights_use_obb(weights):
        return list(DOTA_VEHICLE_CLASSES)
    return [YOLO_COCO_CLASS_CAR]


def parse_yolo_class_ids(arg: str | None) -> list[int] | None:
    if not arg or not str(arg).strip():
        return None
    return [int(x.strip()) for x in str(arg).split(",") if x.strip()]


def _yolo_weights_cache_dir() -> Path:
    return Path(__file__).resolve().parent / ".cache" / "yolo_weights"


_yolo_model_cache: dict[str, Any] = {}


def resolve_yolo_weights_file(weights: str) -> str:
    """
    Return path to a local .pt file. Ultralytics hub names (e.g. yolo26m.pt) are
    downloaded once under tests/.../.cache/yolo_weights/.
    """
    p = Path(weights).expanduser()
    if p.is_file():
        return str(p.resolve())
    cache = _yolo_weights_cache_dir()
    cache.mkdir(parents=True, exist_ok=True)
    return str(_ensure_hub_weights_in_cache(weights, cache))


def _ensure_hub_weights_in_cache(weights: str, cache: Path) -> Path:
    name = weights if str(weights).endswith(".pt") else f"{weights}.pt"
    dest = cache / Path(name).name
    if dest.is_file():
        return dest
    from ultralytics import YOLO

    prev = os.getcwd()
    try:
        os.chdir(cache)
        YOLO(Path(name).name)
    finally:
        os.chdir(prev)
    if not dest.is_file():
        raise FileNotFoundError(
            f"After download, expected weights at {dest} (weights={weights!r})."
        )
    return dest


def get_yolo_model(weights: str) -> Any:
    """Process-local singleton per resolved weights path."""
    from ultralytics import YOLO

    path_key = resolve_yolo_weights_file(weights)
    if path_key not in _yolo_model_cache:
        _yolo_model_cache[path_key] = YOLO(path_key)
    return _yolo_model_cache[path_key]


@dataclass
class Space:
    """Parking space candidate in pixel coordinates (center, size, orientation)."""

    cx: float
    cy: float
    wp: int
    hp: int
    score: float = 1.0
    synthetic: bool = False
    angle_deg: float = 0.0  # stall orientation (degrees); 0 = long axis horizontal


@dataclass
class VehicleOBB:
    """Single YOLO-OBB detection preserving the oriented bounding box."""

    cx: float         # center column (x)
    cy: float         # center row (y)
    vw: float         # width along the OBB long axis (pixels)
    vh: float         # height along OBB short axis (pixels)
    angle_deg: float  # rotation in degrees (from YOLO xywhr.r converted)
    poly: np.ndarray  # (4, 2) float32 polygon corners in original image

    @property
    def aabb(self) -> tuple[int, int, int, int]:
        """Axis-aligned bounding box (x, y, w, h) from polygon corners."""
        xs = self.poly[:, 0]
        ys = self.poly[:, 1]
        x0, y0 = int(xs.min()), int(ys.min())
        x1, y1 = int(xs.max()), int(ys.max())
        return x0, y0, max(1, x1 - x0), max(1, y1 - y0)


def _vehicle_obb_rotate90cw(v: VehicleOBB, orig_h: int) -> VehicleOBB:
    """
    Map a VehicleOBB from the original image to the ROTATE_90_CLOCKWISE frame.

    OpenCV 90° CW mapping: pixel (x, y) → (H - 1 - y, x) in the new frame.
    """
    new_cx = float(orig_h - 1) - v.cy
    new_cy = v.cx
    new_poly = np.column_stack([
        float(orig_h - 1) - v.poly[:, 1],
        v.poly[:, 0],
    ]).astype(np.float32)
    return VehicleOBB(
        cx=new_cx,
        cy=new_cy,
        vw=v.vw,
        vh=v.vh,
        angle_deg=v.angle_deg - 90.0,
        poly=new_poly,
    )


@dataclass
class PipelineConfig:
    """All pipeline parameters with sensible defaults."""

    input_geotiff: str
    output_dir: str
    wgs84_bounds: list[float] | None = None
    pixel_size_m: float | None = None
    ncc_threshold: float = 0.45
    yolo_weights: str = DEFAULT_YOLO_WEIGHTS
    yolo_classes: str | None = None
    yolo_conf: float = 0.15
    yolo_iou: float = 0.45


def _meters_per_pixel_from_transform(transform: rasterio.Affine) -> float:
    """Approximate ground sample distance from the geotransform (meter units assumed)."""
    return float(abs(transform[0]) + abs(transform[4])) / 2.0


def read_geotiff_rgb(path: Path) -> tuple[np.ndarray, rasterio.DatasetReader]:
    """Load first three bands as RGB uint8 (GeoTIFF, PNG, etc. via rasterio)."""
    src = rasterio.open(path)
    if src.count < 3:
        src.close()
        raise ValueError(f"Need at least 3 bands in {path}, got {src.count}.")
    r = src.read(1)
    g = src.read(2)
    b = src.read(3)
    stack = np.dstack([r, g, b])
    if stack.dtype != np.uint8:
        mx = float(stack.max()) or 1.0
        stack = np.clip(stack / mx * 255.0, 0, 255).astype(np.uint8)
    return stack, src



def detect_vehicles_yolo(
    rgb: np.ndarray,
    model: Any,
    conf: float,
    iou: float,
    wp: int,
    output_dir: Path,
    class_ids: list[int],
) -> list[VehicleOBB]:
    """
    Vehicle detection returning ``VehicleOBB`` objects that preserve orientation.

    For ``*-obb.pt`` models: OBB center, size and angle are taken from ``xywhr``
    (angle in radians, converted to degrees).  For standard ``boxes`` models a
    zero-angle VehicleOBB is created from the AABB corners.
    """
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    results = model.predict(
        source=bgr,
        conf=conf,
        iou=iou,
        classes=class_ids,
        verbose=False,
    )
    vehicles: list[VehicleOBB] = []
    vis = bgr.copy()

    if not results:
        cv2.imwrite(str(output_dir / "step04_vehicles.png"), vis)
        return vehicles

    r0 = results[0]
    if r0.obb is not None and len(r0.obb):
        xywhr = r0.obb.xywhr.cpu().numpy()   # (N, 5): cx, cy, w, h, r_rad
        polys = r0.obb.xyxyxyxy.cpu().numpy()  # (N, 4, 2)
        for i in range(xywhr.shape[0]):
            cx, cy, vw, vh, r_rad = xywhr[i]
            angle = math.degrees(float(r_rad))
            poly = polys[i].astype(np.float32).reshape(4, 2)
            vehicles.append(VehicleOBB(cx=float(cx), cy=float(cy),
                                       vw=float(vw), vh=float(vh),
                                       angle_deg=angle, poly=poly))
            pts = np.ascontiguousarray(poly, dtype=np.int32).reshape((-1, 1, 2))
            cv2.polylines(vis, [pts], isClosed=True, color=(0, 200, 255), thickness=2)
    elif r0.boxes is not None and len(r0.boxes):
        xyxy = r0.boxes.xyxy.cpu().numpy()
        for row in xyxy:
            x1, y1, x2, y2 = float(row[0]), float(row[1]), float(row[2]), float(row[3])
            vw, vh = x2 - x1, y2 - y1
            if vw <= 0 or vh <= 0:
                continue
            cx, cy = x1 + vw / 2, y1 + vh / 2
            poly = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)
            vehicles.append(VehicleOBB(cx=cx, cy=cy, vw=vw, vh=vh,
                                       angle_deg=0.0, poly=poly))
            cv2.rectangle(vis, (int(x1), int(y1)), (int(x2), int(y2)), (0, 165, 255), 2)

    vehicles = _nms_vehicle_obbs(vehicles, dist_px=0.35 * wp)
    cv2.imwrite(str(output_dir / "step04_vehicles.png"), vis)
    return vehicles


def _nms_vehicle_obbs(vehicles: list[VehicleOBB], dist_px: float) -> list[VehicleOBB]:
    """Deduplicate OBB detections whose centers are within ``dist_px`` of each other."""
    if not vehicles:
        return []
    kept: list[VehicleOBB] = []
    for v in vehicles:
        if all(math.hypot(v.cx - k.cx, v.cy - k.cy) >= dist_px for k in kept):
            kept.append(v)
    return kept


def _merge_overlapping_rects(
    rects: list[tuple[int, int, int, int]],
    iou_thresh: float,
    dist_px: float,
) -> list[tuple[int, int, int, int]]:
    if not rects:
        return []

    def iou(a, b) -> float:
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        x1, y1 = max(ax, bx), max(ay, by)
        x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        if inter <= 0:
            return 0.0
        ua = aw * ah + bw * bh - inter
        return inter / ua if ua else 0.0

    def center_dist(a, b) -> float:
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        return math.hypot(ax + aw / 2 - (bx + bw / 2), ay + ah / 2 - (by + bh / 2))

    kept = list(rects)
    changed = True
    while changed:
        changed = False
        out: list[tuple[int, int, int, int]] = []
        used = [False] * len(kept)
        for i in range(len(kept)):
            if used[i]:
                continue
            r = kept[i]
            for j in range(i + 1, len(kept)):
                if used[j]:
                    continue
                s = kept[j]
                if iou(r, s) > iou_thresh or center_dist(r, s) < dist_px:
                    x = min(r[0], s[0])
                    y = min(r[1], s[1])
                    x2 = max(r[0] + r[2], s[0] + s[2])
                    y2 = max(r[1] + r[3], s[1] + s[3])
                    r = (x, y, x2 - x, y2 - y)
                    used[j] = True
                    changed = True
            out.append(r)
        kept = out
    return kept


def _crop_vehicle_templates_oriented(
    gray: np.ndarray,
    vehicles: list[VehicleOBB],
    target_w: int,
    target_h: int,
    max_templates: int = 12,
) -> list[tuple[np.ndarray, float]]:
    """
    Extract de-rotated (upright) grayscale crops for NCC, returning (patch, angle_deg).

    Each vehicle is de-rotated to its canonical horizontal orientation before cropping,
    so the template represents the vehicle contents without perspective distortion.
    The original angle is returned alongside the patch so multi-angle NCC can
    rotate the template back to the stall direction.
    """
    if not vehicles or target_w < 6 or target_h < 6:
        return []
    ih, iw = gray.shape[:2]
    crops: list[tuple[np.ndarray, float]] = []
    for v in vehicles:
        M = cv2.getRotationMatrix2D((float(v.cx), float(v.cy)), v.angle_deg, 1.0)
        derotated = cv2.warpAffine(
            gray, M, (iw, ih),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        hw = max(6.0, v.vw / 2.0)
        hh = max(6.0, v.vh / 2.0)
        x0, y0 = max(0, int(v.cx - hw)), max(0, int(v.cy - hh))
        x1, y1 = min(iw, int(v.cx + hw)), min(ih, int(v.cy + hh))
        if x1 - x0 < 4 or y1 - y0 < 4:
            continue
        patch = derotated[y0:y1, x0:x1]
        resized = cv2.resize(patch, (target_w, target_h), interpolation=cv2.INTER_AREA)
        crops.append((resized, v.angle_deg))

    if not crops:
        return []
    crops.sort(key=lambda t: float(t[0].std()), reverse=True)
    selected = crops[: max(1, max_templates // 2)]
    result: list[tuple[np.ndarray, float]] = []
    for patch, angle in selected:
        result.append((patch, angle))
        result.append((cv2.flip(patch, 1), (angle + 180.0) % 360.0))
    return result


def _rotate_template(tpl: np.ndarray, angle_deg: float) -> np.ndarray:
    """
    Rotate a small template patch around its center by ``angle_deg`` degrees.

    The patch is padded to its diagonal so no content is clipped, then cropped
    back to the original size.
    """
    h, w = tpl.shape[:2]
    diag = int(math.ceil(math.hypot(w, h)))
    pad_h, pad_w = (diag - h) // 2, (diag - w) // 2
    fill = int(float(np.median(tpl)))
    padded = cv2.copyMakeBorder(tpl, pad_h, pad_h, pad_w, pad_w,
                                cv2.BORDER_CONSTANT, value=fill)
    M = cv2.getRotationMatrix2D(
        (padded.shape[1] / 2.0, padded.shape[0] / 2.0), angle_deg, 1.0
    )
    rotated = cv2.warpAffine(padded, M, (padded.shape[1], padded.shape[0]),
                             flags=cv2.INTER_LINEAR, borderValue=fill)
    return rotated[pad_h: pad_h + h, pad_w: pad_w + w]


def _build_vehicle_proximity_mask(
    shape: tuple[int, int],
    vehicles: list[VehicleOBB],
    buffer_px: int,
) -> np.ndarray:
    """Binary mask (uint8, 255 near vehicle centers, 0 elsewhere)."""
    mask = np.zeros(shape[:2], dtype=np.uint8)
    h, w = shape[:2]
    for v in vehicles:
        cx, cy = int(v.cx), int(v.cy)
        x0 = max(0, cx - buffer_px)
        y0 = max(0, cy - buffer_px)
        x1 = min(w, cx + buffer_px)
        y1 = min(h, cy + buffer_px)
        mask[y0:y1, x0:x1] = 255
    return mask


def match_parking_spaces(
    rgb: np.ndarray,
    tpl_w: int,
    tpl_h: int,
    ncc_threshold: float,
    vehicles: list[VehicleOBB] | None = None,
    proximity_mask: np.ndarray | None = None,
    angle_step_deg: float = 10.0,
) -> list[Space]:
    """
    Multi-angle NCC parking-space search using OBB-oriented templates.

    Workflow:
      1. For each detected vehicle, de-rotate its crop to a canonical upright
         orientation using its OBB angle → oriented template + angle label.
      2. Group templates by their dominant angle (binned every ``angle_step_deg``).
      3. For each dominant angle bin, rotate every upright template to that angle
         and run ``cv2.matchTemplate`` (TM_CCOEFF_NORMED) on the original image.
      4. Accumulate the per-pixel best NCC score *and* the best-matching angle.
      5. Extract local-maxima above ``ncc_threshold``; record the matched angle
         in each resulting ``Space.angle_deg``.

    The proximity mask (255 = search zone near vehicles) is applied after
    accumulation to focus candidates near detections.
    """
    if not vehicles:
        return []

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    tpl_pairs = _crop_vehicle_templates_oriented(gray, vehicles, tpl_w, tpl_h)
    if not tpl_pairs:
        return []

    # Group upright templates by dominant angle bin.
    angle_to_patches: dict[float, list[np.ndarray]] = {}
    for patch, angle in tpl_pairs:
        bucket = round(angle / angle_step_deg) * angle_step_deg
        angle_to_patches.setdefault(bucket, []).append(patch)

    acc = np.full(gray.shape, -1.0, dtype=np.float32)
    angle_map = np.zeros(gray.shape, dtype=np.float32)

    for ang, patches in angle_to_patches.items():
        for upright in patches:
            rotated_tpl = _rotate_template(upright, ang)
            rh, rw = rotated_tpl.shape[:2]
            if rh > gray.shape[0] or rw > gray.shape[1]:
                continue
            res = cv2.matchTemplate(gray, rotated_tpl, cv2.TM_CCOEFF_NORMED)
            rr, rc = res.shape[:2]
            improve = res > acc[:rr, :rc]
            acc[:rr, :rc] = np.where(improve, res, acc[:rr, :rc])
            angle_map[:rr, :rc] = np.where(improve, ang, angle_map[:rr, :rc])

    if proximity_mask is not None:
        acc[proximity_mask == 0] = -1.0

    MAX_CANDIDATES = 2000
    kernel_sz = max(3, max(tpl_w, tpl_h)) | 1
    dilated = cv2.dilate(acc, np.ones((kernel_sz, kernel_sz), dtype=np.uint8))
    local_max = (acc == dilated) & (acc >= ncc_threshold)
    ys, xs = np.where(local_max)
    if len(ys) > MAX_CANDIDATES:
        top_idx = np.argpartition(acc[ys, xs], -MAX_CANDIDATES)[-MAX_CANDIDATES:]
        ys, xs = ys[top_idx], xs[top_idx]

    cand: list[Space] = []
    for y, x in zip(ys, xs):
        cand.append(Space(
            cx=x + tpl_w / 2.0,
            cy=y + tpl_h / 2.0,
            wp=max(8, tpl_w),
            hp=max(8, tpl_h),
            score=float(acc[y, x]),
            angle_deg=float(angle_map[y, x]),
        ))
    return _nms_spaces(cand, min_dist=max(tpl_w, tpl_h) * 0.65)


def _nms_spaces(spaces: list[Space], min_dist: float) -> list[Space]:
    spaces = sorted(spaces, key=lambda s: s.score, reverse=True)
    kept: list[Space] = []
    for s in spaces:
        ok = True
        for t in kept:
            if math.hypot(s.cx - t.cx, s.cy - t.cy) < min_dist:
                ok = False
                break
        if ok:
            kept.append(s)
    return kept


def _pairwise_group_spaces(
    spaces: list[Space],
    wp: int,
    hp: int,
    margin: int,
) -> list[Space]:
    """
    Group adjoining spaces (center distance <= wp + margin in-row) and insert
    gap fillers (paper §3.5 steps 1–3, simplified).
    """
    if not spaces:
        return []

    current = list(spaces)
    changed = True
    iters = 0
    while changed and iters < 50:
        iters += 1
        changed = False
        used = [False] * len(current)
        new_list: list[Space] = []
        thr_near = wp + margin
        thr_gap = 2 * wp + 2 * margin
        for i, a in enumerate(current):
            if used[i]:
                continue
            cluster = [a]
            used[i] = True
            grew = True
            while grew:
                grew = False
                for j, b in enumerate(current):
                    if used[j]:
                        continue
                    for c in cluster:
                        dx = abs(c.cx - b.cx)
                        dy = abs(c.cy - b.cy)
                        if dy <= hp * 0.6 and dx <= thr_near:
                            cluster.append(b)
                            used[j] = True
                            grew = True
                            break
            if len(cluster) > 1:
                changed = True
            cluster.sort(key=lambda s: s.cx)
            merged: list[Space] = []
            for s in cluster:
                if not merged:
                    merged.append(s)
                    continue
                prev = merged[-1]
                dx = abs(s.cx - prev.cx)
                dy = abs(s.cy - prev.cy)
                if dy <= hp * 0.6 and thr_near < dx <= thr_gap:
                    mid = Space(
                        cx=(prev.cx + s.cx) / 2.0,
                        cy=(prev.cy + s.cy) / 2.0,
                        wp=wp,
                        hp=hp,
                        score=min(prev.score, s.score),
                        synthetic=True,
                    )
                    merged.append(mid)
                    changed = True
                merged.append(s)
            new_list.extend(merged)
        current = new_list
    return current


def edge_extra_candidates(
    rgb: np.ndarray,
    column_bbox: tuple[int, int, int, int],
    wp: int,
    hp: int,
) -> list[Space]:
    """Along 5·wp lateral bands, integrate vertical-edge energy (paper §3.5, simplified)."""
    x0, y0, x1, y1 = column_bbox
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    band_w = int(5 * wp)
    cand: list[Space] = []
    for side_x in (max(0, x0 - band_w), min(gray.shape[1] - 1, x1)):
        xa = max(0, side_x - band_w // 2)
        xb = min(gray.shape[1], side_x + band_w // 2)
        roi = np.abs(gx[y0:y1, xa:xb])
        profile = roi.sum(axis=1)
        if profile.size < 3:
            continue
        thr = float(np.mean(profile) + 0.6 * np.std(profile))
        peaks = []
        for k in range(1, len(profile) - 1):
            if profile[k] > thr and profile[k] >= profile[k - 1] and profile[k] >= profile[k + 1]:
                peaks.append(y0 + k)
        for py in peaks:
            cand.append(
                Space(cx=float((xa + xb) / 2), cy=float(py), wp=wp, hp=hp, synthetic=True)
            )
    return cand


def spaces_to_bbox(spaces: list[Space]) -> tuple[int, int, int, int]:
    xs = [s.cx for s in spaces]
    ys = [s.cy for s in spaces]
    wp = spaces[0].wp if spaces else 14
    hp = spaces[0].hp if spaces else 32
    min_x = int(min(xs) - wp / 2)
    max_x = int(max(xs) + wp / 2)
    min_y = int(min(ys) - hp / 2)
    max_y = int(max(ys) + hp / 2)
    return min_x, min_y, max_x, max_y


def link_columns_to_rows(
    spaces: list[Space],
    hp: int,
    margin: int,
) -> list[list[Space]]:
    """Partition spaces into row groups separated by ~hp or ~2hp vertically."""
    if not spaces:
        return []
    rows: list[list[Space]] = []
    sorted_s = sorted(spaces, key=lambda s: s.cy)
    current: list[Space] = []
    last_cy: float | None = None
    sep_path = 2 * hp + margin
    sep_back = hp + margin
    for s in sorted_s:
        if last_cy is None:
            current = [s]
            last_cy = s.cy
            continue
        dy = abs(s.cy - last_cy)
        if dy <= sep_back * 0.55:
            current.append(s)
        elif dy <= sep_path * 1.2:
            rows.append(current)
            current = [s]
        else:
            rows.append(current)
            current = [s]
        last_cy = s.cy
    if current:
        rows.append(current)
    return rows


def _merge_back_to_back_rows(
    rows: list[list[Space]],
    hp: int,
    margin: int,
) -> list[list[Space]]:
    """Pair consecutive back-to-back rows (gap ~ hp), max 2 rows per group.

    Real parking lots have at most 2 rows sharing a back edge, then a driving
    lane before the next pair.  This function enforces that structure.
    """
    if len(rows) <= 1:
        return list(rows)

    centroids = [sum(s.cy for s in r) / len(r) for r in rows]
    back_to_back_max = (hp + margin) * 1.2

    merged: list[list[Space]] = []
    i = 0
    while i < len(rows):
        group = list(rows[i])
        if i + 1 < len(rows) and abs(centroids[i + 1] - centroids[i]) <= back_to_back_max:
            group.extend(rows[i + 1])
            i += 2
        else:
            i += 1
        merged.append(group)
    return merged


def _space_axis_aligned_rect(s: Space) -> tuple[float, float, float, float]:
    """Return (minx, miny, maxx, maxy) in pixel coords (x=column, y=row)."""
    hw, hh = s.wp / 2.0, s.hp / 2.0
    return s.cx - hw, s.cy - hh, s.cx + hw, s.cy + hh


def _rect_intersection_area(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    x0, y0 = max(ax0, bx0), max(ay0, by0)
    x1, y1 = min(ax1, bx1), min(ay1, by1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return float((x1 - x0) * (y1 - y0))


def infer_space_occupancy(
    spaces: list[Space],
    vehicles: list[VehicleOBB],
    *,
    min_overlap_ratio: float = 0.12,
) -> list[bool]:
    """True if a vehicle AABB overlaps enough of the stall rectangle (occupancy proxy)."""
    if not spaces:
        return []
    out: list[bool] = []
    for s in spaces:
        sa = _space_axis_aligned_rect(s)
        area_s = max(1.0, float(s.wp * s.hp))
        best_ratio = 0.0
        for v in vehicles:
            ax, ay, aw, ah = v.aabb
            va = (float(ax), float(ay), float(ax + aw), float(ay + ah))
            inter = _rect_intersection_area(sa, va)
            best_ratio = max(best_ratio, inter / area_s)
        out.append(best_ratio >= min_overlap_ratio)
    return out


def map_space_rot90cw_to_original(s: Space, orig_image_height: int) -> Space:
    """
    Map a Space defined on ``cv2.rotate(..., ROTATE_90_CLOCKWISE)`` back to original
    image pixel coordinates (column, row center; swap wp/hp for axis-aligned stall).
    """
    cx_o = s.cy
    cy_o = float(orig_image_height - 1) - s.cx
    return Space(
        cx=cx_o,
        cy=cy_o,
        wp=s.hp,
        hp=s.wp,
        score=s.score,
        synthetic=s.synthetic,
    )


def merge_spaces_two_passes(
    primary: list[Space],
    from_rotated_mapped: list[Space],
    wp: int,
    hp: int,
) -> list[Space]:
    """Combine primary-orientation stalls with rotated-pass stalls; NMS in original frame."""
    combined = list(primary) + list(from_rotated_mapped)
    if not combined:
        return []
    return _nms_spaces(combined, min_dist=max(wp, hp) * 0.42)


def row_ids_for_spaces(spaces: list[Space], hp: int, margin: int) -> list[int]:
    """Assign each stall to a row group index (``link_columns_to_rows``), or -1 if ambiguous."""
    if not spaces:
        return []
    rows = link_columns_to_rows(spaces, hp, margin)
    if not rows:
        return [-1] * len(spaces)
    centroids = [sum(s.cy for s in r) / len(r) for r in rows]
    thr = hp * 1.55
    out: list[int] = []
    for s in spaces:
        best_j = min(range(len(centroids)), key=lambda j: abs(s.cy - centroids[j]))
        out.append(best_j if abs(s.cy - centroids[best_j]) < thr else -1)
    return out


def _center_lonlat(
    s: Space,
    transform,
    crs: Any,
) -> tuple[float | None, float | None]:
    """Stall center (lon, lat) if transform + crs are available."""
    if transform is None or crs is None:
        return None, None
    x_map, y_map = xy(transform, s.cy, s.cx, offset="center")
    if str(crs).upper() != "EPSG:4326":
        from pyproj import Transformer

        t = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        lon, lat = t.transform(float(x_map), float(y_map))
        return float(lon), float(lat)
    return float(x_map), float(y_map)


def export_parking_spaces_json(
    spaces: list[Space],
    occupied: list[bool],
    row_ids: list[int],
    transform: Any,
    crs: Any,
    dst_path: Path,
) -> None:
    """Per-stall centers: pixel coords, occupancy flag, optional WGS84."""
    feats: list[dict[str, Any]] = []
    n_occ = sum(1 for o in occupied if o)
    for i, s in enumerate(spaces):
        lon, lat = _center_lonlat(s, transform, crs)
        feats.append(
            {
                "id": i,
                "center_pixel": {"x": round(float(s.cx), 3), "y": round(float(s.cy), 3)},
                "size_pixel": {"w": int(s.wp), "h": int(s.hp)},
                "stall_angle_deg": round(float(s.angle_deg), 2),
                "occupied": bool(occupied[i]) if i < len(occupied) else False,
                "synthetic_gap_fill": bool(s.synthetic),
                "template_ncc_score": round(float(s.score), 4),
                "row_index": row_ids[i] if i < len(row_ids) else -1,
                "center_wgs84": {"lon": lon, "lat": lat} if lon is not None else None,
            }
        )
    payload = {
        "schema": "parking_stall_centers_v1",
        "crs_wgs84_note": "center_wgs84 set when raster CRS / transform is available",
        "counts": {
            "stalls_total": len(spaces),
            "occupied_estimate": n_occ,
            "empty_estimate": len(spaces) - n_occ,
        },
        "stalls": feats,
    }
    dst_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def export_parking_spaces_points_geojson(
    spaces: list[Space],
    occupied: list[bool],
    transform: Any,
    crs: Any,
    dst_path: Path,
) -> None:
    """GeoJSON Point per stall center (WGS84 coordinates)."""
    if not spaces or transform is None or crs is None:
        return
    feats = []
    for i, s in enumerate(spaces):
        lon, lat = _center_lonlat(s, transform, crs)
        if lon is None:
            return
        feats.append(
            {
                "type": "Feature",
                "properties": {
                    "stall_id": i,
                    "occupied": bool(occupied[i]) if i < len(occupied) else False,
                    "synthetic": bool(s.synthetic),
                    "score": float(s.score),
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    geo = {"type": "FeatureCollection", "features": feats}
    dst_path.write_text(json.dumps(geo, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def draw_parking_centers(
    rgb: np.ndarray,
    spaces: list[Space],
    occupied: list[bool],
    path: Path,
) -> None:
    """Visualize stall centers: red = occupied, green = empty (best-effort)."""
    vis = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    for i, s in enumerate(spaces):
        ix, iy = int(round(s.cx)), int(round(s.cy))
        occ = occupied[i] if i < len(occupied) else False
        color = (60, 60, 255) if occ else (60, 220, 80)
        cv2.circle(vis, (ix, iy), max(4, min(s.wp, s.hp) // 6), color, -1)
        cv2.circle(vis, (ix, iy), max(5, min(s.wp, s.hp) // 4), (255, 255, 255), 1)
    cv2.imwrite(str(path), vis)


def draw_spaces(rgb: np.ndarray, spaces: list[Space], path: Path) -> None:
    vis = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    for s in spaces:
        x0 = int(s.cx - s.wp / 2)
        y0 = int(s.cy - s.hp / 2)
        x1 = int(s.cx + s.wp / 2)
        y1 = int(s.cy + s.hp / 2)
        color = (80, 180, 255) if s.synthetic else (60, 220, 100)
        cv2.rectangle(vis, (x0, y0), (x1, y1), color, 1)
    cv2.imwrite(str(path), vis)


def export_geojson_polygons(
    bounds_pixels: list[tuple[float, float, float, float]],
    transform,
    crs,
    dst_path: Path,
) -> None:
    """bounds_pixels: (minx, miny, maxx, maxy) in pixel coords (row/col)."""
    feats = []
    for idx, (px0, py0, px1, py1) in enumerate(bounds_pixels):
        ring = [
            xy(transform, py0, px0, offset="ul"),
            xy(transform, py0, px1, offset="ul"),
            xy(transform, py1, px1, offset="ul"),
            xy(transform, py1, px0, offset="ul"),
            xy(transform, py0, px0, offset="ul"),
        ]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        if crs and str(crs).upper() != "EPSG:4326":
            from pyproj import Transformer

            t = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
            ring_ll = [t.transform(x, y) for x, y in ring]
        else:
            ring_ll = [(float(x), float(y)) for x, y in ring]
        feats.append(
            {
                "type": "Feature",
                "properties": {"lot_id": idx, "label": "parking_lot_area"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[lon, lat] for lon, lat in ring_ll]],
                },
            }
        )
    geo = {"type": "FeatureCollection", "features": feats}
    dst_path.write_text(json.dumps(geo, indent=2), encoding="utf-8")


def run_pipeline(args: PipelineConfig) -> None:
    t_start = time.monotonic()

    def _elapsed(label: str) -> None:
        print(f"  [{time.monotonic() - t_start:6.1f}s] {label}", flush=True)

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    rgb, src = read_geotiff_rgb(Path(args.input_geotiff))
    h, w = rgb.shape[:2]

    if args.wgs84_bounds is not None and src.crs is None:
        west, south, east, north = args.wgs84_bounds
        transf = from_bounds(west, south, east, north, w, h)
        crs = rasterio.crs.CRS.from_epsg(4326)
        src.close()
        src = SimpleNamespace(transform=transf, crs=crs, close=lambda: None)

    mpp = args.pixel_size_m
    if mpp is None or mpp <= 0:
        mpp = _meters_per_pixel_from_transform(src.transform)
    scale = REFERENCE_M_PER_PIXEL / float(mpp)

    wp = max(8, int(round(14 * scale)))
    hp = max(16, int(round(32 * scale)))
    tpl_w = max(10, int(round(15 * scale)))
    tpl_h = max(14, int(round(28 * scale)))
    margin = max(2, int(round(3 * scale)))

    meta = {
        "input": str(Path(args.input_geotiff).resolve()),
        "shape": [h, w],
        "crs": str(src.crs) if src.crs else None,
        "meters_per_pixel_estimate": mpp,
        "scaled_wp_hp_tpl": {"wp": wp, "hp": hp, "tpl_w": tpl_w, "tpl_h": tpl_h},
        "reference_m_per_pixel_paper": REFERENCE_M_PER_PIXEL,
    }
    (out / "step00_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    _elapsed(f"step00 meta  (image {w}x{h}, mpp={mpp:.4f}, wp={wp} hp={hp})")

    preview = rgb if max(h, w) <= 2048 else cv2.resize(rgb, None, fx=2048 / max(h, w), fy=2048 / max(h, w))
    cv2.imwrite(str(out / "step01_rgb_preview.png"), cv2.cvtColor(preview, cv2.COLOR_RGB2BGR))
    _elapsed("step01 preview")

    yolo_weights_path: str | None = None
    vehicles: list[VehicleOBB] = []
    yolo_class_ids = parse_yolo_class_ids(args.yolo_classes)
    if yolo_class_ids is None:
        yolo_class_ids = default_yolo_vehicle_class_ids(args.yolo_weights)
    try:
        yolo_weights_path = resolve_yolo_weights_file(args.yolo_weights)
        yolo = get_yolo_model(args.yolo_weights)
        vehicles = detect_vehicles_yolo(
            rgb,
            yolo,
            args.yolo_conf,
            args.yolo_iou,
            wp,
            out,
            yolo_class_ids,
        )
    except Exception as e:
        sys.stderr.write(f"YOLO vehicle detection failed: {e}\n")
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        cv2.imwrite(str(out / "step04_vehicles_failed.png"), bgr)

    vehicles_note = {
        "vehicle_detections": len(vehicles),
        "detector": "ultralytics_yolo_obb"
        if yolo_weights_use_obb(args.yolo_weights)
        else "ultralytics_yolo_detect",
        "yolo_weights": args.yolo_weights,
        "yolo_weights_path": yolo_weights_path,
        "yolo_class_ids": yolo_class_ids,
    }
    (out / "step04_vehicles.json").write_text(json.dumps(vehicles_note, indent=2))
    _elapsed(f"step04 vehicles ({len(vehicles)} detections)")

    prox_mask: np.ndarray | None = None
    if vehicles:
        buffer_px = max(wp, hp) * 4
        prox_mask = _build_vehicle_proximity_mask((h, w), vehicles, buffer_px)

    spaces = match_parking_spaces(rgb, tpl_w, tpl_h, args.ncc_threshold, vehicles, prox_mask)
    draw_spaces(rgb, spaces, out / "step05_parking_template_matches.png")
    _elapsed(f"step05 template match ({len(spaces)} spaces)")

    grouped = _pairwise_group_spaces(spaces, wp, hp, margin)
    draw_spaces(rgb, grouped, out / "step06_grouped_spaces.png")
    _elapsed(f"step06 grouping ({len(grouped)} grouped)")

    if grouped:
        bbox = spaces_to_bbox(grouped)
        extras = edge_extra_candidates(rgb, bbox, wp, hp)
        grouped = _nms_spaces(grouped + extras, min_dist=max(wp, hp) * 0.5)
        grouped = _pairwise_group_spaces(grouped, wp, hp, margin)

    rows = link_columns_to_rows(grouped, hp, margin)
    lots = _merge_back_to_back_rows(rows, hp, margin)
    lot_bounds: list[tuple[int, int, int, int]] = []
    vis_final = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    for group in lots:
        if not group:
            continue
        bx = spaces_to_bbox(group)
        lot_bounds.append(bx)
        cv2.rectangle(vis_final, (bx[0], bx[1]), (bx[2], bx[3]), (200, 100, 255), 2)
    cv2.imwrite(str(out / "step07_lots_primary_orientation.png"), vis_final)
    _elapsed(f"step07 lots primary ({len(lot_bounds)} lots)")

    # Rotated pass (paper: rotate 90° and repeat)
    rot = cv2.rotate(rgb, cv2.ROTATE_90_CLOCKWISE)
    rot_prox = cv2.rotate(prox_mask, cv2.ROTATE_90_CLOCKWISE) if prox_mask is not None else None
    rot_vehicles = [_vehicle_obb_rotate90cw(v, h) for v in vehicles]
    spaces_r = match_parking_spaces(rot, tpl_w, tpl_h, args.ncc_threshold, rot_vehicles, rot_prox)
    grouped_r = _pairwise_group_spaces(spaces_r, wp, hp, margin)
    if grouped_r:
        bbox_r = spaces_to_bbox(grouped_r)
        extras_r = edge_extra_candidates(rot, bbox_r, wp, hp)
        grouped_r = _nms_spaces(grouped_r + extras_r, min_dist=max(wp, hp) * 0.5)
        grouped_r = _pairwise_group_spaces(grouped_r, wp, hp, margin)
    rows_r = link_columns_to_rows(grouped_r, hp, margin)
    lots_r = _merge_back_to_back_rows(rows_r, hp, margin)
    inv_rot_bounds: list[tuple[int, int, int, int]] = []
    for group in lots_r:
        if not group:
            continue
        bx = spaces_to_bbox(group)
        x0, y0, x1, y1 = bx
        # Rotate-90-CW inverse on axis-aligned box: orig_col = rot_row, orig_row = H - 1 - rot_col.
        inv_rot_bounds.append(
            (int(y0), int(h - 1 - x1), int(y1), int(h - 1 - x0))
        )

    vis_merge = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    for bx in lot_bounds + inv_rot_bounds:
        cv2.rectangle(vis_merge, (bx[0], bx[1]), (bx[2], bx[3]), (120, 255, 80), 2)
    cv2.imwrite(str(out / "step08_lots_merged_orientations.png"), vis_merge)
    _elapsed(f"step08 merged orientations ({len(inv_rot_bounds)} rotated lots)")

    mapped_rot_spaces = [map_space_rot90cw_to_original(s, h) for s in grouped_r]
    final_stalls = merge_spaces_two_passes(grouped, mapped_rot_spaces, wp, hp)
    stall_occupied = infer_space_occupancy(final_stalls, vehicles)
    stall_row_ids = row_ids_for_spaces(final_stalls, hp, margin)
    export_parking_spaces_json(
        final_stalls,
        stall_occupied,
        stall_row_ids,
        src.transform,
        src.crs,
        out / "parking_stalls.json",
    )
    export_parking_spaces_points_geojson(
        final_stalls,
        stall_occupied,
        src.transform,
        src.crs,
        out / "parking_stalls_wgs84.geojson",
    )
    draw_parking_centers(rgb, final_stalls, stall_occupied, out / "step10_parking_centers.png")
    n_stall_occ = sum(1 for x in stall_occupied if x)
    _elapsed(
        f"step10 stalls merged ({len(final_stalls)} centers, ~{n_stall_occ} occupied) "
        f"-> parking_stalls.json / parking_stalls_wgs84.geojson"
    )

    all_px_bounds = [
        (float(b[0]), float(b[1]), float(b[2]), float(b[3]))
        for b in (lot_bounds + inv_rot_bounds)
    ]
    summary = {
        "parking_space_candidates": len(spaces),
        "grouped_spaces": len(grouped),
        "vehicles": len(vehicles),
        "stall_centers_merged": len(final_stalls),
        "stall_centers_occupied_estimate": n_stall_occ,
        "stall_centers_empty_estimate": len(final_stalls) - n_stall_occ,
        "lot_rectangles_pixels": [
            {"minx": a, "miny": b, "maxx": c, "maxy": d} for (a, b, c, d) in all_px_bounds
        ],
    }
    (out / "step09_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if src.crs:
        export_geojson_polygons(all_px_bounds, src.transform, src.crs, out / "parking_lots_wgs84.geojson")
    src.close()
    _elapsed("DONE")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Parking lot structure extraction from GeoTIFF (Koutaki et al., 2016 style).",
    )
    p.add_argument("input_geotiff", type=str, help="Path to RGB GeoTIFF or RGB raster (e.g. PNG).")
    p.add_argument(
        "--wgs84-bounds",
        type=float,
        nargs=4,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        default=None,
        help="If the raster has no CRS (e.g. plain PNG), set WGS84 bounds for GeoJSON export.",
    )
    p.add_argument(
        "--output-dir",
        type=str,
        required=True,
        help="Directory for step outputs.",
    )
    p.add_argument(
        "--pixel-size-m",
        type=float,
        default=None,
        help="Override ground sampling distance in meters/pixel.",
    )
    p.add_argument(
        "--ncc-threshold",
        type=float,
        default=0.45,
        help="Normalized cross-correlation threshold for templates.",
    )
    p.add_argument(
        "--yolo-weights",
        type=str,
        default=DEFAULT_YOLO_WEIGHTS,
        help=(
            "Ultralytics weights (.pt or hub name). Use *-obb.pt for oriented boxes "
            f"(default {DEFAULT_YOLO_WEIGHTS}, DOTA vehicle classes)."
        ),
    )
    p.add_argument(
        "--yolo-classes",
        type=str,
        default=None,
        help=(
            "Comma-separated class ids to keep (default: 9,10 for *-obb.pt DOTA vehicles; "
            f"else COCO car {YOLO_COCO_CLASS_CAR})."
        ),
    )
    p.add_argument(
        "--yolo-conf",
        type=float,
        default=0.15,
        help="Minimum confidence for YOLO detections.",
    )
    p.add_argument(
        "--yolo-iou",
        type=float,
        default=0.45,
        help="NMS IoU threshold for YOLO inference.",
    )
    return p


def main() -> None:
    parser = build_arg_parser()
    ns = parser.parse_args()
    run_pipeline(PipelineConfig(**vars(ns)))


if __name__ == "__main__":
    main()

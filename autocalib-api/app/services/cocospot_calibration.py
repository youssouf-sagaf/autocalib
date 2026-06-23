"""Proxy cocospot ``static_data.calibration`` via backend-b2b (Cocopilot contract)."""

from __future__ import annotations

import logging
import math
from typing import Any

import httpx

from calib_gen.models.fusion import CalibBbox

from app.calib_models import CalibrationSaveRequest, DeviceCalibrationResponse, DeviceCalibBbox
from app.services.b2b_geography import b2b_base_url, b2b_enabled
from app.services.b2b_http import get_b2b_http_client

logger = logging.getLogger(__name__)

DEFAULT_IMAGE_WIDTH = 1280
DEFAULT_IMAGE_HEIGHT = 480


def image_dimensions(static_data: dict[str, Any]) -> tuple[int, int]:
    """Read image size from static_data characteristics or defaults."""
    chars = static_data.get("characteristics") or {}
    width = int(chars.get("image_width") or DEFAULT_IMAGE_WIDTH)
    height = int(chars.get("image_height") or DEFAULT_IMAGE_HEIGHT)
    return width, height


def bbox_center_normalized(bbox: list[float]) -> tuple[float, float] | None:
    """Center from normalized bbox: 4 values (x1,y1,x2,y2) or polygon centroid."""
    if not bbox or len(bbox) < 4:
        return None
    if len(bbox) == 4:
        return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)
    xs = [bbox[i] for i in range(0, len(bbox), 2)]
    ys = [bbox[i] for i in range(1, len(bbox), 2)]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _dist(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def _rotate_point(
    x: float,
    y: float,
    pivot_x: float,
    pivot_y: float,
    angle_deg: float,
) -> tuple[float, float]:
    radians = math.radians(angle_deg)
    cos_a = math.cos(radians)
    sin_a = math.sin(radians)
    tx = x - pivot_x
    ty = y - pivot_y
    return pivot_x + tx * cos_a - ty * sin_a, pivot_y + tx * sin_a + ty * cos_a


def normalized_bbox_to_pixels(
    bbox_norm: list[float],
    image_width: int,
    image_height: int,
) -> tuple[float, float, float, float, float, float, float]:
    """Return center_x, center_y, x, y, width, height, rotation (degrees)."""
    if len(bbox_norm) == 8:
        px = [
            bbox_norm[i] * (image_width if i % 2 == 0 else image_height)
            for i in range(8)
        ]
        x1, y1 = px[0], px[1]
        rotation = math.degrees(math.atan2(px[3] - px[1], px[2] - px[0]))
        width = _dist(px[0], px[1], px[2], px[3])
        height = _dist(px[0], px[1], px[6], px[7])
        center = bbox_center_normalized(bbox_norm)
        if center is None:
            raise ValueError("Invalid normalized bbox")
        center_x = center[0] * image_width
        center_y = center[1] * image_height
        return center_x, center_y, x1, y1, width, height, rotation
    if len(bbox_norm) >= 4:
        x1, y1, x2, y2 = bbox_norm[0], bbox_norm[1], bbox_norm[2], bbox_norm[3]
        x = x1 * image_width
        y = y1 * image_height
        width = (x2 - x1) * image_width
        height = (y2 - y1) * image_height
        center_x = (x1 + x2) / 2 * image_width
        center_y = (y1 + y2) / 2 * image_height
        return center_x, center_y, x, y, width, height, 0.0
    raise ValueError("Invalid normalized bbox")


def pixel_bbox_to_normalized(
    bbox: CalibBbox,
    image_width: int,
    image_height: int,
    *,
    rotation: float = 0.0,
) -> list[float]:
    """Convert pixel bbox to Cocopilot percent coords (4 or 8 values)."""
    if image_width <= 0 or image_height <= 0:
        raise ValueError("image_width and image_height must be positive")
    if not rotation:
        x1 = bbox.x / image_width
        y1 = bbox.y / image_height
        x2 = (bbox.x + bbox.width) / image_width
        y2 = (bbox.y + bbox.height) / image_height
        return [x1, y1, x2, y2]
    pivot_x, pivot_y = bbox.x, bbox.y
    corners = [
        (bbox.x, bbox.y),
        (bbox.x + bbox.width, bbox.y),
        (bbox.x + bbox.width, bbox.y + bbox.height),
        (bbox.x, bbox.y + bbox.height),
    ]
    rotated = [
        _rotate_point(cx, cy, pivot_x, pivot_y, rotation)
        for cx, cy in corners
    ]
    out: list[float] = []
    for cx, cy in rotated:
        out.extend([cx / image_width, cy / image_height])
    return out


def static_data_to_device_calibration(
    device_id: str,
    static_data: dict[str, Any],
) -> DeviceCalibrationResponse:
    """Parse B2B static_data into autocalib calibration response."""
    calib = static_data.get("calibration") or {}
    db_bboxes: dict[str, list[float]] = calib.get("bboxes") or {}
    width, height = image_dimensions(static_data)

    bboxes: list[DeviceCalibBbox] = []
    for index, (slot_id, coords) in enumerate(sorted(db_bboxes.items()), start=1):
        if not isinstance(coords, (list, tuple)) or len(coords) < 4:
            continue
        try:
            cx, cy, x, y, w, h, rot = normalized_bbox_to_pixels(
                list(coords), width, height,
            )
        except ValueError:
            continue
        bboxes.append(
            DeviceCalibBbox(
                spot_id=index,
                slot_id=str(slot_id),
                center_x=cx,
                center_y=cy,
                x=x,
                y=y,
                width=w,
                height=h,
                n_frames=1,
                confidence=1.0,
                rotation=rot,
            ),
        )

    return DeviceCalibrationResponse(
        device_id=device_id,
        image_width=width,
        image_height=height,
        bboxes=bboxes,
        slots=calib.get("slots") or {},
        street_name=calib.get("street_name"),
        nb_slots=int(calib.get("nb_slots") or len(db_bboxes) or 0),
        polygon=calib.get("polygon"),
        front_marker=calib.get("front_marker"),
    )


def build_calibration_post_payload(
    device_id: str,
    existing_static: dict[str, Any],
    request: CalibrationSaveRequest,
) -> dict[str, Any]:
    """Build Cocopilot ``POST /cocospots/{id}/static_data`` body."""
    existing_calib = (existing_static or {}).get("calibration") or {}
    width = request.image_width
    height = request.image_height

    db_bboxes: dict[str, list[float]] = {}
    orphan_bbox_keys: set[str] = set()
    for bbox in request.bboxes:
        slot_key = (bbox.slot_id or "").strip()
        spot_key = str(bbox.spot_id).strip()
        key = slot_key or spot_key
        if not key:
            continue
        if slot_key and spot_key != slot_key:
            orphan_bbox_keys.add(spot_key)
        rot = getattr(bbox, "rotation", 0.0) or 0.0
        db_bboxes[key] = pixel_bbox_to_normalized(
            bbox, width, height, rotation=float(rot),
        )

    request_slots = {
        slot_id: entry.model_dump() for slot_id, entry in request.slots.items()
    }

    if request.reset:
        merged_bboxes = db_bboxes
        merged_slots = request_slots
    else:
        merged_bboxes = {**(existing_calib.get("bboxes") or {}), **db_bboxes}
        for orphan in orphan_bbox_keys:
            merged_bboxes.pop(orphan, None)
        if request.replace_slots:
            merged_slots = request_slots
        else:
            merged_slots = {**(existing_calib.get("slots") or {}), **request_slots}

    nb_slots = request.nb_slots
    if nb_slots is None:
        nb_slots = len(merged_bboxes)

    calibration = {
        "device_id": device_id,
        "nb_slots": nb_slots,
        "polygon": request.polygon if request.polygon is not None else existing_calib.get("polygon") or [],
        "bboxes": merged_bboxes,
        "slots": merged_slots,
        "front_marker": (
            request.front_marker
            if request.front_marker is not None
            else existing_calib.get("front_marker") or {}
        ),
        "street_name": (
            request.street_name
            if request.street_name is not None
            else existing_calib.get("street_name")
        ),
    }
    return {"calibration": calibration}


class CocospotCalibrationClient:
    """Thin HTTP client for cocospot static_data + last_processed_image."""

    def __init__(self, base_url: str | None = None) -> None:
        self._base = (base_url or b2b_base_url()).rstrip("/")

    async def get_static_data(self, device_id: str) -> dict[str, Any]:
        url = f"{self._base}/cocospots/{device_id}/static_data"
        resp = await get_b2b_http_client().get(url)
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, dict):
            raise RuntimeError(f"Unexpected static_data shape for {device_id}")
        return data

    async def post_static_data(
        self,
        device_id: str,
        payload: dict[str, Any],
        *,
        reset: bool = False,
    ) -> Any:
        url = f"{self._base}/cocospots/{device_id}/static_data"
        resp = await get_b2b_http_client().post(url, params={"reset": str(reset).lower()}, json=payload)
        resp.raise_for_status()
        return resp.json()

    async def get_last_processed_image(
        self,
        device_id: str,
        *,
        draw: bool = True,
    ) -> dict[str, Any]:
        url = f"{self._base}/cocospots/{device_id}/last_processed_image"
        resp = await get_b2b_http_client().get(url, params={"draw": str(draw).lower()})
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, dict):
            raise RuntimeError(f"Unexpected last_processed_image shape for {device_id}")
        return data


async def fetch_device_calibration(device_id: str) -> DeviceCalibrationResponse:
    """Load calibration from B2B static_data."""
    if not b2b_enabled():
        raise RuntimeError("B2B sync is disabled (B2B_ENABLED=false)")
    client = CocospotCalibrationClient()
    static_data = await client.get_static_data(device_id)
    return static_data_to_device_calibration(device_id, static_data)


async def save_device_calibration(device_id: str, request: CalibrationSaveRequest) -> dict[str, Any]:
    """Merge and POST calibration to B2B (Cocopilot contract)."""
    if not b2b_enabled():
        raise RuntimeError("B2B sync is disabled (B2B_ENABLED=false)")
    client = CocospotCalibrationClient()
    existing: dict[str, Any] = {}
    try:
        existing = await client.get_static_data(device_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            raise
        logger.info("No existing static_data for %s — creating calibration", device_id)

    existing_calib = (existing or {}).get("calibration") or {}
    existing_bbox_keys = set((existing_calib.get("bboxes") or {}).keys())
    existing_slot_keys = set((existing_calib.get("slots") or {}).keys())

    payload = build_calibration_post_payload(device_id, existing, request)
    calib = payload["calibration"]
    new_bbox_keys = set(calib["bboxes"].keys())
    new_slot_keys = set(calib["slots"].keys())
    removed_bbox_keys = sorted(existing_bbox_keys - new_bbox_keys)
    removed_slot_keys = sorted(existing_slot_keys - new_slot_keys)

    result = await client.post_static_data(device_id, payload, reset=request.reset)
    if removed_bbox_keys or removed_slot_keys:
        logger.info(
            "Calibration saved for %s — prod delete: %d bbox key(s) %s, "
            "%d slot key(s) %s (reset=%s, now %d bbox / %d slot)",
            device_id,
            len(removed_bbox_keys),
            removed_bbox_keys[:12],
            len(removed_slot_keys),
            removed_slot_keys[:12],
            request.reset,
            len(new_bbox_keys),
            len(new_slot_keys),
        )
    else:
        logger.info(
            "Calibration saved for %s (%d bbox keys, %d slot keys, reset=%s)",
            device_id,
            len(new_bbox_keys),
            len(new_slot_keys),
            request.reset,
        )
    return result if isinstance(result, dict) else {"ok": True}


async def fetch_calibration_image(device_id: str, *, draw: bool = True) -> dict[str, Any]:
    """Proxy B2B last_processed_image (base64 JPEG payload)."""
    if not b2b_enabled():
        raise RuntimeError("B2B sync is disabled (B2B_ENABLED=false)")
    client = CocospotCalibrationClient()
    return await client.get_last_processed_image(device_id, draw=draw)

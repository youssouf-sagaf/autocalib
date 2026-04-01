"""
Extract calibration bbox centers for a device (read-only).

Flow:
  1. static_data (device) → calibration.bboxes → les clés sont les slot_id
     (ex. 00P6gdq9Dy3AjA8kyeJb). Source: cv-backend Firestore (FIREBASE_CREDENTIALS).
  2. Pour chaque slot_id, lecture des coordonnées dans Firestore prod au chemin:
     /on_street/collections/slots_static/{slot_id}
     (ex. /on_street/collections/slots_static/00P6gdq9Dy3AjA8kyeJb).
     Credentials: FIRESTORE_PROD_CREDENTIALS (cocoparks-prod).
"""
from __future__ import annotations

import os
from typing import Any

DEFAULT_IMAGE_WIDTH = 1280
DEFAULT_IMAGE_HEIGHT = 480

CV_BACKEND_CREDENTIALS_ENV = "FIREBASE_CREDENTIALS"  # or CV_BACKEND_CREDENTIALS
FIRESTORE_PROD_CREDENTIALS_ENV = "FIRESTORE_PROD_CREDENTIALS"


def bbox_center_normalized(bbox: list[float]) -> tuple[float, float] | None:
    """Center from normalized bbox: 4 values (x1,y1,x2,y2) or 8+ (centroid)."""
    if not bbox or len(bbox) < 4:
        return None
    n = len(bbox)
    if n == 4:
        return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)
    xs = [bbox[i] for i in range(0, n, 2)]
    ys = [bbox[i] for i in range(1, n, 2)]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def get_calib_bbox_centers(
    static_data: dict[str, Any],
    image_width: int | None = None,
    image_height: int | None = None,
) -> list[dict[str, Any]]:
    """
    From static_data (device document), extract per-slot bbox centers.
    Les slot_id sont les clés de calibration.bboxes (utilisés pour lire
    on_street/collections/slots_static/{slot_id} dans Firestore prod).
    """
    calib = static_data.get("calibration") or {}
    bboxes = calib.get("bboxes") or {}  # { slot_id: [x1,y1,x2,y2,... ], ... }
    if not bboxes:
        return []
    w = image_width or (static_data.get("characteristics") or {}).get("image_width") or DEFAULT_IMAGE_WIDTH
    h = image_height or (static_data.get("characteristics") or {}).get("image_height") or DEFAULT_IMAGE_HEIGHT
    w, h = int(w), int(h)
    out = []
    for slot_id, bbox in bboxes.items():
        if not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
            continue
        center_norm = bbox_center_normalized(list(bbox))
        if center_norm is None:
            continue
        out.append({
            "slot_id": slot_id,
            "center_norm": center_norm,
            "center_px": (center_norm[0] * w, center_norm[1] * h),
        })
    return out


def _get_firestore_client(app_name: str, credential_path: str | None):
    """Return Firestore client for app_name using credential_path (path to service account JSON)."""
    if not credential_path or not os.path.isfile(credential_path):
        return None
    import firebase_admin
    from firebase_admin import credentials, firestore
    try:
        app = firebase_admin.get_app(app_name)
    except ValueError:
        cred = credentials.Certificate(credential_path)
        app = firebase_admin.initialize_app(cred, name=app_name)
    return firestore.client(app)


def get_static_data_from_firestore(device_id: str) -> dict[str, Any] | None:
    """Load static_data for device from cv-backend Firestore. Requires FIREBASE_CREDENTIALS or CV_BACKEND_CREDENTIALS."""
    path = (os.environ.get(CV_BACKEND_CREDENTIALS_ENV) or os.environ.get("CV_BACKEND_CREDENTIALS") or "").strip()
    if not path or not os.path.isfile(path):
        return None
    db = _get_firestore_client("cv_backend", path)
    if db is None:
        return None
    doc = db.collection("static_data").document(device_id).get()
    if doc.exists:
        return doc.to_dict()
    return None


def get_slot_coordinates_from_firestore(slot_ids: list[str]) -> dict[str, tuple[float, float]]:
    """
    Récupère (lat, lng) pour chaque slot_id dans Firestore cocoparks-prod.

    Chemin Firestore: /on_street/collections/slots_static/{slot_id}
    (ex. /on_street/collections/slots_static/00P6gdq9Dy3AjA8kyeJb).
    Les slot_id viennent des clés de calibration.bboxes (calib du device).
    Credentials: FIRESTORE_PROD_CREDENTIALS (fichier JSON service account prod).
    """
    path = (os.environ.get(FIRESTORE_PROD_CREDENTIALS_ENV) or "").strip()
    db = _get_firestore_client("slots_prod", path) if path and os.path.isfile(path) else None
    if db is None:
        return {}
    # on_street / collections / slots_static / {slot_id}
    ref = db.collection("on_street").document("collections").collection("slots_static")
    result = {}
    for slot_id in slot_ids:
        doc = ref.document(slot_id).get()
        if not doc.exists:
            continue
        data = doc.to_dict() or {}
        location = data.get("location") or {}
        lat, lng = location.get("lat"), location.get("lng")
        if lat is not None and lng is not None:
            result[slot_id] = (float(lat), float(lng))
    return result


def load_static_data_and_centers(
    device_id: str,
    image_width: int | None = None,
    image_height: int | None = None,
    static_data_json_path: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Load static_data (Firestore or JSON file) and compute calib bbox centers."""
    import json
    static_data = None
    if static_data_json_path and os.path.isfile(static_data_json_path):
        with open(static_data_json_path, encoding="utf-8") as f:
            static_data = json.load(f)
    if static_data is None:
        static_data = get_static_data_from_firestore(device_id)
    if not static_data:
        return [], None
    centers = get_calib_bbox_centers(static_data, image_width, image_height)
    return centers, static_data

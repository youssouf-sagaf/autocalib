#!/usr/bin/env python3
"""
Export slot coordinates from Firestore (cocoparks-prod) to a JSON file. Run from autocalib3 root.

  export FIRESTORE_PROD_CREDENTIALS=./database-cocoparks-firebase-adminsdk-e5647-350e2d1a78.json
  export FIREBASE_CREDENTIALS=/path/to/cv-backend-credentials.json
  python scripts/export_slots_json.py --device device_00000000d6a21d5e
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.calib_bbox_centers import (
    load_static_data_and_centers,
    get_slot_coordinates_from_firestore,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export slot coordinates from cocoparks-prod to JSON")
    parser.add_argument("--device", default="device_00000000d6a21d5e")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    device_id = args.device
    out_path = args.out or Path(f"slots_{device_id}.json")

    print(f"Device: {device_id}, Output: {out_path}")

    centers, static_data = load_static_data_and_centers(device_id)
    if not static_data:
        print("No static_data. Set FIREBASE_CREDENTIALS or CV_BACKEND_CREDENTIALS.")
        sys.exit(1)
    slot_ids = [c["slot_id"] for c in centers]
    if not slot_ids:
        print("No slot_ids in calib.")
        sys.exit(1)

    coords = get_slot_coordinates_from_firestore(slot_ids)
    if not coords:
        print("No coordinates. Set FIRESTORE_PROD_CREDENTIALS (cocoparks-prod key).")
        sys.exit(1)

    out_data = {sid: {"lat": lat, "lng": lng} for sid, (lat, lng) in coords.items()}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_data, f, indent=2, ensure_ascii=False)
    print(f"Written {len(out_data)} slots to {out_path}")


if __name__ == "__main__":
    main()

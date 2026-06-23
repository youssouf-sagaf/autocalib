"""Single GeoJSON schema v1 — atomic write, no parallel schemas.

This is the **only** place where metric → WGS84 conversion happens for
slot geometry (the outbound CRS gate).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.transform import Affine

from autoabsmap.export.models import GeoSlot, LngLat, SlotSource, SlotStatus, SlotType
from autoabsmap.generator_engine.models import PixelSlot
from autoabsmap.generator_engine.pixel_obb import pixel_obb_corner_points
from autoabsmap.io.atomic import write_json_atomic

logger = logging.getLogger(__name__)

__all__ = [
    "pixel_slots_to_geoslots",
    "geoslots_to_feature_collection",
    "geoslot_from_feature",
    "write_geojson",
]


def _pixel_to_world(
    px: float,
    py: float,
    affine: Affine,
) -> tuple[float, float]:
    """Convert pixel coordinates to native CRS coordinates via the affine."""
    x = affine.a * px + affine.b * py + affine.c
    y = affine.d * px + affine.e * py + affine.f
    return x, y


def _obb_corners_world(
    slot: PixelSlot,
    affine: Affine,
) -> list[tuple[float, float]]:
    """OBB corners in native CRS — same pixel convention as ``PixelSlot.corners``."""
    pixel_corners = pixel_obb_corner_points(
        slot.center_x, slot.center_y, slot.width, slot.height, slot.angle_rad,
    )
    return [_pixel_to_world(float(p[0]), float(p[1]), affine) for p in pixel_corners]


def pixel_slots_to_geoslots(
    slots: list[PixelSlot],
    affine: Affine,
    crs_epsg: int,
) -> list[GeoSlot]:
    """Convert pixel-space slots to WGS84 GeoSlots (the outbound CRS gate)."""
    if crs_epsg == 4326:
        transformer = None
    else:
        transformer = Transformer.from_crs(
            CRS.from_epsg(crs_epsg),
            CRS.from_epsg(4326),
            always_xy=True,
        )

    result: list[GeoSlot] = []
    for slot in slots:
        corners_native = _obb_corners_world(slot, affine)
        cx_native, cy_native = _pixel_to_world(slot.center_x, slot.center_y, affine)

        if transformer is not None:
            corners_wgs84 = [transformer.transform(x, y) for x, y in corners_native]
            lng, lat = transformer.transform(cx_native, cy_native)
        else:
            corners_wgs84 = corners_native
            lng, lat = cx_native, cy_native

        coords = [list(c) for c in corners_wgs84]
        coords.append(coords[0])

        status = SlotStatus.occupied if slot.class_id == 1 else SlotStatus.empty

        result.append(GeoSlot(
            slot_id=str(uuid.uuid4()),
            center=LngLat(lng=lng, lat=lat),
            polygon={"type": "Polygon", "coordinates": [coords]},
            source=slot.source,
            confidence=slot.confidence,
            status=status,
        ))

    logger.info("Converted %d pixel slots → GeoSlots (CRS %d → WGS84)", len(result), crs_epsg)
    return result


def geoslots_to_feature_collection(slots: list[GeoSlot]) -> dict[str, Any]:
    """Build a GeoJSON FeatureCollection from GeoSlots."""
    features = []
    for slot in slots:
        feature = {
            "type": "Feature",
            "geometry": slot.polygon.model_dump(),
            "properties": {
                "slot_id": slot.slot_id,
                "center_lng": slot.center.lng,
                "center_lat": slot.center.lat,
                "source": slot.source.value,
                "confidence": slot.confidence,
                "status": slot.status.value,
                "slot_type": slot.slot_type.value,
            },
        }
        features.append(feature)
    return {
        "type": "FeatureCollection",
        "features": features,
    }


def geoslot_from_feature(feature: dict[str, Any]) -> GeoSlot:
    """Reconstruct a GeoSlot from a GeoJSON Feature (schema v1)."""
    props = feature["properties"]
    raw_type = props.get("slot_type", SlotType.common.value)
    try:
        slot_type = SlotType(raw_type)
    except ValueError:
        logger.warning("Unknown slot_type %r — defaulting to common", raw_type)
        slot_type = SlotType.common
    return GeoSlot(
        slot_id=props["slot_id"],
        center=LngLat(lng=props["center_lng"], lat=props["center_lat"]),
        polygon=feature["geometry"],
        source=SlotSource(props["source"]),
        confidence=props["confidence"],
        status=SlotStatus(props["status"]),
        slot_type=slot_type,
    )


def write_geojson(path: str, slots: list[GeoSlot]) -> None:
    """Write a GeoJSON FeatureCollection atomically."""
    fc = geoslots_to_feature_collection(slots)
    write_json_atomic(path, fc)

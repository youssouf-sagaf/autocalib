"""Reprocessing helper models — request and result.

The Reprocessing Helper takes one correct slot (orientation, size, spacing)
and a scoped region, then auto-fills the missed area using the segmentation
mask and geometric row extension.
"""

from __future__ import annotations

import numpy as np
from geojson_pydantic import Polygon as GeoJSONPolygon
from pydantic import BaseModel, ConfigDict

from autoabsmap.export.models import GeoSlot

__all__ = ["ReprocessRequest", "ReprocessResult"]


class ReprocessRequest(BaseModel):
    """Input for a reprocessing call."""

    reference_slot: GeoSlot
    scope_polygon: GeoJSONPolygon
    existing_slots: list[GeoSlot]
    seg_mask: np.ndarray | None = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


class ReprocessResult(BaseModel):
    """Output of a reprocessing call — proposed slots to add."""

    proposed_slots: list[GeoSlot]

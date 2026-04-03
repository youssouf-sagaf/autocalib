"""ReprocessingHelper — auto-fill from reference slot + scope.

When the Generator Engine misses an entire pocket (no detections),
per-click manual Add is too slow. The Reprocessing Helper takes one
correct slot and a scoped region, then auto-fills the missed area
using the segmentation mask and geometric row extension.

Algorithm:
1. Extract geometry from reference slot
2. Clip scope with segmentation mask (if available)
3. Row extension from reference slot along row axis
4. Gap fill into adjacent rows
5. Dedup against existing_slots (IoU > 0.5)
6. Return proposals

Composes GeometricEngine from generator_engine/ — no duplication.
"""

from __future__ import annotations

import logging

from autoabsmap.reprocessing_helper.models import ReprocessRequest, ReprocessResult

logger = logging.getLogger(__name__)

__all__ = ["ReprocessingHelper"]


class ReprocessingHelper:
    """Auto-fill missed parking pockets from a reference slot + scope."""

    def reprocess(self, request: ReprocessRequest) -> ReprocessResult:
        """Propose new slots for the scoped region based on the reference slot.

        Returns proposed slots (source: 'auto_reprocess') for operator review.
        """
        # TODO: implement algorithm steps 1-6
        logger.warning("ReprocessingHelper.reprocess() not yet implemented — returning empty proposals")
        return ReprocessResult(proposed_slots=[])

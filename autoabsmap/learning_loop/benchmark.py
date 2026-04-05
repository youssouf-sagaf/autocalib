"""BenchmarkRunner — retest candidate models on historical corrected cases.

Before any model bundle is promoted to production, this module orchestrates:

1. **Retest** on historical sessions — run the candidate model on the same
   ``crops_geometry`` + ``imagery_provider`` conditions as past corrected sessions.
2. **Compare** outputs against ``baseline_merged.geojson`` (old model) and
   ``final_output.geojson`` (operator truth).
3. **Compute KPI delta** — old model vs candidate on all secondary KPIs.
4. **Publish benchmark report** with go/no-go decision.

The ``PipelineFactory`` protocol lets the runner remain agnostic about how the
pipeline is constructed — the caller injects a factory that builds a pipeline
with the candidate model weights.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Any, Callable, Protocol

from pydantic import BaseModel, Field

from autoabsmap.export.models import GeoSlot
from autoabsmap.generator_engine.models import PipelineRequest, PipelineResult
from autoabsmap.learning_loop.capture import SessionStore
from autoabsmap.learning_loop.models import (
    DeltaSummary,
    SessionKPIs,
    SessionTrace,
    compute_session_kpis,
)

logger = logging.getLogger(__name__)

__all__ = ["BenchmarkReport", "BenchmarkRunner", "MatchResult"]


# ------------------------------------------------------------------
# Slot matching
# ------------------------------------------------------------------

class SlotMatch(BaseModel):
    """A matched pair of slots (model output ↔ ground truth)."""

    model_slot: GeoSlot
    truth_slot: GeoSlot
    centroid_distance_m: float
    """Approximate distance between centroids (degrees → metres at ~111 km/deg)."""


class MatchResult(BaseModel):
    """Result of matching a model's output against operator ground truth."""

    matched: list[SlotMatch] = Field(default_factory=list)
    false_positives: list[GeoSlot] = Field(default_factory=list)
    """Model slots with no match in ground truth (would be deleted by operator)."""
    false_negatives: list[GeoSlot] = Field(default_factory=list)
    """Ground truth slots with no match in model output (would need manual add)."""

    @property
    def precision(self) -> float:
        tp = len(self.matched)
        fp = len(self.false_positives)
        return tp / (tp + fp) if (tp + fp) > 0 else 0.0

    @property
    def recall(self) -> float:
        tp = len(self.matched)
        fn = len(self.false_negatives)
        return tp / (tp + fn) if (tp + fn) > 0 else 0.0


def match_slots(
    model_slots: list[GeoSlot],
    truth_slots: list[GeoSlot],
    max_distance_deg: float = 3e-5,
) -> MatchResult:
    """Greedy spatial matching of model output against ground truth.

    Algorithm: compute all pairwise centroid distances, sort by distance,
    greedily assign closest pairs first (each slot matched at most once).

    Args:
        max_distance_deg: Maximum centroid distance in degrees for a valid
            match. Default ~3.3 m at the equator (3e-5 * 111_000).
    """
    if not model_slots or not truth_slots:
        return MatchResult(
            false_positives=list(model_slots),
            false_negatives=list(truth_slots),
        )

    # Build distance pairs
    pairs: list[tuple[float, int, int]] = []
    for i, ms in enumerate(model_slots):
        for j, ts in enumerate(truth_slots):
            dist = _centroid_distance_deg(ms, ts)
            if dist <= max_distance_deg:
                pairs.append((dist, i, j))

    pairs.sort(key=lambda p: p[0])

    matched_model: set[int] = set()
    matched_truth: set[int] = set()
    matched: list[SlotMatch] = []

    for dist, i, j in pairs:
        if i in matched_model or j in matched_truth:
            continue
        matched_model.add(i)
        matched_truth.add(j)
        matched.append(SlotMatch(
            model_slot=model_slots[i],
            truth_slot=truth_slots[j],
            centroid_distance_m=dist * 111_000,
        ))

    fps = [s for i, s in enumerate(model_slots) if i not in matched_model]
    fns = [s for j, s in enumerate(truth_slots) if j not in matched_truth]

    return MatchResult(
        matched=matched,
        false_positives=fps,
        false_negatives=fns,
    )


def _centroid_distance_deg(a: GeoSlot, b: GeoSlot) -> float:
    """Euclidean distance between two GeoSlot centroids in degrees."""
    dlng = a.center.lng - b.center.lng
    dlat = a.center.lat - b.center.lat
    return math.sqrt(dlng * dlng + dlat * dlat)


# ------------------------------------------------------------------
# Effort estimation from a MatchResult
# ------------------------------------------------------------------

def estimate_effort(match_result: MatchResult, geo_correction_threshold_m: float = 1.0) -> int:
    """Estimate the operator effort (manual actions) needed to correct a model's output.

    Effort = FP (deletions) + FN (additions) + geometric corrections.
    A matched pair counts as a geometric correction if the centroid distance
    exceeds ``geo_correction_threshold_m``.
    """
    n_fp = len(match_result.false_positives)
    n_fn = len(match_result.false_negatives)
    n_geo = sum(
        1 for m in match_result.matched
        if m.centroid_distance_m > geo_correction_threshold_m
    )
    return n_fp + n_fn + n_geo


# ------------------------------------------------------------------
# Pipeline factory protocol
# ------------------------------------------------------------------

class PipelineFactory(Protocol):
    """Builds a pipeline configured with candidate model weights.

    The benchmark runner calls this to create a pipeline that can re-run
    on historical crops.
    """

    def __call__(self, candidate_bundle: str) -> _PipelineCallable:
        ...


class _PipelineCallable(Protocol):
    """A callable that runs the pipeline on one crop and returns GeoSlots."""

    def __call__(self, request: PipelineRequest) -> PipelineResult:
        ...


# ------------------------------------------------------------------
# Benchmark report
# ------------------------------------------------------------------

class BenchmarkReport(BaseModel):
    """Result of a model candidate benchmark run."""

    candidate_bundle: str
    sessions_tested: int
    primary_kpi_delta: float
    """Negative = improvement (fewer manual actions with candidate model)."""
    secondary_kpis: dict[str, float]
    """KPI name → delta (negative = improvement)."""
    regression_flags: list[str]
    """Any KPI that got worse beyond threshold."""
    promoted: bool
    """Go/no-go: True only if primary KPI improved and no major regressions."""
    per_session_details: list[dict[str, Any]] = Field(default_factory=list)
    """Per-session breakdown for debugging."""


# ------------------------------------------------------------------
# Runner
# ------------------------------------------------------------------

class BenchmarkRunner:
    """Benchmark candidate model bundles against historical sessions.

    The runner loads each historical session, re-runs the candidate pipeline
    on the same crops, and compares the output against:

    - **baseline** (``baseline_merged.geojson``) — what the *old* model produced
    - **truth** (``final_output.geojson``) — operator-corrected ground truth

    Promotion rule:
    - Promote **only if** the primary KPI (manual effort) shows a net reduction.
    - And **no** secondary KPI shows a major regression (> ``regression_threshold``).
    """

    def __init__(
        self,
        store: SessionStore,
        *,
        max_match_distance_deg: float = 3e-5,
        geo_correction_threshold_m: float = 1.0,
        regression_threshold: float = 0.05,
    ) -> None:
        self._store = store
        self._max_match_dist = max_match_distance_deg
        self._geo_threshold = geo_correction_threshold_m
        self._regression_threshold = regression_threshold

    def run(
        self,
        candidate_bundle: str,
        session_dirs: list[Path],
        pipeline_fn: Callable[[PipelineRequest], PipelineResult] | None = None,
    ) -> BenchmarkReport:
        """Run the candidate model on historical sessions and compute KPI deltas.

        If ``pipeline_fn`` is provided, the runner re-runs the pipeline on each
        session's crops and compares the *new* output.  If ``pipeline_fn`` is
        ``None``, the runner performs an **offline benchmark** using only the
        stored baseline and final slots (useful for KPI recalculation without
        re-running inference).

        Returns:
            A :class:`BenchmarkReport` with the go/no-go promotion decision.
        """
        total_old_effort = 0
        total_new_effort = 0
        per_session: list[dict[str, Any]] = []
        old_kpi_sums: dict[str, float] = {}
        new_kpi_sums: dict[str, float] = {}
        sessions_tested = 0

        for session_dir in session_dirs:
            session_id = session_dir.name
            try:
                trace = self._store.load(session_id)
            except (FileNotFoundError, Exception) as exc:
                logger.warning("Skipping session %s: %s", session_id, exc)
                continue

            truth_slots = trace.final_slots
            if not truth_slots:
                logger.debug("Skipping session %s: no final slots", session_id)
                continue

            # --- Old model effort (from stored baseline) ---
            old_baseline = trace.baseline_slots
            if old_baseline:
                old_match = match_slots(
                    old_baseline, truth_slots, self._max_match_dist,
                )
                old_effort = estimate_effort(old_match, self._geo_threshold)
            else:
                # No baseline saved — fall back to stored delta
                old_effort = (
                    trace.delta.additions
                    + trace.delta.deletions
                    + trace.delta.geometric_corrections
                )
                old_match = None

            # --- New model (candidate) effort ---
            if pipeline_fn is not None:
                new_slots = self._run_candidate(trace, pipeline_fn)
                new_match = match_slots(
                    new_slots, truth_slots, self._max_match_dist,
                )
                new_effort = estimate_effort(new_match, self._geo_threshold)
            else:
                # Offline benchmark: only recalculate from stored data
                new_effort = old_effort
                new_match = old_match

            total_old_effort += old_effort
            total_new_effort += new_effort
            sessions_tested += 1

            # --- Per-session secondary KPIs ---
            old_kpis = self._secondary_kpis(
                old_match, old_baseline, truth_slots, old_effort,
            )
            new_kpis = self._secondary_kpis(
                new_match,
                new_slots if pipeline_fn else old_baseline,
                truth_slots,
                new_effort,
            ) if pipeline_fn or new_match else old_kpis

            for k, v in old_kpis.items():
                old_kpi_sums[k] = old_kpi_sums.get(k, 0.0) + v
            for k, v in new_kpis.items():
                new_kpi_sums[k] = new_kpi_sums.get(k, 0.0) + v

            per_session.append({
                "session_id": session_id,
                "old_effort": old_effort,
                "new_effort": new_effort,
                "effort_delta": new_effort - old_effort,
                "truth_slot_count": len(truth_slots),
                "old_kpis": old_kpis,
                "new_kpis": new_kpis,
            })

        # --- Aggregate ---
        primary_delta = (
            (total_new_effort - total_old_effort) if sessions_tested > 0 else 0.0
        )

        secondary_deltas: dict[str, float] = {}
        regression_flags: list[str] = []
        if sessions_tested > 0:
            for k in old_kpi_sums:
                avg_old = old_kpi_sums[k] / sessions_tested
                avg_new = new_kpi_sums.get(k, avg_old) / sessions_tested
                delta = avg_new - avg_old
                secondary_deltas[k] = round(delta, 6)
                # For "rate" KPIs (fp_rate, fn_rate, geo_correction_rate):
                # positive delta = regression. For useful_detection_rate:
                # negative delta = regression.
                if k == "useful_detection_rate" and delta < -self._regression_threshold:
                    regression_flags.append(k)
                elif k != "useful_detection_rate" and delta > self._regression_threshold:
                    regression_flags.append(k)

        promoted = (
            sessions_tested > 0
            and primary_delta < 0
            and len(regression_flags) == 0
        )

        report = BenchmarkReport(
            candidate_bundle=candidate_bundle,
            sessions_tested=sessions_tested,
            primary_kpi_delta=round(primary_delta, 4),
            secondary_kpis=secondary_deltas,
            regression_flags=regression_flags,
            promoted=promoted,
            per_session_details=per_session,
        )

        logger.info(
            "Benchmark complete: %d sessions, primary_delta=%.1f, promoted=%s",
            sessions_tested, primary_delta, promoted,
        )
        return report

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _run_candidate(
        self,
        trace: SessionTrace,
        pipeline_fn: Callable[[PipelineRequest], PipelineResult],
    ) -> list[GeoSlot]:
        """Re-run the candidate pipeline on a session's crops and merge results."""
        all_slots: list[GeoSlot] = []
        for crop_geojson in trace.crops:
            request = PipelineRequest(roi=crop_geojson)
            try:
                result = pipeline_fn(request)
                all_slots.extend(result.slots)
            except Exception as exc:
                logger.warning(
                    "Pipeline failed on session %s crop: %s",
                    trace.session_id, exc,
                )
        return all_slots

    def _secondary_kpis(
        self,
        match_result: MatchResult | None,
        model_slots: list[GeoSlot] | None,
        truth_slots: list[GeoSlot],
        effort: int,
    ) -> dict[str, float]:
        """Compute secondary KPIs from a match result."""
        n_model = len(model_slots) if model_slots else 0
        n_truth = len(truth_slots) if truth_slots else 0

        if match_result is None:
            return {
                "fp_rate": 0.0,
                "fn_rate": 0.0,
                "useful_detection_rate": 0.0,
                "geometric_correction_rate": 0.0,
            }

        n_fp = len(match_result.false_positives)
        n_fn = len(match_result.false_negatives)
        n_geo = sum(
            1 for m in match_result.matched
            if m.centroid_distance_m > self._geo_threshold
        )

        fp_rate = n_fp / n_model if n_model > 0 else 0.0
        fn_rate = n_fn / n_truth if n_truth > 0 else 0.0
        geo_rate = n_geo / n_truth if n_truth > 0 else 0.0
        useful = 1.0 - fp_rate

        return {
            "fp_rate": round(fp_rate, 6),
            "fn_rate": round(fn_rate, 6),
            "useful_detection_rate": round(useful, 6),
            "geometric_correction_rate": round(geo_rate, 6),
        }

"""BenchmarkRunner — retest candidate models on historical corrected cases.

Before any model bundle is promoted to production, this module orchestrates:
1. Retest on historical sessions
2. Compare outputs against baseline and operator truth
3. Compute KPI delta
4. Publish benchmark report with go/no-go decision
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel

logger = logging.getLogger(__name__)

__all__ = ["BenchmarkReport", "BenchmarkRunner"]


class BenchmarkReport(BaseModel):
    """Result of a model candidate benchmark run."""

    candidate_bundle: str
    sessions_tested: int
    primary_kpi_delta: float
    secondary_kpis: dict[str, float]
    regression_flags: list[str]
    promoted: bool


class BenchmarkRunner:
    """Benchmark candidate model bundles against historical sessions."""

    def run(
        self,
        candidate_bundle: str,
        session_dirs: list[Path],
    ) -> BenchmarkReport:
        """Run the candidate model on historical sessions and compute KPI deltas.

        Promotion rule:
        - Promote only if primary KPI (manual effort) shows net reduction
        - And no secondary KPI shows a major operational regression
        """
        # TODO: implement
        logger.warning("BenchmarkRunner.run() not yet implemented")
        return BenchmarkReport(
            candidate_bundle=candidate_bundle,
            sessions_tested=len(session_dirs),
            primary_kpi_delta=0.0,
            secondary_kpis={},
            regression_flags=[],
            promoted=False,
        )

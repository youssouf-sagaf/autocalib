"""Learning Loop — Block 4: Systematic Engine Retraining Loop.

Two responsibilities: session capture and benchmarking.
Entry points: ``SessionStore.save()``, ``BenchmarkRunner.run()``.
"""

from autoabsmap.learning_loop.benchmark import BenchmarkReport, BenchmarkRunner, MatchResult
from autoabsmap.learning_loop.capture import SessionStore
from autoabsmap.learning_loop.models import (
    CropMeta,
    DeltaSummary,
    DifficultyTag,
    EditEvent,
    EditEventType,
    ReprocessStep,
    SessionKPIs,
    SessionTrace,
    compute_session_kpis,
)

__all__ = [
    "BenchmarkReport",
    "BenchmarkRunner",
    "CropMeta",
    "DeltaSummary",
    "DifficultyTag",
    "EditEvent",
    "EditEventType",
    "MatchResult",
    "ReprocessStep",
    "SessionKPIs",
    "SessionStore",
    "SessionTrace",
    "compute_session_kpis",
]

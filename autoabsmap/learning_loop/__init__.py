"""Learning Loop — Block 4: Systematic Engine Retraining Loop.

Three responsibilities: capture, dataset building, and benchmarking.
Entry points: ``SessionStore.save()``, ``DatasetBuilder.build_*()``,
``BenchmarkRunner.run()``.

CLI (manual): ``python -m autoabsmap.learning_loop.export_training_layout`` and
``python -m autoabsmap.learning_loop.merge_training_datasets`` — see
``absolutemap-gen/scripts/README.md``.
"""

from autoabsmap.learning_loop.benchmark import BenchmarkReport, BenchmarkRunner, MatchResult
from autoabsmap.learning_loop.capture import SessionStore
from autoabsmap.learning_loop.dataset_builder import (
    DatasetBuilder,
    DatasetStats,
    DetectionTrainingSet,
    SegmentationTrainingSet,
)
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
    "DatasetBuilder",
    "DatasetStats",
    "DeltaSummary",
    "DetectionTrainingSet",
    "DifficultyTag",
    "EditEvent",
    "EditEventType",
    "MatchResult",
    "ReprocessStep",
    "SegmentationTrainingSet",
    "SessionKPIs",
    "SessionStore",
    "SessionTrace",
    "compute_session_kpis",
]

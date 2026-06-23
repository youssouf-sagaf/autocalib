"""Validation rules for parking-slot OBB annotations."""

from __future__ import annotations

from app.annotations.models import ObbAnnotation

MIN_AREA_PX = 400.0
AR_MIN = 1.5
AR_MAX = 3.0


class AnnotationValidationError(ValueError):
    pass


def validate_annotation(ann: ObbAnnotation) -> None:
    """Raise if the annotation violates slot geometry constraints."""
    if ann.area_px < MIN_AREA_PX:
        raise AnnotationValidationError(
            f"Area {ann.area_px:.1f} px² below minimum {MIN_AREA_PX}"
        )
    ar = ann.aspect_ratio
    if ar < AR_MIN or ar > AR_MAX:
        raise AnnotationValidationError(
            f"Aspect ratio {ar:.2f} outside slot range [{AR_MIN}, {AR_MAX}]"
        )


def validate_annotations(annotations: list[ObbAnnotation]) -> list[str]:
    """Return human-readable errors (empty list if all valid)."""
    errors: list[str] = []
    for i, ann in enumerate(annotations):
        try:
            validate_annotation(ann)
        except AnnotationValidationError as exc:
            errors.append(f"annotation[{i}]: {exc}")
    return errors

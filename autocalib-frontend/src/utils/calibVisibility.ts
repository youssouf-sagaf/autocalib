import type { CalibBbox } from '../types';

/** Same rule as the Calibration canvas / slider — only these are drawn and selectable. */
export function visibleCalibBboxes(
  bboxes: CalibBbox[],
  confidenceThreshold: number,
): CalibBbox[] {
  return bboxes.filter((b) => b.confidence >= confidenceThreshold);
}

/** Cocopilot-compatible calibration bbox % coords (4 or 8 values). */

import type { CalibBbox } from '../types';

export interface RotatedRectPixels {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX?: number;
  scaleY?: number;
}

function rotatePoint(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  angleDeg: number,
): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const tx = point.x - pivot.x;
  const ty = point.y - pivot.y;
  return {
    x: tx * cos - ty * sin + pivot.x,
    y: tx * sin + ty * cos + pivot.y,
  };
}

/** Pixel rect → normalized corner coords for B2B (4 or 8 values). */
export function percentCoordsFromRotatedRect(
  rect: RotatedRectPixels,
  canvasWidth: number,
  canvasHeight: number,
): number[] {
  const scaleX = rect.scaleX ?? 1;
  const scaleY = rect.scaleY ?? 1;
  const { x, y, width, height, rotation } = rect;
  if (!rotation) {
    return [
      x / canvasWidth,
      y / canvasHeight,
      (x + width) / canvasWidth,
      (y + height) / canvasHeight,
    ];
  }
  const topLeft = { x, y };
  const topRight = { x: x + width * scaleX, y };
  const bottomLeft = { x, y: y + height * scaleY };
  const bottomRight = { x: x + width * scaleX, y: y + height * scaleY };
  const pivot = { x, y };
  const corners = [
    rotatePoint(topLeft, pivot, rotation),
    rotatePoint(topRight, pivot, rotation),
    rotatePoint(bottomRight, pivot, rotation),
    rotatePoint(bottomLeft, pivot, rotation),
  ];
  return corners.flatMap((c) => [c.x / canvasWidth, c.y / canvasHeight]);
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const a = x2 - x1;
  const b = y2 - y1;
  return Math.sqrt(a * a + b * b);
}

/** Normalized coords (4 or 8) → pixel rect for canvas. */
export function rotatedRectFromPercentCoords(
  coords: number[],
  canvasWidth: number,
  canvasHeight: number,
): RotatedRectPixels {
  if (coords.length === 4) {
    const [c0, c1, c2, c3] = coords;
    const x = c0! * canvasWidth;
    const y = c1! * canvasHeight;
    const width = (c2! - c0!) * canvasWidth;
    const height = (c3! - c1!) * canvasHeight;
    return {
      x,
      y,
      width,
      height,
      rotation: 0,
    };
  }
  const px = coords.map((v, i) => (i % 2 === 0 ? v * canvasWidth : v * canvasHeight));
  const x1 = px[0]!;
  const y1 = px[1]!;
  const x2 = px[2]!;
  const y2 = px[3]!;
  const x7 = px[6]!;
  const y7 = px[7]!;
  const rotation = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const width = distance(x1, y1, x2, y2);
  const height = distance(x1, y1, x7, y7);
  return { x: x1, y: y1, width, height, rotation };
}

/** Scale pixel bbox fields from one image size to another (rotation unchanged). */
export function scaleCalibBbox(bbox: CalibBbox, sx: number, sy: number): CalibBbox {
  return {
    ...bbox,
    x: bbox.x * sx,
    y: bbox.y * sy,
    width: bbox.width * sx,
    height: bbox.height * sy,
    center_x: bbox.center_x * sx,
    center_y: bbox.center_y * sy,
  };
}

/** Rescale bboxes when reference dimensions differ from the displayed image. */
export function scaleCalibBboxesToDimensions(
  bboxes: CalibBbox[],
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): CalibBbox[] {
  if (
    fromWidth <= 0
    || fromHeight <= 0
    || toWidth <= 0
    || toHeight <= 0
    || (fromWidth === toWidth && fromHeight === toHeight)
  ) {
    return bboxes;
  }
  const sx = toWidth / fromWidth;
  const sy = toHeight / fromHeight;
  return bboxes.map((bbox) => scaleCalibBbox(bbox, sx, sy));
}

import type { CalibBbox } from '../types';

/** Stroke/fill a calib bbox, applying rotation around top-left (Cocopilot pivot). */
export function withCalibBboxTransform(
  ctx: CanvasRenderingContext2D,
  bbox: CalibBbox,
  draw: () => void,
): void {
  const rotation = bbox.rotation ?? 0;
  if (!rotation) {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(bbox.x, bbox.y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-bbox.x, -bbox.y);
  draw();
  ctx.restore();
}

export function fillCalibBbox(
  ctx: CanvasRenderingContext2D,
  bbox: CalibBbox,
): void {
  withCalibBboxTransform(ctx, bbox, () => {
    ctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
  });
}

export function strokeCalibBbox(
  ctx: CanvasRenderingContext2D,
  bbox: CalibBbox,
): void {
  withCalibBboxTransform(ctx, bbox, () => {
    ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
  });
}

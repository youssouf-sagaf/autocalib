import type { ObAnnotation, ObAnnotationClass, TileDetail } from '../types';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:8100';

export type WireObbAnnotation = {
  class_id: number;
  cx_px: number;
  cy_px: number;
  w_px: number;
  h_px: number;
  angle_rad: number;
};

export function tileImageUrl(imagePath: string): string {
  const path = imagePath.replace(/^\//, '');
  return `${API_BASE.replace(/\/$/, '')}/static/${path}`;
}

export function classToId(
  _annotationClass: Exclude<ObAnnotationClass, 'background'>,
): number {
  // Single-class dataset: vehicles only.
  return 0;
}

function idToClass(classId: number): Exclude<ObAnnotationClass, 'background'> {
  void classId;
  return 'vehicle';
}

export function obbToWire(ann: ObAnnotation): WireObbAnnotation {
  const [cx, cy, w, h, angle] = ann.obb;
  return {
    class_id: classToId(ann.class as Exclude<ObAnnotationClass, 'background'>),
    cx_px: cx,
    cy_px: cy,
    w_px: w,
    h_px: h,
    angle_rad: angle,
  };
}

export function wireToObb(raw: WireObbAnnotation, id?: string): ObAnnotation {
  return {
    id: id ?? crypto.randomUUID(),
    class: idToClass(raw.class_id),
    obb: [raw.cx_px, raw.cy_px, raw.w_px, raw.h_px, raw.angle_rad],
  };
}

export function tileRowToDetail(row: Record<string, unknown>): TileDetail {
  const imagePath = row.image_path as string | undefined;
  const rawAnnotations = row.annotations;
  return {
    id: String(row.id),
    name: row.name as string | undefined,
    created_at: row.created_at as string | undefined,
    image_url: imagePath ? tileImageUrl(imagePath) : undefined,
    width: (row.width_px as number | undefined) ?? (row.width as number | undefined),
    height:
      (row.height_px as number | undefined) ?? (row.height as number | undefined),
    annotations: Array.isArray(rawAnnotations)
      ? (rawAnnotations as WireObbAnnotation[]).map((a) => wireToObb(a))
      : [],
  };
}

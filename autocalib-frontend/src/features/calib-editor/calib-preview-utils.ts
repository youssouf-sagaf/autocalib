import type { CalibPreviewImage } from '../../types';

/** Rank 6 (or last rank when >5 items) is the aggregated overlay on rank-1 image. */
export function isAggregatedPreviewItem(
  item: CalibPreviewImage,
  items: CalibPreviewImage[],
): boolean {
  if (items.length <= 5) return false;
  const maxRank = Math.max(...items.map((i) => i.rank));
  return item.rank === maxRank;
}

/** Image key to fetch — aggregated entry uses rank 1's object_key. */
export function previewImageObjectKey(
  item: CalibPreviewImage,
  items: CalibPreviewImage[],
): string {
  if (isAggregatedPreviewItem(item, items)) {
    return items.find((i) => i.rank === 1)?.object_key ?? item.object_key;
  }
  return item.object_key;
}

/** Default selection: aggregated overlay when present, else rank 1. */
export function defaultPreviewSelection(
  items: CalibPreviewImage[],
): CalibPreviewImage | null {
  if (!items.length) return null;
  const aggregated = items.find((i) => isAggregatedPreviewItem(i, items));
  return aggregated ?? items.find((i) => i.rank === 1) ?? items[0] ?? null;
}

export const PREVIEW_LABEL_COLORS: Record<string, string> = {
  car: '#22c55e',
  moto: '#3b82f6',
  van: '#f59e0b',
};

export function previewLabelColor(labelName: string): string {
  return PREVIEW_LABEL_COLORS[labelName] ?? '#ef4444';
}

import type { CropRequest, EditEvent } from '../types';

function polygonDedupeKey(polygon: GeoJSON.Polygon): string {
  return JSON.stringify(polygon.coordinates);
}

function appendCropPolygons(
  crops: CropRequest[] | undefined,
  seen: Set<string>,
  out: GeoJSON.Polygon[],
): void {
  for (const crop of crops ?? []) {
    const key = polygonDedupeKey(crop.polygon);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(crop.polygon);
  }
}

/**
 * Crop ROIs to send on B2B Save so pipeline (sam3) slots inside drawn ROIs publish.
 *
 * After Launch, `state.crops` is cleared but ROIs remain on pipeline `modify` events
 * (`crops_before`). Include live map crops and any `crops` undo steps still in history.
 */
export function collectCropPolygonsForB2bSync(
  crops: CropRequest[],
  editHistory: EditEvent[],
  editIndex: number,
): GeoJSON.Polygon[] {
  const seen = new Set<string>();
  const out: GeoJSON.Polygon[] = [];

  appendCropPolygons(crops, seen, out);

  const history = editHistory.slice(0, editIndex);
  for (const evt of history) {
    if (evt.type === 'crops') {
      appendCropPolygons(evt.crops_before, seen, out);
      appendCropPolygons(evt.crops_after, seen, out);
      continue;
    }
    if (evt.type === 'modify') {
      appendCropPolygons(evt.crops_before, seen, out);
      appendCropPolygons(evt.crops_after, seen, out);
    }
  }

  return out;
}

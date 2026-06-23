import type { Slot } from '../types';

/** Deep-clone slots for snapshot comparison (delta vs B2B load). */
export function cloneSlotsSnapshot(slots: Slot[]): Slot[] {
  return slots.map((slot) => ({
    ...slot,
    center: { ...slot.center },
    polygon: JSON.parse(JSON.stringify(slot.polygon)) as GeoJSON.Polygon,
  }));
}

/** Prod slots removed since the last B2B snapshot (for sync payload). */
export function computeRemovedProdSlots(current: Slot[], snapshot: Slot[]): Slot[] {
  const currentIds = new Set(current.map((s) => s.slot_id).filter((id) => id.trim()));
  return snapshot.filter((s) => s.slot_id.trim() && !currentIds.has(s.slot_id));
}

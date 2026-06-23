import type { ParkingSlotType, Slot } from '../types';

const COORD_EPS = 1e-7;

/** Lightweight prod snapshot for dirty diff ({ lat, lng, slot_type } per slot_id). */
export type ProdSlotSnapshot = Record<
  string,
  { lat: number; lng: number; slot_type: ParkingSlotType | undefined }
>;

export function prodSnapshotFromSlots(slots: Slot[]): ProdSlotSnapshot {
  const out: ProdSlotSnapshot = {};
  for (const slot of slots) {
    const id = slot.slot_id.trim();
    if (!id) continue;
    out[id] = {
      lat: slot.center.lat,
      lng: slot.center.lng,
      slot_type: slot.slot_type,
    };
  }
  return out;
}

function slotCoordsOrTypeChanged(slot: Slot, prod: ProdSlotSnapshot[string]): boolean {
  if ((slot.slot_type ?? 'common') !== (prod.slot_type ?? 'common')) return true;
  if (Math.abs(slot.center.lat - prod.lat) > COORD_EPS) return true;
  if (Math.abs(slot.center.lng - prod.lng) > COORD_EPS) return true;
  return false;
}

/** Build dirty payload for POST slots/save from working set + prod snapshot. */
export function buildDirtySlotsPayload(
  slots: Slot[],
  prodSnapshot: ProdSlotSnapshot,
): { dirtySlots: Slot[] } {
  const prodIds = new Set(Object.keys(prodSnapshot));

  const dirtySlots: Slot[] = [];
  for (const slot of slots) {
    const sid = slot.slot_id.trim();
    if (!sid || !prodIds.has(sid)) {
      dirtySlots.push({ ...slot, slot_id: '' });
      continue;
    }
    const prod = prodSnapshot[sid];
    if (prod && slotCoordsOrTypeChanged(slot, prod)) {
      dirtySlots.push(slot);
    }
  }

  return { dirtySlots };
}

/** True when the dirty payload includes new pipeline slots expecting a B2B create. */
export function dirtyPayloadExpectsCreates(dirtySlots: Slot[]): boolean {
  return dirtySlots.some((s) => !s.slot_id.trim() && s.source !== 'manual');
}

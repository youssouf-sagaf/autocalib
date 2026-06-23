import type { Slot } from '../types';
import { uuid } from './uuid';

/** Normalize a slot id from map feature properties or API payloads. */
export function normalizeSlotId(slotId: string | undefined | null): string {
  return slotId?.trim() ?? '';
}

/** Stable React / selection key: prod ``slot_id`` or ephemeral ``_draftKey``. */
export function slotKey(slot: Slot): string {
  const prod = slot.slot_id.trim();
  if (prod) return prod;
  return slot._draftKey ?? '';
}

export function ensureDraftSlot(slot: Slot): Slot {
  const prod = slot.slot_id.trim();
  if (prod) return slot;
  return {
    ...slot,
    slot_id: '',
    _draftKey: slot._draftKey ?? uuid(),
  };
}

export function isProdSlotId(slotId: string, prodSnapshotIds: ReadonlySet<string>): boolean {
  const id = slotId.trim();
  return Boolean(id && prodSnapshotIds.has(id));
}

import type { Slot } from '../types';
import { createLogger } from './logger';
import { slotKey } from './slot-key';
import { buildDirtySlotsPayload, prodSnapshotFromSlots } from './slots-save';

const log = createLogger('dirty');

export interface AbsmapDirtyState {
  slots: Slot[];
  b2bSnapshotAtLoad: Slot[];
  dirtyProdSlotIds: string[];
  deletedProdIds: string[];
}

export function resetAbsmapDirtyTracking(state: AbsmapDirtyState): void {
  state.dirtyProdSlotIds = [];
  state.deletedProdIds = [];
}

export function markProdSlotDirty(state: AbsmapDirtyState, slotId: string): void {
  const id = slotId.trim();
  if (!id) return;
  if (!state.dirtyProdSlotIds.includes(id)) {
    state.dirtyProdSlotIds.push(id);
  }
}

/** True when the slot id is tracked as a prod delete for B2B PUT. */
export function markProdSlotDeleted(state: AbsmapDirtyState, slotId: string): boolean {
  const id = slotId.trim();
  if (!id) return false;
  const prodIds = new Set(Object.keys(prodSnapshotFromSlots(state.b2bSnapshotAtLoad)));
  if (!prodIds.has(id)) return false;
  if (!state.deletedProdIds.includes(id)) {
    state.deletedProdIds.push(id);
  }
  state.dirtyProdSlotIds = state.dirtyProdSlotIds.filter((x) => x !== id);
  return true;
}

function prodSnapshotIds(state: AbsmapDirtyState): Set<string> {
  return new Set(Object.keys(prodSnapshotFromSlots(state.b2bSnapshotAtLoad)));
}

/** True only when the removed slot is an explicit prod row (by ``slot_id`` or map pick key). */
function resolveProdIdForRemovedSlot(
  state: AbsmapDirtyState,
  removed: Slot,
  pickedKey?: string,
): string | null {
  const prodIds = prodSnapshotIds(state);
  const directId = removed.slot_id.trim();
  if (directId && prodIds.has(directId)) return directId;

  const key = pickedKey?.trim();
  if (key && prodIds.has(key)) return key;

  return null;
}

/**
 * After a slot is removed from the session, queue a B2B delete only when it is a prod slot.
 * Session-only pipeline drafts (``_draftKey``) are ignored — not a prod delete.
 */
export function markProdDeletesForRemovedSlot(
  state: AbsmapDirtyState,
  removed: Slot,
  pickedKey?: string,
): boolean {
  const prodId = resolveProdIdForRemovedSlot(state, removed, pickedKey);
  if (!prodId) {
    log.debug(`Session slot removed (not a prod delete): ${slotKey(removed).slice(0, 8)}…`);
    return false;
  }

  markProdSlotDeleted(state, prodId);
  state.slots = state.slots.filter((s) => s.slot_id.trim() !== prodId);
  log.info(`Prod delete queued: ${prodId.slice(0, 8)}…`);
  return true;
}

export function markProdDeletesForRemovedSlots(
  state: AbsmapDirtyState,
  removed: Slot[],
  pickedKeys?: string[],
): void {
  removed.forEach((slot, index) => {
    markProdDeletesForRemovedSlot(state, slot, pickedKeys?.[index]);
  });
}

export function assembleDirtySavePayload(state: AbsmapDirtyState): {
  dirtySlots: Slot[];
  deletedProdIds: string[];
} {
  const prodSnapshot = prodSnapshotFromSlots(state.b2bSnapshotAtLoad);
  const { dirtySlots } = buildDirtySlotsPayload(state.slots, prodSnapshot);
  return { dirtySlots, deletedProdIds: [...state.deletedProdIds] };
}

/** Prod-only overlay shown immediately on save (B2B snapshot + pending center/type updates). */
export function buildOptimisticProdOverlay(state: AbsmapDirtyState): Slot[] {
  const { dirtySlots, deletedProdIds } = assembleDirtySavePayload(state);
  const deleted = new Set(deletedProdIds.map((id) => id.trim()).filter(Boolean));
  const overlay = state.b2bSnapshotAtLoad
    .filter((s) => !deleted.has(s.slot_id.trim()))
    .map((s) => ({
      ...s,
      center: { ...s.center },
      polygon: JSON.parse(JSON.stringify(s.polygon)) as GeoJSON.Polygon,
    }));
  const byId = new Map(overlay.map((s) => [s.slot_id.trim(), s]));

  for (const dirty of dirtySlots) {
    const id = dirty.slot_id.trim();
    if (!id) continue;
    const prod = byId.get(id);
    if (!prod) continue;
    prod.center = { ...dirty.center };
    prod.slot_type = dirty.slot_type;
  }

  return overlay;
}

import type { Slot } from '../types';
import type { AbsmapDomainState } from '../store/slices/nested-state';
import { slotKey } from './slot-key';
import { excludeSlotsOverlappingExisting } from './slot-geometry';

export interface AbsmapDisplaySlotsInput {
  slots: Slot[];
  baselineSlots: Slot[];
  b2bSnapshotAtLoad: Slot[];
  slotMapDisplayMode: 'workspace' | 'prod';
  deletedProdIds?: string[];
}

function normalizedDeletedIds(deletedProdIds: string[] | undefined): Set<string> {
  return new Set((deletedProdIds ?? []).map((id) => id.trim()).filter(Boolean));
}

function displayReferenceSlots(absmap: AbsmapDisplaySlotsInput): Slot[] {
  if (absmap.baselineSlots.length > 0) return absmap.baselineSlots;
  return absmap.b2bSnapshotAtLoad;
}

function filterDeletedReference(reference: Slot[], deleted: Set<string>): Slot[] {
  if (deleted.size === 0) return reference;
  return reference.filter((slot) => {
    const prodId = slot.slot_id.trim();
    return !prodId || !deleted.has(prodId);
  });
}

/**
 * Composite map view: reference prod/baseline slots with workspace overrides and new drafts.
 * Workspace entries win on the same ``slotKey`` and on overlapping footprints (IoU);
 * prod deletes are omitted from reference.
 */
export function mergeWorkspaceDisplaySlots(
  reference: Slot[],
  workspace: Slot[],
  deletedProdIds: string[] = [],
): Slot[] {
  const deleted = normalizedDeletedIds(deletedProdIds);
  const filteredReference = filterDeletedReference(reference, deleted);
  const dedupedReference =
    workspace.length > 0
      ? excludeSlotsOverlappingExisting(filteredReference, workspace)
      : filteredReference;

  if (workspace.length === 0) {
    return dedupedReference;
  }

  const byKey = new Map<string, Slot>();
  for (const slot of dedupedReference) {
    const key = slotKey(slot);
    if (!key) continue;
    byKey.set(key, slot);
  }
  for (const slot of workspace) {
    const key = slotKey(slot);
    if (!key) continue;
    byKey.set(key, slot);
  }
  return [...byKey.values()];
}

/** Same slot list resolution as the absolute map layers (reference + workspace overlay). */
export function resolveAbsmapDisplaySlots(absmap: AbsmapDisplaySlotsInput): Slot[] {
  if (absmap.slotMapDisplayMode === 'prod') {
    return absmap.b2bSnapshotAtLoad;
  }

  return mergeWorkspaceDisplaySlots(
    displayReferenceSlots(absmap),
    absmap.slots,
    absmap.deletedProdIds,
  );
}

/** Display slots from absmap domain state (pairing zone commit, save, auto-suggest). */
export function absmapDisplaySlotsFromDomain(
  absmap: Pick<
    AbsmapDomainState,
    'slots' | 'baselineSlots' | 'b2bSnapshotAtLoad' | 'slotMapDisplayMode' | 'deletedProdIds'
  >,
): Slot[] {
  return resolveAbsmapDisplaySlots(absmap);
}

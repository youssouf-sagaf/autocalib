import type { CalibBbox, PairingLink } from '../types';
import { PAIR_PALETTE } from '../types';

function shortSlotId(slotId: string): string {
  const trimmed = slotId.trim();
  return trimmed.length > 28 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

/** Source of truth for prod pairing writes: absmap ``slot_id`` → calib ``spot_id``. */
export type PairingBySlotId = Record<string, number>;

export function pairingLinksFromMap(map: PairingBySlotId): PairingLink[] {
  return Object.entries(map).map(([slotId, bboxSpotId], index) => ({
    id: `link-${slotId}`,
    slotId,
    bboxSpotId,
    colorIndex: index % PAIR_PALETTE.length,
  }));
}

export function setPairingLink(map: PairingBySlotId, slotId: string, bboxSpotId: number): PairingBySlotId {
  return { ...map, [slotId]: bboxSpotId };
}

export function removePairingForSlot(map: PairingBySlotId, slotId: string): PairingBySlotId {
  const next = { ...map };
  delete next[slotId];
  return next;
}

export function removePairingForBbox(map: PairingBySlotId, bboxSpotId: number): PairingBySlotId {
  const next = { ...map };
  for (const [slotId, spotId] of Object.entries(next)) {
    if (spotId === bboxSpotId) delete next[slotId];
  }
  return next;
}

export function syncPairingMapFromLinks(links: PairingLink[]): PairingBySlotId {
  const out: PairingBySlotId = {};
  for (const link of links) {
    out[link.slotId] = link.bboxSpotId;
  }
  return out;
}

/** Pairings that will be persisted — slot linked to a bbox still in the workspace. */
export function activePairingEntries(
  pairingBySlotId: PairingBySlotId,
  bboxes: CalibBbox[],
): { slotId: string; bboxSpotId: number }[] {
  const spotIds = new Set(bboxes.map((b) => b.spot_id));
  return Object.entries(pairingBySlotId)
    .filter(([, bboxSpotId]) => spotIds.has(bboxSpotId))
    .map(([slotId, bboxSpotId]) => ({ slotId, bboxSpotId }))
    .sort((a, b) => a.slotId.localeCompare(b.slotId) || a.bboxSpotId - b.bboxSpotId);
}

export function formatPairingSaveLabels(
  pairingBySlotId: PairingBySlotId,
  bboxes: CalibBbox[],
): string[] {
  return activePairingEntries(pairingBySlotId, bboxes).map(
    ({ slotId, bboxSpotId }) => `${shortSlotId(slotId)} ↔ bbox #${bboxSpotId}`,
  );
}

/** Resolve which side (map slots vs image bboxes) to reverse for pairing order. */
export function resolvePairingReverseSide(args: {
  activeZoneSide: 'map' | 'image' | null;
  focusedPanel: 'map' | 'image' | null;
}): 'map' | 'image' {
  return args.activeZoneSide ?? args.focusedPanel ?? 'image';
}

/** Spatial baseline order for reversing pairings without a committed zone polygon. */
export function pairingOrderForReverse(args: {
  links: PairingLink[];
  slots: Array<{ slot_id: string; center: { lng: number; lat: number } }>;
  bboxes: Array<{ spot_id: number }>;
  dbSlots?: Record<string, { lat: number; lng: number }>;
}): { slotIds: string[]; bboxSpotIds: number[] } | null {
  const slotById = new Map(args.slots.map((s) => [s.slot_id, s]));
  const bboxSpots = new Set(args.bboxes.map((b) => b.spot_id));

  const slotCenter = (slotId: string): { lng: number; lat: number } | null => {
    const fromDisplay = slotById.get(slotId);
    if (fromDisplay) return fromDisplay.center;
    const fromDb = args.dbSlots?.[slotId];
    if (fromDb) return { lng: fromDb.lng, lat: fromDb.lat };
    return null;
  };

  const entries = args.links.filter((link) => {
    if (!bboxSpots.has(link.bboxSpotId)) return false;
    return slotCenter(link.slotId) != null;
  });
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => {
    const sa = slotCenter(a.slotId)!;
    const sb = slotCenter(b.slotId)!;
    return sa.lng - sb.lng || sa.lat - sb.lat;
  });

  const slotIds = sorted.map((entry) => entry.slotId);
  const bboxSpotIds = sorted.map((entry) => entry.bboxSpotId);
  return { slotIds, bboxSpotIds };
}

/** Count of pairings that would be reversed (zone scope or prod fallback). */
export function reversePairCount(args: {
  activeZone: { mapSlotIds: string[] } | null | undefined;
  links: PairingLink[];
  slots: Array<{ slot_id: string; center: { lng: number; lat: number } }>;
  bboxes: Array<{ spot_id: number }>;
  dbSlots?: Record<string, { lat: number; lng: number }>;
}): number {
  if (args.activeZone && args.activeZone.mapSlotIds.length > 0) {
    return args.activeZone.mapSlotIds.length;
  }
  return pairingOrderForReverse({
    links: args.links,
    slots: args.slots,
    bboxes: args.bboxes,
    dbSlots: args.dbSlots,
  })?.slotIds.length ?? 0;
}

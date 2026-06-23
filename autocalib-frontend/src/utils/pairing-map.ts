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

/** Spatial baseline order for reversing pairings without a committed zone polygon. */
export function pairingOrderForReverse(args: {
  links: PairingLink[];
  slots: Array<{ slot_id: string; center: { lng: number; lat: number } }>;
  bboxes: Array<{ spot_id: number }>;
  side: 'map' | 'image';
}): { slotIds: string[]; bboxSpotIds: number[] } | null {
  const slotById = new Map(args.slots.map((s) => [s.slot_id, s]));
  const bboxSpots = new Set(args.bboxes.map((b) => b.spot_id));
  const entries = args.links.filter(
    (link) => slotById.has(link.slotId) && bboxSpots.has(link.bboxSpotId),
  );
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => {
    const sa = slotById.get(a.slotId)!;
    const sb = slotById.get(b.slotId)!;
    return sa.center.lng - sb.center.lng || sa.center.lat - sb.center.lat;
  });

  let slotIds = sorted.map((entry) => entry.slotId);
  let bboxSpotIds = sorted.map((entry) => entry.bboxSpotId);
  if (args.side === 'map') slotIds = [...slotIds].reverse();
  else bboxSpotIds = [...bboxSpotIds].reverse();

  return { slotIds, bboxSpotIds };
}

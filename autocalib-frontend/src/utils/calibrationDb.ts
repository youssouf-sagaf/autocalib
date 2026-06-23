import type {
  CalibrationSaveRequest,
  CalibrationSlotEntry,
  DeviceCalibBbox,
  PairingLink,
  Slot,
} from '../types';
import { PAIR_PALETTE } from '../types';
import { createLogger } from './logger';
import type { PairingBySlotId } from './pairing-map';
import { pairingLinksFromMap } from './pairing-map';

const slotsLog = createLogger('pairing-save');

function shortId(id: string): string {
  const t = id.trim();
  return t.length > 12 ? `${t.slice(0, 8)}…` : t;
}

/** Build Cocopilot calibration.slots from pairing links + absmap slots. */
export function buildCalibrationSlotsFromPairing(
  pairingBySlotId: PairingBySlotId,
  absmapSlots: Slot[],
  dbSlots: Record<string, CalibrationSlotEntry> = {},
): Record<string, CalibrationSlotEntry> {
  const out: Record<string, CalibrationSlotEntry> = { ...dbSlots };
  const links = pairingLinksFromMap(pairingBySlotId);
  const absmapIds = new Set(absmapSlots.map((s) => s.slot_id.trim()).filter(Boolean));
  const resolved: string[] = [];
  const missingGeo: string[] = [];

  for (const link of links) {
    const slot = absmapSlots.find((s) => s.slot_id === link.slotId);
    if (!slot) {
      missingGeo.push(link.slotId);
      continue;
    }
    out[link.slotId] = {
      lat: slot.center.lat,
      lng: slot.center.lng,
      slot_type: slot.slot_type ?? 'standard',
    };
    resolved.push(link.slotId);
  }

  slotsLog.debug('buildCalibrationSlotsFromPairing', {
    pairingLinks: links.length,
    absmapPool: absmapSlots.length,
    resolved: resolved.length,
    missingGeo: missingGeo.map(shortId),
    pairs: links.map((l) => `${shortId(l.slotId)}↔#${l.bboxSpotId}`),
    slotKeys: Object.keys(out),
  });
  if (missingGeo.length > 0) {
    slotsLog.warn(
      `${missingGeo.length} paired slot(s) missing from absmap pool — no geo in calibration.slots`,
      missingGeo.map(shortId),
      { absmapPoolHas: [...absmapIds].slice(0, 5).map(shortId) },
    );
  }

  return out;
}

/** Attach slot_id keys from pairing links before POST. */
export function bboxesForCalibrationSave(
  bboxes: DeviceCalibBbox[],
  pairingBySlotId: PairingBySlotId,
): DeviceCalibBbox[] {
  const linkBySpot = new Map(
    Object.entries(pairingBySlotId).map(([slotId, spotId]) => [spotId, slotId]),
  );
  return bboxes.map((bbox) => ({
    ...bbox,
    slot_id: linkBySpot.get(bbox.spot_id) ?? bbox.slot_id ?? null,
  }));
}

/** B2B static_data.bboxes keys that would be written for this session snapshot. */
export function calibrationBboxDbKeys(bboxes: DeviceCalibBbox[]): Set<string> {
  const keys = new Set<string>();
  for (const bbox of bboxes) {
    const slotKey = (bbox.slot_id ?? '').trim();
    const spotKey = String(bbox.spot_id).trim();
    const key = slotKey || spotKey;
    if (key) keys.add(key);
  }
  return keys;
}

export function buildCalibrationSaveRequest(args: {
  bboxes: DeviceCalibBbox[];
  pairingBySlotId: PairingBySlotId;
  absmapSlots: Slot[];
  imageWidth: number;
  imageHeight: number;
  dbSlots?: Record<string, CalibrationSlotEntry>;
  reset?: boolean;
  pairingSave?: boolean;
}): CalibrationSaveRequest {
  const tagged = bboxesForCalibrationSave(args.bboxes, args.pairingBySlotId);
  const activeKeys = calibrationBboxDbKeys(tagged);

  let slots: Record<string, CalibrationSlotEntry>;
  if (args.pairingSave) {
    slots = buildCalibrationSlotsFromPairing(args.pairingBySlotId, args.absmapSlots, {});
  } else {
    const fromPairing = buildCalibrationSlotsFromPairing(
      args.pairingBySlotId,
      args.absmapSlots,
      {},
    );
    slots = {};
    for (const [id, entry] of Object.entries(args.dbSlots ?? {})) {
      if (activeKeys.has(id)) slots[id] = entry;
    }
    for (const [id, entry] of Object.entries(fromPairing)) {
      if (activeKeys.has(id)) slots[id] = entry;
    }
  }

  const request = {
    bboxes: tagged,
    slots,
    image_width: args.imageWidth,
    image_height: args.imageHeight,
    // Authoritative workspace snapshot — merge mode kept deleted prod bboxes alive.
    reset: args.reset ?? true,
    replace_slots: args.pairingSave ?? false,
  };

  slotsLog.debug('buildCalibrationSaveRequest', {
    pairingSave: args.pairingSave ?? false,
    reset: request.reset,
    replace_slots: request.replace_slots,
    pairingBySlotId: Object.keys(args.pairingBySlotId).length,
    absmapSlots: args.absmapSlots.length,
    bboxCount: tagged.length,
    slotCount: Object.keys(slots).length,
    bboxDbKeys: [...calibrationBboxDbKeys(tagged)],
    slotDbKeys: Object.keys(slots).map(shortId),
    bboxesWithoutSlotId: tagged.filter((b) => !(b.slot_id ?? '').trim()).map((b) => b.spot_id),
  });

  return request;
}

export function formatCalibrationSlotLabel(slotId: string): string {
  const trimmed = slotId.trim();
  if (!trimmed) return slotId;
  return trimmed.length > 28 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

export function formatCalibrationSlotLabels(slotIds: string[]): string[] {
  return slotIds.map(formatCalibrationSlotLabel);
}

/** Slot keys written on this save but not in the last DB load snapshot. */
/** Prod pairing snapshot: slot geo key present in both bbox.slot_id and calibration.slots. */
export function prodPairingBySlotIdFromDb(
  bboxes: DeviceCalibBbox[],
  dbSlots: Record<string, CalibrationSlotEntry>,
): PairingBySlotId {
  const out: PairingBySlotId = {};
  const slotKeys = new Set(Object.keys(dbSlots));
  for (const bbox of bboxes) {
    const slotId = bbox.slot_id?.trim();
    if (!slotId || !slotKeys.has(slotId)) continue;
    out[slotId] = bbox.spot_id;
  }
  return out;
}

/** Pairing snapshot at last DB load (prod bbox key → canvas spot #), slots in calibration.slots only. */
export function pairingBySlotIdFromDbSnapshot(
  dbBboxKeys: string[],
  meta: Record<string, CalibBboxProdMeta>,
  dbSlots: Record<string, CalibrationSlotEntry> = {},
): PairingBySlotId {
  const out: PairingBySlotId = {};
  const slotKeys = new Set(Object.keys(dbSlots));
  for (const key of dbBboxKeys) {
    if (!slotKeys.has(key)) continue;
    const entry = meta[key];
    if (entry) out[key] = entry.canvasSpotId;
  }
  return out;
}

export interface PairingSaveDiff {
  added: number;
  modified: number;
  deleted: number;
}

export type CalibrationSaveDiff = PairingSaveDiff;

export function calibrationBboxDbKey(bbox: DeviceCalibBbox): string {
  return (bbox.slot_id ?? '').trim() || String(bbox.spot_id).trim();
}

export function buildCalibrationBboxesByKey(
  bboxes: DeviceCalibBbox[],
): Record<string, DeviceCalibBbox> {
  const out: Record<string, DeviceCalibBbox> = {};
  for (const bbox of bboxes) {
    const key = calibrationBboxDbKey(bbox);
    if (key) out[key] = bbox;
  }
  return out;
}

function calibrationBboxGeometryEqual(a: DeviceCalibBbox, b: DeviceCalibBbox): boolean {
  return (
    a.center_x === b.center_x
    && a.center_y === b.center_y
    && a.x === b.x
    && a.y === b.y
    && a.width === b.width
    && a.height === b.height
    && (a.rotation ?? 0) === (b.rotation ?? 0)
    && (a.slot_id ?? '') === (b.slot_id ?? '')
  );
}

/** Compare prod bbox snapshot vs workspace request before save. */
export function diffCalibrationBboxes(
  dbBboxesByKey: Record<string, DeviceCalibBbox>,
  requestBboxes: DeviceCalibBbox[],
): CalibrationSaveDiff {
  const prevKeys = new Set(Object.keys(dbBboxesByKey));
  const nextByKey = buildCalibrationBboxesByKey(requestBboxes);
  const nextKeys = new Set(Object.keys(nextByKey));
  let added = 0;
  let modified = 0;
  let deleted = 0;

  for (const key of nextKeys) {
    if (!prevKeys.has(key)) {
      added += 1;
    } else if (!calibrationBboxGeometryEqual(dbBboxesByKey[key]!, nextByKey[key]!)) {
      modified += 1;
    }
  }
  for (const key of prevKeys) {
    if (!nextKeys.has(key)) deleted += 1;
  }
  return { added, modified, deleted };
}

/** Compare prod pairing snapshot vs workspace pairing before save. */
export function diffPairingBySlotId(
  previous: PairingBySlotId,
  next: PairingBySlotId,
): PairingSaveDiff {
  const prevKeys = new Set(Object.keys(previous));
  const nextKeys = new Set(Object.keys(next));
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const slotId of nextKeys) {
    if (!prevKeys.has(slotId)) {
      added += 1;
    } else if (previous[slotId] !== next[slotId]) {
      modified += 1;
    }
  }
  for (const slotId of prevKeys) {
    if (!nextKeys.has(slotId)) deleted += 1;
  }
  return { added, modified, deleted };
}

/** Slot ids present in prod snapshot but absent from workspace draft (unpair pending save). */
export function deletedPairingSlotIds(
  previous: PairingBySlotId,
  next: PairingBySlotId,
): string[] {
  const nextKeys = new Set(Object.keys(next));
  return Object.keys(previous).filter((slotId) => !nextKeys.has(slotId));
}

export function formatDeletedPairingLabels(
  previous: PairingBySlotId,
  next: PairingBySlotId,
): string[] {
  return deletedPairingSlotIds(previous, next).map((slotId) => {
    const spotId = previous[slotId];
    const label = formatCalibrationSlotLabel(slotId);
    return spotId != null ? `${label} ↔ bbox #${spotId}` : label;
  });
}

export function countPairingDraftChanges(
  prod: PairingBySlotId,
  draft: PairingBySlotId,
): number {
  const diff = diffPairingBySlotId(prod, draft);
  return diff.added + diff.modified + diff.deleted;
}

export function calibrationSlotKeysAdded(
  dbSlots: Record<string, CalibrationSlotEntry>,
  requestSlots: Record<string, CalibrationSlotEntry>,
): string[] {
  const previous = new Set(Object.keys(dbSlots));
  return Object.keys(requestSlots).filter((slotId) => !previous.has(slotId));
}

/** Prod bbox keys dropped by this save (present in DB snapshot, absent from workspace). */
export function calibrationBboxKeysRemoved(
  dbBboxKeys: string[],
  requestBboxes: DeviceCalibBbox[],
): string[] {
  const nextKeys = calibrationBboxDbKeys(requestBboxes);
  return dbBboxKeys.filter((key) => !nextKeys.has(key));
}

/** Snapshot at DB load — maps prod static_data key → calib canvas spot #. */
export interface CalibBboxProdMeta {
  canvasSpotId: number;
  prodKey: string;
}

export function buildCalibBboxProdMetaFromLoad(
  bboxes: DeviceCalibBbox[],
): Record<string, CalibBboxProdMeta> {
  const meta: Record<string, CalibBboxProdMeta> = {};
  for (const bbox of bboxes) {
    const key = (bbox.slot_id ?? '').trim() || String(bbox.spot_id).trim();
    if (!key) continue;
    meta[key] = { canvasSpotId: bbox.spot_id, prodKey: key };
  }
  return meta;
}

/**
 * Human-readable label for a removed prod bbox key.
 * Prod keys are often numeric strings (legacy spot_id) — not the canvas # shown in Calib.
 */
export function formatRemovedCalibBboxLabel(
  prodKey: string,
  meta: Record<string, CalibBboxProdMeta>,
  pairingBySlotId: PairingBySlotId,
): string {
  const pairedSlotId = Object.keys(pairingBySlotId).find((slotId) => slotId === prodKey);
  if (pairedSlotId) {
    return pairedSlotId.length > 28 ? `${pairedSlotId.slice(0, 24)}…` : pairedSlotId;
  }

  const entry = meta[prodKey];
  if (entry) {
    const slotFromCanvasSpot = Object.entries(pairingBySlotId).find(
      ([, spotId]) => spotId === entry.canvasSpotId,
    )?.[0];
    if (slotFromCanvasSpot) {
      return slotFromCanvasSpot.length > 28
        ? `${slotFromCanvasSpot.slice(0, 24)}…`
        : slotFromCanvasSpot;
    }
    return `bbox #${entry.canvasSpotId}`;
  }

  if (/^\d+$/.test(prodKey)) {
    return `bbox #${prodKey}`;
  }
  return prodKey;
}

export function formatRemovedCalibBboxLabels(
  prodKeys: string[],
  meta: Record<string, CalibBboxProdMeta>,
  pairingBySlotId: PairingBySlotId,
): string[] {
  return prodKeys.map((key) => formatRemovedCalibBboxLabel(key, meta, pairingBySlotId));
}

/** Prod pairing snapshot: one link per bbox that already has a ``slot_id`` (static_data key). */
export function pairingLinksFromDbBboxes(bboxes: DeviceCalibBbox[]): PairingLink[] {
  const added: PairingLink[] = [];
  let colorIndex = 0;
  for (const bbox of bboxes) {
    const slotId = bbox.slot_id?.trim();
    if (!slotId) continue;
    added.push({
      id: `db-${slotId}-${bbox.spot_id}`,
      slotId,
      bboxSpotId: bbox.spot_id,
      colorIndex: colorIndex % PAIR_PALETTE.length,
    });
    colorIndex += 1;
  }
  return added;
}

/** Auto-create pairing links when DB bbox keys match absmap slot ids. */
export function autoLinksFromDbBboxes(
  bboxes: DeviceCalibBbox[],
  absmapSlotIds: Set<string>,
  existingLinks: PairingLink[],
): PairingLink[] {
  const linkedSpots = new Set(existingLinks.map((l) => l.bboxSpotId));
  const linkedSlots = new Set(existingLinks.map((l) => l.slotId));
  const added: PairingLink[] = [];
  let colorIndex = existingLinks.length;

  for (const bbox of bboxes) {
    const slotId = bbox.slot_id?.trim();
    if (!slotId || !absmapSlotIds.has(slotId)) continue;
    if (linkedSpots.has(bbox.spot_id) || linkedSlots.has(slotId)) continue;
    added.push({
      id: `db-${slotId}-${bbox.spot_id}`,
      slotId,
      bboxSpotId: bbox.spot_id,
      colorIndex: colorIndex % PAIR_PALETTE.length,
    });
    colorIndex += 1;
    linkedSpots.add(bbox.spot_id);
    linkedSlots.add(slotId);
  }
  return added;
}

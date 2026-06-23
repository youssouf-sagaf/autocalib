import type { OrientedRect, Slot } from '../types';
import { slotKey } from './slot-key';
import { uuid } from './uuid';

/** Match ``autoabsmap`` ``default_slot_w_m`` / depth prior (~2.5 m × 5 m). */
export const DEFAULT_WIDTH_M = 2.5;
export const DEFAULT_HEIGHT_M = 5.0;
/** Hard cap on tiled slots per seed to avoid runaway loops. */
export const TILE_ROW_MAX_PER_SEED = 200;

/** Geometric tolerance when testing OBB overlap (metres). */
const TILE_ROW_OVERLAP_EPS_M = 0.10;

/** Visual gap between adjacent ghost bboxes (metres). */
const TILE_ROW_GAP_M = 0.15;

export interface Placement {
  /** Ephemeral draft key — not a prod ``slot_id``. */
  draftKey: string;
  centerLng: number;
  centerLat: number;
  widthM: number;
  heightM: number;
  angle: number;
}

/**
 * Approximate distance in metres between two WGS84 points.
 * Equirectangular projection — accurate for sub-km distances.
 */
export function approxDistanceM(
  lng1: number, lat1: number,
  lng2: number, lat2: number,
): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const avgLat = (lat1 + lat2) / 2 * Math.PI / 180;
  const dx = dLng * Math.cos(avgLat) * R;
  const dy = dLat * R;
  return Math.sqrt(dx * dx + dy * dy);
}

interface MetersPerDegree {
  mPerDegLng: number;
  mPerDegLat: number;
}

function metersPerDegreeAt(lat: number): MetersPerDegree {
  const R = 6_371_000;
  const latRad = (lat * Math.PI) / 180;
  return {
    mPerDegLng: (Math.PI / 180) * R * Math.cos(latRad),
    mPerDegLat: (Math.PI / 180) * R,
  };
}

/**
 * Extract width (short edge), height (long edge), and orientation angle from an OBB
 * polygon (5-coord ring: 4 corners + closing duplicate).
 *
 * `angle` matches `buildObbPolygon(..., angleRad)`: unit vector along local **height**
 * (+y after rotation) is (-sin(angle), cos(angle)) in east/north metres — so we derive
 * angle from the long-edge direction in metre space via atan2(-vx, vy), not atan2(Δlat, Δlng).
 */
export function extractObbMetrics(polygon: GeoJSON.Polygon): {
  width: number;
  height: number;
  angle: number;
} {
  const coords = polygon.coordinates[0];
  if (!coords || coords.length < 4) {
    return { width: DEFAULT_WIDTH_M, height: DEFAULT_HEIGHT_M, angle: 0 };
  }

  const [p0, p1, p2] = coords as [[number, number], [number, number], [number, number]];
  const edge1 = approxDistanceM(p0[0], p0[1], p1[0], p1[1]);
  const edge2 = approxDistanceM(p1[0], p1[1], p2[0], p2[1]);

  const isEdge1Longer = edge1 >= edge2;
  const height = isEdge1Longer ? edge1 : edge2;
  const width = isEdge1Longer ? edge2 : edge1;

  const [refA, refB] = isEdge1Longer ? [p0, p1] : [p1, p2];
  const latMid = (refA[1] + refB[1]) / 2;
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(latMid);
  const dLng = refB[0] - refA[0];
  const dLat = refB[1] - refA[1];
  let vx = dLng * mPerDegLng;
  let vy = dLat * mPerDegLat;
  const norm = Math.hypot(vx, vy);
  if (norm < 1e-12) {
    return { width, height, angle: 0 };
  }
  vx /= norm;
  vy /= norm;
  const angle = Math.atan2(-vx, vy);

  return { width, height, angle };
}

/**
 * Build an OBB polygon (GeoJSON) from center, dimensions (metres), and angle (radians).
 */
export function buildObbPolygon(
  centerLng: number,
  centerLat: number,
  widthM: number,
  heightM: number,
  angleRad: number,
): GeoJSON.Polygon {
  const R = 6_371_000;
  const latRad = centerLat * Math.PI / 180;
  const mPerDegLat = (Math.PI / 180) * R;
  const mPerDegLng = (Math.PI / 180) * R * Math.cos(latRad);

  const hw = widthM / 2;
  const hh = heightM / 2;

  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const localCorners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];

  const coords: [number, number][] = localCorners.map(([lx, ly]) => {
    const rx = lx * cosA - ly * sinA;
    const ry = lx * sinA + ly * cosA;
    return [
      centerLng + rx / mPerDegLng,
      centerLat + ry / mPerDegLat,
    ];
  });

  coords.push(coords[0]!);
  return { type: 'Polygon', coordinates: [coords] };
}

export function findKNearest(slots: Slot[], lng: number, lat: number, k: number): Slot[] {
  if (slots.length === 0) return [];
  const withDist = slots.map((s) => ({
    slot: s,
    dist: approxDistanceM(lng, lat, s.center.lng, s.center.lat),
  }));
  withDist.sort((a, b) => a.dist - b.dist);
  return withDist.slice(0, k).map((d) => d.slot);
}

/** True when the operator can use absmap edit tools (session, baseline, or prod overlay). */
export function hasAbsmapEditableSlots(
  slots: Slot[],
  baselineSlots: Slot[],
  b2bSnapshotAtLoad: Slot[] = [],
): boolean {
  return slots.length > 0 || baselineSlots.length > 0 || b2bSnapshotAtLoad.length > 0;
}

/** Deduped union for ADD / reprocess / tile-row sizing (job + baseline + prod reference). */
export function mergeSlotsForPlacementHints(...groups: readonly Slot[][]): Slot[] {
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const group of groups) {
    for (const slot of group) {
      const key = slotKey(slot);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(slot);
    }
  }
  return out;
}

/**
 * Working slots shown on the absmap (same rule as MapPanel).
 * When the session has edits in `slots`, baseline is not merged — avoids stale geometry after straighten.
 */
export function activeSessionSlots(slots: Slot[], baselineSlots: Slot[]): Slot[] {
  return slots.length > 0 ? slots : baselineSlots;
}

const PLACEMENT_NEIGHBOR_K = 6;

/**
 * Default OBB size for manual placement: average nearby slots, else parking priors.
 */
export function computePlacementDefaultsFromNeighbors(
  hintSlots: Slot[],
  lng: number,
  lat: number,
): Pick<Placement, 'widthM' | 'heightM' | 'angle'> {
  const neighbors = findKNearest(hintSlots, lng, lat, PLACEMENT_NEIGHBOR_K);
  if (neighbors.length === 0) {
    return { widthM: DEFAULT_WIDTH_M, heightM: DEFAULT_HEIGHT_M, angle: 0 };
  }

  const metrics = neighbors.map((s) => extractObbMetrics(s.polygon));
  let widthM = metrics.reduce((sum, m) => sum + m.width, 0) / metrics.length;
  let heightM = metrics.reduce((sum, m) => sum + m.height, 0) / metrics.length;
  widthM = Math.max(DEFAULT_WIDTH_M, widthM);
  heightM = Math.max(DEFAULT_HEIGHT_M, heightM);
  widthM = Math.max(widthM, heightM * 0.4);

  const sinSum = metrics.reduce((sum, m) => sum + Math.sin(m.angle), 0);
  const cosSum = metrics.reduce((sum, m) => sum + Math.cos(m.angle), 0);
  const angle = Math.atan2(sinSum / metrics.length, cosSum / metrics.length);
  return { widthM, heightM, angle };
}

export function placementToSlot(p: Placement): Slot {
  return {
    slot_id: '',
    _draftKey: p.draftKey,
    center: { lng: p.centerLng, lat: p.centerLat },
    polygon: buildObbPolygon(p.centerLng, p.centerLat, p.widthM, p.heightM, p.angle),
    source: 'manual',
    confidence: 1.0,
    status: 'unknown',
    slot_type: 'common',
    obbAngle: p.angle,
  };
}

/**
 * Test whether a lng/lat point lies inside the oriented rectangle.
 *
 * Uses the rect's local frame (long/short axes) so the check is exact
 * regardless of orientation.
 */
export function isPointInOrientedRect(
  lng: number,
  lat: number,
  rect: OrientedRect,
): boolean {
  const lat0 = rect.center[1];
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);

  const dx = (lng - rect.center[0]) * mPerDegLng;
  const dy = (lat - rect.center[1]) * mPerDegLat;

  // longAxisUnit is in lng/lat units; convert to a meter-space unit vector.
  const lxM = rect.longAxisUnit[0] * mPerDegLng;
  const lyM = rect.longAxisUnit[1] * mPerDegLat;
  const lMag = Math.hypot(lxM, lyM);
  if (lMag < 1e-9) return false;
  const ux = lxM / lMag;
  const uy = lyM / lMag;

  // Component along long axis and perpendicular.
  const along = dx * ux + dy * uy;
  const across = dx * -uy + dy * ux;

  return (
    Math.abs(along) <= rect.halfLengthM + 1e-6 &&
    Math.abs(across) <= rect.halfWidthM + 1e-6
  );
}

/** The four OBB corners of a slot polygon (no closing duplicate). */
export function obbCornerLngLats(polygon: GeoJSON.Polygon): [number, number][] {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return [];
  return ring.slice(0, 4) as [number, number][];
}

/**
 * At least 3 of the 4 OBB corners must lie inside the ROI (≥ 75% containment).
 */
export function isSlotMostlyInsideOrientedRect(slot: Slot, roi: OrientedRect): boolean {
  let inside = 0;
  for (const [lng, lat] of obbCornerLngLats(slot.polygon)) {
    if (isPointInOrientedRect(lng, lat, roi)) inside++;
  }
  return inside >= 3;
}


function slotsObbOverlapSameOrientation(
  a: Slot,
  b: Slot,
  lat0: number,
  widthM: number,
  heightM: number,
  cosA: number,
  sinA: number,
): boolean {
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);
  const dx = (b.center.lng - a.center.lng) * mPerDegLng;
  const dy = (b.center.lat - a.center.lat) * mPerDegLat;
  const dw = Math.abs(dx * cosA + dy * sinA);
  const dh = Math.abs(dx * -sinA + dy * cosA);
  return dw < widthM - TILE_ROW_OVERLAP_EPS_M && dh < heightM - TILE_ROW_OVERLAP_EPS_M;
}

/**
 * Drop extension candidates that overlap an existing slot footprint (extend = new bays only).
 * Row duplicate (`translateSlots`) is the only tool that intentionally copies geometry elsewhere.
 */
export function excludeSlotsOverlappingExisting(
  candidates: Slot[],
  existing: Slot[],
): Slot[] {
  if (candidates.length === 0 || existing.length === 0) return candidates;
  const lat0 = candidates[0]!.center.lat;
  const { width, height, angle } = extractObbMetrics(candidates[0]!.polygon);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const out: Slot[] = [];
  for (const candidate of candidates) {
    const overlapsExisting = existing.some((ex) =>
      slotsObbOverlapSameOrientation(ex, candidate, lat0, width, height, cosA, sinA),
    );
    const overlapsKept = out.some((kept) =>
      slotsObbOverlapSameOrientation(kept, candidate, lat0, width, height, cosA, sinA),
    );
    if (!overlapsExisting && !overlapsKept) out.push(candidate);
  }
  return out;
}

/**
 * Preserves candidate order; rejects slots with any corner outside the ROI, then drops any
 * that overlap a previously kept slot (two-row / numeric edge cases).
 */
export function sanitizeTileRowProposals(candidates: Slot[], roi: OrientedRect): Slot[] {
  if (candidates.length === 0) return [];
  const { width: W, height: H, angle: θ } = extractObbMetrics(candidates[0]!.polygon);
  const cosA = Math.cos(θ);
  const sinA = Math.sin(θ);
  const lat0 = roi.center[1];
  const out: Slot[] = [];
  for (const s of candidates) {
    if (!isSlotMostlyInsideOrientedRect(s, roi)) continue;
    if (out.some((k) => slotsObbOverlapSameOrientation(k, s, lat0, W, H, cosA, sinA))) continue;
    out.push(s);
  }
  return out;
}

/**
 * Nearest point inside the oriented ROI to the given lng/lat (axis-aligned clamp in the
 * ROI's local frame). A seed clicked on the strip edge or slightly outside would otherwise
 * yield zero proposals with a single seed; clamping keeps one-row tiling usable.
 */
export function clampPointToOrientedRect(
  lng: number,
  lat: number,
  rect: OrientedRect,
): [number, number] {
  const lat0 = rect.center[1];
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);

  const dx = (lng - rect.center[0]) * mPerDegLng;
  const dy = (lat - rect.center[1]) * mPerDegLat;

  const lxM = rect.longAxisUnit[0] * mPerDegLng;
  const lyM = rect.longAxisUnit[1] * mPerDegLat;
  const lMag = Math.hypot(lxM, lyM);
  if (lMag < 1e-9) {
    return [rect.center[0], rect.center[1]];
  }
  const ux = lxM / lMag;
  const uy = lyM / lMag;

  let along = dx * ux + dy * uy;
  let across = dx * -uy + dy * ux;

  along = Math.max(-rect.halfLengthM, Math.min(rect.halfLengthM, along));
  across = Math.max(-rect.halfWidthM, Math.min(rect.halfWidthM, across));

  const mxM = along * ux + across * -uy;
  const myM = along * uy + across * ux;

  return [
    rect.center[0] + mxM / mPerDegLng,
    rect.center[1] + myM / mPerDegLat,
  ];
}

export interface GenerateRowProposalsOptions {
  /**
   * Source for **dimensions** (width, height) so all rows use consistent bay sizes.
   * The **angle** always comes from the individual seed — each row keeps its own orientation.
   */
  orientationSource?: Slot;
}

/**
 * Tile slots inside the ROI: **center line follows the ROI long axis** (what the user
 * traced). Step along that axis is the **SAT minimum separation**
 * `min(W/|w·u|, H/|h·u|)` so angled bays pack tightly without overlap. Each rectangle uses
 * the **seed's orientation** (angle + dimensions). Slots are kept when the footprint is
 * **fully** inside the ROI (all four corners). `sanitizeTileRowProposals` removes
 * cross-row overlap.
 *
 * Anchor keeps its id but `polygon` is rebuilt from orientation metrics.
 */
export function generateRowProposals(
  roi: OrientedRect,
  seed: Slot,
  options?: GenerateRowProposalsOptions,
): Slot[] {
  const dimSrc = options?.orientationSource ?? seed;
  const dimMetrics = extractObbMetrics(dimSrc.polygon);
  const seedWidthM = dimMetrics.width;
  const seedHeightM = dimMetrics.height;
  const obbRotationRad = seed.obbAngle ?? extractObbMetrics(seed.polygon).angle;

  if (seedWidthM <= 0) return [];

  const [anchorLng, anchorLat] = clampPointToOrientedRect(
    seed.center.lng,
    seed.center.lat,
    roi,
  );

  const anchorPolygon = buildObbPolygon(
    anchorLng,
    anchorLat,
    seedWidthM,
    seedHeightM,
    obbRotationRad,
  );

  const lat0 = roi.center[1];
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);
  const lxM = roi.longAxisUnit[0] * mPerDegLng;
  const lyM = roi.longAxisUnit[1] * mPerDegLat;
  const lMag = Math.hypot(lxM, lyM);
  if (lMag < 1e-9) {
    const only: Slot = {
      ...seed,
      center: { lng: anchorLng, lat: anchorLat },
      polygon: anchorPolygon,
      obbAngle: obbRotationRad,
    };
    return isSlotMostlyInsideOrientedRect(only, roi) ? [only] : [];
  }

  const uxM = lxM / lMag;
  const uyM = lyM / lMag;

  // SAT minimum separation along the ROI axis, capped at parking row pitch (width).
  const spacingM = pitchAlongDirectionM(
    { widthM: seedWidthM, heightM: seedHeightM, obbAngle: obbRotationRad },
    uxM,
    uyM,
  );

  const stepLng = (uxM * spacingM) / mPerDegLng;
  const stepLat = (uyM * spacingM) / mPerDegLat;

  const out: Slot[] = [];

  const anchorSlot: Slot = {
    ...seed,
    center: { lng: anchorLng, lat: anchorLat },
    polygon: anchorPolygon,
    obbAngle: obbRotationRad,
  };
  if (!isSlotMostlyInsideOrientedRect(anchorSlot, roi)) {
    return [];
  }
  out.push(anchorSlot);

  // Forward k = 1, 2, ...
  for (let k = 1; k <= TILE_ROW_MAX_PER_SEED; k++) {
    const lng = anchorLng + k * stepLng;
    const lat = anchorLat + k * stepLat;
    const slot = makeTiledSlot(lng, lat, seedWidthM, seedHeightM, obbRotationRad);
    if (!isPointInOrientedRect(lng, lat, roi)) break;
    if (!isSlotMostlyInsideOrientedRect(slot, roi)) break;
    out.push(slot);
    if (out.length >= TILE_ROW_MAX_PER_SEED) break;
  }
  // Backward k = -1, -2, ...
  for (let k = 1; k <= TILE_ROW_MAX_PER_SEED; k++) {
    if (out.length >= TILE_ROW_MAX_PER_SEED) break;
    const lng = anchorLng - k * stepLng;
    const lat = anchorLat - k * stepLat;
    const slot = makeTiledSlot(lng, lat, seedWidthM, seedHeightM, obbRotationRad);
    if (!isSlotMostlyInsideOrientedRect(slot, roi)) break;
    out.push(slot);
  }

  return sanitizeTileRowProposals(out, roi);
}

function makeTiledSlot(
  lng: number,
  lat: number,
  widthM: number,
  heightM: number,
  angleRad: number,
): Slot {
  return {
    slot_id: '',
    _draftKey: uuid(),
    center: { lng, lat },
    polygon: buildObbPolygon(lng, lat, widthM, heightM, angleRad),
    source: 'manual',
    confidence: 1.0,
    status: 'unknown',
    slot_type: 'common',
    obbAngle: angleRad,
  };
}

/** Single orange ghost at the extend anchor — shows bay size and orientation after click. */
export function makeAnchorPreviewSlot(lng: number, lat: number, geom: RowGeometry): Slot {
  return makeTiledSlot(lng, lat, geom.widthM, geom.heightM, geom.obbAngle);
}

/** Centre-to-centre pitch along a parking row (short edge + visual gap). */
export function defaultRowPitchM(widthM: number): number {
  return widthM + TILE_ROW_GAP_M;
}

/**
 * Minimum centre spacing along unit direction ``(ux, uy)`` without OBB overlap (SAT),
 * capped at the parking row pitch (width axis) so a mis-aimed brush does not use depth (~5 m).
 */
export function pitchAlongDirectionM(geom: RowGeometry, ux: number, uy: number): number {
  const cosA = Math.cos(geom.obbAngle);
  const sinA = Math.sin(geom.obbAngle);
  const wDotU = Math.abs(cosA * ux + sinA * uy);
  const hDotU = Math.abs(-sinA * ux + cosA * uy);
  const dw = wDotU > 1e-9 ? geom.widthM / wDotU : Infinity;
  const dh = hDotU > 1e-9 ? geom.heightM / hDotU : Infinity;
  let satM = Math.min(dw, dh);
  if (!isFinite(satM) || satM < 1e-3) satM = geom.widthM;
  const rowPitchM = defaultRowPitchM(geom.widthM);
  return Math.min(satM + TILE_ROW_GAP_M, rowPitchM);
}

export interface RowGeometry {
  widthM: number;
  heightM: number;
  obbAngle: number;
}

/** Smallest angle difference between two orientations (mod 90° parking bays). */
export function normalizeAngleDiffRad(a: number, b: number): number {
  let diff = Math.abs(a - b) % Math.PI;
  if (diff > Math.PI / 2) diff = Math.PI - diff;
  return diff;
}

/**
 * Infer slot dimensions and angle from nearby detected slots, else parking priors.
 * `fallbackAngle` is used when no neighbours exist (typically perpendicular to brush line).
 */
export function inferRowGeometry(
  lng: number,
  lat: number,
  hintSlots: Slot[],
  fallbackAngle: number,
): RowGeometry {
  const neighbors = findKNearest(hintSlots, lng, lat, PLACEMENT_NEIGHBOR_K);
  if (neighbors.length === 0) {
    return {
      widthM: DEFAULT_WIDTH_M,
      heightM: DEFAULT_HEIGHT_M,
      obbAngle: fallbackAngle,
    };
  }
  const n = computePlacementDefaultsFromNeighbors(neighbors, lng, lat);
  return {
    widthM: n.widthM,
    heightM: n.heightM,
    obbAngle: n.angle,
  };
}

/**
 * Collect all slots belonging to the same row as `seedSlot` (metric, angle-aware).
 * Mirrors backend row_normal_factor / row_axis_factor heuristics: row runs along
 * the slot **width** axis; perpendicular offset uses the smaller of width/depth
 * projections (YOLO angle may align either way).
 */
export function detectRowCluster(seedSlot: Slot, allSlots: Slot[]): Slot[] {
  const seedMetrics = extractObbMetrics(seedSlot.polygon);
  const seedAngle = seedSlot.obbAngle ?? seedMetrics.angle;
  const rowWidthM = seedMetrics.width;
  const rowHeightM = seedMetrics.height;
  const normalMaxM = rowHeightM * 0.8;
  const alongMaxM = rowWidthM * 4;
  const angleTolRad = (25 * Math.PI) / 180;

  const lat0 = seedSlot.center.lat;
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);
  const widthXM = Math.cos(seedAngle);
  const widthYM = Math.sin(seedAngle);
  const depthXM = -Math.sin(seedAngle);
  const depthYM = Math.cos(seedAngle);

  const pool = allSlots.some((s) => s.slot_id === seedSlot.slot_id)
    ? allSlots
    : [seedSlot, ...allSlots];

  const projected = pool.map((s) => {
    const dx = (s.center.lng - seedSlot.center.lng) * mPerDegLng;
    const dy = (s.center.lat - seedSlot.center.lat) * mPerDegLat;
    const sm = extractObbMetrics(s.polygon);
    const sAngle = s.obbAngle ?? sm.angle;
    const angleDiff = normalizeAngleDiffRad(seedAngle, sAngle);
    const pWidth = Math.abs(dx * widthXM + dy * widthYM);
    const pDepth = Math.abs(dx * depthXM + dy * depthYM);
    const perp = Math.min(pWidth, pDepth);
    const along = dx * widthXM + dy * widthYM;
    return { slot: s, along, perp, angleDiff };
  });

  const inRow = projected.filter(
    (p) => p.angleDiff <= angleTolRad && p.perp <= normalMaxM,
  );
  if (inRow.length === 0) return [seedSlot];

  inRow.sort((a, b) => a.along - b.along);
  let seedIndex = inRow.findIndex((p) => p.slot.slot_id === seedSlot.slot_id);
  if (seedIndex < 0) seedIndex = 0;

  let left = seedIndex;
  let right = seedIndex;
  while (left > 0) {
    const gap = Math.abs(inRow[left]!.along - inRow[left - 1]!.along);
    if (gap > alongMaxM) break;
    left--;
  }
  while (right < inRow.length - 1) {
    const gap = Math.abs(inRow[right + 1]!.along - inRow[right]!.along);
    if (gap > alongMaxM) break;
    right++;
  }

  return inRow.slice(left, right + 1).map((p) => p.slot);
}

/** Copy slots with a translation; new ids and rebuilt polygons. */
export function translateSlots(slots: Slot[], dLng: number, dLat: number): Slot[] {
  return slots.map((s) => {
    const metrics = extractObbMetrics(s.polygon);
    const angle = s.obbAngle ?? metrics.angle;
    const lng = s.center.lng + dLng;
    const lat = s.center.lat + dLat;
    return {
      ...s,
      slot_id: uuid(),
      center: { lng, lat },
      polygon: buildObbPolygon(lng, lat, metrics.width, metrics.height, angle),
      obbAngle: angle,
      source: 'manual' as const,
    };
  });
}

/** Signed distance (m) along the row width axis from an origin. */
export function rowAxisProjectionM(
  originLng: number,
  originLat: number,
  lng: number,
  lat: number,
  angleRad: number,
): number {
  const lat0 = (originLat + lat) / 2;
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);
  const dxM = (lng - originLng) * mPerDegLng;
  const dyM = (lat - originLat) * mPerDegLat;
  const ux = Math.cos(angleRad);
  const uy = Math.sin(angleRad);
  return dxM * ux + dyM * uy;
}

/** Signed distance (m) along the row depth axis from an origin (perpendicular to width). */
export function rowDepthProjectionM(
  originLng: number,
  originLat: number,
  lng: number,
  lat: number,
  angleRad: number,
): number {
  const lat0 = (originLat + lat) / 2;
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);
  const dxM = (lng - originLng) * mPerDegLng;
  const dyM = (lat - originLat) * mPerDegLat;
  const px = -Math.sin(angleRad);
  const py = Math.cos(angleRad);
  return dxM * px + dyM * py;
}

/** WGS84 centre from row-frame coordinates (along width axis, perp depth axis). */
export function rowFramePosition(
  originLng: number,
  originLat: number,
  alongM: number,
  perpM: number,
  angleRad: number,
): [number, number] {
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(originLat);
  const wx = Math.cos(angleRad);
  const wy = Math.sin(angleRad);
  const px = -Math.sin(angleRad);
  const py = Math.cos(angleRad);
  const dxM = alongM * wx + perpM * px;
  const dyM = alongM * wy + perpM * py;
  return [
    originLng + dxM / mPerDegLng,
    originLat + dyM / mPerDegLat,
  ];
}

/** Regular grid on a parking row — phase-locked to detected bay centres. */
export interface RowLattice {
  originLng: number;
  originLat: number;
  angleRad: number;
  pitchM: number;
  widthM: number;
  heightM: number;
  /** Collapsed perpendicular noise — all new bays sit on this offset. */
  medianPerpM: number;
  /** Along-axis phase so ``phase + k × pitch`` hits existing centres. */
  phaseAlongM: number;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Brush segment direction = parking row width axis (user draws along the row). */
export function brushRowAxisAngleRad(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const lat0 = (aLat + bLat) / 2;
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);
  const dxM = (bLng - aLng) * mPerDegLng;
  const dyM = (bLat - aLat) * mPerDegLat;
  if (Math.hypot(dxM, dyM) < 1e-6) return 0;
  return Math.atan2(dyM, dxM);
}

/** Pick row angle: neighbour OBB when aligned with brush, else brush direction. */
export function effectiveRowAngleForBrush(
  brushAngleRad: number,
  geomAngleRad: number,
  hasOrientationHints: boolean,
): number {
  const dParallel = normalizeAngleDiffRad(geomAngleRad, brushAngleRad);
  const dPerpendicular = normalizeAngleDiffRad(geomAngleRad, brushAngleRad + Math.PI / 2);
  if (dParallel <= dPerpendicular) return geomAngleRad;
  if (!hasOrientationHints || dPerpendicular < 0.12) return brushAngleRad;
  return geomAngleRad;
}

const PARALLEL_ROW_ANGLE_TOL_RAD = (25 * Math.PI) / 180;

/** Slots on the same row line as ``(originLng, originLat)`` (any source — manual, prod, SAM3). */
export function findSlotsOnSameRow(
  originLng: number,
  originLat: number,
  rowAngle: number,
  hintSlots: Slot[],
  heightM: number,
): Slot[] {
  const normalMaxM = heightM * 0.55;
  return hintSlots.filter((s) => {
    const sm = extractObbMetrics(s.polygon);
    const sAngle = s.obbAngle ?? sm.angle;
    if (normalizeAngleDiffRad(rowAngle, sAngle) > PARALLEL_ROW_ANGLE_TOL_RAD) return false;
    const perp = Math.abs(
      rowDepthProjectionM(originLng, originLat, s.center.lng, s.center.lat, rowAngle),
    );
    return perp <= normalMaxM;
  });
}

/**
 * When the target row has no (or one) detection, copy pitch + phase from a parallel row
 * offset by ~one bay depth (typical empty row between detected rows).
 */
function inferPitchPhaseFromParallelRow(
  anchorLng: number,
  anchorLat: number,
  rowAngle: number,
  hintSlots: Slot[],
  widthM: number,
  heightM: number,
  excludeSlotId?: string,
): { pitchM: number; phaseAlongM: number } | null {
  const depthMinM = heightM * 0.35;
  const depthMaxM = heightM * 1.25;

  const parallel = hintSlots.filter((s) => {
    if (excludeSlotId && s.slot_id === excludeSlotId) return false;
    const sm = extractObbMetrics(s.polygon);
    const sAngle = s.obbAngle ?? sm.angle;
    if (normalizeAngleDiffRad(rowAngle, sAngle) > PARALLEL_ROW_ANGLE_TOL_RAD) return false;
    const perp = Math.abs(
      rowDepthProjectionM(anchorLng, anchorLat, s.center.lng, s.center.lat, rowAngle),
    );
    return perp >= depthMinM && perp <= depthMaxM;
  });

  if (parallel.length < 2) return null;

  const ref = findKNearest(parallel, anchorLng, anchorLat, 1)[0]!;
  const pitchM =
    measureRowPitchM(parallel, ref, rowAngle) ?? defaultRowPitchM(widthM);

  const alongs = parallel.map((s) =>
    rowAxisProjectionM(anchorLng, anchorLat, s.center.lng, s.center.lat, rowAngle),
  );
  const phaseSamples = alongs.map((a) => {
    const k = Math.round(a / pitchM);
    return a - k * pitchM;
  });

  return { pitchM, phaseAlongM: medianOf(phaseSamples) };
}

/** Infer pitch, row line, and lattice phase from an in-row cluster (mirrors backend gap-fill). */
export function inferRowLattice(
  cluster: Slot[],
  seed: Slot,
  allHints: Slot[] = [],
): RowLattice {
  const geom = rowGeometryFromSlot(seed);
  const angle = geom.obbAngle;
  const oLng = seed.center.lng;
  const oLat = seed.center.lat;
  let pitchM =
    measureRowPitchM(cluster, seed, angle) ?? defaultRowPitchM(geom.widthM);

  const alongs: number[] = [];
  const perps: number[] = [];
  for (const s of cluster) {
    alongs.push(rowAxisProjectionM(oLng, oLat, s.center.lng, s.center.lat, angle));
    perps.push(rowDepthProjectionM(oLng, oLat, s.center.lng, s.center.lat, angle));
  }

  let phaseAlongM =
    alongs.length > 0
      ? medianOf(
          alongs.map((a) => {
            const k = Math.round(a / pitchM);
            return a - k * pitchM;
          }),
        )
      : 0;

  if (cluster.length < 2) {
    const parallel = inferPitchPhaseFromParallelRow(
      oLng,
      oLat,
      angle,
      allHints,
      geom.widthM,
      geom.heightM,
      seed.slot_id,
    );
    if (parallel) {
      pitchM = parallel.pitchM;
      phaseAlongM = parallel.phaseAlongM;
    } else if (cluster.length <= 1) {
      phaseAlongM = 0;
    }
  }

  return {
    originLng: oLng,
    originLat: oLat,
    angleRad: angle,
    pitchM,
    widthM: geom.widthM,
    heightM: geom.heightM,
    medianPerpM: perps.length > 0 ? medianOf(perps) : 0,
    phaseAlongM,
  };
}

function sameRowLatticeIndices(
  originLng: number,
  originLat: number,
  rowAngle: number,
  pitchM: number,
  phaseAlongM: number,
  heightM: number,
  slots: Slot[],
): Set<number> {
  const occupied = new Set<number>();
  for (const s of findSlotsOnSameRow(originLng, originLat, rowAngle, slots, heightM)) {
    const along = rowAxisProjectionM(originLng, originLat, s.center.lng, s.center.lat, rowAngle);
    occupied.add(latticeIndex(along, pitchM, phaseAlongM));
  }
  return occupied;
}

function latticeIndex(alongM: number, pitchM: number, phaseAlongM: number): number {
  return Math.round((alongM - phaseAlongM) / pitchM);
}

function latticeAlongM(k: number, pitchM: number, phaseAlongM: number): number {
  return phaseAlongM + k * pitchM;
}

export function rowGeometryFromSlot(slot: Slot): RowGeometry {
  const m = extractObbMetrics(slot.polygon);
  return { widthM: m.width, heightM: m.height, obbAngle: slot.obbAngle ?? m.angle };
}

/** Median centre-to-centre spacing from the seed's nearest in-row neighbours. */
export function measureRowPitchM(cluster: Slot[], originSlot: Slot, angleRad: number): number | null {
  if (cluster.length < 2) return null;
  const oLng = originSlot.center.lng;
  const oLat = originSlot.center.lat;
  const originAlong = rowAxisProjectionM(
    oLng,
    oLat,
    originSlot.center.lng,
    originSlot.center.lat,
    angleRad,
  );
  const widthM = extractObbMetrics(originSlot.polygon).width;

  let nearestPosM = Infinity;
  let nearestNegM = Infinity;
  for (const s of cluster) {
    if (s.slot_id === originSlot.slot_id) continue;
    const along = rowAxisProjectionM(oLng, oLat, s.center.lng, s.center.lat, angleRad);
    const delta = along - originAlong;
    if (delta > 0.35) nearestPosM = Math.min(nearestPosM, delta);
    if (delta < -0.35) nearestNegM = Math.min(nearestNegM, -delta);
  }

  const gaps = [nearestPosM, nearestNegM].filter((g) => g < Infinity);
  if (gaps.length === 0) return null;

  let pitchM = gaps.length === 1 ? gaps[0]! : Math.min(...gaps);

  // One missing detection doubles the gap — halve when still plausible bay width.
  if (pitchM > widthM * 1.55) {
    const halved = pitchM / 2;
    if (halved >= widthM * 0.75) pitchM = halved;
  }

  const maxPitchM = defaultRowPitchM(widthM) * 1.35;
  if (pitchM > maxPitchM) return null;

  return pitchM;
}

/**
 * Extend an existing row toward a target using measured pitch from the cluster.
 * Returns **new** slots only (existing cluster members are excluded).
 */
export function extendRowFromSeed(
  seed: Slot,
  hintSlots: Slot[],
  targetLng: number,
  targetLat: number,
  slotCount?: number,
): Slot[] {
  const cluster = detectRowCluster(seed, hintSlots);
  const lattice = inferRowLattice(cluster, seed, hintSlots);
  const {
    originLng: oLng,
    originLat: oLat,
    angleRad: angle,
    pitchM,
    widthM,
    heightM,
    medianPerpM,
    phaseAlongM,
  } = lattice;

  const alongOf = (lng: number, lat: number) =>
    rowAxisProjectionM(oLng, oLat, lng, lat, angle);

  const clusterAlongs = cluster.map((s) => alongOf(s.center.lng, s.center.lat));
  const minAlong = Math.min(...clusterAlongs);
  const maxAlong = Math.max(...clusterAlongs);

  const targetAlong = alongOf(targetLng, targetLat);
  const extendFromMax = Math.abs(targetAlong - maxAlong) <= Math.abs(targetAlong - minAlong);
  const edgeAlong = extendFromMax ? maxAlong : minAlong;
  const dir = targetAlong >= edgeAlong ? 1 : -1;

  if (Math.abs(targetAlong - edgeAlong) < pitchM * 0.35) return [];

  const occupiedIndices = sameRowLatticeIndices(
    oLng,
    oLat,
    angle,
    pitchM,
    phaseAlongM,
    heightM,
    hintSlots,
  );

  const kEdge = latticeIndex(edgeAlong, pitchM, phaseAlongM);
  const kTarget = latticeIndex(targetAlong, pitchM, phaseAlongM);

  let indices: number[];
  if (slotCount != null) {
    indices = Array.from({ length: Math.min(slotCount, TILE_ROW_MAX_PER_SEED) }, (_, i) =>
      kEdge + dir * (i + 1),
    );
  } else if (dir > 0) {
    indices = [];
    for (let k = kEdge + 1; k <= kTarget; k++) indices.push(k);
  } else {
    indices = [];
    for (let k = kEdge - 1; k >= kTarget; k--) indices.push(k);
  }

  const out: Slot[] = [];
  for (const k of indices) {
    if (occupiedIndices.has(k)) continue;
    const alongM = latticeAlongM(k, pitchM, phaseAlongM);
    const [lng, lat] = rowFramePosition(oLng, oLat, alongM, medianPerpM, angle);
    out.push({ ...makeTiledSlot(lng, lat, widthM, heightM, angle), source: 'row_extension' });
    if (out.length >= TILE_ROW_MAX_PER_SEED) break;
  }
  return out;
}

/**
 * Extend on a row with no SAM3 detections: brush direction + parallel-row grid + priors.
 * Places bay centres on the lattice from the anchor click toward the target.
 */
export function extendRowAlongBrush(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
  geom: RowGeometry,
  hintSlots: Slot[],
  slotCount?: number,
): Slot[] {
  const lat0 = (aLat + bLat) / 2;
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(lat0);
  const dxM = (bLng - aLng) * mPerDegLng;
  const dyM = (bLat - aLat) * mPerDegLat;
  const lengthM = Math.hypot(dxM, dyM);
  if (lengthM < 0.25) return [];

  const brushAngle = brushRowAxisAngleRad(aLng, aLat, bLng, bLat);
  const rowAngle = effectiveRowAngleForBrush(
    brushAngle,
    geom.obbAngle,
    hintSlots.length > 0,
  );

  const anchorSlot = makeTiledSlot(aLng, aLat, geom.widthM, geom.heightM, rowAngle);
  const sameRow = findSlotsOnSameRow(aLng, aLat, rowAngle, hintSlots, geom.heightM);
  const lattice = inferRowLattice(
    sameRow.length > 0 ? sameRow : [anchorSlot],
    anchorSlot,
    hintSlots,
  );

  const {
    originLng: oLng,
    originLat: oLat,
    pitchM,
    widthM,
    heightM,
    medianPerpM,
    phaseAlongM,
  } = lattice;

  const targetAlong = rowAxisProjectionM(oLng, oLat, bLng, bLat, rowAngle);
  if (Math.abs(targetAlong) < pitchM * 0.35 && slotCount == null) return [];

  const occupiedIndices = sameRowLatticeIndices(
    oLng,
    oLat,
    rowAngle,
    pitchM,
    phaseAlongM,
    heightM,
    hintSlots,
  );

  const kAnchor = latticeIndex(0, pitchM, phaseAlongM);
  const kTarget = latticeIndex(targetAlong, pitchM, phaseAlongM);
  const dir = targetAlong >= 0 ? 1 : -1;

  let indices: number[];
  if (slotCount != null) {
    indices = Array.from({ length: Math.min(slotCount, TILE_ROW_MAX_PER_SEED) }, (_, i) =>
      kAnchor + dir * i,
    );
  } else {
    const lo = Math.min(kAnchor, kTarget);
    const hi = Math.max(kAnchor, kTarget);
    indices = [];
    for (let k = lo; k <= hi; k++) indices.push(k);
  }

  const out: Slot[] = [];
  for (const k of indices) {
    if (occupiedIndices.has(k)) continue;
    const alongM = latticeAlongM(k, pitchM, phaseAlongM);
    const [lng, lat] = rowFramePosition(oLng, oLat, alongM, medianPerpM, rowAngle);
    out.push({ ...makeTiledSlot(lng, lat, widthM, heightM, rowAngle), source: 'row_extension' });
    if (out.length >= TILE_ROW_MAX_PER_SEED) break;
  }
  return out;
}

/**
 * Propose new row slots from anchor A toward B.
 * When `seed` is set, pitch and orientation come from the detected row cluster.
 */
export function proposeRowExtension(
  seed: Slot | null,
  hintSlots: Slot[],
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
  geom: RowGeometry,
  slotCount?: number,
): Slot[] {
  const raw = seed
    ? extendRowFromSeed(seed, hintSlots, bLng, bLat, slotCount)
    : (() => {
        const inferred = inferRowGeometry(
          aLng,
          aLat,
          hintSlots,
          brushRowAxisAngleRad(aLng, aLat, bLng, bLat),
        );
        const merged: RowGeometry = {
          widthM: geom.widthM > 0 ? geom.widthM : inferred.widthM,
          heightM: geom.heightM > 0 ? geom.heightM : inferred.heightM,
          obbAngle: hintSlots.length > 0 ? geom.obbAngle : inferred.obbAngle,
        };
        return extendRowAlongBrush(aLng, aLat, bLng, bLat, merged, hintSlots, slotCount);
      })();
  return excludeSlotsOverlappingExisting(raw, hintSlots);
}

/** Same rule as ``autoabsmap`` orchestrator — first session batch wins on overlap. */
export const PIPELINE_MERGE_IOU_THRESHOLD = 0.5;

function shoelaceAreaM2(pts: Array<[number, number]>): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function polygonToLocalM(
  ring: Array<[number, number]>,
  originLng: number,
  originLat: number,
): Array<[number, number]> {
  const { mPerDegLng, mPerDegLat } = metersPerDegreeAt(originLat);
  return ring.map(([lng, lat]) => [
    (lng - originLng) * mPerDegLng,
    (lat - originLat) * mPerDegLat,
  ]);
}

/** Sutherland–Hodgman clip of ``subject`` against convex ``clip`` (local metres). */
function clipConvexPolygon(
  subject: Array<[number, number]>,
  clip: Array<[number, number]>,
): Array<[number, number]> {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    const [ax, ay] = clip[i]!;
    const [bx, by] = clip[(i + 1) % clip.length]!;
    const input = output;
    output = [];
    if (input.length === 0) break;

    const cross = (px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

    for (let j = 0; j < input.length; j++) {
      const curr = input[j]!;
      const prev = input[(j + input.length - 1) % input.length]!;
      const currIn = cross(curr[0], curr[1]) >= 0;
      const prevIn = cross(prev[0], prev[1]) >= 0;

      if (currIn) {
        if (!prevIn) {
          const denom = cross(prev[0], prev[1]) - cross(curr[0], curr[1]);
          if (Math.abs(denom) > 1e-12) {
            const t = cross(prev[0], prev[1]) / denom;
            output.push([
              prev[0] + t * (curr[0] - prev[0]),
              prev[1] + t * (curr[1] - prev[1]),
            ]);
          }
        }
        output.push(curr);
      } else if (prevIn) {
        const denom = cross(prev[0], prev[1]) - cross(curr[0], curr[1]);
        if (Math.abs(denom) > 1e-12) {
          const t = cross(prev[0], prev[1]) / denom;
          output.push([
            prev[0] + t * (curr[0] - prev[0]),
            prev[1] + t * (curr[1] - prev[1]),
          ]);
        }
      }
    }
  }
  return output;
}

/**
 * After row straighten, manual slots drawn on top of pipeline detections can
 * land on the same footprint — drop the redundant manual copy.
 */
export function dropManualSlotsRedundantWithPipeline(
  aligned: Slot[],
  context: Slot[],
  iouThreshold: number = 0.45,
): { kept: Slot[]; droppedIds: string[] } {
  const mergedById = new Map<string, Slot>();
  for (const slot of context) mergedById.set(slot.slot_id, slot);
  for (const slot of aligned) mergedById.set(slot.slot_id, slot);

  const nonManual = [...mergedById.values()].filter((s) => s.source !== 'manual');
  if (nonManual.length === 0) {
    return { kept: aligned, droppedIds: [] };
  }

  const droppedIds: string[] = [];
  const kept = aligned.filter((slot) => {
    if (slot.source !== 'manual') return true;
    const overlaps = nonManual.some(
      (other) =>
        other.slot_id !== slot.slot_id &&
        slotFootprintIoU(other, slot) > iouThreshold,
    );
    if (overlaps) {
      droppedIds.push(slot.slot_id);
      return false;
    }
    return true;
  });

  return { kept, droppedIds };
}

/** IoU of two slot footprints in local metres (convex OBB rings). */
export function slotFootprintIoU(a: Slot, b: Slot): number {
  const ringA = obbCornerLngLats(a.polygon);
  const ringB = obbCornerLngLats(b.polygon);
  if (ringA.length < 4 || ringB.length < 4) return 0;

  const originLng = (a.center.lng + b.center.lng) / 2;
  const originLat = (a.center.lat + b.center.lat) / 2;
  const polyA = polygonToLocalM(ringA, originLng, originLat);
  const polyB = polygonToLocalM(ringB, originLng, originLat);
  const areaA = shoelaceAreaM2(polyA);
  const areaB = shoelaceAreaM2(polyB);
  if (areaA < 1e-6 || areaB < 1e-6) return 0;

  const inter = shoelaceAreaM2(clipConvexPolygon(polyA, polyB));
  const union = areaA + areaB - inter;
  return union > 1e-6 ? inter / union : 0;
}

/**
 * Append pipeline slots into the session without dropping prior ROI batches.
 * Mirrors backend ``_merge_slots`` (first-crop-wins on IoU).
 */
export function mergePipelineSlots(
  existing: Slot[],
  incoming: Slot[],
  iouThreshold: number = PIPELINE_MERGE_IOU_THRESHOLD,
): Slot[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return [...incoming];

  const merged = [...existing];
  for (const slot of incoming) {
    const duplicate = merged.some(
      (kept) => slotFootprintIoU(kept, slot) > iouThreshold,
    );
    if (!duplicate) merged.push(slot);
  }
  return merged;
}

import type { Slot } from '../types';

export const DEFAULT_WIDTH_M = 2.5;
export const DEFAULT_HEIGHT_M = 5.0;

export interface Placement {
  slotId: string;
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

/**
 * Extract width (short edge), height (long edge), and orientation angle
 * from an OBB polygon (5-coord ring: 4 corners + closing duplicate).
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
  const angle = Math.atan2(refB[1] - refA[1], refB[0] - refA[0]);

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

export function placementToSlot(p: Placement): Slot {
  return {
    slot_id: p.slotId,
    center: { lng: p.centerLng, lat: p.centerLat },
    polygon: buildObbPolygon(p.centerLng, p.centerLat, p.widthM, p.heightM, p.angle),
    source: 'manual',
    confidence: 1.0,
    status: 'unknown',
  };
}

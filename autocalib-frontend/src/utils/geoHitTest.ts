/** Geospatial hit tests in WGS84 (lng, lat). Rings are GeoJSON-style [lng, lat][] — first ring only. */

type Ring = [number, number][];

/** Ray-casting point-in-polygon for a closed or open ring (any planar x/y units). */
export function pointInRing(
  x: number,
  y: number,
  ring: ReadonlyArray<readonly [number, number]>,
): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const xi = pi[0];
    const yi = pi[1];
    const xj = pj[0];
    const yj = pj[1];
    const denom = yj - yi;
    if (denom === 0) continue;
    const intersect =
      ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Test point against polygon outer ring (first ring of GeoJSON Polygon). */
export function pointInPolygonLngLat(lng: number, lat: number, polygon: GeoJSON.Polygon): boolean {
  const ring = polygon.coordinates[0] as Ring | undefined;
  if (!ring || ring.length < 3) return false;
  return pointInRing(lng, lat, ring);
}

/**
 * True if the slot should be included in a bulk-delete lasso selection:
 * centroid inside the region OR any footprint vertex inside (parking OBB corners).
 */
/** Close an open lng/lat lasso ring for GeoJSON polygon tests. */
export function lassoPolygonFromLngLatRing(
  points: ReadonlyArray<readonly [number, number]>,
): GeoJSON.Polygon {
  const ring: [number, number][] = points.map(([lng, lat]) => [lng, lat]);
  if (ring.length > 0) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push(first);
    }
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/** Map zone lasso: centroid or any footprint corner inside the ring (same as absmap bulk select). */
export function slotInLngLatLasso(
  slot: { center: { lng: number; lat: number }; polygon: GeoJSON.Polygon },
  lassoPoints: ReadonlyArray<readonly [number, number]>,
): boolean {
  if (lassoPoints.length < 3) return false;
  return slotTouchesLassoPolygon(slot, lassoPolygonFromLngLatRing(lassoPoints));
}

export function slotTouchesLassoPolygon(
  slot: { center: { lng: number; lat: number }; polygon: GeoJSON.Polygon },
  lasso: GeoJSON.Polygon,
): boolean {
  if (pointInPolygonLngLat(slot.center.lng, slot.center.lat, lasso)) return true;
  const footprint = slot.polygon.coordinates[0] as Ring | undefined;
  if (!footprint) return false;
  for (const pt of footprint) {
    if (pointInPolygonLngLat(pt[0], pt[1], lasso)) return true;
  }
  return false;
}

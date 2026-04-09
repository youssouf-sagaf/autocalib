/** Geospatial hit tests in WGS84 (lng, lat). Rings are GeoJSON-style [lng, lat][] — first ring only. */

type Ring = [number, number][];

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const xi = pi[0];
    const yi = pi[1];
    const xj = pj[0];
    const yj = pj[1];
    if (yi === yj) continue;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
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

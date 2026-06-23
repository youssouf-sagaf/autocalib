/**
 * Parse pasted or typed GPS coordinates for the map search bar.
 * Supports decimal pairs (lat,lng or lng,lat) and WKT POINT.
 */

export interface ParsedGpsCoordinates {
  lng: number;
  lat: number;
  /** Decimal degrees formatted for display (lat, lng — common copy order). */
  label: string;
}

const DECIMAL_RE = /-?\d+(?:\.\d+)?/g;

function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isValidLng(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

/** Disambiguate two numbers into WGS84 lng/lat (Mapbox order). */
function pairToLngLat(a: number, b: number): { lng: number; lat: number } | null {
  if (Math.abs(a) > 90 && isValidLng(a) && isValidLat(b)) {
    return { lng: a, lat: b };
  }
  if (Math.abs(b) > 90 && isValidLat(a) && isValidLng(b)) {
    return { lng: b, lat: a };
  }
  if (!isValidLat(a) || !isValidLng(b)) {
    if (isValidLat(b) && isValidLng(a)) {
      return { lng: a, lat: b };
    }
    return null;
  }
  const asLatLng =
    a >= 35 && a <= 72 && b >= -15 && b <= 20;
  const asLngLat =
    b >= 35 && b <= 72 && a >= -15 && a <= 20;
  if (asLatLng && !asLngLat) {
    return { lng: b, lat: a };
  }
  if (asLngLat && !asLatLng) {
    return { lng: a, lat: b };
  }
  return { lng: b, lat: a };
}

function toResult(lng: number, lat: number): ParsedGpsCoordinates {
  return {
    lng,
    lat,
    label: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
  };
}

function tryPair(a: number, b: number): ParsedGpsCoordinates | null {
  const pair = pairToLngLat(a, b);
  return pair ? toResult(pair.lng, pair.lat) : null;
}

/**
 * Return lng/lat when ``input`` looks like coordinates, else ``null``.
 * Address strings are not matched (needs at least one digit pattern).
 */
export function parseGpsCoordinates(input: string): ParsedGpsCoordinates | null {
  const trimmed = input.trim();
  if (!trimmed || !/\d/.test(trimmed)) {
    return null;
  }

  const latParam = trimmed.match(/(?:^|[?&])lat=(-?\d+(?:\.\d+)?)/i);
  const lngParam = trimmed.match(/(?:^|[?&])(?:lng|lon)=(-?\d+(?:\.\d+)?)/i);
  if (latParam?.[1] != null && lngParam?.[1] != null) {
    const lat = parseFloat(latParam[1]);
    const lng = parseFloat(lngParam[1]);
    if (isValidLat(lat) && isValidLng(lng)) {
      return toResult(lng, lat);
    }
  }

  const wktMatch = trimmed.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (wktMatch?.[1] != null && wktMatch[2] != null) {
    const lng = parseFloat(wktMatch[1]);
    const lat = parseFloat(wktMatch[2]);
    if (isValidLat(lat) && isValidLng(lng)) {
      return toResult(lng, lat);
    }
  }

  const nums = trimmed.match(DECIMAL_RE)?.map((s) => parseFloat(s)) ?? [];
  if (nums.length >= 2 && nums[0] != null && nums[1] != null) {
    return tryPair(nums[0], nums[1]);
  }

  return null;
}

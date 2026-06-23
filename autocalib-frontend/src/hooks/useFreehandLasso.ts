import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import type { Feature, LineString, Polygon } from 'geojson';
import { approxDistanceM } from '../utils/slot-geometry';

const LASSO_MIN_PX_SCREEN = 1.35;
const LASSO_MIN_M = 0.25;
const MERGE_TAIL_PX_SQ = 0.35 ** 2;
const DEFAULT_MIN_POINTS = 3;

interface MapboxLike {
  project: (lngLat: [number, number]) => { x: number; y: number };
  unproject: (point: [number, number]) => { lng: number; lat: number };
  getCanvas?: () => HTMLCanvasElement;
}

/** Mapbox `unproject` expects canvas-relative pixels, not window client coords. */
function clientToLngLat(
  map: MapboxLike,
  clientX: number,
  clientY: number,
): { lng: number; lat: number } {
  const canvas = map.getCanvas?.();
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    return map.unproject([clientX - rect.left, clientY - rect.top]);
  }
  return map.unproject([clientX, clientY]);
}

interface UseFreehandLassoOptions {
  onComplete: (polygon: GeoJSON.Polygon) => void;
  onStrokeTooShort?: () => void;
  minPoints?: number;
}

function resolveMapboxMap(e: MapMouseEvent): MapboxLike | null {
  const target = e.target as unknown;
  if (!target || typeof target !== 'object') return null;
  if ('project' in target && typeof (target as MapboxLike).project === 'function') {
    return target as MapboxLike;
  }
  if ('getMap' in target && typeof (target as { getMap: () => unknown }).getMap === 'function') {
    const map = (target as { getMap: () => unknown }).getMap();
    if (map && typeof map === 'object' && 'project' in map) {
      return map as MapboxLike;
    }
  }
  return null;
}

function mergeTailScreen(
  pts: [number, number][],
  tail: [number, number] | null,
  project: (lngLat: [number, number]) => { x: number; y: number },
): [number, number][] {
  const out = pts.slice();
  if (!tail || out.length === 0) return out;
  const last = out[out.length - 1]!;
  const pTail = project(tail);
  const pLast = project(last);
  const dx = pTail.x - pLast.x;
  const dy = pTail.y - pLast.y;
  if (dx * dx + dy * dy >= MERGE_TAIL_PX_SQ) {
    out.push([tail[0], tail[1]]);
  }
  return out;
}

function shouldSamplePoint(
  last: [number, number],
  next: [number, number],
  map: MapboxLike | null,
): boolean {
  if (map) {
    const p = map.project(next);
    const q = map.project(last);
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const minSq = LASSO_MIN_PX_SCREEN * LASSO_MIN_PX_SCREEN;
    return dx * dx + dy * dy >= minSq;
  }
  return approxDistanceM(last[0], last[1], next[0], next[1]) >= LASSO_MIN_M;
}

/**
 * Freehand lasso on the map: press-drag to trace, release to close the polygon.
 * Uses window-level pointer events so drawing continues reliably while dragging.
 */
export function useFreehandLasso({
  onComplete,
  onStrokeTooShort,
  minPoints = DEFAULT_MIN_POINTS,
}: UseFreehandLassoOptions) {
  const [active, setActive] = useState(false);
  const [stroke, setStroke] = useState<[number, number][]>([]);
  const [tail, setTail] = useState<[number, number] | null>(null);
  const [dragging, setDragging] = useState(false);

  const draggingRef = useRef(false);
  const pointsRef = useRef<[number, number][]>([]);
  const tailRef = useRef<[number, number] | null>(null);
  const mapRef = useRef<MapboxLike | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);

  const clearStroke = useCallback(() => {
    pointsRef.current = [];
    tailRef.current = null;
    setStroke([]);
    setTail(null);
  }, []);

  const startDrawing = useCallback(() => {
    setActive(true);
    draggingRef.current = false;
    setDragging(false);
    mapRef.current = null;
    clearStroke();
  }, [clearStroke]);

  const appendPoint = useCallback((lng: number, lat: number) => {
    const pt: [number, number] = [lng, lat];
    tailRef.current = pt;
    setTail(pt);

    const pts = pointsRef.current;
    const last = pts[pts.length - 1];
    if (!last) return;
    if (!shouldSamplePoint(last, pt, mapRef.current)) return;

    const next = [...pts, pt];
    pointsRef.current = next;
    setStroke(next);
  }, []);

  const releasePointerCapture = useCallback(() => {
    const map = mapRef.current;
    const pointerId = capturePointerIdRef.current;
    if (pointerId == null) return;
    capturePointerIdRef.current = null;
    const canvas = map?.getCanvas?.();
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const stopDrawing = useCallback(() => {
    releasePointerCapture();
    setActive(false);
    draggingRef.current = false;
    setDragging(false);
    mapRef.current = null;
    clearStroke();
  }, [clearStroke, releasePointerCapture]);

  const finishStroke = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    releasePointerCapture();

    let pts = [...pointsRef.current];
    const liveTail = tailRef.current;
    const map = mapRef.current;
    if (map && pts.length > 0 && liveTail) {
      pts = mergeTailScreen(pts, liveTail, (ll) => map.project(ll));
    }

    clearStroke();

    if (pts.length < minPoints) {
      onStrokeTooShort?.();
      return;
    }
    const first = pts[0]!;
    const ring: [number, number][] = [...pts, first];
    onComplete({ type: 'Polygon', coordinates: [ring] });
  }, [minPoints, onComplete, onStrokeTooShort, clearStroke, releasePointerCapture]);

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!active) return;
      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      const map = resolveMapboxMap(e);
      mapRef.current = map;
      draggingRef.current = true;
      setDragging(true);

      if (map && ev instanceof PointerEvent) {
        const canvas = map.getCanvas?.();
        if (canvas) {
          try {
            canvas.setPointerCapture(ev.pointerId);
            capturePointerIdRef.current = ev.pointerId;
          } catch {
            capturePointerIdRef.current = null;
          }
        }
      }

      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      pointsRef.current = [pt];
      tailRef.current = pt;
      setStroke([pt]);
      setTail(pt);
    },
    [active],
  );

  /** Primary path while the cursor stays over the map (react-map-gl gives correct lngLat). */
  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!draggingRef.current) return;
      appendPoint(e.lngLat.lng, e.lngLat.lat);
    },
    [appendPoint],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const map = mapRef.current;
      if (!map) return;
      const lngLat = clientToLngLat(map, ev.clientX, ev.clientY);
      appendPoint(lngLat.lng, lngLat.lat);
    };

    const onUp = () => finishStroke();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, appendPoint, finishStroke]);

  const previewFeature: Feature<Polygon> | null = useMemo(() => {
    if (stroke.length < 2) return null;
    const first = stroke[0]!;
    const live = tail ?? stroke[stroke.length - 1]!;
    const ring: [number, number][] = [...stroke, live, first];
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
  }, [stroke, tail]);

  const edgeFeature: Feature<LineString> | null = useMemo(() => {
    if (stroke.length === 0) return null;
    const coords = tail ? [...stroke, tail] : stroke;
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
  }, [stroke, tail]);

  return {
    isActive: active,
    isDragging: dragging,
    startDrawing,
    stopDrawing,
    previewFeature,
    edgeFeature,
    handleMouseDown,
    handleMouseMove,
    cursor: active ? 'crosshair' : '',
  } as const;
}

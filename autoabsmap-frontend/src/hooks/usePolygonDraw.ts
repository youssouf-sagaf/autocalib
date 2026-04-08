import { useState, useCallback, useRef } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import type { Feature, Polygon, LineString, Point, FeatureCollection } from 'geojson';

interface UsePolygonDrawOptions {
  onComplete: (polygon: GeoJSON.Polygon) => void;
  minVertices?: number;
}

const SNAP_THRESHOLD_PX = 12;

/**
 * Polygon draw tool — click to place vertices, double-click or snap to
 * first vertex to close.  Escape removes the last vertex (or cancels).
 */
export function usePolygonDraw({
  onComplete,
  minVertices = 3,
}: UsePolygonDrawOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  const lastClickTime = useRef(0);

  const startDrawing = useCallback(() => {
    setIsDrawing(true);
    setVertices([]);
    setCursorPos(null);
  }, []);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    setVertices([]);
    setCursorPos(null);
  }, []);

  const closePolygon = useCallback(
    (pts: [number, number][]) => {
      if (pts.length < minVertices) return;
      const first = pts[0];
      if (!first) return;
      const ring: [number, number][] = [...pts, first];
      const polygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [ring],
      };
      onComplete(polygon);
      setVertices([]);
      setCursorPos(null);
    },
    [onComplete, minVertices],
  );

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isDrawing) return;

      const now = Date.now();
      const isDblClick = now - lastClickTime.current < 350;
      lastClickTime.current = now;

      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (isDblClick && vertices.length >= minVertices) {
        closePolygon(vertices);
        return;
      }

      if (vertices.length >= minVertices) {
        const first = vertices[0];
        if (first) {
          const p = e.point;
          const map = e.target as unknown as { project: (lngLat: [number, number]) => { x: number; y: number } };
          const firstScreen = map.project(first);
          const dx = p.x - firstScreen.x;
          const dy = p.y - firstScreen.y;
          if (Math.sqrt(dx * dx + dy * dy) < SNAP_THRESHOLD_PX) {
            closePolygon(vertices);
            return;
          }
        }
      }

      setVertices((prev) => [...prev, pt]);
    },
    [isDrawing, vertices, minVertices, closePolygon],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isDrawing || vertices.length === 0) return;
      setCursorPos([e.lngLat.lng, e.lngLat.lat]);
    },
    [isDrawing, vertices],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (vertices.length > 0) {
          setVertices((prev) => prev.slice(0, -1));
          setCursorPos(null);
        } else {
          stopDrawing();
        }
      }
    },
    [vertices.length, stopDrawing],
  );

  /* ── Preview GeoJSON ── */

  const previewFeature: Feature<Polygon> | null = (() => {
    if (vertices.length < 2 || !cursorPos) return null;
    const first = vertices[0];
    if (!first) return null;
    const ring: [number, number][] = [...vertices, cursorPos, first];
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    };
  })();

  const edgeFeature: Feature<LineString> | null =
    vertices.length >= 1 && cursorPos
      ? {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [...vertices, cursorPos],
          },
        }
      : null;

  const vertexFeatures: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: vertices.map((v, i) => ({
      type: 'Feature' as const,
      properties: { index: i, isFirst: i === 0 },
      geometry: { type: 'Point' as const, coordinates: v },
    })),
  };

  return {
    isDrawing,
    vertices,
    startDrawing,
    stopDrawing,
    previewFeature,
    edgeFeature,
    vertexFeatures,
    handleClick,
    handleMouseMove,
    handleKeyDown,
    cursor: isDrawing ? 'crosshair' : '',
  } as const;
}

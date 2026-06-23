import { useState, useCallback, useRef } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import type { Feature, Polygon, LineString, Point, FeatureCollection } from 'geojson';
import { createLogger } from '../utils/logger';

const log = createLogger('roi');

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
  const drawSessionStart = useRef<number | null>(null);

  const startDrawing = useCallback(() => {
    drawSessionStart.current = performance.now();
    setIsDrawing(true);
    setVertices([]);
    setCursorPos(null);
    log.info('Draw session started');
  }, []);

  const stopDrawing = useCallback(() => {
    const elapsedMs =
      drawSessionStart.current == null
        ? null
        : Math.round(performance.now() - drawSessionStart.current);
    drawSessionStart.current = null;
    setIsDrawing(false);
    setVertices([]);
    setCursorPos(null);
    if (elapsedMs != null) {
      log.info(`Draw session cancelled after ${elapsedMs}ms`);
    }
  }, []);

  const closePolygon = useCallback(
    (pts: [number, number][]) => {
      if (pts.length < minVertices) return;
      const first = pts[0];
      if (!first) return;
      const t0 = performance.now();
      const sessionMs =
        drawSessionStart.current == null
          ? null
          : Math.round(t0 - drawSessionStart.current);
      const ring: [number, number][] = [...pts, first];
      const polygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [ring],
      };
      onComplete(polygon);
      const completeMs = Math.round(performance.now() - t0);
      drawSessionStart.current = null;
      setVertices([]);
      setCursorPos(null);
      log.info(
        `Polygon closed (${pts.length} vertices): onComplete=${completeMs}ms` +
          (sessionMs != null ? `, session=${sessionMs}ms` : ''),
      );
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
          const target = e.target as {
            project?: (lngLat: [number, number]) => { x: number; y: number };
            getMap?: () => { project: (lngLat: [number, number]) => { x: number; y: number } };
          };
          const mapboxMap = target.getMap?.() ?? target;
          if (typeof mapboxMap.project === 'function') {
            const firstScreen = mapboxMap.project(first);
            const dx = p.x - firstScreen.x;
            const dy = p.y - firstScreen.y;
            if (Math.sqrt(dx * dx + dy * dy) < SNAP_THRESHOLD_PX) {
              closePolygon(vertices);
              return;
            }
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

  /** Remove the last placed vertex, or exit draw mode if none. */
  const undoDrawingStep = useCallback(() => {
    if (!isDrawing) return;
    if (vertices.length > 0) {
      setVertices((prev) => prev.slice(0, -1));
      setCursorPos(null);
    } else {
      stopDrawing();
    }
  }, [isDrawing, vertices.length, stopDrawing]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        undoDrawingStep();
      }
    },
    [undoDrawingStep],
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
    undoDrawingStep,
    previewFeature,
    edgeFeature,
    vertexFeatures,
    handleClick,
    handleMouseMove,
    handleKeyDown,
    cursor: isDrawing ? 'crosshair' : '',
  } as const;
}

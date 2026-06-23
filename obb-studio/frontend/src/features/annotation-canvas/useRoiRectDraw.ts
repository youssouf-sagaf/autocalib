import { useCallback, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import type { Feature, LineString, Polygon } from 'geojson';

/** Matches backend ``Settings.tile_size_px`` × ``primary_gsd_m``. */
export const TRAINING_TILE_PX = 1024;
export const TRAINING_GSD_M = 0.05;
export const TRAINING_ROI_SIZE_M = TRAINING_TILE_PX * TRAINING_GSD_M;

export type RoiVertex = { lng: number; lat: number };

export function rectCornersFromCenter(
  lng: number,
  lat: number,
  sizeM = TRAINING_ROI_SIZE_M,
): RoiVertex[] {
  const half = sizeM / 2;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const dLat = half / metersPerDegLat;
  const dLng = half / metersPerDegLng;
  return [
    { lng: lng - dLng, lat: lat - dLat },
    { lng: lng + dLng, lat: lat - dLat },
    { lng: lng + dLng, lat: lat + dLat },
    { lng: lng - dLng, lat: lat + dLat },
  ];
}

export function isPointInRect(point: RoiVertex, corners: RoiVertex[]): boolean {
  if (corners.length !== 4) return false;
  const lngs = corners.map((c) => c.lng);
  const lats = corners.map((c) => c.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  return (
    point.lng >= minLng &&
    point.lng <= maxLng &&
    point.lat >= minLat &&
    point.lat <= maxLat
  );
}

function toPolygonFeature(corners: RoiVertex[]): Feature<Polygon> {
  const ring = [...corners, corners[0]!].map((v) => [v.lng, v.lat] as [number, number]);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

type DragState = {
  startPointer: RoiVertex;
  startCenter: RoiVertex;
};

export type RoiMapAction = { action: 'place'; corners: RoiVertex[] };

export function useRoiRectDraw() {
  const [drawing, setDrawing] = useState(false);
  const [center, setCenter] = useState<RoiVertex | null>(null);
  const centerRef = useRef<RoiVertex | null>(null);
  const [previewCenter, setPreviewCenter] = useState<RoiVertex | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const setCenterSync = useCallback((next: RoiVertex | null) => {
    centerRef.current = next;
    setCenter(next);
  }, []);

  const startDrawing = useCallback(() => {
    setDrawing(true);
    setCenterSync(null);
    setPreviewCenter(null);
    setDragging(false);
    dragRef.current = null;
  }, [setCenterSync]);

  const stopDrawing = useCallback(() => {
    setDrawing(false);
    setCenterSync(null);
    setPreviewCenter(null);
    setDragging(false);
    dragRef.current = null;
  }, [setCenterSync]);

  const clearRect = useCallback(() => {
    setCenterSync(null);
    setPreviewCenter(null);
    setDragging(false);
    dragRef.current = null;
  }, [setCenterSync]);

  const activeCenter = center ?? previewCenter;

  const activeCorners = useMemo(
    () => (activeCenter ? rectCornersFromCenter(activeCenter.lng, activeCenter.lat) : []),
    [activeCenter],
  );

  const hasPosition = activeCorners.length === 4;
  const isAnchored = center !== null;

  const getSaveCorners = useCallback((): RoiVertex[] => {
    const c = center ?? previewCenter;
    return c ? rectCornersFromCenter(c.lng, c.lat) : [];
  }, [center, previewCenter]);

  const handleMapMouseDown = useCallback(
    (e: MapMouseEvent): RoiMapAction | null => {
      if (!drawing) return null;
      const pointer = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      const anchored = centerRef.current;
      if (anchored) {
        const corners = rectCornersFromCenter(anchored.lng, anchored.lat);
        if (isPointInRect(pointer, corners)) {
          dragRef.current = { startPointer: pointer, startCenter: anchored };
          setDragging(true);
          return null;
        }
      }
      setCenterSync(pointer);
      setPreviewCenter(null);
      return {
        action: 'place',
        corners: rectCornersFromCenter(pointer.lng, pointer.lat),
      };
    },
    [drawing, setCenterSync],
  );

  const handleMapMouseUp = useCallback((): null => {
    setDragging(false);
    dragRef.current = null;
    return null;
  }, []);

  const handleMapMove = useCallback(
    (e: MapMouseEvent) => {
      if (!drawing) {
        setPreviewCenter(null);
        return;
      }

      const pointer = { lng: e.lngLat.lng, lat: e.lngLat.lat };

      if (dragging && dragRef.current) {
        const { startPointer, startCenter } = dragRef.current;
        setCenterSync({
          lng: startCenter.lng + (pointer.lng - startPointer.lng),
          lat: startCenter.lat + (pointer.lat - startPointer.lat),
        });
        return;
      }

      if (!centerRef.current) {
        setPreviewCenter(pointer);
      }
    },
    [drawing, dragging, setCenterSync],
  );

  const fillFeature: Feature<Polygon> | null = useMemo(
    () => (activeCorners.length === 4 ? toPolygonFeature(activeCorners) : null),
    [activeCorners],
  );

  const edgeFeature: Feature<LineString> | null = useMemo(() => {
    if (activeCorners.length !== 4) return null;
    const coords = [...activeCorners, activeCorners[0]!].map(
      (v) => [v.lng, v.lat] as [number, number],
    );
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
  }, [activeCorners]);

  return {
    drawing,
    dragging,
    center,
    hasPosition,
    isAnchored,
    corners: activeCorners,
    startDrawing,
    stopDrawing,
    clearRect,
    getSaveCorners,
    handleMapMouseDown,
    handleMapMouseUp,
    handleMapMove,
    fillFeature,
    edgeFeature,
  };
}

import { useState, useCallback } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import type { Feature, Polygon } from 'geojson';

interface UseRectangleDrawOptions {
  onComplete: (polygon: GeoJSON.Polygon) => void;
}

function makeRectPolygon(
  corner1: [number, number],
  corner2: [number, number],
): GeoJSON.Polygon {
  const [lng1, lat1] = corner1;
  const [lng2, lat2] = corner2;
  return {
    type: 'Polygon',
    coordinates: [[
      [lng1, lat1],
      [lng2, lat1],
      [lng2, lat2],
      [lng1, lat2],
      [lng1, lat1],
    ]],
  };
}

export function useRectangleDraw({ onComplete }: UseRectangleDrawOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [firstCorner, setFirstCorner] = useState<[number, number] | null>(null);
  const [previewFeature, setPreviewFeature] = useState<Feature<Polygon> | null>(null);

  const startDrawing = useCallback(() => {
    setIsDrawing(true);
    setFirstCorner(null);
    setPreviewFeature(null);
  }, []);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    setFirstCorner(null);
    setPreviewFeature(null);
  }, []);

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isDrawing) return;
      const point: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (!firstCorner) {
        setFirstCorner(point);
        return;
      }

      const polygon = makeRectPolygon(firstCorner, point);
      onComplete(polygon);
      setFirstCorner(null);
      setPreviewFeature(null);
    },
    [isDrawing, firstCorner, onComplete],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isDrawing || !firstCorner) return;
      const current: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      setPreviewFeature({
        type: 'Feature',
        properties: {},
        geometry: makeRectPolygon(firstCorner, current),
      });
    },
    [isDrawing, firstCorner],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (firstCorner) {
          setFirstCorner(null);
          setPreviewFeature(null);
        } else {
          stopDrawing();
        }
      }
    },
    [firstCorner, stopDrawing],
  );

  return {
    isDrawing,
    firstCorner,
    startDrawing,
    stopDrawing,
    previewFeature,
    handleClick,
    handleMouseMove,
    handleKeyDown,
    cursor: isDrawing ? 'crosshair' : '',
  } as const;
}

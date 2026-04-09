import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bulkDeleteSlots, setEditMode } from '../store/autoabsmap-slice';
import { usePolygonDraw } from './usePolygonDraw';
import { slotTouchesLassoPolygon } from '../utils/geoHitTest';

/**
 * Bulk delete: draw a closed polygon (lasso); slots whose centroid or footprint
 * vertex lies inside are preview-highlighted; Enter confirms one bulk_delete event.
 */
export function useBulkDelete() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.absmap.editMode);
  const finalSlots = useAppSelector((s) => s.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.absmap.baselineSlots);
  const hasResults = finalSlots.length > 0 || baselineSlots.length > 0;

  const slotsForPick = useMemo(
    () => (finalSlots.length > 0 ? finalSlots : baselineSlots),
    [finalSlots, baselineSlots],
  );

  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const startDrawingRef = useRef<() => void>(() => {});

  const onLassoComplete = useCallback(
    (polygon: GeoJSON.Polygon) => {
      const editable = new Set(finalSlots.map((s) => s.slot_id));
      const hits = slotsForPick
        .filter((s) => slotTouchesLassoPolygon(s, polygon))
        .map((s) => s.slot_id)
        .filter((id) => editable.has(id));
      const unique = [...new Set(hits)];
      setPreviewIds(unique);
      if (unique.length === 0) {
        startDrawingRef.current();
      }
    },
    [finalSlots, slotsForPick],
  );

  const {
    isDrawing: isBulkDrawing,
    startDrawing,
    stopDrawing,
    previewFeature,
    edgeFeature,
    vertexFeatures,
    handleClick: lassoClick,
    handleMouseMove: lassoMouseMove,
    handleKeyDown: lassoKeyDown,
  } = usePolygonDraw({ onComplete: onLassoComplete });

  useEffect(() => {
    startDrawingRef.current = startDrawing;
  }, [startDrawing]);

  const isBulkDeleteMode = editMode === 'bulk_delete';

  const toggleBulkDeleteMode = useCallback(() => {
    if (!hasResults) return;
    if (isBulkDeleteMode) {
      stopDrawing();
      setPreviewIds(null);
      dispatch(setEditMode('none'));
      return;
    }
    dispatch(setEditMode('bulk_delete'));
    setPreviewIds(null);
    queueMicrotask(() => startDrawing());
  }, [dispatch, hasResults, isBulkDeleteMode, startDrawing, stopDrawing]);

  const confirmBulkDelete = useCallback(() => {
    if (!previewIds?.length) return;
    dispatch(bulkDeleteSlots(previewIds));
    setPreviewIds(null);
    startDrawing();
  }, [dispatch, previewIds, startDrawing]);

  const cancelBulkDelete = useCallback(() => {
    stopDrawing();
    setPreviewIds(null);
    dispatch(setEditMode('none'));
  }, [dispatch, stopDrawing]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isBulkDeleteMode) return;
      if (previewIds !== null) return;
      lassoClick(e);
    },
    [isBulkDeleteMode, previewIds, lassoClick],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isBulkDeleteMode || previewIds !== null) return;
      lassoMouseMove(e);
    },
    [isBulkDeleteMode, previewIds, lassoMouseMove],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isBulkDeleteMode) return;
      if (e.key === 'Enter') {
        if (previewIds?.length) {
          e.preventDefault();
          confirmBulkDelete();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (previewIds !== null) {
          setPreviewIds(null);
          startDrawing();
          return;
        }
        if (isBulkDrawing) {
          lassoKeyDown(e);
          return;
        }
        dispatch(setEditMode('none'));
      }
    },
    [
      isBulkDeleteMode,
      previewIds,
      isBulkDrawing,
      lassoKeyDown,
      confirmBulkDelete,
      startDrawing,
      dispatch,
    ],
  );

  return {
    isBulkDeleteMode,
    isBulkDrawing,
    previewIds,
    previewFeature: isBulkDeleteMode && previewIds === null ? previewFeature : null,
    edgeFeature: isBulkDeleteMode && previewIds === null ? edgeFeature : null,
    vertexFeatures: isBulkDeleteMode && previewIds === null ? vertexFeatures : undefined,
    toggleBulkDeleteMode,
    confirmBulkDelete,
    cancelBulkDelete,
    handleMapClick,
    handleMouseMove,
    handleKeyDown,
  } as const;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import type { Feature, LineString } from 'geojson';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bulkDeleteSlots, setEditMode } from '../store/autocalib-slice';
import { useFreehandLasso } from './useFreehandLasso';
import { slotTouchesLassoPolygon } from '../utils/geoHitTest';
import { showAlertModal } from '../ui/AlertModal';
import type { Slot } from '../types';

type BulkDeletePhase = 'draw' | 'confirm';

function resolveLassoHits(
  slots: Slot[],
  deletableIds: Set<string>,
  polygon: GeoJSON.Polygon,
): string[] {
  const hits = slots
    .filter((s) => slotTouchesLassoPolygon(s, polygon))
    .map((s) => s.slot_id)
    .filter((id) => deletableIds.has(id));
  return [...new Set(hits)];
}

function polygonToEdgeFeature(polygon: GeoJSON.Polygon): Feature<LineString> {
  const ring = polygon.coordinates[0] ?? [];
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: ring },
  };
}

/**
 * Bulk delete: freehand lasso with live preview → release → Enter to confirm.
 */
export function useBulkDelete() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const finalSlots = useAppSelector((s) => s.autocalib.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.autocalib.absmap.baselineSlots);
  const b2bSnapshotAtLoad = useAppSelector((s) => s.autocalib.absmap.b2bSnapshotAtLoad);
  const hasResults =
    finalSlots.length > 0 || baselineSlots.length > 0 || b2bSnapshotAtLoad.length > 0;

  const slotsForPick = useMemo(() => {
    if (finalSlots.length > 0) return finalSlots;
    if (baselineSlots.length > 0) return baselineSlots;
    return b2bSnapshotAtLoad;
  }, [finalSlots, baselineSlots, b2bSnapshotAtLoad]);

  const deletableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of finalSlots) ids.add(s.slot_id);
    for (const s of baselineSlots) ids.add(s.slot_id);
    for (const s of b2bSnapshotAtLoad) ids.add(s.slot_id);
    return ids;
  }, [finalSlots, baselineSlots, b2bSnapshotAtLoad]);

  const [phase, setPhase] = useState<BulkDeletePhase>('draw');
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [confirmPolygon, setConfirmPolygon] = useState<GeoJSON.Polygon | null>(null);

  const startDrawingRef = useRef<() => void>(() => {});

  const resetConfirm = useCallback(() => {
    setPhase('draw');
    setPendingIds([]);
    setConfirmPolygon(null);
  }, []);

  const onStrokeTooShort = useCallback(() => {
    showAlertModal({
      variant: 'warning',
      titleKey: 'alerts.lassoCopyTooShort.title',
      messageKey: 'alerts.lassoCopyTooShort.message',
      onClose: () => startDrawingRef.current(),
    });
  }, []);

  const onLassoComplete = useCallback(
    (polygon: GeoJSON.Polygon) => {
      const hits = resolveLassoHits(slotsForPick, deletableIds, polygon);
      if (hits.length === 0) {
        showAlertModal({
          variant: 'warning',
          titleKey: 'alerts.lassoNoHits.title',
          messageKey: 'alerts.lassoNoHits.message',
          onClose: () => startDrawingRef.current(),
        });
        return;
      }
      setPendingIds(hits);
      setConfirmPolygon(polygon);
      setPhase('confirm');
    },
    [slotsForPick, deletableIds],
  );

  const {
    isActive: isBulkDrawing,
    isDragging: isBulkLassoDragging,
    startDrawing,
    stopDrawing,
    previewFeature: lassoPreviewFeature,
    edgeFeature: lassoEdgeFeature,
    handleMouseDown: lassoMouseDown,
    handleMouseMove: lassoMouseMove,
    cursor: lassoCursor,
  } = useFreehandLasso({ onComplete: onLassoComplete, onStrokeTooShort });

  useEffect(() => {
    startDrawingRef.current = startDrawing;
  }, [startDrawing]);

  useEffect(() => {
    if (phase === 'confirm') stopDrawing();
  }, [phase, stopDrawing]);

  const isBulkDeleteMode = editMode === 'bulk_delete';

  const livePreviewIds = useMemo(() => {
    if (!isBulkDeleteMode || phase !== 'draw' || !lassoPreviewFeature) return [];
    return resolveLassoHits(slotsForPick, deletableIds, lassoPreviewFeature.geometry);
  }, [isBulkDeleteMode, phase, lassoPreviewFeature, slotsForPick, deletableIds]);

  const bulkPreviewSlotIds =
    phase === 'confirm' ? pendingIds : livePreviewIds.length > 0 ? livePreviewIds : null;

  const confirmEdgeFeature =
    phase === 'confirm' && confirmPolygon ? polygonToEdgeFeature(confirmPolygon) : null;

  const toggleBulkDeleteMode = useCallback(() => {
    if (!hasResults) return;
    if (isBulkDeleteMode) {
      stopDrawing();
      resetConfirm();
      dispatch(setEditMode('none'));
      return;
    }
    resetConfirm();
    dispatch(setEditMode('bulk_delete'));
    queueMicrotask(() => startDrawing());
  }, [dispatch, hasResults, isBulkDeleteMode, startDrawing, stopDrawing, resetConfirm]);

  const cancelBulkDelete = useCallback(() => {
    stopDrawing();
    resetConfirm();
    dispatch(setEditMode('none'));
  }, [dispatch, stopDrawing, resetConfirm]);

  const cancelConfirm = useCallback(() => {
    resetConfirm();
    queueMicrotask(() => startDrawing());
  }, [resetConfirm, startDrawing]);

  const confirmBulkDelete = useCallback(() => {
    if (pendingIds.length === 0) return;
    dispatch(bulkDeleteSlots(pendingIds));
    resetConfirm();
    queueMicrotask(() => startDrawing());
  }, [dispatch, pendingIds, resetConfirm, startDrawing]);

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!isBulkDeleteMode || phase !== 'draw') return;
      lassoMouseDown(e);
    },
    [isBulkDeleteMode, phase, lassoMouseDown],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isBulkDeleteMode || phase !== 'draw') return;
      lassoMouseMove(e);
    },
    [isBulkDeleteMode, phase, lassoMouseMove],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isBulkDeleteMode) return;

      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        if (phase === 'confirm' && pendingIds.length > 0) {
          e.preventDefault();
          confirmBulkDelete();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (phase === 'confirm') {
          cancelConfirm();
          return;
        }
        if (isBulkLassoDragging) {
          stopDrawing();
          queueMicrotask(() => startDrawing());
          return;
        }
        cancelBulkDelete();
      }
    },
    [
      isBulkDeleteMode,
      phase,
      pendingIds.length,
      confirmBulkDelete,
      cancelConfirm,
      isBulkLassoDragging,
      stopDrawing,
      startDrawing,
      cancelBulkDelete,
    ],
  );

  return {
    isBulkDeleteMode,
    isBulkDrawing,
    isBulkLassoDragging,
    bulkDeletePhase: phase,
    bulkDeletePendingCount: pendingIds.length,
    bulkPreviewSlotIds,
    previewFeature: null,
    edgeFeature: isBulkDeleteMode ? (confirmEdgeFeature ?? lassoEdgeFeature) : null,
    vertexFeatures: undefined,
    toggleBulkDeleteMode,
    cancelBulkDelete,
    confirmBulkDelete,
    cancelBulkDeleteConfirm: cancelConfirm,
    handleMouseDown,
    handleMouseMove,
    handleKeyDown,
    cursor: isBulkDeleteMode ? lassoCursor || 'crosshair' : '',
  } as const;
}

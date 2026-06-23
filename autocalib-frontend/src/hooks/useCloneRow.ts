import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { RootState } from '../store/store';
import {
  setEditMode,
  tileRowSetProposed,
  cloneRowAccept,
  tileRowReject,
  tileRowReset,
} from '../store/autocalib-slice';
import {
  activeSessionSlots,
  extractObbMetrics,
  translateSlots,
} from '../utils/slot-geometry';
import { slotTouchesLassoPolygon } from '../utils/geoHitTest';
import { useFreehandLasso } from './useFreehandLasso';
import { showAlertModal } from '../ui/AlertModal';
import { createLogger } from '../utils/logger';
import type { Slot } from '../types';

const log = createLogger('row-clone');

type CloneStep = 'idle' | 'pickRow' | 'placing';

interface MapboxLike {
  dragPan?: { disable: () => void; enable: () => void };
  getCanvas?: () => HTMLCanvasElement;
  unproject: (point: [number, number]) => { lng: number; lat: number };
}

function resolveMapboxMap(e: MapMouseEvent): MapboxLike | null {
  const target = e.target as unknown;
  if (!target || typeof target !== 'object') return null;
  if ('unproject' in target) return target as MapboxLike;
  if ('getMap' in target && typeof (target as { getMap: () => unknown }).getMap === 'function') {
    const map = (target as { getMap: () => unknown }).getMap();
    if (map && typeof map === 'object') return map as MapboxLike;
  }
  return null;
}

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

function selectionCentroid(slots: Slot[]): [number, number] {
  let lng = 0;
  let lat = 0;
  for (const s of slots) {
    lng += s.center.lng;
    lat += s.center.lat;
  }
  return [lng / slots.length, lat / slots.length];
}

/** Perpendicular offset so a tap-only pick shows the copy beside the selection. */
function initialCloneOffset(selection: Slot[]): { dLng: number; dLat: number } {
  const ref = selection[0]!;
  const metrics = extractObbMetrics(ref.polygon);
  const angle = ref.obbAngle ?? metrics.angle;
  const R = 6_371_000;
  const latRad = (ref.center.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * R;
  const mPerDegLng = (Math.PI / 180) * R * Math.cos(latRad);
  const offsetM = metrics.width * 1.1;
  const perpAngle = angle + Math.PI / 2;
  return {
    dLng: (offsetM * Math.cos(perpAngle)) / mPerDegLng,
    dLat: (offsetM * Math.sin(perpAngle)) / mPerDegLat,
  };
}

/**
 * Row duplicate: freehand lasso to select slot(s) → drag copy → Enter to commit.
 */
export function useCloneRow() {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const finalSlots = useAppSelector((s) => s.autocalib.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.autocalib.absmap.baselineSlots);
  const proposed = useAppSelector((s) => s.autocalib.absmap.tileRowProposed);

  const sessionSlots = useMemo(
    () => activeSessionSlots(finalSlots, baselineSlots),
    [finalSlots, baselineSlots],
  );

  const slotsForPick = sessionSlots;

  const canActivate = useAppSelector((s) => {
    const st = s.autocalib.absmap.job?.status;
    if (st === 'running' || st === 'pending') return false;
    return (
      s.autocalib.absmap.slots.length > 0
      || s.autocalib.absmap.baselineSlots.length > 0
      || s.autocalib.absmap.b2bSnapshotAtLoad.length > 0
    );
  });

  const isCloneRowMode = editMode === 'clone_row';

  const [sourceCluster, setSourceCluster] = useState<Slot[] | null>(null);
  const [isPlacingDragging, setIsPlacingDragging] = useState(false);

  const isDraggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const mapRef = useRef<MapboxLike | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);
  const sourceClusterRef = useRef<Slot[] | null>(null);
  const anchorLngLatRef = useRef<[number, number] | null>(null);
  const startLassoRef = useRef<() => void>(() => {});

  const step: CloneStep = !isCloneRowMode
    ? 'idle'
    : sourceCluster
      ? 'placing'
      : 'pickRow';

  const applyPreviewAtCursor = useCallback(
    (cursorLng: number, cursorLat: number, cluster: Slot[], anchor: [number, number]) => {
      const dLng = cursorLng - anchor[0];
      const dLat = cursorLat - anchor[1];
      dispatch(tileRowSetProposed(translateSlots(cluster, dLng, dLat)));
    },
    [dispatch],
  );

  const updatePreview = useCallback(
    (cursorLng: number, cursorLat: number) => {
      if (!sourceClusterRef.current || !anchorLngLatRef.current) return;
      applyPreviewAtCursor(
        cursorLng,
        cursorLat,
        sourceClusterRef.current,
        anchorLngLatRef.current,
      );
    },
    [applyPreviewAtCursor],
  );

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

  const setPlacingCluster = useCallback((cluster: Slot[]) => {
    const anchor = selectionCentroid(cluster);
    sourceClusterRef.current = cluster;
    anchorLngLatRef.current = anchor;
    setSourceCluster(cluster);
  }, []);

  const beginPlacingWithOffset = useCallback(
    (cluster: Slot[]) => {
      setPlacingCluster(cluster);
      const offset = initialCloneOffset(cluster);
      dispatch(
        tileRowSetProposed(
          translateSlots(cluster, offset.dLng, offset.dLat),
        ),
      );
      log.info(`Row duplicate — ${cluster.length} slot(s) selected, drag to position`);
    },
    [dispatch, setPlacingCluster],
  );

  const onStrokeTooShort = useCallback(() => {
    showAlertModal({
      variant: 'warning',
      titleKey: 'alerts.lassoCopyTooShort.title',
      messageKey: 'alerts.lassoCopyTooShort.message',
      onClose: () => startLassoRef.current(),
    });
  }, []);

  const onLassoComplete = useCallback(
    (polygon: GeoJSON.Polygon) => {
      const hits = slotsForPick.filter((s) => slotTouchesLassoPolygon(s, polygon));
      if (hits.length === 0) {
        showAlertModal({
          variant: 'warning',
          titleKey: 'alerts.cloneRowNoPick.title',
          messageKey: 'alerts.cloneRowNoPick.message',
          onClose: () => startLassoRef.current(),
        });
        return;
      }
      beginPlacingWithOffset(hits);
    },
    [slotsForPick, beginPlacingWithOffset],
  );

  const {
    isDragging: isCloneLassoDragging,
    startDrawing: startLassoDrawing,
    stopDrawing: stopLassoDrawing,
    edgeFeature: lassoEdgeFeature,
    handleMouseDown: lassoMouseDown,
    handleMouseMove: lassoMouseMove,
  } = useFreehandLasso({ onComplete: onLassoComplete, onStrokeTooShort });

  useEffect(() => {
    startLassoRef.current = startLassoDrawing;
  }, [startLassoDrawing]);

  useEffect(() => {
    if (step === 'placing') stopLassoDrawing();
  }, [step, stopLassoDrawing]);

  const startDrag = useCallback(
    (e: MapMouseEvent) => {
      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return false;

      const map = resolveMapboxMap(e);
      map?.dragPan?.disable();
      ev.preventDefault();
      ev.stopPropagation();

      mapRef.current = map;
      isDraggingRef.current = true;
      dragMovedRef.current = false;
      setIsPlacingDragging(true);

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
      return true;
    },
    [],
  );

  const resetLocal = useCallback(() => {
    isDraggingRef.current = false;
    dragMovedRef.current = false;
    setIsPlacingDragging(false);
    mapRef.current?.dragPan?.enable();
    mapRef.current = null;
    releasePointerCapture();
    sourceClusterRef.current = null;
    anchorLngLatRef.current = null;
    setSourceCluster(null);
  }, [releasePointerCapture]);

  const restartLassoPick = useCallback(() => {
    queueMicrotask(() => startLassoDrawing());
  }, [startLassoDrawing]);

  const toggleMode = useCallback(() => {
    if (!canActivate) {
      showAlertModal({
        variant: 'warning',
        titleKey: 'alerts.cloneRowNeedSlots.title',
        messageKey: 'alerts.cloneRowNeedSlots.message',
      });
      return;
    }
    if (isCloneRowMode) {
      stopLassoDrawing();
      resetLocal();
      dispatch(tileRowReset());
      dispatch(setEditMode('none'));
    } else {
      resetLocal();
      dispatch(tileRowReset());
      dispatch(setEditMode('clone_row'));
      restartLassoPick();
      log.info('Row duplicate on — lasso around slot(s) to duplicate');
    }
  }, [canActivate, isCloneRowMode, dispatch, resetLocal, stopLassoDrawing, restartLassoPick]);

  const cancelMode = useCallback(() => {
    stopLassoDrawing();
    resetLocal();
    dispatch(tileRowReset());
    dispatch(setEditMode('none'));
  }, [dispatch, resetLocal, stopLassoDrawing]);

  const acceptProposed = useCallback(() => {
    if (proposed.length === 0) return;
    const expected = proposed.length;
    const slotsBefore = store.getState().autocalib.absmap.slots.length;
    dispatch(cloneRowAccept());
    const slotsAfter = store.getState().autocalib.absmap.slots.length;
    const added = slotsAfter - slotsBefore;
    if (added === 0) {
      showAlertModal({
        variant: 'warning',
        titleKey: 'alerts.cloneRowNothingCommitted.title',
        messageKey: 'alerts.cloneRowNothingCommitted.message',
        onClose: () => restartLassoPick(),
      });
      resetLocal();
      return;
    }
    if (added < expected) {
      log.warn(`Row duplicate: ${added}/${expected} copies committed (id collision?)`);
    }
    resetLocal();
    restartLassoPick();
    log.info(`Row duplicate accepted — ${added} slot(s) committed`);
  }, [dispatch, store, proposed.length, resetLocal, restartLassoPick]);

  const endPlacingDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    const moved = dragMovedRef.current;
    isDraggingRef.current = false;
    setIsPlacingDragging(false);
    mapRef.current?.dragPan?.enable();
    releasePointerCapture();
    mapRef.current = null;
    if (!moved && sourceClusterRef.current) {
      const offset = initialCloneOffset(sourceClusterRef.current);
      dispatch(
        tileRowSetProposed(
          translateSlots(sourceClusterRef.current, offset.dLng, offset.dLat),
        ),
      );
    }
    dragMovedRef.current = false;
  }, [dispatch, releasePointerCapture]);

  const rejectPlacing = useCallback(() => {
    dispatch(tileRowReject());
    resetLocal();
    restartLassoPick();
  }, [dispatch, resetLocal, restartLassoPick]);

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!isCloneRowMode) return;

      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return;

      if (step === 'pickRow') {
        lassoMouseDown(e);
        return;
      }

      if (step === 'placing' && sourceClusterRef.current && anchorLngLatRef.current) {
        if (!startDrag(e)) return;
        updatePreview(e.lngLat.lng, e.lngLat.lat);
      }
    },
    [isCloneRowMode, step, lassoMouseDown, startDrag, updatePreview],
  );

  const handleMouseUp = useCallback(
    (e: MapMouseEvent) => {
      if (!isCloneRowMode || step !== 'placing') return;
      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return;
      endPlacingDrag();
    },
    [isCloneRowMode, step, endPlacingDrag],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isCloneRowMode) return;
      if (step === 'pickRow') {
        lassoMouseMove(e);
        return;
      }
      if (!isDraggingRef.current) return;
      dragMovedRef.current = true;
      updatePreview(e.lngLat.lng, e.lngLat.lat);
    },
    [isCloneRowMode, step, lassoMouseMove, updatePreview],
  );

  useEffect(() => {
    if (!isPlacingDragging) return;

    const onMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      dragMovedRef.current = true;
      const map = mapRef.current;
      if (!map) return;
      const lngLat = clientToLngLat(map, ev.clientX, ev.clientY);
      updatePreview(lngLat.lng, lngLat.lat);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      endPlacingDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isPlacingDragging, updatePreview, endPlacingDrag]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isCloneRowMode) return;

      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        if (step === 'placing' && proposed.length > 0) {
          e.preventDefault();
          acceptProposed();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'placing') {
          rejectPlacing();
        } else if (isCloneLassoDragging) {
          stopLassoDrawing();
          restartLassoPick();
        } else {
          cancelMode();
        }
      }
    },
    [
      isCloneRowMode,
      step,
      proposed.length,
      acceptProposed,
      rejectPlacing,
      isCloneLassoDragging,
      stopLassoDrawing,
      restartLassoPick,
      cancelMode,
    ],
  );

  return {
    isCloneRowMode,
    canCloneRow: canActivate,
    cloneRowStep: step,
    proposedSlots: proposed,
    sourceClusterSize: sourceCluster?.length ?? 0,
    isClonePlacingDragging: isPlacingDragging,
    isCloneLassoDragging: step === 'pickRow' && isCloneLassoDragging,
    edgeFeature: isCloneRowMode && step === 'pickRow' ? lassoEdgeFeature : null,
    handleMouseDown,
    handleMouseUp,
    handleMouseMove,
    handleKeyDown,
    toggleMode,
    cancelMode,
    acceptProposed,
    rejectProposed: rejectPlacing,
    cursor: isCloneRowMode
      ? step === 'pickRow'
        ? 'crosshair'
        : isPlacingDragging
          ? 'grabbing'
          : 'grab'
      : '',
  } as const;
}

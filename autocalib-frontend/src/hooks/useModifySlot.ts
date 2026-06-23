import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAbsmapDisplaySlots } from './useAbsmapDisplaySlots';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, modifySlot } from '../store/autocalib-slice';
import type { Slot } from '../types';
import { createLogger } from '../utils/logger';
import { slotKey } from '../utils/slot-key';
import { selectHasAbsmapEditableSlots } from '../store/autocalib-selectors';
import { extractObbMetrics, buildObbPolygon } from '../utils/slot-geometry';

const log = createLogger('modify');

interface ModifyState {
  originalSlot: Slot;
  currentLng: number;
  currentLat: number;
  width: number;
  height: number;
  angle: number;
}

interface MapboxLike {
  project: (lngLat: [number, number]) => { x: number; y: number };
  unproject: (point: [number, number]) => { lng: number; lat: number };
  getCanvas?: () => HTMLCanvasElement;
  dragPan?: { disable: () => void; enable: () => void };
}

function resolveMapboxMap(e: MapMouseEvent): MapboxLike | null {
  const target = e.target as unknown;
  if (!target || typeof target !== 'object') return null;
  if ('project' in target && typeof (target as MapboxLike).project === 'function') {
    return target as MapboxLike;
  }
  if ('dragPan' in target && 'unproject' in target) {
    return target as MapboxLike;
  }
  if ('getMap' in target && typeof (target as { getMap: () => unknown }).getMap === 'function') {
    const map = (target as { getMap: () => unknown }).getMap();
    if (map && typeof map === 'object' && 'unproject' in map) {
      return map as MapboxLike;
    }
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

function slotAtPosition(state: ModifyState, lng: number, lat: number): Slot {
  return {
    ...state.originalSlot,
    center: { lng, lat },
    polygon: buildObbPolygon(lng, lat, state.width, state.height, state.angle),
    obbAngle: state.angle,
  };
}

/**
 * Modify slot — drag the P marker to reposition only (no bbox overlay, no rotation).
 */
export function useModifySlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const editableSlots = useAbsmapDisplaySlots();
  const hasResults = useAppSelector(selectHasAbsmapEditableSlots);
  const isModifyMode = editMode === 'modify';

  const [state, setState] = useState<ModifyState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const stateRef = useRef<ModifyState | null>(null);
  const mapRef = useRef<MapboxLike | null>(null);
  const isDraggingRef = useRef(false);
  const capturePointerIdRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ lng: number; lat: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  stateRef.current = state;

  const flushDragPosition = useCallback(() => {
    rafRef.current = null;
    const pos = pendingPosRef.current;
    const s = stateRef.current;
    if (!pos || !s || !isDraggingRef.current) return;
    setState({
      ...s,
      currentLng: pos.lng,
      currentLat: pos.lat,
    });
  }, []);

  const scheduleDragPosition = useCallback(
    (lng: number, lat: number) => {
      pendingPosRef.current = { lng, lat };
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(flushDragPosition);
    },
    [flushDragPosition],
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

  const commitAt = useCallback(
    (lng: number, lat: number) => {
      const s = stateRef.current;
      if (!s) return;
      isDraggingRef.current = false;
      stateRef.current = null;
      setDragActive(false);
      const updated = slotAtPosition(s, lng, lat);
      log.info(
        `Commit slot ${slotKey(updated).slice(0, 8)}… → (${lng.toFixed(6)}, ${lat.toFixed(6)})`,
      );
      dispatch(modifySlot(updated));
      mapRef.current?.dragPan?.enable();
      mapRef.current = null;
      pendingPosRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setState(null);
    },
    [dispatch],
  );

  const modifyDragSlot = useMemo(() => {
    if (!state) return null;
    return slotAtPosition(state, state.currentLng, state.currentLat);
  }, [state]);

  const toggleModifyMode = useCallback(() => {
    if (!hasResults) return;
    if (isModifyMode) {
      log.info('Modify mode off');
      setState(null);
      isDraggingRef.current = false;
      dispatch(setEditMode('none'));
    } else {
      log.info(`Modify mode on (${editableSlots.length} editable slot(s))`);
      dispatch(setEditMode('modify'));
    }
  }, [dispatch, isModifyMode, hasResults, editableSlots.length]);

  const findEditableSlot = useCallback(
    (pickedId: string) => editableSlots.find((s) => slotKey(s) === pickedId),
    [editableSlots],
  );

  const selectSlotById = useCallback(
    (slotId: string) => {
      const slot = findEditableSlot(slotId);
      if (!slot) return;
      const metrics = extractObbMetrics(slot.polygon);
      setState({
        originalSlot: slot,
        currentLng: slot.center.lng,
        currentLat: slot.center.lat,
        width: metrics.width,
        height: metrics.height,
        angle: slot.obbAngle ?? metrics.angle,
      });
    },
    [findEditableSlot],
  );

  const pickUpSlot = useCallback(
    (pickedId: string) => {
      const slot = findEditableSlot(pickedId);
      if (!slot) {
        log.warn(
          `Pick up failed — id ${pickedId.slice(0, 8)}… not in editable set (${editableSlots.length} slot(s))`,
        );
        return false;
      }
      const metrics = extractObbMetrics(slot.polygon);
      log.info(`Pick up slot ${pickedId.slice(0, 8)}…`);
      setState({
        originalSlot: slot,
        currentLng: slot.center.lng,
        currentLat: slot.center.lat,
        width: metrics.width,
        height: metrics.height,
        angle: slot.obbAngle ?? metrics.angle,
      });
      return true;
    },
    [findEditableSlot, editableSlots.length],
  );

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!isModifyMode) return;
      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      if (!slotId) {
        log.debug('MouseDown — no slot feature under pointer');
        return;
      }

      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return;
      if (!pickUpSlot(slotId)) return;

      const map = resolveMapboxMap(e);
      if (!map) {
        log.warn('MouseDown — Mapbox map not resolved (drag will not track pointer)');
      }
      map?.dragPan?.disable();
      ev.preventDefault();
      ev.stopPropagation();

      mapRef.current = map;
      isDraggingRef.current = true;
      setDragActive(true);

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

      scheduleDragPosition(e.lngLat.lng, e.lngLat.lat);
    },
    [isModifyMode, pickUpSlot, scheduleDragPosition],
  );

  const handleMouseUp = useCallback(() => {
    if (!isModifyMode || !isDraggingRef.current) return;
    releasePointerCapture();
    const s = stateRef.current;
    if (s) commitAt(s.currentLng, s.currentLat);
  }, [isModifyMode, releasePointerCapture, commitAt]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isModifyMode || !state || isDraggingRef.current) return;
      commitAt(e.lngLat.lng, e.lngLat.lat);
    },
    [isModifyMode, state, commitAt],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isModifyMode || !isDraggingRef.current) return;
      scheduleDragPosition(e.lngLat.lng, e.lngLat.lat);
    },
    [isModifyMode, scheduleDragPosition],
  );

  useEffect(() => {
    if (!dragActive) return;

    const onMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const map = mapRef.current;
      if (!map) return;
      const lngLat = clientToLngLat(map, ev.clientX, ev.clientY);
      scheduleDragPosition(lngLat.lng, lngLat.lat);
    };

    const onUp = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const map = mapRef.current;
      const s = stateRef.current;
      if (!s) return;
      releasePointerCapture();
      if (map) {
        const lngLat = clientToLngLat(map, ev.clientX, ev.clientY);
        commitAt(lngLat.lng, lngLat.lat);
      } else {
        commitAt(s.currentLng, s.currentLat);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragActive, scheduleDragPosition, releasePointerCapture, commitAt]);

  const cancelModify = useCallback(() => {
    isDraggingRef.current = false;
    setDragActive(false);
    mapRef.current = null;
    releasePointerCapture();
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (state) {
      setState(null);
    } else {
      dispatch(setEditMode('none'));
    }
  }, [dispatch, state, releasePointerCapture]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isModifyMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelModify();
      }
    },
    [isModifyMode, cancelModify],
  );

  return {
    isModifyMode,
    modifyDragSlot,
    /** Disable map pan while a slot is picked up or actively dragged. */
    isModifyDragLocked: state !== null || dragActive,
    handleMapClick,
    handleMouseDown,
    handleMouseUp,
    handleMouseMove,
    handleKeyDown,
    toggleModifyMode,
    selectSlotById,
    cancelModify,
  } as const;
}

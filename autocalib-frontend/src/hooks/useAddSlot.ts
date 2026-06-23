import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, addSlot } from '../store/autocalib-slice';
import { uuid } from '../utils/uuid';
import type { Placement } from '../utils/slot-geometry';
import {
  computePlacementDefaultsFromNeighbors,
  mergeSlotsForPlacementHints,
  placementToSlot,
} from '../utils/slot-geometry';

interface MapboxLike {
  project: (lngLat: [number, number]) => { x: number; y: number };
  unproject: (point: [number, number]) => { lng: number; lat: number };
  getCanvas?: () => HTMLCanvasElement;
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

/**
 * Add slot — press on the map, drag the + marker, release to place (no bbox overlay).
 */
export function useAddSlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const slots = useAppSelector((s) => s.autocalib.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.autocalib.absmap.baselineSlots);
  const canActivateAdd = useAppSelector((s) => {
    const st = s.autocalib.absmap.job?.status;
    return st !== 'running' && st !== 'pending';
  });
  const isAddMode = editMode === 'add';

  const placementHintSlots = useMemo(
    () => mergeSlotsForPlacementHints(slots, baselineSlots),
    [slots, baselineSlots],
  );

  const [placement, setPlacement] = useState<Placement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const placementRef = useRef<Placement | null>(null);
  const mapRef = useRef<MapboxLike | null>(null);
  const isDraggingRef = useRef(false);
  const capturePointerIdRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ lng: number; lat: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  placementRef.current = placement;

  const flushDragPosition = useCallback(() => {
    rafRef.current = null;
    const pos = pendingPosRef.current;
    const p = placementRef.current;
    if (!pos || !p || !isDraggingRef.current) return;
    setPlacement({ ...p, centerLng: pos.lng, centerLat: pos.lat });
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

  const commitPlacement = useCallback(
    (p: Placement) => {
      dispatch(addSlot(placementToSlot(p)));
    },
    [dispatch],
  );

  const commitAt = useCallback(
    (lng: number, lat: number) => {
      const p = placementRef.current;
      if (!p || !isDraggingRef.current) return;
      isDraggingRef.current = false;
      placementRef.current = null;
      setDragActive(false);
      mapRef.current = null;
      pendingPosRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      commitPlacement({ ...p, centerLng: lng, centerLat: lat });
      setPlacement(null);
    },
    [commitPlacement],
  );

  const addDragSlot = useMemo(
    () => (placement ? placementToSlot(placement) : null),
    [placement],
  );

  const toggleAddMode = useCallback(() => {
    if (!canActivateAdd) return;
    if (isAddMode) {
      setPlacement(null);
      isDraggingRef.current = false;
      setDragActive(false);
      dispatch(setEditMode('none'));
    } else {
      dispatch(setEditMode('add'));
    }
  }, [dispatch, isAddMode, canActivateAdd]);

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!isAddMode || isDraggingRef.current) return;
      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      if (slotId) return;

      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      const { lng, lat } = e.lngLat;
      const { widthM, heightM, angle } = computePlacementDefaultsFromNeighbors(
        placementHintSlots,
        lng,
        lat,
      );

      const next: Placement = {
        draftKey: uuid(),
        centerLng: lng,
        centerLat: lat,
        widthM,
        heightM,
        angle,
      };
      placementRef.current = next;
      setPlacement(next);

      const map = resolveMapboxMap(e);
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

      scheduleDragPosition(lng, lat);
    },
    [isAddMode, placementHintSlots, scheduleDragPosition],
  );

  const handleMouseUp = useCallback(() => {
    if (!isAddMode || !isDraggingRef.current) return;
    releasePointerCapture();
    const p = placementRef.current;
    if (p) commitAt(p.centerLng, p.centerLat);
  }, [isAddMode, releasePointerCapture, commitAt]);

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isAddMode || !isDraggingRef.current) return;
      scheduleDragPosition(e.lngLat.lng, e.lngLat.lat);
    },
    [isAddMode, scheduleDragPosition],
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
      releasePointerCapture();
      const map = mapRef.current;
      if (map) {
        const lngLat = clientToLngLat(map, ev.clientX, ev.clientY);
        commitAt(lngLat.lng, lngLat.lat);
      } else {
        const p = placementRef.current;
        if (p) commitAt(p.centerLng, p.centerLat);
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

  const cancelSlot = useCallback(() => {
    isDraggingRef.current = false;
    setDragActive(false);
    mapRef.current = null;
    releasePointerCapture();
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (placement) {
      setPlacement(null);
      placementRef.current = null;
    } else {
      dispatch(setEditMode('none'));
    }
  }, [dispatch, placement, releasePointerCapture]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isAddMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelSlot();
      }
    },
    [isAddMode, cancelSlot],
  );

  return {
    isAddMode,
    addDragSlot,
    isAddDragLocked: dragActive,
    handleMouseDown,
    handleMouseUp,
    handleMouseMove,
    handleKeyDown,
    toggleAddMode,
    cancelSlot,
  } as const;
}

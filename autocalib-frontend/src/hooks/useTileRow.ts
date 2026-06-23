import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import type { Slot } from '../types';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  setEditMode,
  tileRowSetProposed,
  tileRowAccept,
  tileRowReject,
  tileRowReset,
} from '../store/autocalib-slice';
import {
  computePlacementDefaultsFromNeighbors,
  makeAnchorPreviewSlot,
  mergeSlotsForPlacementHints,
  proposeRowExtension,
  rowGeometryFromSlot,
  type RowGeometry,
} from '../utils/slot-geometry';
import { slotKey } from '../utils/slot-key';
import { createLogger } from '../utils/logger';

const log = createLogger('row-brush');

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

type BrushStep = 'idle' | 'pickSeed' | 'orient' | 'aiming' | 'brushing' | 'review';

/**
 * Row extend: (1) click an existing slot or empty gap, (2) aim toward the missing
 * segment (live preview), (3) click or drag to confirm. Pitch comes from the
 * detected row when a slot is picked.
 */
export function useTileRow() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const slots = useAppSelector((s) => s.autocalib.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.autocalib.absmap.baselineSlots);
  const b2bSnapshotAtLoad = useAppSelector((s) => s.autocalib.absmap.b2bSnapshotAtLoad);
  const proposed = useAppSelector((s) => s.autocalib.absmap.tileRowProposed);

  const placementHintSlots = useMemo(
    () => mergeSlotsForPlacementHints(slots, baselineSlots, b2bSnapshotAtLoad),
    [slots, baselineSlots, b2bSnapshotAtLoad],
  );

  const canActivate = useAppSelector((s) => {
    const st = s.autocalib.absmap.job?.status;
    return st !== 'running' && st !== 'pending';
  });

  const isTileRowMode = editMode === 'tile_row';

  const [anchorGeom, setAnchorGeom] = useState<RowGeometry | null>(null);
  const [anchorPreviewSlot, setAnchorPreviewSlot] = useState<Slot | null>(null);
  const [orientationLocked, setOrientationLocked] = useState(false);
  const [targetSet, setTargetSet] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const orientationLockedRef = useRef(false);
  const isDraggingRef = useRef(false);
  const seedSlotRef = useRef<Slot | null>(null);
  const anchorPointRef = useRef<[number, number] | null>(null);
  const anchorGeomRef = useRef<RowGeometry | null>(null);
  const slotCountOverrideRef = useRef<number | null>(null);
  const targetRef = useRef<[number, number] | null>(null);
  const mapRef = useRef<MapboxLike | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);
  // A click-to-confirm gesture fires `mousedown`→`mouseup`→`click`. `finishBrush`
  // runs on mouseup and clears `isDraggingRef` before the trailing `click` arrives,
  // so that click would otherwise reach `handleMapClick` in the `review` step and
  // wipe the just-confirmed proposal. Swallow exactly that one trailing click.
  const suppressNextClickRef = useRef(false);

  const resetLocal = useCallback(() => {
    isDraggingRef.current = false;
    seedSlotRef.current = null;
    anchorPointRef.current = null;
    anchorGeomRef.current = null;
    slotCountOverrideRef.current = null;
    targetRef.current = null;
    mapRef.current = null;
    capturePointerIdRef.current = null;
    suppressNextClickRef.current = false;
    setAnchorGeom(null);
    setAnchorPreviewSlot(null);
    setOrientationLocked(false);
    orientationLockedRef.current = false;
    setTargetSet(false);
    setIsDragging(false);
  }, []);

  const step: BrushStep = !isTileRowMode
    ? 'idle'
    : !anchorGeom
      ? 'pickSeed'
      : !orientationLocked
        ? 'orient'
        : isDragging
          ? 'brushing'
          : targetSet
            ? 'review'
            : 'aiming';

  const syncAnchorOrientation = useCallback((cursorLng: number, cursorLat: number) => {
    const point = anchorPointRef.current;
    const g = anchorGeomRef.current;
    if (!point || !g) return;
    const angle = Math.atan2(cursorLat - point[1], cursorLng - point[0]);
    const updated: RowGeometry = { ...g, obbAngle: angle };
    anchorGeomRef.current = updated;
    setAnchorGeom(updated);
    setAnchorPreviewSlot(makeAnchorPreviewSlot(point[0], point[1], updated));
  }, []);

  const lockOrientation = useCallback(() => {
    orientationLockedRef.current = true;
    setOrientationLocked(true);
    dispatch(tileRowSetProposed([]));
    log.info('Row extend — orientation locked, aim toward the gap');
  }, [dispatch]);

  const regenerateProposed = useCallback(
    (bLng: number, bLat: number, count?: number | null) => {
      const a = anchorPointRef.current;
      const g = anchorGeomRef.current;
      if (!a || !g) return [];
      const next = proposeRowExtension(
        seedSlotRef.current,
        placementHintSlots,
        a[0],
        a[1],
        bLng,
        bLat,
        g,
        count ?? undefined,
      );
      dispatch(tileRowSetProposed(next));
      return next;
    },
    [dispatch, placementHintSlots],
  );

  const setSeed = useCallback(
    (slot: Slot | null, point: [number, number], geom: RowGeometry) => {
      seedSlotRef.current = slot;
      anchorPointRef.current = point;
      anchorGeomRef.current = geom;
      targetRef.current = null;
      slotCountOverrideRef.current = null;
      setAnchorGeom(geom);
      setAnchorPreviewSlot(makeAnchorPreviewSlot(point[0], point[1], geom));
      setOrientationLocked(false);
      orientationLockedRef.current = false;
      setTargetSet(false);
      dispatch(tileRowSetProposed([]));
      log.info(
        slot
          ? `Row extend — seed slot ${slot.slot_id}, aim toward the gap`
          : 'Row extend — empty anchor, aim along the row',
      );
    },
    [dispatch],
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

  const returnToAiming = useCallback(() => {
    targetRef.current = null;
    slotCountOverrideRef.current = null;
    setTargetSet(false);
    dispatch(tileRowSetProposed([]));
  }, [dispatch]);

  const confirmTarget = useCallback(
    (lng: number, lat: number) => {
      targetRef.current = [lng, lat];
      setTargetSet(true);
      const next = regenerateProposed(lng, lat, slotCountOverrideRef.current);
      log.info(`Row extend — ${next.length} new slot(s)`);
    },
    [regenerateProposed],
  );

  const finishBrush = useCallback(
    (lng: number, lat: number) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      releasePointerCapture();
      mapRef.current = null;
      confirmTarget(lng, lat);
      // Swallow the trailing `click` that a click-like gesture emits right after
      // this mouseup. A real drag emits no trailing click, so the next macrotask
      // clears the flag and the user's next deliberate click still registers.
      suppressNextClickRef.current = true;
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
    },
    [confirmTarget, releasePointerCapture],
  );

  const toggleMode = useCallback(() => {
    if (!canActivate) {
      log.info('Row brush toggle ignored — pipeline busy');
      return;
    }
    if (isTileRowMode) {
      resetLocal();
      dispatch(tileRowReset());
      dispatch(setEditMode('none'));
      log.info('Row brush off');
    } else {
      dispatch(tileRowReset());
      resetLocal();
      dispatch(setEditMode('tile_row'));
      log.info('Row brush on — click a slot at the row edge, then aim toward the gap');
    }
  }, [canActivate, isTileRowMode, dispatch, resetLocal]);

  const cancelMode = useCallback(() => {
    resetLocal();
    dispatch(tileRowReset());
    dispatch(setEditMode('none'));
  }, [dispatch, resetLocal]);

  const acceptProposed = useCallback(() => {
    dispatch(tileRowAccept());
    resetLocal();
    log.info('Row extend accepted — click another slot to continue');
  }, [dispatch, resetLocal]);

  const rejectProposed = useCallback(() => {
    dispatch(tileRowReject());
    resetLocal();
  }, [dispatch, resetLocal]);

  const pickSeedFromClick = useCallback(
    (e: MapMouseEvent) => {
      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      const picked = slotId
        ? placementHintSlots.find((s) => slotKey(s) === slotId)
        : undefined;

      if (picked) {
        setSeed(picked, [picked.center.lng, picked.center.lat], rowGeometryFromSlot(picked));
        return;
      }

      const { lng, lat } = e.lngLat;
      const defaults = computePlacementDefaultsFromNeighbors(placementHintSlots, lng, lat);
      setSeed(null, [lng, lat], {
        widthM: defaults.widthM,
        heightM: defaults.heightM,
        obbAngle: defaults.angle,
      });
    },
    [placementHintSlots, setSeed],
  );

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isTileRowMode || isDraggingRef.current) return;
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      if (step === 'review') {
        const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
        const picked = slotId
          ? placementHintSlots.find((s) => slotKey(s) === slotId)
          : undefined;
        if (picked) {
          setSeed(picked, [picked.center.lng, picked.center.lat], rowGeometryFromSlot(picked));
          return;
        }
        returnToAiming();
        return;
      }

      if (!anchorGeom) {
        pickSeedFromClick(e);
        return;
      }

      if (step === 'orient') {
        lockOrientation();
        return;
      }

      if (step === 'aiming') {
        confirmTarget(e.lngLat.lng, e.lngLat.lat);
      }
    },
    [
      isTileRowMode,
      step,
      anchorGeom,
      placementHintSlots,
      pickSeedFromClick,
      setSeed,
      returnToAiming,
      confirmTarget,
      lockOrientation,
    ],
  );

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!isTileRowMode || !anchorPointRef.current) return;
      if (step === 'pickSeed' || step === 'orient') return;

      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      if (step === 'review') {
        returnToAiming();
      }

      if (!anchorGeomRef.current) return;

      const map = resolveMapboxMap(e);
      mapRef.current = map;
      isDraggingRef.current = true;
      setIsDragging(true);
      setTargetSet(false);
      slotCountOverrideRef.current = null;

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

      regenerateProposed(e.lngLat.lng, e.lngLat.lat, null);
    },
    [isTileRowMode, step, regenerateProposed, returnToAiming],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isTileRowMode || !anchorGeomRef.current) return;

      if (step === 'orient') {
        syncAnchorOrientation(e.lngLat.lng, e.lngLat.lat);
        return;
      }

      if (isDraggingRef.current) {
        regenerateProposed(e.lngLat.lng, e.lngLat.lat, slotCountOverrideRef.current);
        return;
      }

      if (step === 'aiming') {
        regenerateProposed(e.lngLat.lng, e.lngLat.lat, null);
      }
    },
    [isTileRowMode, step, regenerateProposed, syncAnchorOrientation],
  );

  const handleMouseUp = useCallback(
    (e: MapMouseEvent) => {
      if (!isTileRowMode || !isDraggingRef.current) return;
      finishBrush(e.lngLat.lng, e.lngLat.lat);
    },
    [isTileRowMode, finishBrush],
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const map = mapRef.current;
      if (!map) return;
      const lngLat = clientToLngLat(map, ev.clientX, ev.clientY);
      regenerateProposed(lngLat.lng, lngLat.lat, slotCountOverrideRef.current);
    };

    const onUp = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const map = mapRef.current;
      if (map) {
        const lngLat = clientToLngLat(map, ev.clientX, ev.clientY);
        finishBrush(lngLat.lng, lngLat.lat);
        return;
      }
      const end = targetRef.current;
      if (end) finishBrush(end[0], end[1]);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isDragging, regenerateProposed, finishBrush]);

  const adjustSlotCount = useCallback(
    (delta: number) => {
      const end = targetRef.current;
      if (!end) return;
      const current = slotCountOverrideRef.current ?? proposed.length;
      const nextCount = Math.max(1, Math.min(current + delta, 200));
      slotCountOverrideRef.current = nextCount;
      regenerateProposed(end[0], end[1], nextCount);
    },
    [proposed.length, regenerateProposed],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isTileRowMode) return;

      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        if (step === 'review' && proposed.length > 0 && !isDraggingRef.current) {
          e.preventDefault();
          acceptProposed();
        }
        return;
      }

      if (
        e.key === '+' ||
        e.key === '=' ||
        e.key === 'ArrowUp' ||
        e.key === '-' ||
        e.key === 'ArrowDown'
      ) {
        if (step === 'review' && !isDraggingRef.current) {
          e.preventDefault();
          adjustSlotCount(e.key === '-' || e.key === 'ArrowDown' ? -1 : 1);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isDraggingRef.current) {
          isDraggingRef.current = false;
          setIsDragging(false);
          releasePointerCapture();
          mapRef.current = null;
          setTargetSet(false);
          dispatch(tileRowSetProposed([]));
        } else if (step === 'review') {
          returnToAiming();
        } else if (anchorGeom) {
          resetLocal();
          dispatch(tileRowSetProposed([]));
        } else {
          cancelMode();
        }
      }
    },
    [
      isTileRowMode,
      step,
      proposed.length,
      acceptProposed,
      adjustSlotCount,
      rejectProposed,
      cancelMode,
      anchorGeom,
      dispatch,
      releasePointerCapture,
      resetLocal,
      returnToAiming,
    ],
  );

  const brushPreviewSlots = useMemo(() => {
    if (!isTileRowMode) return [];
    return proposed;
  }, [isTileRowMode, proposed]);

  return {
    isTileRowMode,
    tileRowStep: step,
    proposedSlots: proposed,
    pendingAnchorSlot: anchorPreviewSlot,
    hasPendingAnchor: anchorPreviewSlot != null,
    handleMapClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleKeyDown,
    toggleMode,
    cancelMode,
    acceptProposed,
    rejectProposed,
    brushPreviewSlots,
    isBrushDragging: isDragging,
    cursor: isTileRowMode
      ? isDragging
        ? 'grabbing'
        : step === 'pickSeed'
          ? 'pointer'
          : 'crosshair'
      : '',
  } as const;
}

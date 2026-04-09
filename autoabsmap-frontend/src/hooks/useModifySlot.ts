import { useCallback, useMemo, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, modifySlot } from '../store/autoabsmap-slice';
import type { Slot } from '../types';
import {
  extractObbMetrics,
  buildObbPolygon,
} from '../utils/slot-geometry';

type Phase = 'position' | 'rotation';

interface ModifyState {
  phase: Phase;
  /** True when entered via mousedown-on-marker (drag flow); false when seeded by Copy. */
  viaDrag: boolean;
  originalSlot: Slot;
  currentLng: number;
  currentLat: number;
  width: number;
  height: number;
  angle: number;
}

/**
 * Hook for the "Modify slot" editing mode.
 *
 * Drag-to-move flow (entry via mousedown on a marker):
 *   1. Mousedown on a marker → "picked up" (position phase, center follows cursor)
 *   2. Mouseup → lock position, enter rotation phase (angle follows cursor)
 *   3. Click → dispatches modifySlot, returns to idle
 *
 * Click-to-place flow (entry via Copy mode auto-switch):
 *   1. selectSlotById() seeds a slot in position phase (viaDrag=false)
 *   2. Click → lock position, enter rotation phase
 *   3. Click → confirm
 */
export function useModifySlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.absmap.editMode);
  const slots = useAppSelector((s) => s.absmap.slots);
  const hasResults = useAppSelector(
    (s) => s.absmap.slots.length > 0 || s.absmap.baselineSlots.length > 0,
  );
  const isModifyMode = editMode === 'modify';

  const [state, setState] = useState<ModifyState | null>(null);

  const modifyingSlot: Slot | null = useMemo(() => {
    if (!state) return null;
    return {
      ...state.originalSlot,
      center: { lng: state.currentLng, lat: state.currentLat },
      polygon: buildObbPolygon(
        state.currentLng,
        state.currentLat,
        state.width,
        state.height,
        state.angle,
      ),
    };
  }, [state]);

  const toggleModifyMode = useCallback(() => {
    if (!hasResults) return;
    if (isModifyMode) {
      setState(null);
      dispatch(setEditMode('none'));
    } else {
      dispatch(setEditMode('modify'));
    }
  }, [dispatch, isModifyMode, hasResults]);

  /** Allow external callers (Copy mode) to pre-select a slot. */
  const selectSlotById = useCallback(
    (slotId: string) => {
      const slot = slots.find((s) => s.slot_id === slotId);
      if (!slot) return;
      const metrics = extractObbMetrics(slot.polygon);
      setState({
        phase: 'position',
        viaDrag: false,
        originalSlot: slot,
        currentLng: slot.center.lng,
        currentLat: slot.center.lat,
        width: metrics.width,
        height: metrics.height,
        angle: metrics.angle,
      });
    },
    [slots],
  );

  const pickUpSlot = useCallback(
    (slotId: string, viaDrag: boolean) => {
      const slot = slots.find((s) => s.slot_id === slotId);
      if (!slot) return false;
      const metrics = extractObbMetrics(slot.polygon);
      setState({
        phase: 'position',
        viaDrag,
        originalSlot: slot,
        currentLng: slot.center.lng,
        currentLat: slot.center.lat,
        width: metrics.width,
        height: metrics.height,
        angle: metrics.angle,
      });
      return true;
    },
    [slots],
  );

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!isModifyMode || state) return;
      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      if (!slotId) return;
      pickUpSlot(slotId, true);
    },
    [isModifyMode, state, pickUpSlot],
  );

  const handleMouseUp = useCallback(
    () => {
      if (!isModifyMode || !state || !state.viaDrag || state.phase !== 'position') return;
      setState((prev) => (prev ? { ...prev, phase: 'rotation' } : null));
    },
    [isModifyMode, state],
  );

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isModifyMode || !state) return;
      const { lng, lat } = e.lngLat;

      // Drag flow: position phase ends on mouseup, not click. Skip clicks here.
      if (state.phase === 'position' && state.viaDrag) return;

      if (state.phase === 'position') {
        // Click-to-place flow (Copy → Modify auto-switch)
        setState((prev) =>
          prev ? { ...prev, phase: 'rotation', currentLng: lng, currentLat: lat } : null,
        );
        return;
      }

      if (state.phase === 'rotation') {
        if (!modifyingSlot) return;
        dispatch(modifySlot(modifyingSlot));
        setState(null);
      }
    },
    [isModifyMode, state, modifyingSlot, dispatch],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isModifyMode || !state) return;
      const { lng, lat } = e.lngLat;

      if (state.phase === 'position') {
        setState((prev) => (prev ? { ...prev, currentLng: lng, currentLat: lat } : null));
      } else if (state.phase === 'rotation') {
        const angle = Math.atan2(lat - state.currentLat, lng - state.currentLng);
        setState((prev) => (prev ? { ...prev, angle } : null));
      }
    },
    [isModifyMode, state],
  );

  const cancelModify = useCallback(() => {
    if (state) {
      setState(null);
    } else {
      dispatch(setEditMode('none'));
    }
  }, [dispatch, state]);

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
    modifyingSlot,
    modifyPhase: state?.phase ?? null,
    /** True while a slot is actively being dragged or rotated (map pan must be off). */
    isModifyDragLocked: state !== null,
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

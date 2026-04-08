import { useCallback, useMemo, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, modifySlot } from '../store/autoabsmap-slice';
import type { Slot } from '../types';
import {
  approxDistanceM,
  extractObbMetrics,
  buildObbPolygon,
} from '../utils/slot-geometry';

const HIT_RADIUS_M = 4;

type Phase = 'select' | 'position' | 'rotation';

interface ModifyState {
  phase: Phase;
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
 * Two-phase interaction:
 *   1. Click a slot → "picked up" (position phase, center follows cursor)
 *   2. Click to lock position → rotation phase (angle follows cursor)
 *   3. Click to confirm → dispatches modifySlot, returns to select phase
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

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isModifyMode) return;
      const { lng, lat } = e.lngLat;

      if (!state) {
        let closest: { slot: Slot; dist: number } | null = null;
        for (const slot of slots) {
          const d = approxDistanceM(lng, lat, slot.center.lng, slot.center.lat);
          if (d < HIT_RADIUS_M && (!closest || d < closest.dist)) {
            closest = { slot, dist: d };
          }
        }
        if (!closest) return;

        const metrics = extractObbMetrics(closest.slot.polygon);
        setState({
          phase: 'position',
          originalSlot: closest.slot,
          currentLng: closest.slot.center.lng,
          currentLat: closest.slot.center.lat,
          width: metrics.width,
          height: metrics.height,
          angle: metrics.angle,
        });
        return;
      }

      if (state.phase === 'position') {
        setState((prev) => (prev ? { ...prev, phase: 'rotation', currentLng: lng, currentLat: lat } : null));
        return;
      }

      if (state.phase === 'rotation') {
        if (!modifyingSlot) return;
        dispatch(modifySlot(modifyingSlot));
        setState(null);
      }
    },
    [isModifyMode, state, slots, modifyingSlot, dispatch],
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
    handleMapClick,
    handleMouseMove,
    handleKeyDown,
    toggleModifyMode,
    selectSlotById,
    cancelModify,
  } as const;
}

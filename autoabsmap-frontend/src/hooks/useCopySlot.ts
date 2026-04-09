import { useCallback } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, addSlot } from '../store/autoabsmap-slice';
import {
  extractObbMetrics,
  buildObbPolygon,
} from '../utils/slot-geometry';

/**
 * Hook for the "Copy slot" editing mode.
 *
 * Press C → click a slot → duplicate is created offset by 1× width along
 * the slot's long-axis. Then auto-switch to Modify mode with the new copy
 * pre-selected, so the user can reposition/rotate it.
 */
export function useCopySlot(onEnterModify?: (slotId: string) => void) {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.absmap.editMode);
  const slots = useAppSelector((s) => s.absmap.slots);
  const hasResults = useAppSelector(
    (s) => s.absmap.slots.length > 0 || s.absmap.baselineSlots.length > 0,
  );
  const isCopyMode = editMode === 'copy';

  const toggleCopyMode = useCallback(() => {
    if (!hasResults) return;
    if (isCopyMode) {
      dispatch(setEditMode('none'));
    } else {
      dispatch(setEditMode('copy'));
    }
  }, [dispatch, isCopyMode, hasResults]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isCopyMode) return;

      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      if (!slotId) return;
      const src = slots.find((s) => s.slot_id === slotId);
      if (!src) return;

      const metrics = extractObbMetrics(src.polygon);

      const R = 6_371_000;
      const latRad = src.center.lat * Math.PI / 180;
      const mPerDegLat = (Math.PI / 180) * R;
      const mPerDegLng = (Math.PI / 180) * R * Math.cos(latRad);

      const offsetM = metrics.width * 1.1;
      const perpAngle = metrics.angle + Math.PI / 2;
      const dLng = (offsetM * Math.cos(perpAngle)) / mPerDegLng;
      const dLat = (offsetM * Math.sin(perpAngle)) / mPerDegLat;

      const newId = crypto.randomUUID();
      const newSlot = {
        slot_id: newId,
        center: { lng: src.center.lng + dLng, lat: src.center.lat + dLat },
        polygon: buildObbPolygon(
          src.center.lng + dLng,
          src.center.lat + dLat,
          metrics.width,
          metrics.height,
          metrics.angle,
        ),
        source: 'manual' as const,
        confidence: 1.0,
        status: 'unknown' as const,
      };

      dispatch(addSlot(newSlot));

      if (onEnterModify) {
        dispatch(setEditMode('modify'));
        onEnterModify(newId);
      }
    },
    [isCopyMode, slots, dispatch, onEnterModify],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isCopyMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(setEditMode('none'));
      }
    },
    [isCopyMode, dispatch],
  );

  return {
    isCopyMode,
    handleMapClick,
    handleKeyDown,
    toggleCopyMode,
  } as const;
}

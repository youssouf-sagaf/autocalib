import { useCallback, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, deleteSlot } from '../store/autoabsmap-slice';
import { approxDistanceM } from '../utils/slot-geometry';

const HIT_RADIUS_M = 4;

export function useDeleteSlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.absmap.editMode);
  const slots = useAppSelector((s) => s.absmap.slots);
  const hasResults = useAppSelector(
    (s) => s.absmap.slots.length > 0 || s.absmap.baselineSlots.length > 0,
  );
  const isDeleteMode = editMode === 'delete';

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const toggleDeleteMode = useCallback(() => {
    if (!hasResults) return;
    if (isDeleteMode) {
      setSelectedSlotId(null);
      dispatch(setEditMode('none'));
    } else {
      dispatch(setEditMode('delete'));
    }
  }, [dispatch, isDeleteMode, hasResults]);

  const confirmDelete = useCallback(() => {
    if (!selectedSlotId) return;
    dispatch(deleteSlot(selectedSlotId));
    setSelectedSlotId(null);
  }, [dispatch, selectedSlotId]);

  const cancelDelete = useCallback(() => {
    if (selectedSlotId) {
      setSelectedSlotId(null);
    } else {
      dispatch(setEditMode('none'));
    }
  }, [dispatch, selectedSlotId]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isDeleteMode) return;

      if (selectedSlotId) {
        confirmDelete();
        return;
      }

      const { lng, lat } = e.lngLat;
      let closest: { id: string; dist: number } | null = null;
      for (const slot of slots) {
        const d = approxDistanceM(lng, lat, slot.center.lng, slot.center.lat);
        if (d < HIT_RADIUS_M && (!closest || d < closest.dist)) {
          closest = { id: slot.slot_id, dist: d };
        }
      }

      if (closest) {
        setSelectedSlotId(closest.id);
      }
    },
    [isDeleteMode, selectedSlotId, confirmDelete, slots],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isDeleteMode) return;
      if (e.key === 'Enter' && selectedSlotId) {
        e.preventDefault();
        confirmDelete();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelDelete();
      }
    },
    [isDeleteMode, selectedSlotId, confirmDelete, cancelDelete],
  );

  return {
    isDeleteMode,
    selectedSlotId,
    handleMapClick,
    handleKeyDown,
    toggleDeleteMode,
    confirmDelete,
    cancelDelete,
  } as const;
}

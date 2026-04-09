import { useCallback, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, deleteSlot } from '../store/autoabsmap-slice';

/**
 * Hook for the "Delete slot" editing mode.
 *
 * Two-click flow:
 *   1. Click a marker → it is selected (the marker grows as visual feedback).
 *   2. Click the same marker (or any marker) → deletes the selected slot.
 * Enter also confirms; Esc / click off-marker dismisses the selection.
 */
export function useDeleteSlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.absmap.editMode);
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

      // 2nd click — anywhere — commits the pending deletion.
      if (selectedSlotId) {
        confirmDelete();
        return;
      }

      // 1st click — must be on a marker to select.
      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      if (slotId) {
        setSelectedSlotId(slotId);
      }
    },
    [isDeleteMode, selectedSlotId, confirmDelete],
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

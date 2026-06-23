import { useCallback } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, deleteMapSlot } from '../store/autocalib-slice';
import { selectHasAbsmapEditableSlots } from '../store/autocalib-selectors';

interface MapboxLike {
  dragPan?: { disable: () => void; enable: () => void };
}

function resolveMapboxMap(e: MapMouseEvent): MapboxLike | null {
  const target = e.target as unknown;
  if (!target || typeof target !== 'object') return null;
  if ('dragPan' in target) return target as MapboxLike;
  if ('getMap' in target && typeof (target as { getMap: () => unknown }).getMap === 'function') {
    const map = (target as { getMap: () => unknown }).getMap();
    if (map && typeof map === 'object') return map as MapboxLike;
  }
  return null;
}

/**
 * Eraser tool (E): click a parking marker to remove it immediately.
 * Stays active for rapid one-by-one cleanup (ex delete mode).
 */
export function useEraserSlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const hasResults = useAppSelector(selectHasAbsmapEditableSlots);
  const isEraserMode = editMode === 'eraser';

  const toggleEraserMode = useCallback(() => {
    if (!hasResults) return;
    if (isEraserMode) {
      dispatch(setEditMode('none'));
    } else {
      dispatch(setEditMode('eraser'));
    }
  }, [dispatch, isEraserMode, hasResults]);

  const cancelEraser = useCallback(() => {
    dispatch(setEditMode('none'));
  }, [dispatch]);

  const deleteSlotAt = useCallback(
    (e: MapMouseEvent) => {
      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      if (!slotId) return false;

      const ev = e.originalEvent;
      if ('button' in ev && ev.button !== 0) return false;

      resolveMapboxMap(e)?.dragPan?.disable();
      ev.preventDefault();
      ev.stopPropagation();
      dispatch(deleteMapSlot(slotId));
      return true;
    },
    [dispatch],
  );

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!isEraserMode) return;
      deleteSlotAt(e);
    },
    [isEraserMode, deleteSlotAt],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isEraserMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEraser();
      }
    },
    [isEraserMode, cancelEraser],
  );

  return {
    isEraserMode,
    handleMouseDown,
    handleKeyDown,
    toggleEraserMode,
    cancelEraser,
  } as const;
}

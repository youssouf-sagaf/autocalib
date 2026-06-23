import { useCallback } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  setEditMode,
  straightenRow,
  rejectStraighten,
  straightenSetAnchor,
} from '../store/autocalib-slice';

type UseStraightenSlotOptions = {
  /** Called after a successful align so map browse selection can clear. */
  onStraightenApplied?: () => void;
};

/**
 * Straighten mode: first click = anchor A, second click = anchor B → API applies alignment immediately (undo with ⌘Z).
 */
export function useStraightenSlot(options?: UseStraightenSlotOptions) {
  const onStraightenApplied = options?.onStraightenApplied;
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const anchorId = useAppSelector((s) => s.autocalib.absmap.straightenAnchorSlotId);
  const hasSlots = useAppSelector(
    (s) =>
      s.autocalib.absmap.slots.length > 0
      || s.autocalib.absmap.baselineSlots.length > 0
      || s.autocalib.absmap.b2bSnapshotAtLoad.length > 0,
  );
  const isStraightenMode = editMode === 'straighten';
  const loading = useAppSelector((s) => s.autocalib.absmap.straightenLoading);
  const error = useAppSelector((s) => s.autocalib.absmap.straightenError);

  const toggleStraightenMode = useCallback(() => {
    if (!hasSlots) return;
    if (isStraightenMode) {
      dispatch(rejectStraighten());
      dispatch(setEditMode('none'));
    } else {
      dispatch(straightenSetAnchor(null));
      dispatch(setEditMode('straighten'));
    }
  }, [dispatch, isStraightenMode, hasSlots]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isStraightenMode || loading) return;

      const slotId = e.features?.[0]?.properties?.slot_id as string | undefined;
      if (!slotId) return;

      if (anchorId === null) {
        dispatch(straightenSetAnchor(slotId));
        return;
      }

      if (slotId === anchorId) {
        dispatch(straightenSetAnchor(null));
        return;
      }

      void dispatch(
        straightenRow({ slot_id_a: anchorId, slot_id_b: slotId }),
      )
        .unwrap()
        .then((payload) => {
          if (payload.proposed.length > 0) {
            onStraightenApplied?.();
          }
        })
        .catch(() => {
          /* Error surfaced via straightenError in the store. */
        });
    },
    [dispatch, isStraightenMode, loading, anchorId, onStraightenApplied],
  );

  const cancelStraighten = useCallback(() => {
    dispatch(straightenSetAnchor(null));
    dispatch(setEditMode('none'));
  }, [dispatch]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isStraightenMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(rejectStraighten());
        dispatch(setEditMode('none'));
      }
    },
    [isStraightenMode, dispatch],
  );

  return {
    isStraightenMode,
    straightenAnchorSlotId: anchorId,
    loading,
    error,
    handleMapClick,
    handleKeyDown,
    toggleStraightenMode,
    cancelStraighten,
  } as const;
}

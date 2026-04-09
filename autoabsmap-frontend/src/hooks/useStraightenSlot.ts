import { useCallback } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  setEditMode,
  straightenRow,
  acceptStraighten,
  rejectStraighten,
  straightenSetAnchor,
} from '../store/autoabsmap-slice';

/**
 * Straighten mode: pick two slots on the same row (any positions along the row).
 * First click sets the first anchor; second click runs alignment for that segment.
 */
export function useStraightenSlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.absmap.editMode);
  const anchorId = useAppSelector((s) => s.absmap.straightenAnchorSlotId);
  const hasResults = useAppSelector(
    (s) => s.absmap.slots.length > 0 || s.absmap.baselineSlots.length > 0,
  );
  const isStraightenMode = editMode === 'straighten';
  const proposal = useAppSelector((s) => s.absmap.straightenProposal);
  const loading = useAppSelector((s) => s.absmap.straightenLoading);
  const error = useAppSelector((s) => s.absmap.straightenError);
  const hasProposal = proposal !== null && proposal.length > 0;

  const toggleStraightenMode = useCallback(() => {
    if (!hasResults) return;
    if (isStraightenMode) {
      dispatch(rejectStraighten());
      dispatch(setEditMode('none'));
    } else {
      dispatch(straightenSetAnchor(null));
      dispatch(setEditMode('straighten'));
    }
  }, [dispatch, isStraightenMode, hasResults]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isStraightenMode || loading) return;
      if (hasProposal) return;

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
      );
    },
    [dispatch, isStraightenMode, loading, hasProposal, anchorId],
  );

  const confirmStraighten = useCallback(() => {
    if (!hasProposal) return;
    dispatch(acceptStraighten());
  }, [dispatch, hasProposal]);

  const cancelStraighten = useCallback(() => {
    if (hasProposal) {
      dispatch(rejectStraighten());
    } else {
      dispatch(straightenSetAnchor(null));
      dispatch(setEditMode('none'));
    }
  }, [dispatch, hasProposal]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isStraightenMode) return;
      if (e.key === 'Enter' && hasProposal) {
        e.preventDefault();
        confirmStraighten();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelStraighten();
      }
    },
    [isStraightenMode, hasProposal, confirmStraighten, cancelStraighten],
  );

  return {
    isStraightenMode,
    hasProposal,
    straightenAnchorSlotId: anchorId,
    loading,
    error,
    proposal,
    handleMapClick,
    handleKeyDown,
    toggleStraightenMode,
    confirmStraighten,
    cancelStraighten,
  } as const;
}

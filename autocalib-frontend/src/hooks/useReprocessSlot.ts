import { useCallback, useMemo, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { uuid } from '../utils/uuid';
import {
  setEditMode,
  reprocessArea,
  reprocessSetRef,
  reprocessSetScope,
  reprocessAccept,
  reprocessReject,
  reprocessReset,
} from '../store/autocalib-slice';
import { usePolygonDraw } from './usePolygonDraw';
import { createLogger } from '../utils/logger';
import type { Placement } from '../utils/slot-geometry';
import {
  computePlacementDefaultsFromNeighbors,
  mergeSlotsForPlacementHints,
  placementToSlot,
} from '../utils/slot-geometry';

const log = createLogger('reprocess');

/**
 * Reprocess mode — simple and efficient:
 *
 *   1. drawingScope  — trace the zone (polygon, typically a quadrilateral)
 *   2. placingRefSlot — click inside the zone to place a reference slot
 *                       (move mouse to rotate, click again to confirm → API fires)
 *   3. waitingForReview — accept / reject ghost proposals
 *
 * Escape backs up one step; R toggles on/off.
 */
export function useReprocessSlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const scopePolygon = useAppSelector((s) => s.autocalib.absmap.reprocessScopePolygon);
  const proposedSlots = useAppSelector((s) => s.autocalib.absmap.reprocessProposedSlots);
  const loading = useAppSelector((s) => s.autocalib.absmap.reprocessLoading);
  const error = useAppSelector((s) => s.autocalib.absmap.reprocessError);
  const slots = useAppSelector((s) => s.autocalib.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.autocalib.absmap.baselineSlots);
  const placementHintSlots = useMemo(
    () => mergeSlotsForPlacementHints(slots, baselineSlots),
    [slots, baselineSlots],
  );
  const job = useAppSelector((s) => s.autocalib.absmap.job);
  const slotCount = useAppSelector((s) => s.autocalib.absmap.slots.length);
  const baselineCount = useAppSelector((s) => s.autocalib.absmap.baselineSlots.length);
  const canReprocess = Boolean(
    job?.status === 'done' && job.id.length > 0 && (slotCount > 0 || baselineCount > 0),
  );
  const isReprocessMode = editMode === 'reprocess';

  // Local placement state for the reference slot (same pattern as useAddSlot)
  const [placement, setPlacement] = useState<Placement | null>(null);

  const pendingRefSlot = useMemo(
    () => (placement ? placementToSlot(placement) : null),
    [placement],
  );

  const step: 'idle' | 'drawingScope' | 'placingRefSlot' | 'waitingForReview' =
    !isReprocessMode
      ? 'idle'
      : proposedSlots.length > 0
        ? 'waitingForReview'
        : scopePolygon !== null
          ? 'placingRefSlot'
          : 'drawingScope';

  // When polygon drawing completes, store the scope
  const onScopeComplete = useCallback(
    (polygon: GeoJSON.Polygon) => {
      dispatch(reprocessSetScope(polygon));
      log.info('Scope polygon drawn — place a reference slot inside the zone');
    },
    [dispatch],
  );

  const polygonDraw = usePolygonDraw({ onComplete: onScopeComplete });

  // Confirm the placed ref slot → fire the API
  const commitRefSlot = useCallback(
    (p: Placement) => {
      if (!scopePolygon) return;
      const refSlot = placementToSlot(p);
      dispatch(reprocessSetRef(refSlot.slot_id));
      void dispatch(reprocessArea({ referenceSlot: refSlot, scopePolygon }));
      setPlacement(null);
    },
    [dispatch, scopePolygon],
  );

  const toggleReprocessMode = useCallback(() => {
    if (!canReprocess) {
      log.info('Reprocess toggle ignored — need job done with slots');
      return;
    }
    if (isReprocessMode) {
      polygonDraw.stopDrawing();
      setPlacement(null);
      dispatch(reprocessReset());
      dispatch(setEditMode('none'));
      log.info('Reprocess mode off');
    } else {
      dispatch(reprocessReset());
      setPlacement(null);
      dispatch(setEditMode('reprocess'));
      polygonDraw.startDrawing();
      log.info('Reprocess mode on — trace the zone, then place a reference slot');
    }
  }, [dispatch, isReprocessMode, canReprocess, polygonDraw]);

  const cancelReprocess = useCallback(() => {
    polygonDraw.stopDrawing();
    setPlacement(null);
    dispatch(reprocessReset());
    dispatch(setEditMode('none'));
  }, [dispatch, polygonDraw]);

  const acceptProposed = useCallback(() => {
    dispatch(reprocessAccept());
    dispatch(setEditMode('none'));
  }, [dispatch]);

  const rejectProposed = useCallback(() => {
    dispatch(reprocessReject());
    dispatch(setEditMode('none'));
  }, [dispatch]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isReprocessMode || loading) return;

      // Drawing scope phase
      if (step === 'drawingScope') {
        polygonDraw.handleClick(e);
        return;
      }

      // Review phase — ignore clicks
      if (step === 'waitingForReview') return;

      // placingRefSlot — first click places, second click confirms (like Add)
      if (placement) {
        commitRefSlot(placement);
        return;
      }

      const { lng, lat } = e.lngLat;
      const { widthM, heightM, angle } = computePlacementDefaultsFromNeighbors(
        placementHintSlots,
        lng,
        lat,
      );
      setPlacement({
        draftKey: uuid(),
        centerLng: lng,
        centerLat: lat,
        widthM,
        heightM,
        angle,
      });
    },
    [isReprocessMode, loading, step, placement, polygonDraw, commitRefSlot, placementHintSlots],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isReprocessMode) return;
      if (step === 'drawingScope') {
        polygonDraw.handleMouseMove(e);
        return;
      }
      // Rotate the pending ref slot (same as Add mode)
      if (step === 'placingRefSlot' && placement) {
        const { lng, lat } = e.lngLat;
        const angle = Math.atan2(lat - placement.centerLat, lng - placement.centerLng);
        setPlacement((prev) => (prev ? { ...prev, angle } : null));
      }
    },
    [isReprocessMode, step, polygonDraw, placement],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isReprocessMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'drawingScope') {
          if (polygonDraw.vertices.length > 0) {
            polygonDraw.handleKeyDown(e);
          } else {
            cancelReprocess();
          }
        } else if (step === 'placingRefSlot') {
          if (placement) {
            // Cancel the pending slot, stay in placingRefSlot
            setPlacement(null);
          } else {
            // Back to drawing — clear scope
            dispatch(reprocessSetScope(null));
            polygonDraw.startDrawing();
          }
        } else if (step === 'waitingForReview') {
          rejectProposed();
        }
      }
      if (e.key === 'Enter' && step === 'placingRefSlot' && placement) {
        e.preventDefault();
        commitRefSlot(placement);
      }
    },
    [isReprocessMode, step, dispatch, polygonDraw, placement, cancelReprocess, rejectProposed, commitRefSlot],
  );

  return {
    isReprocessMode,
    reprocessStep: step,
    reprocessProposedSlots: proposedSlots,
    pendingRefSlot,
    hasPendingRef: placement !== null,
    loading,
    error,
    handleMapClick,
    handleMouseMove,
    handleKeyDown,
    toggleReprocessMode,
    cancelReprocess,
    acceptProposed,
    rejectProposed,
    // While drawing: show live preview. After close: show the stored scope polygon.
    scopePreviewFeature: step === 'drawingScope'
      ? polygonDraw.previewFeature
      : scopePolygon
        ? { type: 'Feature' as const, properties: {}, geometry: scopePolygon }
        : null,
    scopeEdgeFeature: step === 'drawingScope' ? polygonDraw.edgeFeature : null,
    scopeVertexFeatures: step === 'drawingScope' ? polygonDraw.vertexFeatures : undefined,
    cursor: step === 'drawingScope' ? polygonDraw.cursor : step === 'placingRefSlot' ? 'crosshair' : '',
  } as const;
}

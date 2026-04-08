import { useCallback, useMemo, useState } from 'react';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setEditMode, addSlot } from '../store/autoabsmap-slice';
import type { Placement } from '../utils/slot-geometry';
import {
  findKNearest,
  extractObbMetrics,
  placementToSlot,
  DEFAULT_WIDTH_M,
  DEFAULT_HEIGHT_M,
} from '../utils/slot-geometry';

const MAX_NEIGHBORS = 6;

export function useAddSlot() {
  const dispatch = useAppDispatch();
  const editMode = useAppSelector((s) => s.absmap.editMode);
  const slots = useAppSelector((s) => s.absmap.slots);
  const hasResults = useAppSelector(
    (s) => s.absmap.slots.length > 0 || s.absmap.baselineSlots.length > 0,
  );
  const isAddMode = editMode === 'add';

  const [placement, setPlacement] = useState<Placement | null>(null);

  const pendingSlot = useMemo(
    () => (placement ? placementToSlot(placement) : null),
    [placement],
  );

  const toggleAddMode = useCallback(() => {
    if (!hasResults) return;
    if (isAddMode) {
      setPlacement(null);
      dispatch(setEditMode('none'));
    } else {
      dispatch(setEditMode('add'));
    }
  }, [dispatch, isAddMode, hasResults]);

  const computeNeighborDefaults = useCallback(
    (lng: number, lat: number) => {
      const neighbors = findKNearest(slots, lng, lat, MAX_NEIGHBORS);

      let avgWidth = DEFAULT_WIDTH_M;
      let avgHeight = DEFAULT_HEIGHT_M;
      let avgAngle = 0;

      if (neighbors.length > 0) {
        const metrics = neighbors.map((s) => extractObbMetrics(s.polygon));
        avgWidth = metrics.reduce((sum, m) => sum + m.width, 0) / metrics.length;
        avgHeight = metrics.reduce((sum, m) => sum + m.height, 0) / metrics.length;

        const sinSum = metrics.reduce((sum, m) => sum + Math.sin(m.angle), 0);
        const cosSum = metrics.reduce((sum, m) => sum + Math.cos(m.angle), 0);
        avgAngle = Math.atan2(sinSum / metrics.length, cosSum / metrics.length);
      }

      return { avgWidth, avgHeight, avgAngle };
    },
    [slots],
  );

  const commitPlacement = useCallback(
    (p: Placement) => {
      dispatch(addSlot(placementToSlot(p)));
    },
    [dispatch],
  );

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!isAddMode) return;

      if (placement) {
        commitPlacement(placement);
        setPlacement(null);
        return;
      }

      const { lng, lat } = e.lngLat;
      const { avgWidth, avgHeight, avgAngle } = computeNeighborDefaults(lng, lat);

      setPlacement({
        slotId: crypto.randomUUID(),
        centerLng: lng,
        centerLat: lat,
        widthM: avgWidth,
        heightM: avgHeight,
        angle: avgAngle,
      });
    },
    [isAddMode, placement, commitPlacement, computeNeighborDefaults],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (!isAddMode || !placement) return;
      const { lng, lat } = e.lngLat;
      const angle = Math.atan2(lat - placement.centerLat, lng - placement.centerLng);
      setPlacement((prev) => (prev ? { ...prev, angle } : null));
    },
    [isAddMode, placement],
  );

  const confirmSlot = useCallback(() => {
    if (!placement) return;
    commitPlacement(placement);
    setPlacement(null);
  }, [placement, commitPlacement]);

  const cancelSlot = useCallback(() => {
    if (placement) {
      setPlacement(null);
    } else {
      dispatch(setEditMode('none'));
    }
  }, [dispatch, placement]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isAddMode) return;
      if (e.key === 'Enter' && placement) {
        e.preventDefault();
        confirmSlot();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelSlot();
      }
    },
    [isAddMode, placement, confirmSlot, cancelSlot],
  );

  return {
    isAddMode,
    pendingSlot,
    hasPending: placement !== null,
    handleMapClick,
    handleMouseMove,
    handleKeyDown,
    toggleAddMode,
    confirmSlot,
    cancelSlot,
  } as const;
}

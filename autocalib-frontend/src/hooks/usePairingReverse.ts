import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { pairingReverseZoneLinks, pairingSetActiveZone } from '../store/autocalib-slice';
import { useAbsmapDisplaySlots } from './useAbsmapDisplaySlots';
import { visibleCalibBboxes } from '../utils/calibVisibility';
import {
  pairingOrderForReverse,
  resolvePairingReverseSide,
  reversePairCount,
} from '../utils/pairing-map';

export function usePairingReverse() {
  const dispatch = useAppDispatch();
  const pairing = useAppSelector((s) => s.autocalib.pairing);
  const { zones, links, activeZoneId, activeZoneSide, focusedPanel } = pairing;
  const displaySlots = useAbsmapDisplaySlots();
  const b2bSnapshotAtLoad = useAppSelector((s) => s.autocalib.absmap.b2bSnapshotAtLoad);
  const calibrationDbSlots = useAppSelector((s) => s.autocalib.calib.calibrationDbSlots);
  const calibBboxes = useAppSelector((s) => s.autocalib.calib.bboxes);
  const confidenceThreshold = useAppSelector((s) => s.autocalib.calib.confidenceThreshold);
  const visibleBboxes = useMemo(
    () => visibleCalibBboxes(calibBboxes, confidenceThreshold),
    [calibBboxes, confidenceThreshold],
  );

  const activeZone = zones.find((z) => z.id === activeZoneId);
  const reverseSide = resolvePairingReverseSide({ activeZoneSide, focusedPanel });
  const hasProdSlots =
    b2bSnapshotAtLoad.length > 0 || Object.keys(calibrationDbSlots).length > 0;
  const reversePairCountValue = useMemo(
    () => reversePairCount({
      activeZone,
      links,
      slots: displaySlots,
      bboxes: visibleBboxes,
      dbSlots: calibrationDbSlots,
    }),
    [activeZone, links, displaySlots, visibleBboxes, calibrationDbSlots],
  );
  const canReverse =
    (activeZone != null && activeZone.mapSlotIds.length > 0)
    || (hasProdSlots && reversePairCountValue > 0);

  const confirmReverse = useCallback((side: 'map' | 'image') => {
    if (!canReverse) return false;
    if (activeZone && activeZone.mapSlotIds.length > 0) {
      dispatch(pairingReverseZoneLinks({
        zoneId: activeZone.id,
        side,
        slotIds: activeZone.mapSlotIds,
        bboxSpotIds: activeZone.imageBboxIds,
      }));
    } else {
      const order = pairingOrderForReverse({
        links,
        slots: displaySlots,
        bboxes: visibleBboxes,
        dbSlots: calibrationDbSlots,
      });
      if (!order) return false;
      dispatch(pairingReverseZoneLinks({
        side,
        slotIds: order.slotIds,
        bboxSpotIds: order.bboxSpotIds,
      }));
    }
    dispatch(pairingSetActiveZone({ zoneId: null, side: null }));
    return true;
  }, [
    activeZone,
    calibrationDbSlots,
    canReverse,
    dispatch,
    displaySlots,
    links,
    visibleBboxes,
  ]);

  return {
    canReverse,
    confirmReverse,
    reverseSide,
    activeZone,
    reversePairCount: reversePairCountValue,
    hasReverseZone: activeZone != null && activeZone.mapSlotIds.length > 0,
  };
}

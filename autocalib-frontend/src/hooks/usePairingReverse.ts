import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { pairingReverseZoneLinks } from '../store/autocalib-slice';
import { useAbsmapDisplaySlots } from './useAbsmapDisplaySlots';
import { visibleCalibBboxes } from '../utils/calibVisibility';
import { pairingOrderForReverse, resolvePairingReverseSide } from '../utils/pairing-map';

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
  const canReverse =
    (activeZone != null && activeZone.mapSlotIds.length > 0)
    || (hasProdSlots && links.length > 0);

  const handleReverse = useCallback(() => {
    if (!canReverse) return;
    if (activeZone && activeZone.mapSlotIds.length > 0) {
      dispatch(pairingReverseZoneLinks({
        zoneId: activeZone.id,
        side: reverseSide,
        slotIds: activeZone.mapSlotIds,
        bboxSpotIds: activeZone.imageBboxIds,
      }));
      return;
    }
    const order = pairingOrderForReverse({
      links,
      slots: displaySlots,
      bboxes: visibleBboxes,
      side: reverseSide,
      dbSlots: calibrationDbSlots,
    });
    if (!order) return;
    dispatch(pairingReverseZoneLinks({
      side: reverseSide,
      slotIds: order.slotIds,
      bboxSpotIds: order.bboxSpotIds,
    }));
  }, [
    activeZone,
    calibrationDbSlots,
    canReverse,
    dispatch,
    displaySlots,
    links,
    reverseSide,
    visibleBboxes,
  ]);

  return { canReverse, handleReverse, reverseSide, activeZone };
}

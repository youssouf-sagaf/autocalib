import { useMemo } from 'react';
import { useAppSelector } from '../store/hooks';
import { resolveAbsmapDisplaySlots } from '../utils/absmapDisplaySlots';

/** Slots shown on the absolute map — shared with pairing map for consistent framing. */
export function useAbsmapDisplaySlots() {
  const slots = useAppSelector((s) => s.autocalib.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.autocalib.absmap.baselineSlots);
  const b2bSnapshotAtLoad = useAppSelector((s) => s.autocalib.absmap.b2bSnapshotAtLoad);
  const slotMapDisplayMode = useAppSelector((s) => s.autocalib.absmap.slotMapDisplayMode);
  const deletedProdIds = useAppSelector((s) => s.autocalib.absmap.deletedProdIds);

  return useMemo(
    () =>
      resolveAbsmapDisplaySlots({
        slots,
        baselineSlots,
        b2bSnapshotAtLoad,
        slotMapDisplayMode,
        deletedProdIds,
      }),
    [slots, baselineSlots, b2bSnapshotAtLoad, slotMapDisplayMode, deletedProdIds],
  );
}

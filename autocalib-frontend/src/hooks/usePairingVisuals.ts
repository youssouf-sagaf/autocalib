import { useMemo } from 'react';
import { useAppSelector } from '../store/hooks';
import { PAIR_PALETTE } from '../types';
import { countPairingDraftChanges } from '../utils/calibrationDb';

/** Pairing workspace colors: draft session links (slot ↔ bbox share one palette color). */
export function usePairingVisuals() {
  const prodPairingBySlotId = useAppSelector((s) => s.autocalib.calib.prodPairingBySlotId);
  const draftPairingBySlotId = useAppSelector((s) => s.autocalib.pairing.pairingBySlotId);
  const links = useAppSelector((s) => s.autocalib.pairing.links);
  const activeTool = useAppSelector((s) => s.autocalib.pairing.activeTool);
  const selectedSlotId = useAppSelector((s) => s.autocalib.pairing.selectedSlotId);
  const selectedBboxId = useAppSelector((s) => s.autocalib.pairing.selectedBboxId);

  return useMemo(() => {
    const linkedSlotIds = new Set<string>();
    const linkedBboxIds = new Set<number>();
    const slotColorMap: Record<string, string> = {};
    const bboxColorMap = new Map<number, string>();

    for (const link of links) {
      const idx = link.colorIndex ?? 0;
      const color = PAIR_PALETTE[idx % PAIR_PALETTE.length] ?? '#37bc9b';
      slotColorMap[link.slotId] = color;
      bboxColorMap.set(link.bboxSpotId, color);
      linkedSlotIds.add(link.slotId);
      linkedBboxIds.add(link.bboxSpotId);
    }

    const pendingChanges = countPairingDraftChanges(prodPairingBySlotId, draftPairingBySlotId);

    const selectionPreviewColor =
      activeTool === 'pair' && (selectedSlotId != null || selectedBboxId != null)
        ? (PAIR_PALETTE[links.length % PAIR_PALETTE.length] ?? '#37bc9b')
        : null;

    return {
      linkedSlotIds,
      linkedBboxIds,
      slotColorMap,
      bboxColorMap,
      pendingChanges,
      selectionPreviewColor,
      selectedSlotId,
      selectedBboxId,
      activeTool,
    };
  }, [
    links,
    prodPairingBySlotId,
    draftPairingBySlotId,
    activeTool,
    selectedSlotId,
    selectedBboxId,
  ]);
}

/** @deprecated Use usePairingVisuals */
export const useProdPairingVisuals = usePairingVisuals;

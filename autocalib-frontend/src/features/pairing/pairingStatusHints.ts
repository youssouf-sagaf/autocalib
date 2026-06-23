import type { PairingTool } from '../../types';

const PAIRING_HINT_TOOLS = new Set<PairingTool>(['pair', 'unpair', 'draw_zone']);

export function pairingStatusHintKey(args: {
  activeTool: PairingTool;
  autoSuggestMode: boolean;
  mapPtsLen: number;
  imgPtsLen: number;
  zoneMismatchError?: string | null;
}): string {
  if (args.zoneMismatchError) return 'statusBar.pairing.hints.zoneRejected';
  if (args.autoSuggestMode) return 'statusBar.pairing.hints.autoSuggest';
  if (!PAIRING_HINT_TOOLS.has(args.activeTool)) return 'statusBar.pairing.hint';
  if (args.activeTool === 'draw_zone') {
    const mapReady = args.mapPtsLen >= 3;
    const imgReady = args.imgPtsLen >= 3;
    if (mapReady && !imgReady) return 'statusBar.pairing.hints.draw_zoneNeedImage';
    if (imgReady && !mapReady) return 'statusBar.pairing.hints.draw_zoneNeedMap';
    return 'statusBar.pairing.hints.draw_zone';
  }
  return `statusBar.pairing.hints.${args.activeTool}`;
}

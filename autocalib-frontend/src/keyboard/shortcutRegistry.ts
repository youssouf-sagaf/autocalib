export type ShortcutScope = 'global' | 'absmap' | 'calib' | 'pairing';

export type ShortcutPriority = 'modal' | 'palette' | 'workspace' | 'global';

export interface ShortcutDefinition {
  id: string;
  scope: ShortcutScope;
  /** Human-readable binding for Kbd / overlay / palette */
  display: string;
  /** i18n key for description */
  descKey: string;
  category?: string;
}

export const GLOBAL_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'palette', scope: 'global', display: '⌘K', descKey: 'shortcutOverlay.global.palette', category: 'navigation' },
  { id: 'save', scope: 'global', display: '⌘S', descKey: 'shortcutOverlay.global.save', category: 'navigation' },
  { id: 'undo', scope: 'global', display: '⌘Z', descKey: 'shortcutOverlay.global.undo', category: 'edit' },
  { id: 'redo', scope: 'global', display: '⌘⇧Z', descKey: 'shortcutOverlay.global.redo', category: 'edit' },
  { id: 'sidebar', scope: 'global', display: '⌘B', descKey: 'shortcutOverlay.global.sidebar', category: 'view' },
  { id: 'picker', scope: 'global', display: '⌘D', descKey: 'shortcutOverlay.global.devicePicker', category: 'device' },
  { id: 'nav-absmap', scope: 'global', display: '⌘1', descKey: 'shortcutOverlay.global.absmap', category: 'navigation' },
  { id: 'nav-calib', scope: 'global', display: '⌘2', descKey: 'shortcutOverlay.global.calibration', category: 'navigation' },
  { id: 'nav-pairing', scope: 'global', display: '⌘3', descKey: 'shortcutOverlay.global.pairingNav', category: 'navigation' },
  { id: 'nav-dashboard', scope: 'global', display: '⌘H', descKey: 'shortcutOverlay.global.dashboard', category: 'navigation' },
  { id: 'dual-map', scope: 'global', display: '⌘⇧M', descKey: 'shortcutOverlay.global.dualMap', category: 'view' },
  { id: 'help', scope: 'global', display: '?', descKey: 'shortcutOverlay.global.thisSheet', category: 'help' },
  { id: 'esc', scope: 'global', display: 'Esc', descKey: 'shortcutOverlay.global.esc', category: 'help' },
  { id: 'pan', scope: 'global', display: 'Space', descKey: 'shortcutOverlay.global.pan', category: 'view' },
];

export const ABSMAP_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'select', scope: 'absmap', display: 'V', descKey: 'shortcutOverlay.absmap.select' },
  { id: 'eraser', scope: 'absmap', display: 'E', descKey: 'shortcutOverlay.absmap.eraser' },
  { id: 'lasso', scope: 'absmap', display: 'L', descKey: 'shortcutOverlay.absmap.lassoDelete' },
  { id: 'add', scope: 'absmap', display: 'A', descKey: 'shortcutOverlay.absmap.addSlot' },
  { id: 'modify', scope: 'absmap', display: 'M', descKey: 'shortcutOverlay.absmap.modifySlot' },
  { id: 'delete-selection', scope: 'absmap', display: 'Del', descKey: 'shortcutOverlay.absmap.deleteSelection' },
  { id: 'copy', scope: 'absmap', display: 'C', descKey: 'shortcutOverlay.absmap.copySlot' },
  { id: 'roi', scope: 'absmap', display: 'R', descKey: 'shortcutOverlay.absmap.drawRoi' },
  { id: 'launch', scope: 'absmap', display: 'J', descKey: 'shortcutOverlay.absmap.launchPipeline' },
  { id: 'straighten', scope: 'absmap', display: 'Y', descKey: 'shortcutOverlay.absmap.straighten' },
  { id: 'reprocess', scope: 'absmap', display: 'B', descKey: 'shortcutOverlay.absmap.reprocess' },
  { id: 'tile-row', scope: 'absmap', display: 'T', descKey: 'shortcutOverlay.absmap.rowBrush' },
  { id: 'clone-row', scope: 'absmap', display: 'Shift R', descKey: 'shortcutOverlay.absmap.cloneRow' },
];

export const CALIB_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'select', scope: 'calib', display: 'V', descKey: 'shortcutOverlay.calib.rectSelect' },
  { id: 'lasso', scope: 'calib', display: 'L', descKey: 'shortcutOverlay.calib.lasso' },
  { id: 'add', scope: 'calib', display: 'A', descKey: 'shortcutOverlay.calib.addBbox' },
  { id: 'modify', scope: 'calib', display: 'M', descKey: 'shortcutOverlay.calib.modifyBbox' },
  { id: 'lock', scope: 'calib', display: 'K', descKey: 'shortcutOverlay.calib.lockSelection' },
  { id: 'delete', scope: 'calib', display: 'Del', descKey: 'shortcutOverlay.calib.deleteSelected' },
  { id: 'zoom', scope: 'calib', display: '+ −', descKey: 'shortcutOverlay.calib.zoom' },
];

export const PAIRING_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'pair', scope: 'pairing', display: 'P', descKey: 'shortcutOverlay.pairing.pairTool' },
  { id: 'unpair', scope: 'pairing', display: 'U', descKey: 'shortcutOverlay.pairing.unpairTool' },
  { id: 'zone', scope: 'pairing', display: 'Z', descKey: 'shortcutOverlay.pairing.zone' },
  { id: 'auto', scope: 'pairing', display: 'Q', descKey: 'shortcutOverlay.pairing.autoSuggest' },
  { id: 'delete', scope: 'pairing', display: 'Del', descKey: 'shortcutOverlay.pairing.deleteZone' },
];

export function shortcutsForRoute(pathname: string): ShortcutDefinition[] {
  const groups = [...GLOBAL_SHORTCUTS];
  if (pathname.startsWith('/absmap')) groups.push(...ABSMAP_SHORTCUTS);
  else if (pathname.startsWith('/calib')) groups.push(...CALIB_SHORTCUTS);
  else if (pathname.startsWith('/pairing')) groups.push(...PAIRING_SHORTCUTS);
  return groups;
}

export function overlayGroupsForRoute(pathname: string): { scope: ShortcutScope; shortcuts: ShortcutDefinition[] }[] {
  const result: { scope: ShortcutScope; shortcuts: ShortcutDefinition[] }[] = [
    { scope: 'global', shortcuts: GLOBAL_SHORTCUTS },
  ];
  if (pathname.startsWith('/absmap')) {
    result.push({ scope: 'absmap', shortcuts: ABSMAP_SHORTCUTS });
  } else if (pathname.startsWith('/calib')) {
    result.push({ scope: 'calib', shortcuts: CALIB_SHORTCUTS });
  } else if (pathname.startsWith('/pairing')) {
    result.push({ scope: 'pairing', shortcuts: PAIRING_SHORTCUTS });
  }
  return result;
}

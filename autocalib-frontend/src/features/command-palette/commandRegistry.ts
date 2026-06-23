import type { TFunction } from 'i18next';
type NavigateFn = (path: string) => void;

export interface CommandPaletteCommand {
  id: string;
  label: string;
  keywords: string[];
  category: string;
  shortcut?: string;
  run: () => void;
}

interface CommandActions {
  toggleDualMap: () => void;
  toggleSidebar: () => void;
  openClientPicker: () => void;
  openDevicePicker: () => void;
  openShortcuts: () => void;
  onSave?: () => void;
}

export interface WorkspaceCommandActions {
  absmap?: {
    addSlot?: () => void;
    eraser?: () => void;
    lasso?: () => void;
    drawRoi?: () => void;
    launchPipeline?: () => void;
    straighten?: () => void;
    reprocess?: () => void;
    toggleOverlayDet?: () => void;
    toggleOverlayPost?: () => void;
  };
  calib?: {
    runDetection?: () => void;
    lockSelection?: () => void;
    deleteSelection?: () => void;
  };
  pairing?: {
    pair?: () => void;
    zone?: () => void;
    autoSuggest?: () => void;
    save?: () => void;
  };
}

export function createNavigationCommands(navigate: NavigateFn, t: TFunction): CommandPaletteCommand[] {
  return [
    {
      id: 'go-home',
      label: t('commands.goHome'),
      keywords: ['home', 'dashboard', 'overview', 'accueil'],
      category: t('commandCategories.navigation'),
      shortcut: '⌘H',
      run: () => navigate('/'),
    },
    {
      id: 'go-absmap',
      label: t('commands.goAbsmap'),
      keywords: ['absmap', 'map', 'slots', 'satellite', 'carte'],
      category: t('commandCategories.navigation'),
      shortcut: '⌘1',
      run: () => navigate('/absmap'),
    },
    {
      id: 'go-calib',
      label: t('commands.goCalib'),
      keywords: ['calib', 'calibration', 'bbox', 'camera'],
      category: t('commandCategories.navigation'),
      shortcut: '⌘2',
      run: () => navigate('/calib'),
    },
    {
      id: 'go-pairing',
      label: t('commands.goPairing'),
      keywords: ['pairing', 'match', 'link', 'appariement'],
      category: t('commandCategories.navigation'),
      shortcut: '⌘3',
      run: () => navigate('/pairing'),
    },
  ];
}

function createAbsmapCommands(t: TFunction, ws?: WorkspaceCommandActions['absmap']): CommandPaletteCommand[] {
  if (!ws) return [];
  const cmds: CommandPaletteCommand[] = [];
  const cat = t('commandCategories.absmap');
  if (ws.addSlot) {
    cmds.push({ id: 'absmap-add', label: t('commands.absmapAddSlot'), keywords: ['add', 'slot', 'place'], category: cat, shortcut: 'A', run: ws.addSlot });
  }
  if (ws.eraser) {
    cmds.push({ id: 'absmap-eraser', label: t('commands.absmapEraser'), keywords: ['eraser', 'gomme', 'delete'], category: cat, shortcut: 'E', run: ws.eraser });
  }
  if (ws.lasso) {
    cmds.push({ id: 'absmap-lasso', label: t('commands.absmapLasso'), keywords: ['lasso', 'bulk'], category: cat, shortcut: 'L', run: ws.lasso });
  }
  if (ws.drawRoi) {
    cmds.push({ id: 'absmap-roi', label: t('commands.absmapDrawRoi'), keywords: ['roi', 'region', 'polygon'], category: cat, shortcut: 'R', run: ws.drawRoi });
  }
  if (ws.launchPipeline) {
    cmds.push({ id: 'absmap-launch', label: t('commands.absmapLaunch'), keywords: ['launch', 'pipeline', 'job'], category: cat, shortcut: 'J', run: ws.launchPipeline });
  }
  if (ws.straighten) {
    cmds.push({ id: 'absmap-straighten', label: t('commands.absmapStraighten'), keywords: ['straighten', 'align'], category: cat, shortcut: 'Y', run: ws.straighten });
  }
  if (ws.reprocess) {
    cmds.push({ id: 'absmap-reprocess', label: t('commands.absmapReprocess'), keywords: ['reprocess', 'retreat'], category: cat, shortcut: 'B', run: ws.reprocess });
  }
  if (ws.toggleOverlayDet) {
    cmds.push({ id: 'absmap-overlay-det', label: t('commands.absmapOverlayDet'), keywords: ['detection', 'overlay'], category: cat, run: ws.toggleOverlayDet });
  }
  if (ws.toggleOverlayPost) {
    cmds.push({ id: 'absmap-overlay-post', label: t('commands.absmapOverlayPost'), keywords: ['post', 'postprocess'], category: cat, run: ws.toggleOverlayPost });
  }
  return cmds;
}

function createCalibCommands(t: TFunction, ws?: WorkspaceCommandActions['calib']): CommandPaletteCommand[] {
  if (!ws) return [];
  const cat = t('commandCategories.calib');
  const cmds: CommandPaletteCommand[] = [];
  if (ws.runDetection) {
    cmds.push({ id: 'calib-run', label: t('commands.calibRun'), keywords: ['detect', 'run', 'job'], category: cat, shortcut: 'J', run: ws.runDetection });
  }
  if (ws.lockSelection) {
    cmds.push({ id: 'calib-lock', label: t('commands.calibLock'), keywords: ['lock'], category: cat, shortcut: 'K', run: ws.lockSelection });
  }
  if (ws.deleteSelection) {
    cmds.push({ id: 'calib-delete', label: t('commands.calibDelete'), keywords: ['delete', 'remove'], category: cat, shortcut: 'Del', run: ws.deleteSelection });
  }
  return cmds;
}

function createPairingCommands(t: TFunction, ws?: WorkspaceCommandActions['pairing']): CommandPaletteCommand[] {
  if (!ws) return [];
  const cat = t('commandCategories.pairing');
  const cmds: CommandPaletteCommand[] = [];
  if (ws.pair) {
    cmds.push({ id: 'pairing-pair', label: t('commands.pairingPair'), keywords: ['pair'], category: cat, shortcut: 'P', run: ws.pair });
  }
  if (ws.zone) {
    cmds.push({ id: 'pairing-zone', label: t('commands.pairingZone'), keywords: ['zone', 'map', 'image'], category: cat, shortcut: 'Z', run: ws.zone });
  }
  if (ws.autoSuggest) {
    cmds.push({ id: 'pairing-auto', label: t('commands.pairingAuto'), keywords: ['auto', 'suggest'], category: cat, shortcut: 'Q', run: ws.autoSuggest });
  }
  if (ws.save) {
    cmds.push({ id: 'pairing-save', label: t('commands.pairingSave'), keywords: ['save'], category: cat, shortcut: '⌘S', run: ws.save });
  }
  return cmds;
}

export function createAllCommands(
  navigate: NavigateFn,
  actions: CommandActions,
  t: TFunction,
  pathname = '/',
  workspace?: WorkspaceCommandActions,
): CommandPaletteCommand[] {
  const base: CommandPaletteCommand[] = [
    ...createNavigationCommands(navigate, t),
    {
      id: 'toggle-sidebar',
      label: t('commands.toggleSidebar'),
      keywords: ['sidebar', 'panel', 'collapse', 'expand'],
      category: t('commandCategories.view'),
      shortcut: '⌘B',
      run: actions.toggleSidebar,
    },
    {
      id: 'toggle-dualmap',
      label: t('commands.toggleDualMap'),
      keywords: ['dual', 'map', 'split', 'compare'],
      category: t('commandCategories.view'),
      shortcut: '⌘⇧M',
      run: actions.toggleDualMap,
    },
    {
      id: 'switch-client',
      label: t('commands.switchClient'),
      keywords: ['client', 'city', 'ville', 'picker'],
      category: t('commandCategories.device'),
      shortcut: '⌘D',
      run: actions.openClientPicker,
    },
    {
      id: 'switch-device',
      label: t('commands.switchDevice'),
      keywords: ['device', 'camera', 'cocospot', 'picker'],
      category: t('commandCategories.device'),
      shortcut: '⌘D',
      run: actions.openDevicePicker,
    },
    {
      id: 'show-shortcuts',
      label: t('commands.showShortcuts'),
      keywords: ['keyboard', 'shortcuts', 'help', 'keys'],
      category: t('commandCategories.help'),
      shortcut: '?',
      run: actions.openShortcuts,
    },
  ];

  if (actions.onSave) {
    base.push({
      id: 'save',
      label: t('commands.save'),
      keywords: ['save', 'enregistrer', 'persist'],
      category: t('commandCategories.navigation'),
      shortcut: '⌘S',
      run: actions.onSave,
    });
  }

  if (pathname.startsWith('/absmap')) {
    base.push(...createAbsmapCommands(t, workspace?.absmap));
  } else if (pathname.startsWith('/calib')) {
    base.push(...createCalibCommands(t, workspace?.calib));
  } else if (pathname.startsWith('/pairing')) {
    base.push(...createPairingCommands(t, workspace?.pairing));
  }

  return base;
}

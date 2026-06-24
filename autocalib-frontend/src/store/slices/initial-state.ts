import { getInitialDirectoryState } from '../directory-state';
import type { AutocalibRootState, AbsmapDomainState, AutocalibUiState } from './nested-state';
import {
  calibInitial,
  pairingInitial,
  buildInitialWorkspaceContext,
  buildInitialSessionNotifications,
  initialSaveFeedback,
  defaultOverlayVisibility,
  loadImagerySourceFromStorage,
  loadMapDisplayLayerFromStorage,
} from './shared';

export { calibInitial, pairingInitial };

export const uiInitialState: AutocalibUiState = {
  workspaceMode: 'absmap',
  saveFeedback: initialSaveFeedback(),
  sessionNotifications: buildInitialSessionNotifications(),
};

export const absmapInitialState: AbsmapDomainState = {
  dualMapActive: false,
  crops: [],
  job: null,
  slots: [],
  baselineSlots: [],
  b2bSnapshotAtLoad: [],
  selection: [],
  markerDisplayMode: 'auto',
  editMode: 'none',
  editHistory: [],
  editIndex: 0,
  isDirty: false,
  dirtyProdSlotIds: [],
  deletedProdIds: [],
  slotMapDisplayMode: 'workspace',
  preSaveBackup: null,
  isSaving: false,
  isRefreshingReferenceOverlay: false,
  lastSavedAt: null,
  saveError: null,
  overlayVisibility: defaultOverlayVisibility(),
  detectionOverlay: null,
  postprocessOverlay: null,
  straightenAnchorSlotId: null,
  straightenLoading: false,
  straightenError: null,
  reprocessRefSlotId: null,
  reprocessScopePolygon: null,
  reprocessProposedSlots: [],
  reprocessLoading: false,
  reprocessError: null,
  reprocessedSteps: [],
  tileRowROI: null,
  tileRowSeeds: [],
  tileRowProposed: [],
  absmapViewState: null,
  imagerySource: loadImagerySourceFromStorage(),
  mapDisplayLayer: loadMapDisplayLayerFromStorage(),
};

export const autocalibInitialState: AutocalibRootState = {
  absmap: absmapInitialState,
  calib: { ...calibInitial },
  pairing: { ...pairingInitial },
  context: buildInitialWorkspaceContext(),
  directory: getInitialDirectoryState(),
  ui: uiInitialState,
};

import type { AppNotification } from '../../features/notifications/notification-types';
import type {
  CropRequest,
  EditEvent,
  EditMode,
  ImagerySource,
  MarkerDisplayMode,
  OverlayVisibility,
  OrientedRect,
  PipelineJob,
  ReprocessStep,
  SaveFeedbackState,
  Slot,
  WorkspaceContext,
} from '../../types';
import type { DirectoryState } from '../directory-state';
import type { CalibState, PairingState } from '../autocalib-state-types';

/** Absmap workspace fields (map, pipeline, edits, dirty tracking). */
export interface AbsmapDomainState {
  dualMapActive: boolean;
  crops: CropRequest[];
  job: PipelineJob | null;
  slots: Slot[];
  baselineSlots: Slot[];
  b2bSnapshotAtLoad: Slot[];
  selection: string[];
  markerDisplayMode: MarkerDisplayMode;
  editMode: EditMode;
  editHistory: EditEvent[];
  editIndex: number;
  isDirty: boolean;
  dirtyProdSlotIds: string[];
  deletedProdIds: string[];
  slotMapDisplayMode: 'workspace' | 'prod';
  preSaveBackup: {
    slots: Slot[];
    dirtyProdSlotIds: string[];
    deletedProdIds: string[];
  } | null;
  isSaving: boolean;
  isRefreshingReferenceOverlay: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
  overlayVisibility: OverlayVisibility;
  detectionOverlay: GeoJSON.FeatureCollection | null;
  postprocessOverlay: GeoJSON.FeatureCollection | null;
  straightenAnchorSlotId: string | null;
  straightenLoading: boolean;
  straightenError: string | null;
  reprocessRefSlotId: string | null;
  reprocessScopePolygon: GeoJSON.Polygon | null;
  reprocessProposedSlots: Slot[];
  reprocessLoading: boolean;
  reprocessError: string | null;
  reprocessedSteps: ReprocessStep[];
  tileRowROI: OrientedRect | null;
  tileRowSeeds: Slot[];
  tileRowProposed: Slot[];
  absmapViewState: { longitude: number; latitude: number; zoom: number } | null;
  imagerySource: ImagerySource;
}

export interface AutocalibUiState {
  workspaceMode: 'absmap' | 'calib' | 'pairing';
  saveFeedback: SaveFeedbackState;
  sessionNotifications: AppNotification[];
}

/** Nested autocalib root — matches combineReducers layout (phase 2). */
export interface AutocalibRootState {
  absmap: AbsmapDomainState;
  calib: CalibState;
  pairing: PairingState;
  context: WorkspaceContext;
  directory: DirectoryState;
  ui: AutocalibUiState;
}

/** Flat legacy shape used by the monolithic slice reducer (bridge). */
export interface LegacyAutocalibState extends AbsmapDomainState {
  calib: CalibState;
  pairing: PairingState;
  context: WorkspaceContext;
  directory: DirectoryState;
  workspaceMode: 'absmap' | 'calib' | 'pairing';
  saveFeedback: SaveFeedbackState;
  sessionNotifications: AppNotification[];
}

const ABSMAP_KEYS: (keyof AbsmapDomainState)[] = [
  'dualMapActive',
  'crops',
  'job',
  'slots',
  'baselineSlots',
  'b2bSnapshotAtLoad',
  'selection',
  'markerDisplayMode',
  'editMode',
  'editHistory',
  'editIndex',
  'isDirty',
  'dirtyProdSlotIds',
  'deletedProdIds',
  'slotMapDisplayMode',
  'preSaveBackup',
  'isSaving',
  'isRefreshingReferenceOverlay',
  'lastSavedAt',
  'saveError',
  'overlayVisibility',
  'detectionOverlay',
  'postprocessOverlay',
  'straightenAnchorSlotId',
  'straightenLoading',
  'straightenError',
  'reprocessRefSlotId',
  'reprocessScopePolygon',
  'reprocessProposedSlots',
  'reprocessLoading',
  'reprocessError',
  'reprocessedSteps',
  'tileRowROI',
  'tileRowSeeds',
  'tileRowProposed',
  'absmapViewState',
  'imagerySource',
];

export function flatToNested(flat: LegacyAutocalibState): AutocalibRootState {
  const absmap = {} as AbsmapDomainState;
  for (const key of ABSMAP_KEYS) {
    (absmap as unknown as Record<string, unknown>)[key] = flat[key];
  }
  return {
    absmap,
    calib: flat.calib,
    pairing: flat.pairing,
    context: flat.context,
    directory: flat.directory,
    ui: {
      workspaceMode: flat.workspaceMode,
      saveFeedback: flat.saveFeedback,
      sessionNotifications: flat.sessionNotifications,
    },
  };
}

export function nestedToFlat(root: AutocalibRootState): LegacyAutocalibState {
  return {
    ...root.absmap,
    calib: root.calib,
    pairing: root.pairing,
    context: root.context,
    directory: root.directory,
    workspaceMode: root.ui.workspaceMode,
    saveFeedback: root.ui.saveFeedback,
    sessionNotifications: root.ui.sessionNotifications,
  };
}

/** Read legacy flat state from the store (thunks / listeners during migration). */
export function legacyAutocalibFromRoot(root: AutocalibRootState): LegacyAutocalibState {
  return nestedToFlat(root);
}

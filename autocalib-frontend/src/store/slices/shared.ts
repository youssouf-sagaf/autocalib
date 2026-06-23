import type {
  CropRequest,
  DeviceCalibrationResponse,
  EditEvent,
  ImagerySource,
  OverlayVisibility,
  SaveFeedbackState,
  SaveFeedbackVariant,
  SaveFeedbackWorkspace,
  SaveSummary,
  PipelineOverlaysSnapshot,
  PairingEditEvent,
  PairingLink,
  RecentDevice,
  Slot,
  ActiveClientSelection,
  WorkspaceContext,
  WorkspaceStep,
} from '../../types';
import {
  activeClientDirectoryKey,
  clientDirectoryKey,
  isB2bClientId,
  syncWorkspaceClientFromDirectory,
} from '../../utils/clientContext';
import { createLogger } from '../../utils/logger';
import { absmapDisplaySlotsFromDomain } from '../../utils/absmapDisplaySlots';
import {
  buildCalibBboxProdMetaFromLoad,
  buildCalibrationBboxesByKey,
  prodPairingBySlotIdFromDb,
  pairingLinksFromDbBboxes,
} from '../../utils/calibrationDb';
import { uuid } from '../../utils/uuid';
import type { AppNotification } from '../../features/notifications/notification-types';
import { reloadSessionNotifications } from '../../features/notifications/session-notifications';
import { loadSessionNotifications } from '../../utils/sessionNotificationsCache';
import { resetAbsmapDirtyTracking } from '../../utils/absmap-dirty';
import { slotKey } from '../../utils/slot-key';
import { pairingLinksFromMap } from '../../utils/pairing-map';
import type { CalibState, PairingState } from '../autocalib-state-types';
import type { AutocalibRootState, AbsmapDomainState } from './nested-state';
import { getInitialDirectoryState } from '../directory-state';
import {
  activeSessionSlots,
  dropManualSlotsRedundantWithPipeline,
} from '../../utils/slot-geometry';

export const log = createLogger('store');

export function defaultOverlayVisibility(roiVisible = true): OverlayVisibility {
  return { detection: false, postprocess: false, roi: roiVisible };
}

/** Accumulate per-crop pipeline overlays when merging a new Launch into the session. */
export function mergePipelineOverlay(
  existing: GeoJSON.FeatureCollection | null,
  incoming: GeoJSON.FeatureCollection | null | undefined,
): GeoJSON.FeatureCollection | null {
  const features = [
    ...(existing?.features ?? []),
    ...(incoming?.features ?? []),
  ];
  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
}

const CONTEXT_STORAGE_KEY = 'autocalib:context';
const SIDEBAR_EXPANDED_DEFAULT_MIGRATION_KEY = 'autocalib:sidebar-expanded-default-v2';
const IMAGERY_SOURCE_STORAGE_KEY = 'autocalib:imagerySource';
const MAX_RECENT_DEVICES = 20;
const MAX_RECENT_CLIENTS = 8;

const VALID_IMAGERY_SOURCES: ImagerySource[] = [
  'mapbox',
  'ign-current',
  'ign-pleiades-2026',
];

// Migration: legacy values before per-layer presets or removed providers.
const LEGACY_IMAGERY_SOURCE_MAP: Record<string, ImagerySource> = {
  ign: 'ign-current',
  'ign-2025': 'ign-current',
  'google-satellite': 'mapbox',
};

export function loadImagerySourceFromStorage(): ImagerySource {
  try {
    const raw = localStorage.getItem(IMAGERY_SOURCE_STORAGE_KEY);
    if (!raw) return 'mapbox';
    if ((VALID_IMAGERY_SOURCES as string[]).includes(raw)) {
      return raw as ImagerySource;
    }
    const migrated = LEGACY_IMAGERY_SOURCE_MAP[raw];
    if (migrated) {
      saveImagerySourceToStorage(migrated);
      return migrated;
    }
  } catch { /* ignore */ }
  return 'mapbox';
}

export function saveImagerySourceToStorage(src: ImagerySource) {
  try {
    localStorage.setItem(IMAGERY_SOURCE_STORAGE_KEY, src);
  } catch { /* quota or private mode — ignore */ }
}

export function loadContextFromStorage(): WorkspaceContext {
  const defaults: WorkspaceContext = {
    clientId: '',
    clientName: '',
    deviceId: '',
    recentDevices: [],
    recentClients: [],
    sidebarExpanded: true,
  };
  try {
    const raw = localStorage.getItem(CONTEXT_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const legacyClient = typeof parsed.client === 'string' ? parsed.client.trim() : '';
    if (legacyClient && !parsed.clientId && !parsed.clientName) {
      if (isB2bClientId(legacyClient)) {
        parsed.clientId = legacyClient;
      } else {
        parsed.clientName = legacyClient;
      }
    }
    delete parsed.client;
    const ctx = { ...defaults, ...parsed } as WorkspaceContext;
    try {
      if (!localStorage.getItem(SIDEBAR_EXPANDED_DEFAULT_MIGRATION_KEY)) {
        ctx.sidebarExpanded = true;
        localStorage.setItem(SIDEBAR_EXPANDED_DEFAULT_MIGRATION_KEY, '1');
        saveContextToStorage(ctx);
      }
    } catch { /* quota or private mode — ignore */ }
    return ctx;
  } catch {
    return defaults;
  }
}

export function saveContextToStorage(ctx: WorkspaceContext) {
  try {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(ctx));
  } catch { /* quota or private mode — ignore */ }
}

export function pushRecentClient(list: string[], client: string): string[] {
  if (!client) return list;
  const filtered = list.filter((c) => c !== client);
  return [client, ...filtered].slice(0, MAX_RECENT_CLIENTS);
}

export function pushRecentDevice(list: RecentDevice[], client: string, deviceId: string, label?: string): RecentDevice[] {
  if (!client || !deviceId) return list;
  const existing = list.find((d) => d.client === client && d.deviceId === deviceId);
  const filtered = list.filter((d) => !(d.client === client && d.deviceId === deviceId));
  return [
    { client, deviceId, label: label ?? existing?.label, lastUsed: Date.now(), completedSteps: existing?.completedSteps ?? [] },
    ...filtered,
  ].slice(0, MAX_RECENT_DEVICES);
}

export function markStepDone(list: RecentDevice[], client: string, deviceId: string, step: WorkspaceStep): RecentDevice[] {
  return list.map((d) => {
    if (d.client !== client || d.deviceId !== deviceId) return d;
    const steps = d.completedSteps ?? [];
    if (steps.includes(step)) return d;
    return { ...d, completedSteps: [...steps, step] };
  });
}

export const calibInitial: CalibState = {
  viewTab: 'production',
  deviceId: '',
  client: '',
  jobId: null,
  jobStatus: 'idle',
  jobProgress: null,
  jobError: null,
  bboxes: [],
  frameCount: 0,
  totalDetections: 0,
  activeFrameIndex: -1,
  editMode: 'none',
  selectedBboxIds: [],
  lockedBboxIds: [],
  editHistory: [],
  editIndex: 0,
  confidenceThreshold: 0.25,
  canvasZoom: 1,
  canvasPanX: 0,
  canvasPanY: 0,
  sessionRevision: 0,
  lastCalibSubmitConfidenceThreshold: null,
  showCalibEditorResult: false,
  imageWidth: 1280,
  imageHeight: 480,
  streetName: null,
  calibrationDbSlots: {},
  calibrationDbBboxKeys: [],
  calibrationDbBboxesByKey: {},
  calibrationDbBboxMeta: {},
  prodPairingBySlotId: {},
  isSavingCalibration: false,
  calibrationLoadedFromDb: false,
  calibrationLoading: false,
};

export const pairingInitial: PairingState = {
  activeTool: 'none',
  pairingBySlotId: {},
  links: [],
  zones: [],
  selectedSlotId: null,
  selectedBboxId: null,
  drawingMapPoints: [],
  drawingImagePoints: [],
  activeZoneId: null,
  activeZoneSide: null,
  suggestion: null,
  zoneMismatchError: null,
  autoSuggestMode: false,
  autoSuggest: null,
  editHistory: [],
  editIndex: 0,
};

export let pairingLinkCounter = 0;
export let pairingZoneCounter = 0;

export function syncPairingLinkCounterFromLinks(links: PairingLink[]) {
  let max = 0;
  for (const l of links) {
    const m = /^link-(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  pairingLinkCounter = Math.max(pairingLinkCounter, max);
}

/** Clears absmap geo work and pairing when the active city changes (device not required on absmap). */
export function resetAbsmapStackForClientChange(state: AutocalibRootState) {
  state.absmap.selection = [];
  state.absmap.slots = [];
  state.absmap.baselineSlots = [];
  state.absmap.job = null;
  state.absmap.crops = [];
  state.absmap.editMode = 'none';
  state.absmap.editHistory = [];
  state.absmap.editIndex = 0;
  state.absmap.isDirty = false;
  state.absmap.isSaving = false;
  state.absmap.slotMapDisplayMode = 'workspace';
  state.absmap.preSaveBackup = null;
  state.absmap.isRefreshingReferenceOverlay = false;
  state.absmap.lastSavedAt = null;
  state.absmap.saveError = null;
  state.absmap.overlayVisibility = defaultOverlayVisibility();
  state.absmap.detectionOverlay = null;
  state.absmap.postprocessOverlay = null;
  state.absmap.straightenAnchorSlotId = null;
  state.absmap.straightenLoading = false;
  state.absmap.straightenError = null;
  state.absmap.reprocessRefSlotId = null;
  state.absmap.reprocessScopePolygon = null;
  state.absmap.reprocessProposedSlots = [];
  state.absmap.reprocessLoading = false;
  state.absmap.reprocessError = null;
  state.absmap.reprocessedSteps = [];
  state.absmap.b2bSnapshotAtLoad = [];
  resetAbsmapDirtyTracking(state.absmap);
  state.absmap.dualMapActive = false;
  state.absmap.absmapViewState = null;
  state.pairing = { ...pairingInitial };
  syncPairingLinkCounterFromLinks([]);
}

/** Clears absmap, calib, and pairing when the active Cocospot (device) changes. */
export function resetWorkspaceStacksForDeviceChange(state: AutocalibRootState) {
  resetAbsmapStackForClientChange(state);
  state.calib = { ...calibInitial };
}

export function applyActiveClient(state: AutocalibRootState, selection: ActiveClientSelection) {
  const clientId = selection.clientId.trim();
  const clientName = selection.clientName.trim();
  const directoryKey = clientDirectoryKey(clientId, clientName);
  if (!directoryKey) return;
  const prevKey = activeClientDirectoryKey(state.context);
  const sameClient =
    state.context.clientId === clientId && state.context.clientName === clientName;
  if (prevKey === directoryKey && sameClient) return;
  if (prevKey === directoryKey) {
    state.context.clientId = clientId;
    state.context.clientName = clientName;
    saveContextToStorage(state.context);
    return;
  }

  state.context.clientId = clientId;
  state.context.clientName = clientName;
  state.context.deviceId = '';
  state.context.recentClients = pushRecentClient(state.context.recentClients ?? [], directoryKey);
  resetAbsmapStackForClientChange(state);
  saveContextToStorage(state.context);
  reloadSessionNotifications({
    context: state.context,
    sessionNotifications: state.ui.sessionNotifications,
  });
}

export function truncatePairingFuture(state: PairingState) {
  const p = state;
  if (p.editIndex < p.editHistory.length) {
    state.editHistory = p.editHistory.slice(0, p.editIndex);
  }
}

export function syncPairingLinksFromMap(state: PairingState, incomingLinks: PairingLink[] = []): void {
  const colorBySlot = new Map<string, number>();
  for (const link of state.links) {
    if (link.colorIndex != null) colorBySlot.set(link.slotId, link.colorIndex);
  }
  for (const link of incomingLinks) {
    if (link.colorIndex != null) colorBySlot.set(link.slotId, link.colorIndex);
  }
  state.links = pairingLinksFromMap(state.pairingBySlotId).map((link) => ({
    ...link,
    colorIndex: colorBySlot.get(link.slotId) ?? link.colorIndex,
  }));
  syncPairingLinkCounterFromLinks(state.links);
}

export function syncPairingLinksFromRoot(state: AutocalibRootState): void {
  syncPairingLinksFromMap(state.pairing);
}

export function applyPairingEvent(state: PairingState, evt: PairingEditEvent) {
  switch (evt.type) {
    case 'links_added':
      for (const link of evt.links) {
        state.pairingBySlotId[link.slotId] = link.bboxSpotId;
      }
      syncPairingLinksFromMap(state, evt.links);
      break;
    case 'links_removed': {
      for (const link of evt.links) {
        delete state.pairingBySlotId[link.slotId];
      }
      syncPairingLinksFromMap(state);
      break;
    }
    case 'zone_added':
      state.zones.push({ ...evt.zone });
      state.activeZoneId = evt.zone.id;
      state.activeZoneSide = null;
      for (const link of evt.autoLinks) {
        state.pairingBySlotId[link.slotId] = link.bboxSpotId;
      }
      syncPairingLinksFromMap(state, evt.autoLinks);
      break;
    case 'zone_reversed': {
      for (const link of evt.oldLinks) {
        delete state.pairingBySlotId[link.slotId];
      }
      for (const link of evt.newLinks) {
        state.pairingBySlotId[link.slotId] = link.bboxSpotId;
      }
      syncPairingLinksFromMap(state, evt.newLinks);
      const z = state.zones.find((zz) => zz.id === evt.zoneId);
      if (z) {
        if (evt.side === 'map') z.mapSlotIds.reverse();
        else z.imageBboxIds.reverse();
      }
      break;
    }
    case 'zone_deleted': {
      for (const link of evt.links) {
        delete state.pairingBySlotId[link.slotId];
      }
      syncPairingLinksFromMap(state);
      state.zones = state.zones.filter((z) => z.id !== evt.zone.id);
      if (state.activeZoneId === evt.zone.id) {
        state.activeZoneId = null;
        state.activeZoneSide = null;
      }
      break;
    }
  }
}

export function reversePairingEvent(state: PairingState, evt: PairingEditEvent) {
  switch (evt.type) {
    case 'links_added': {
      for (const link of evt.links) {
        delete state.pairingBySlotId[link.slotId];
      }
      syncPairingLinksFromMap(state);
      break;
    }
    case 'links_removed':
      for (const link of evt.links) {
        state.pairingBySlotId[link.slotId] = link.bboxSpotId;
      }
      syncPairingLinksFromMap(state);
      break;
    case 'zone_added': {
      for (const link of evt.autoLinks) {
        delete state.pairingBySlotId[link.slotId];
      }
      syncPairingLinksFromMap(state);
      state.zones = state.zones.filter((z) => z.id !== evt.zone.id);
      state.suggestion = null;
      if (state.activeZoneId === evt.zone.id) {
        state.activeZoneId = null;
        state.activeZoneSide = null;
      }
      break;
    }
    case 'zone_reversed': {
      for (const link of evt.newLinks) {
        delete state.pairingBySlotId[link.slotId];
      }
      for (const link of evt.oldLinks) {
        state.pairingBySlotId[link.slotId] = link.bboxSpotId;
      }
      syncPairingLinksFromMap(state);
      const z = state.zones.find((zz) => zz.id === evt.zoneId);
      if (z) {
        if (evt.side === 'map') z.mapSlotIds.reverse();
        else z.imageBboxIds.reverse();
      }
      break;
    }
    case 'zone_deleted':
      state.zones.push({ ...evt.zone });
      for (const link of evt.links) {
        state.pairingBySlotId[link.slotId] = link.bboxSpotId;
      }
      syncPairingLinksFromMap(state);
      state.activeZoneId = evt.zone.id;
      state.activeZoneSide = null;
      break;
  }
}

export const initialSaveFeedback = (): SaveFeedbackState => ({
  open: false,
  variant: 'success',
  workspace: 'absmap',
});

export function saveFeedbackWorkspace(state: AutocalibRootState): SaveFeedbackWorkspace {
  if (state.ui.workspaceMode === 'calib') return 'calib';
  if (state.ui.workspaceMode === 'pairing') return 'pairing';
  return 'absmap';
}

export function openSaveFeedback(
  state: AutocalibRootState,
  args: {
    variant: SaveFeedbackVariant;
    summary?: SaveSummary;
    bboxCount?: number;
    deletedBboxCount?: number;
    deletedBboxKeys?: string[];
    deletedBboxLabels?: string[];
    slotCount?: number;
    savedSlotLabels?: string[];
    addedSlotCount?: number;
    addedSlotLabels?: string[];
    pairedCount?: number;
    pairedLabels?: string[];
    errorMessage?: string;
  },
): void {
  state.ui.saveFeedback = {
    open: true,
    variant: args.variant,
    workspace: saveFeedbackWorkspace(state),
    summary: args.summary,
    bboxCount: args.bboxCount,
    deletedBboxCount: args.deletedBboxCount,
    deletedBboxKeys: args.deletedBboxKeys,
    deletedBboxLabels: args.deletedBboxLabels,
    slotCount: args.slotCount,
    savedSlotLabels: args.savedSlotLabels,
    addedSlotCount: args.addedSlotCount,
    addedSlotLabels: args.addedSlotLabels,
    pairedCount: args.pairedCount,
    pairedLabels: args.pairedLabels,
    errorMessage: args.errorMessage,
  };
}

export function buildInitialWorkspaceContext(): WorkspaceContext {
  const ctx = loadContextFromStorage();
  const clients = getInitialDirectoryState().clients;
  return { ...ctx, ...syncWorkspaceClientFromDirectory(ctx, clients) };
}

export function buildInitialSessionNotifications(): AppNotification[] {
  const ctx = buildInitialWorkspaceContext();
  const client = ctx.clientName.trim() || ctx.clientId.trim();
  return client ? loadSessionNotifications(client, ctx.deviceId) : [];
}


/**
 * Restore pairing link colors from prod ``slot_id`` on each calib bbox.
 * ``replace`` — full prod snapshot (calib load). ``merge`` — fill gaps after client slots race.
 */
export function hydratePairingLinksFromDbCalibration(
  state: AutocalibRootState,
  mode: 'replace' | 'merge' = 'replace',
): number {
  if (!state.calib.calibrationLoadedFromDb || state.calib.bboxes.length === 0) {
    return 0;
  }
  const prodLinks = pairingLinksFromDbBboxes(state.calib.bboxes).filter((link) =>
    link.slotId in (state.calib.calibrationDbSlots ?? {}),
  );
  if (prodLinks.length === 0) return 0;

  const displaySlotIds = new Set(
    absmapDisplaySlotsFromDomain(state.absmap)
      .map((s) => s.slot_id.trim())
      .filter(Boolean),
  );
  let applied = 0;

  if (mode === 'replace') {
    state.pairing.pairingBySlotId = {};
    for (const link of prodLinks) {
      state.pairing.pairingBySlotId[link.slotId] = link.bboxSpotId;
    }
    applied = prodLinks.length;
  } else {
    const linkedSpots = new Set(Object.values(state.pairing.pairingBySlotId));
    for (const link of prodLinks) {
      if (state.pairing.pairingBySlotId[link.slotId] != null) continue;
      if (linkedSpots.has(link.bboxSpotId)) continue;
      state.pairing.pairingBySlotId[link.slotId] = link.bboxSpotId;
      linkedSpots.add(link.bboxSpotId);
      applied += 1;
    }
  }

  if (applied > 0) {
    syncPairingLinksFromRoot(state);
    prunePairingLinksOrphans(state);
    log.info(
      `Pairing hydrated from prod: ${applied} link(s) (${mode})`,
    );
    log.debug('hydratePairingLinksFromDb', {
      mode,
      prodLinks: prodLinks.length,
      applied,
      displaySlotPool: displaySlotIds.size,
      onMap: prodLinks.filter((l) => displaySlotIds.has(l.slotId)).length,
    });
  }
  return applied;
}

/** Remove zone lasso overlays after pairing is saved; keeps links and slot assignments. */
export function clearPairingZoneOverlays(pairing: PairingState): void {
  pairing.zones = [];
  pairing.drawingMapPoints = [];
  pairing.drawingImagePoints = [];
  pairing.activeZoneId = null;
  pairing.activeZoneSide = null;
  pairing.activeTool = 'none';
  pairing.suggestion = null;
  pairing.zoneMismatchError = null;
  pairing.autoSuggest = null;
  log.info('[pairing] Zone lassos cleared after save');
}

/** Drop pairing links / zone bbox refs that no longer exist in calib.bboxes. */
export function prunePairingLinksOrphans(state: AutocalibRootState) {
  const ids = new Set(state.calib.bboxes.map((b) => b.spot_id));
  for (const slotId of Object.keys(state.pairing.pairingBySlotId)) {
    const spotId = state.pairing.pairingBySlotId[slotId];
    if (spotId == null || !ids.has(spotId)) {
      delete state.pairing.pairingBySlotId[slotId];
    }
  }
  syncPairingLinksFromRoot(state);
  for (const z of state.pairing.zones) {
    z.imageBboxIds = z.imageBboxIds.filter((id) => ids.has(id));
  }
  const sel = state.pairing.selectedBboxId;
  if (sel != null && !ids.has(sel)) {
    state.pairing.selectedBboxId = null;
  }
}

export function applyDeviceCalibrationFromDb(
  state: AutocalibRootState,
  payload: DeviceCalibrationResponse,
  client: string,
  deviceId: string,
): void {
  state.calib.client = client;
  state.calib.deviceId = deviceId;
  state.calib.imageWidth = payload.image_width;
  state.calib.imageHeight = payload.image_height;
  state.calib.streetName = payload.street_name ?? null;
  state.calib.calibrationDbSlots = payload.slots ?? {};
  state.calib.calibrationDbBboxKeys = payload.bboxes
    .map((b) => (b.slot_id ?? '').trim() || String(b.spot_id).trim())
    .filter(Boolean);
  state.calib.calibrationDbBboxesByKey = buildCalibrationBboxesByKey(payload.bboxes);
  state.calib.calibrationDbBboxMeta = buildCalibBboxProdMetaFromLoad(payload.bboxes);
  state.calib.prodPairingBySlotId = prodPairingBySlotIdFromDb(
    payload.bboxes,
    payload.slots ?? {},
  );
  state.calib.calibrationLoadedFromDb = true;
  state.calib.bboxes = payload.bboxes.map((b) => ({ ...b }));
  state.calib.frameCount = payload.bboxes.length > 0 ? 1 : 0;
  state.calib.activeFrameIndex = -1;
  state.calib.totalDetections = payload.bboxes.length;
  state.calib.jobStatus = payload.bboxes.length > 0 ? 'done' : 'idle';
  state.calib.jobId = payload.bboxes.length > 0 ? 'db-static' : null;
  state.calib.jobError = null;
  state.calib.jobProgress = null;
  state.calib.editHistory = [];
  state.calib.editIndex = 0;
  state.calib.lockedBboxIds = [];
  state.calib.selectedBboxIds = [];
  state.calib.editMode = 'none';
  state.calib.showCalibEditorResult = payload.bboxes.length > 0;
  state.calib.lastCalibSubmitConfidenceThreshold =
    payload.bboxes.length > 0 ? state.calib.confidenceThreshold : null;
  state.calib.sessionRevision += 1;

  const hydrateMode =
    Object.keys(state.pairing.pairingBySlotId).length > 0 ? 'merge' : 'replace';
  hydratePairingLinksFromDbCalibration(state, hydrateMode);
}

export function truncateFuture(state: AbsmapDomainState) {
  if (state.editIndex < state.editHistory.length) {
    state.editHistory = state.editHistory.slice(0, state.editIndex);
  }
}

/** Manual edits without Launch still need a job id for the learning-loop sidecar. */
export function ensureManualSessionJob(state: AbsmapDomainState): void {
  const status = state.job?.status;
  if (status === 'running' || status === 'pending') return;
  if (!state.job?.id) {
    state.job = { id: uuid(), status: 'done' };
    log.info(`Manual absmap session ${state.job.id.slice(0, 8)}… (no pipeline job)`);
    return;
  }
  if (status !== 'done' && status !== 'failed') {
    state.job = { ...state.job, status: 'done' };
  }
}

export function markAbsmapDirty(state: AbsmapDomainState): void {
  ensureManualSessionJob(state);
  state.isDirty = true;
  state.slotMapDisplayMode = 'workspace';
}

export function cloneSlotForHistory(slot: Slot): Slot {
  return { ...slot };
}

export function cloneCropForHistory(crop: CropRequest): CropRequest {
  return {
    polygon: JSON.parse(JSON.stringify(crop.polygon)) as GeoJSON.Polygon,
    hints: crop.hints,
  };
}

export function applyCropsSnapshot(
  state: AbsmapDomainState,
  crops: CropRequest[] | undefined,
  syncVisibility = false,
) {
  if (crops === undefined) return;
  state.crops = crops.map(cloneCropForHistory);
  if (syncVisibility) {
    state.overlayVisibility.roi = state.crops.length > 0;
  }
}

/** Fold every committed `crops` edit into the pipeline launch snapshot (one undo/redo step). */
export function absorbCropEventsFromHistory(state: AbsmapDomainState): {
  launchCrops: CropRequest[];
  cropsBeforeDraw: CropRequest[];
} {
  let launchCrops = state.crops.map(cloneCropForHistory);
  let cropsBeforeDraw: CropRequest[] | undefined;
  const kept: EditEvent[] = [];
  for (let i = 0; i < state.editIndex; i++) {
    const evt = state.editHistory[i]!;
    if (evt.type === 'crops') {
      if (cropsBeforeDraw === undefined) {
        cropsBeforeDraw = evt.crops_before?.map(cloneCropForHistory) ?? [];
      }
      launchCrops = evt.crops_after?.map(cloneCropForHistory) ?? launchCrops;
      continue;
    }
    kept.push(evt);
  }
  state.editHistory = [...kept, ...state.editHistory.slice(state.editIndex)];
  state.editIndex = kept.length;
  return {
    launchCrops,
    cropsBeforeDraw: cropsBeforeDraw ?? launchCrops.map(cloneCropForHistory),
  };
}

/** Merge consecutive manual `add` events (not tile_row) into one undo step. */
export function coalesceTrailingAddEvents(state: AbsmapDomainState): void {
  if (state.editIndex <= 0) return;
  let start = state.editIndex;
  while (start > 0 && state.editHistory[start - 1]?.type === 'add') {
    start -= 1;
  }
  const runLength = state.editIndex - start;
  if (runLength <= 1) return;

  const chunk = state.editHistory.slice(start, state.editIndex);
  const merged: EditEvent = {
    type: 'add',
    timestamp: chunk[chunk.length - 1]!.timestamp,
    slot_ids: chunk.flatMap((e) => e.slot_ids),
    before: [],
    after: chunk.flatMap((e) => e.after.map(cloneSlotForHistory)),
  };
  state.editHistory = [
    ...state.editHistory.slice(0, start),
    merged,
    ...state.editHistory.slice(state.editIndex),
  ];
  state.editIndex = start + 1;
  log.info(`Coalesced ${runLength} add(s) into one undo step (${merged.after.length} slots)`);
}

/** Merge consecutive `crops` events so one Undo clears every ROI drawn in a row. */
export function coalesceTrailingCropEvents(state: AbsmapDomainState): void {
  if (state.editIndex <= 0) return;
  let start = state.editIndex;
  while (start > 0 && state.editHistory[start - 1]?.type === 'crops') {
    start -= 1;
  }
  const runLength = state.editIndex - start;
  if (runLength <= 1) return;

  const chunk = state.editHistory.slice(start, state.editIndex);
  const merged: EditEvent = {
    type: 'crops',
    timestamp: chunk[chunk.length - 1]!.timestamp,
    slot_ids: [],
    before: [],
    after: [],
    crops_before: chunk[0]!.crops_before?.map(cloneCropForHistory) ?? [],
    crops_after: chunk[chunk.length - 1]!.crops_after?.map(cloneCropForHistory) ?? [],
  };
  state.editHistory = [
    ...state.editHistory.slice(0, start),
    merged,
    ...state.editHistory.slice(state.editIndex),
  ];
  state.editIndex = start + 1;
  log.info(`Coalesced ${runLength} crop(s) into one undo step (${merged.crops_after?.length ?? 0} ROI)`);
}

export function recordCropHistory(state: AbsmapDomainState, cropsBefore: CropRequest[]) {
  truncateFuture(state);
  const cropsAfter = state.crops.map(cloneCropForHistory);
  const last = state.editIndex > 0 ? state.editHistory[state.editIndex - 1] : undefined;
  if (last?.type === 'crops') {
    last.crops_after = cropsAfter;
    last.timestamp = Date.now();
    return;
  }
  const evt: EditEvent = {
    type: 'crops',
    timestamp: Date.now(),
    slot_ids: [],
    before: [],
    after: [],
    crops_before: cropsBefore.map(cloneCropForHistory),
    crops_after: cropsAfter,
  };
  state.editHistory.push(evt);
  state.editIndex++;
}

export function isPipelineLoadEvent(evt: EditEvent): boolean {
  return evt.type === 'modify' && evt.baseline_after !== undefined;
}

export function capturePipelineOverlaysSnapshot(state: AbsmapDomainState): PipelineOverlaysSnapshot {
  return {
    detection: state.detectionOverlay,
    postprocess: state.postprocessOverlay,
    visibility: { ...state.overlayVisibility },
  };
}

export function applyPipelineOverlaysSnapshot(
  state: AbsmapDomainState,
  snap: PipelineOverlaysSnapshot | undefined,
): void {
  if (!snap) {
    state.detectionOverlay = null;
    state.postprocessOverlay = null;
    state.overlayVisibility = defaultOverlayVisibility();
    return;
  }
  state.detectionOverlay = snap.detection;
  state.postprocessOverlay = snap.postprocess;
  state.overlayVisibility = {
    ...defaultOverlayVisibility(),
    ...snap.visibility,
  };
}

export function applyBaselineSnapshot(state: AbsmapDomainState, baseline: Slot[] | undefined) {
  if (baseline === undefined) return;
  state.baselineSlots = baseline.map(cloneSlotForHistory);
}

export function removeAllSlotsByIds(state: AbsmapDomainState, slotIds: Iterable<string>): void {
  const idSet = new Set(slotIds);
  if (idSet.size === 0) return;
  state.slots = state.slots.filter((s) => !idSet.has(slotKey(s)));
}

export function upsertWorkingSlot(state: AbsmapDomainState, slot: Slot): void {
  const cloned = cloneSlotForHistory(slot);
  const key = slotKey(slot);
  const idx = state.slots.findIndex((s) => slotKey(s) === key);
  if (idx !== -1) {
    state.slots[idx] = cloned;
  } else {
    state.slots.push(cloned);
  }
}

export function applyEvent(state: AbsmapDomainState, evt: EditEvent) {
  if (evt.type !== 'crops') {
    const idsToRemove =
      evt.type === 'align'
        ? [
            ...evt.before.map((s) => slotKey(s)),
            ...evt.after.map((s) => slotKey(s)),
          ]
        : evt.before.map((s) => slotKey(s));
    removeAllSlotsByIds(state, idsToRemove);
    for (const slot of evt.after) {
      upsertWorkingSlot(state, slot);
    }
    applyBaselineSnapshot(state, evt.baseline_after);
  }
  if (evt.type === 'crops') {
    applyCropsSnapshot(state, evt.crops_after, true);
  } else if (isPipelineLoadEvent(evt)) {
    applyCropsSnapshot(state, evt.crops_after ?? [], true);
    applyPipelineOverlaysSnapshot(state, evt.pipeline_overlays_after);
  }
}

export function reverseEvent(state: AbsmapDomainState, evt: EditEvent) {
  if (evt.type !== 'crops') {
    removeAllSlotsByIds(state, evt.after.map((s) => slotKey(s)));
    for (const slot of evt.before) {
      upsertWorkingSlot(state, slot);
    }
    applyBaselineSnapshot(state, evt.baseline_before);
  }
  if (evt.type === 'crops') {
    applyCropsSnapshot(state, evt.crops_before, true);
  } else if (isPipelineLoadEvent(evt)) {
    applyCropsSnapshot(state, evt.crops_before, true);
    applyPipelineOverlaysSnapshot(state, evt.pipeline_overlays_before);
  }
}

export function clearTileRowWizard(state: AbsmapDomainState) {
  state.tileRowROI = null;
  state.tileRowSeeds = [];
  state.tileRowProposed = [];
}

/** Editable working set sent to straighten (pipeline + gap_fill + manual extend/clone). */
export function slotsSnapshotForStraighten(slots: Slot[], baselineSlots: Slot[]): Slot[] {
  return activeSessionSlots(slots, baselineSlots).map((s) => ({
    ...s,
    slot_id: slotKey(s),
  }));
}

function mergeStraightenProposal(proposed: Slot, existing: Slot | undefined): Slot {
  if (!existing) return proposed;
  const merged = {
    ...proposed,
    obbAngle: existing.obbAngle ?? proposed.obbAngle,
  };
  if (!existing.slot_id.trim()) {
    return {
      ...merged,
      slot_id: '',
      _draftKey: existing._draftKey ?? proposed.slot_id,
    };
  }
  return merged;
}

export function commitStraightenAligned(state: AbsmapDomainState, proposed: Slot[]) {
  truncateFuture(state);
  const working = activeSessionSlots(state.slots, state.baselineSlots);
  const workingByKey = new Map(working.map((s) => [slotKey(s), s]));

  const aligned = proposed.map((p) => mergeStraightenProposal(p, workingByKey.get(p.slot_id)));

  const { kept: alignedKept, droppedIds } = dropManualSlotsRedundantWithPipeline(
    aligned,
    working,
  );
  const alignedByKey = new Map(alignedKept.map((s) => [slotKey(s), s]));

  const touchedIds = new Set([
    ...aligned.map((s) => slotKey(s)),
    ...droppedIds,
  ]);
  const beforeSlots: Slot[] = [];
  for (const id of touchedIds) {
    const existing = workingByKey.get(id);
    if (existing) beforeSlots.push(cloneSlotForHistory(existing));
  }

  const baselineBefore = state.baselineSlots.map(cloneSlotForHistory);
  const baselineAfter = state.baselineSlots.map((s) => {
    const updated = alignedByKey.get(slotKey(s));
    return updated ? cloneSlotForHistory(updated) : cloneSlotForHistory(s);
  });

  const afterSlots = alignedKept.map(cloneSlotForHistory);
  const evt: EditEvent = {
    type: 'align',
    timestamp: Date.now(),
    slot_ids: afterSlots.map((s) => s.slot_id),
    before: beforeSlots,
    after: afterSlots,
    baseline_before: baselineBefore,
    baseline_after: baselineAfter,
  };
  state.editHistory.push(evt);
  state.editIndex++;
  applyEvent(state, evt);
  markAbsmapDirty(state);
  const droppedNote =
    droppedIds.length > 0
      ? ` (${droppedIds.length} redundant manual slot(s) removed)`
      : '';
  log.info(`Straighten applied: ${afterSlots.length} slots aligned${droppedNote}`);
}




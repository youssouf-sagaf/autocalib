import { createAction, isAnyOf, type UnknownAction } from '@reduxjs/toolkit';
import { produce, type Draft } from 'immer';
import i18n from '../i18n/config';
import { showAlertModal } from '../ui/AlertModal';
import type { ActiveClientSelection, EditEvent, PairingZonePolygon, Slot } from '../types';
import { normalizeSlotParkingType } from '../theme/slotTypes';
import { absmapDisplaySlotsFromDomain } from '../utils/absmapDisplaySlots';
import { bboxesForCalibrationSave, prodPairingBySlotIdFromDb } from '../utils/calibrationDb';
import { buildRowPolygon, findBestClusters } from '../utils/rowClustering';
import { ensureDraftSlot } from '../utils/slot-key';
import {
  excludeSlotsOverlappingExisting,
  mergePipelineSlots,
  mergeSlotsForPlacementHints,
} from '../utils/slot-geometry';
import {
  activeClientDirectoryKey,
  clientDirectoryKey,
  resolveClientFromDirectoryKey,
  syncWorkspaceClientFromDirectory,
} from '../utils/clientContext';
import {
  markAllSessionNotificationsRead as applyMarkAllSessionNotificationsRead,
  markSessionNotificationRead as applyMarkSessionNotificationRead,
  pushSessionNotification,
  reloadSessionNotifications,
  type NewSessionNotification,
} from '../features/notifications/session-notifications';
import {
  applyActiveClient,
  applyDeviceCalibrationFromDb,
  calibInitial,
  cloneSlotForHistory,
  coalesceTrailingAddEvents,
  coalesceTrailingCropEvents,
  commitStraightenAligned,
  defaultOverlayVisibility,
  ensureManualSessionJob,
  log,
  markAbsmapDirty,
  markStepDone,
  mergePipelineOverlay,
  clearPairingZoneOverlays,
  hydratePairingLinksFromDbCalibration,
  openSaveFeedback,
  prunePairingLinksOrphans,
  pushRecentClient,
  pushRecentDevice,
  resetWorkspaceStacksForDeviceChange,
  saveContextToStorage,
  syncPairingLinksFromRoot,
  truncateFuture,
  absorbCropEventsFromHistory,
  capturePipelineOverlaysSnapshot,
  cloneCropForHistory,
} from './slices/shared';
import { resetAbsmapDirtyTracking } from '../utils/absmap-dirty';
import { cloneSlotsSnapshot } from '../utils/slot-delta';
import type { AutoSuggestProposal } from './autocalib-state-types';
import type { AutocalibRootState } from './slices/nested-state';
import type { FetchJobResultReject, FetchJobResultArg } from './autocalib-thunks';
import { parseFetchJobResultArg } from './autocalib-thunks';
import {
  submitCalibJob,
  fetchCalibResult,
  hydrateCalibFromLocalCache,
  loadDeviceCalibration,
  saveDeviceCalibration,
  savePairings,
  launchJob,
  saveSlotsToB2b,
  loadClientSlots,
  fetchJobResult,
  reprocessArea,
  straightenRow,
  fetchClients,
} from './autocalib-thunks';
import {
  calibRemoveBbox,
  calibBulkRemove,
  calibUndo,
  calibRedo,
} from './slices/calib-slice';

export const beginSaveProdDisplay = createAction('autocalib/beginSaveProdDisplay');

export const setActiveClient = createAction<ActiveClientSelection | string>('autocalib/setActiveClient');
export const setDeviceContext = createAction<{
  clientId: string;
  clientName: string;
  deviceId: string;
  label?: string;
}>('autocalib/setDeviceContext');

export const markSessionNotificationRead = createAction<string>(
  'autocalib/markSessionNotificationRead',
);
export const markAllSessionNotificationsRead = createAction(
  'autocalib/markAllSessionNotificationsRead',
);
export const pairingAutoSuggestZoneDrawn = createAction<{
  side: 'map' | 'image';
  polygon: PairingZonePolygon;
  slotIds: string[];
  bboxIds: number[];
}>('autocalib/pairingAutoSuggestZoneDrawn');

const CALIB_PRUNE_SYNC = isAnyOf(calibRemoveBbox, calibBulkRemove, calibUndo, calibRedo);

function sessionNotifHost(draft: Draft<AutocalibRootState>) {
  return { context: draft.context, sessionNotifications: draft.ui.sessionNotifications };
}

function notifySession(draft: Draft<AutocalibRootState>, item: NewSessionNotification): void {
  pushSessionNotification(sessionNotifHost(draft), {
    ...item,
    createdAt: item.createdAt ?? new Date().toISOString(),
  });
}

function handlePairingAutoSuggestZoneDrawn(
  draft: Draft<AutocalibRootState>,
  action: ReturnType<typeof pairingAutoSuggestZoneDrawn>,
): void {
  if (!draft.pairing.autoSuggestMode) return;
  const { side, polygon, slotIds, bboxIds } = action.payload;
  const count = side === 'map' ? slotIds.length : bboxIds.length;
  if (count === 0) {
    draft.pairing.zoneMismatchError = 'Zone is empty — draw around some items.';
    draft.pairing.autoSuggest = null;
    return;
  }

  const MAX_PROPOSALS = 3;
  const MAP_PAD_LNG = 0.00003;
  const MAP_PAD_LAT = 0.00002;
  const IMG_PAD_X = 15;
  const IMG_PAD_Y = 15;

  const alreadyPairedSlots = new Set(draft.pairing.links.map((l) => l.slotId));
  const alreadyPairedBboxes = new Set(draft.pairing.links.map((l) => l.bboxSpotId));

  let proposals: AutoSuggestProposal[];

  if (side === 'map') {
    const availableBboxes = draft.calib.bboxes.filter((b) => !alreadyPairedBboxes.has(b.spot_id));
    const clusters = findBestClusters(
      availableBboxes,
      count,
      (b) => b.center_x,
      (b) => b.center_y,
      MAX_PROPOSALS,
    );
    proposals = clusters.map((group) => {
      const sorted = [...group].sort((a, b) => a.center_x - b.center_x || a.center_y - b.center_y);
      const imgPoints: [number, number][] = sorted.map((b) => [b.center_x, b.center_y]);
      return {
        mapSlotIds: slotIds,
        imageBboxIds: sorted.map((b) => b.spot_id),
        mapPolygon: polygon,
        imagePolygon: { points: buildRowPolygon(imgPoints, IMG_PAD_X, IMG_PAD_Y) },
      };
    });
  } else {
    const availableSlots = absmapDisplaySlotsFromDomain(draft.absmap).filter(
      (s) => !alreadyPairedSlots.has(s.slot_id),
    );
    const clusters = findBestClusters(
      availableSlots,
      count,
      (s) => s.center.lng,
      (s) => -s.center.lat,
      MAX_PROPOSALS,
    );
    proposals = clusters.map((group) => {
      const sorted = [...group].sort((a, b) => a.center.lng - b.center.lng || a.center.lat - b.center.lat);
      const mapPoints: [number, number][] = sorted.map((s) => [s.center.lng, s.center.lat]);
      return {
        mapSlotIds: sorted.map((s) => s.slot_id),
        imageBboxIds: bboxIds,
        mapPolygon: { points: buildRowPolygon(mapPoints, MAP_PAD_LNG, MAP_PAD_LAT) },
        imagePolygon: polygon,
      };
    });
  }

  if (proposals.length === 0) {
    draft.pairing.zoneMismatchError = `No matching group of ${count} items found on the other side.`;
    draft.pairing.autoSuggest = null;
    return;
  }

  draft.pairing.autoSuggest = {
    drawnSide: side,
    drawnSlotIds: slotIds,
    drawnBboxIds: bboxIds,
    drawnPolygon: polygon,
    proposals,
    proposalIndex: 0,
    maxAttempts: MAX_PROPOSALS,
  };
  draft.pairing.drawingMapPoints = [];
  draft.pairing.drawingImagePoints = [];
  draft.pairing.activeTool = 'none';
  log.info(`Auto-suggest: ${proposals.length} proposals for ${count} items (${side} side)`);
}

function backupAbsmapPreSave(draft: Draft<AutocalibRootState>): void {
  if (draft.absmap.preSaveBackup) return;
  draft.absmap.preSaveBackup = {
    slots: draft.absmap.slots.map(cloneSlotForHistory),
    dirtyProdSlotIds: [...draft.absmap.dirtyProdSlotIds],
    deletedProdIds: [...draft.absmap.deletedProdIds],
  };
}

function applyProdDisplay(draft: Draft<AutocalibRootState>, slots: Slot[]): void {
  const normalized = slots.map(normalizeSlotParkingType);
  draft.absmap.slotMapDisplayMode = 'prod';
  draft.absmap.slots = normalized;
  draft.absmap.baselineSlots = [];
  draft.absmap.b2bSnapshotAtLoad = cloneSlotsSnapshot(normalized);
  draft.absmap.isDirty = false;
  resetAbsmapDirtyTracking(draft.absmap);
}

function handleCrossSyncReducers(draft: Draft<AutocalibRootState>, action: UnknownAction): boolean {
  if (beginSaveProdDisplay.match(action)) {
    backupAbsmapPreSave(draft);
    return true;
  }
  if (setActiveClient.match(action)) {
    const payload =
      typeof action.payload === 'string'
        ? resolveClientFromDirectoryKey(action.payload, draft.directory.clients)
        : action.payload;
    applyActiveClient(draft, payload);
    return true;
  }
  if (setDeviceContext.match(action)) {
    const prevKey = activeClientDirectoryKey(draft.context);
    const prevDeviceId = draft.context.deviceId;
    const clientId = action.payload.clientId.trim();
    const clientName = action.payload.clientName.trim();
    const directoryKey = clientDirectoryKey(clientId, clientName);
    const deviceId = action.payload.deviceId.trim();
    const { label } = action.payload;
    if (!directoryKey || !deviceId) return true;
    const cocospotSwitched =
      Boolean(prevDeviceId) &&
      (prevDeviceId !== deviceId || prevKey !== directoryKey);
    if (cocospotSwitched) {
      resetWorkspaceStacksForDeviceChange(draft);
    }
    draft.context.clientId = clientId;
    draft.context.clientName = clientName;
    draft.context.deviceId = deviceId;
    draft.context.recentClients = pushRecentClient(draft.context.recentClients ?? [], directoryKey);
    draft.context.recentDevices = pushRecentDevice(
      draft.context.recentDevices,
      directoryKey,
      deviceId,
      label,
    );
    draft.calib.client = clientName || clientId;
    draft.calib.deviceId = deviceId;
    saveContextToStorage(draft.context);
    reloadSessionNotifications(sessionNotifHost(draft));
    return true;
  }
  if (markSessionNotificationRead.match(action)) {
    applyMarkSessionNotificationRead(
      { context: draft.context, sessionNotifications: draft.ui.sessionNotifications },
      action.payload,
    );
    return true;
  }
  if (markAllSessionNotificationsRead.match(action)) {
    applyMarkAllSessionNotificationsRead({
      context: draft.context,
      sessionNotifications: draft.ui.sessionNotifications,
    });
    return true;
  }
  if (pairingAutoSuggestZoneDrawn.match(action)) {
    handlePairingAutoSuggestZoneDrawn(draft, action);
    return true;
  }
  return false;
}


export function crossSliceReducer(
  state: AutocalibRootState,
  action: UnknownAction,
  _prevState?: AutocalibRootState,
): AutocalibRootState {
  return produce(state, (draft) => {
    if (handleCrossSyncReducers(draft, action)) {
      if (CALIB_PRUNE_SYNC(action)) prunePairingLinksOrphans(draft);
      return;
    }

    // Thunk extra reducers (migrated from monolithic slice)
    applyThunkExtraReducers(draft, action);

    if (CALIB_PRUNE_SYNC(action)) {
      prunePairingLinksOrphans(draft);
    }
  });
}


function applyThunkExtraReducers(draft: Draft<AutocalibRootState>, action: UnknownAction): void {

  if (fetchClients.fulfilled.match(action)) {
    const synced = syncWorkspaceClientFromDirectory(draft.context, action.payload);
    if (
      synced.clientId !== draft.context.clientId ||
      synced.clientName !== draft.context.clientName
    ) {
      applyActiveClient(draft, synced);
    }
  }


  if (submitCalibJob.pending.match(action)) {

        draft.calib.jobStatus = 'pending';
        draft.calib.jobError = null;
        draft.calib.jobProgress = null;
        draft.calib.lastCalibSubmitConfidenceThreshold = draft.calib.confidenceThreshold;
      
  }

  if (submitCalibJob.fulfilled.match(action)) {

        draft.calib.jobId = action.payload.id;
        draft.calib.jobStatus = 'pending';
      
  }

  if (submitCalibJob.rejected.match(action)) {

        draft.calib.jobStatus = 'failed';
        draft.calib.jobError = action.error.message ?? 'Failed to submit calib job';
        draft.calib.lastCalibSubmitConfidenceThreshold = null;
      
  }

  if (fetchCalibResult.fulfilled.match(action)) {

        draft.calib.bboxes = action.payload.calib_bboxes;
        draft.calib.frameCount = action.payload.frame_count;
        draft.calib.totalDetections = action.payload.total_detections;
        draft.calib.jobStatus = 'done';
        draft.calib.jobError = null;
        draft.calib.jobProgress = null;
        draft.calib.editHistory = [];
        draft.calib.editIndex = 0;
        draft.calib.lockedBboxIds = [];
        draft.calib.selectedBboxIds = [];
        const ctxClient = draft.context.clientName || draft.context.clientId;
        const ctxDeviceId = draft.context.deviceId;
        if (ctxClient) draft.calib.client = ctxClient;
        if (ctxDeviceId) draft.calib.deviceId = ctxDeviceId;
        prunePairingLinksOrphans(draft);
        draft.calib.sessionRevision += 1;
        draft.calib.lastCalibSubmitConfidenceThreshold = draft.calib.confidenceThreshold;
        const directoryKey = activeClientDirectoryKey(draft.context);
        const deviceId = draft.calib.deviceId || draft.context.deviceId;
        draft.context.recentDevices = markStepDone(
          draft.context.recentDevices, directoryKey, deviceId, 'calib',
        );
        saveContextToStorage(draft.context);
      
  }

  if (fetchCalibResult.rejected.match(action)) {

        draft.calib.jobStatus = 'failed';
        draft.calib.jobError = action.error.message ?? 'Failed to fetch result';
        draft.calib.lastCalibSubmitConfidenceThreshold = null;
      
  }

  if (hydrateCalibFromLocalCache.fulfilled.match(action)) {

        const { client, deviceId } = action.meta.arg;
        const { snap, revisionAtDispatch } = action.payload;

        if (activeClientDirectoryKey(draft.context) !== client || draft.context.deviceId !== deviceId) {
          return;
        }

        if (revisionAtDispatch !== draft.calib.sessionRevision) {
          if (client) draft.calib.client = draft.calib.client || client;
          if (deviceId) draft.calib.deviceId = draft.calib.deviceId || deviceId;
          return;
        }

        if (!snap) {
          draft.calib = { ...calibInitial, client, deviceId };
          return;
        }

        draft.calib.calibrationLoadedFromDb = false;
        draft.calib.client = client;
        draft.calib.deviceId = deviceId;
        draft.calib.bboxes = snap.bboxes;
        draft.calib.frameCount = snap.frameCount;
        draft.calib.totalDetections = snap.totalDetections;
        draft.calib.jobId = snap.jobId;
        if (snap.bboxes.length > 0) {
          draft.calib.jobStatus = 'done';
        } else {
          const stale = snap.jobStatus === 'pending' || snap.jobStatus === 'running';
          draft.calib.jobStatus = stale || snap.jobStatus === 'failed' ? 'idle' : snap.jobStatus;
        }
        draft.calib.activeFrameIndex = snap.activeFrameIndex;
        draft.calib.lockedBboxIds = snap.lockedBboxIds;
        draft.calib.editHistory = snap.editHistory;
        draft.calib.editIndex = snap.editIndex;
        draft.calib.confidenceThreshold = snap.confidenceThreshold;
        draft.calib.canvasZoom = snap.canvasZoom;
        draft.calib.canvasPanX = snap.canvasPanX;
        draft.calib.canvasPanY = snap.canvasPanY;
        draft.calib.editMode = 'none';
        draft.calib.selectedBboxIds = [];
        draft.calib.jobProgress = null;
        draft.calib.jobError = null;
        prunePairingLinksOrphans(draft);
        if (draft.calib.jobStatus === 'done' && draft.calib.bboxes.length > 0) {
          draft.calib.lastCalibSubmitConfidenceThreshold = draft.calib.confidenceThreshold;
        } else {
          draft.calib.lastCalibSubmitConfidenceThreshold = null;
        }
        draft.calib.showCalibEditorResult = snap.bboxes.length > 0;
      
  }

  if (loadDeviceCalibration.pending.match(action)) {
    draft.calib.calibrationLoading = true;
  }

  if (loadDeviceCalibration.fulfilled.match(action)) {

        draft.calib.calibrationLoading = false;
        const { client, deviceId, revisionAtDispatch, source } = action.payload;
        if (activeClientDirectoryKey(draft.context) !== client || draft.context.deviceId !== deviceId) {
          return;
        }
        const dbPayload = source === 'db' ? action.payload.data : null;
        const revisionStale = revisionAtDispatch !== draft.calib.sessionRevision;
        if (revisionStale) {
          const canApplyStaleDb =
            dbPayload &&
            dbPayload.bboxes.length > 0 &&
            !draft.calib.calibrationLoadedFromDb &&
            draft.calib.bboxes.length === 0;
          if (!canApplyStaleDb) return;
        }
        if (dbPayload) {
          applyDeviceCalibrationFromDb(draft, dbPayload, client, deviceId);
        }
      
  }

  if (loadDeviceCalibration.rejected.match(action)) {

        draft.calib.calibrationLoading = false;
        log.error(`Load device calibration failed: ${action.error.message}`);
      
  }

  if (saveDeviceCalibration.pending.match(action)) {

        draft.calib.isSavingCalibration = true;
      
  }

  if (saveDeviceCalibration.fulfilled.match(action)) {

        draft.calib.isSavingCalibration = false;
        draft.calib.calibrationLoadedFromDb = true;
        draft.calib.calibrationDbSlots = action.payload.savedSlots;
        draft.calib.calibrationDbBboxKeys = action.payload.savedBboxKeys;
        draft.calib.calibrationDbBboxesByKey = action.payload.savedBboxesByKey;
        draft.calib.calibrationDbBboxMeta = action.payload.savedBboxMeta;
        if (action.payload.pairingSave) {
          const savedPairing = { ...draft.pairing.pairingBySlotId };
          draft.calib.bboxes = bboxesForCalibrationSave(draft.calib.bboxes, savedPairing);
          draft.calib.prodPairingBySlotId = prodPairingBySlotIdFromDb(
            draft.calib.bboxes,
            action.payload.savedSlots,
          );
          clearPairingZoneOverlays(draft.pairing);
          draft.pairing.pairingBySlotId = { ...savedPairing };
          syncPairingLinksFromRoot(draft);
        } else {
          draft.calib.prodPairingBySlotId = prodPairingBySlotIdFromDb(
            draft.calib.bboxes,
            action.payload.savedSlots,
          );
        }
        if (action.payload.removedBboxKeys.length > 0) {
          log.info(
            `[calib] Prod delete: ${action.payload.removedBboxKeys.length} bbox key(s) removed for ${action.payload.deviceId}`,
          );
        }
        const directoryKey = activeClientDirectoryKey(draft.context);
        draft.context.recentDevices = markStepDone(
          draft.context.recentDevices,
          directoryKey,
          action.payload.deviceId,
          'calib',
        );
        saveContextToStorage(draft.context);
        openSaveFeedback(draft, {
          variant: 'success',
          summary: action.payload.saveSummary,
          deletedBboxCount: action.payload.removedBboxKeys.length,
          deletedBboxKeys: action.payload.removedBboxKeys,
          deletedBboxLabels: action.payload.removedBboxLabels,
        });
        notifySession(draft, {
          category: 'save',
          titleKey: 'notifications.events.calibSaved',
          titleParams: { count: action.payload.bboxCount },
        });
      
  }

  if (saveDeviceCalibration.rejected.match(action)) {

        draft.calib.isSavingCalibration = false;
        log.error(`Save calibration failed: ${action.error.message}`);
        openSaveFeedback(draft, {
          variant: 'error',
          errorMessage: action.error.message ?? i18n.t('saveFeedback.calib.error.subtitle'),
        });
        notifySession(draft, {
          category: 'error',
          titleKey: 'notifications.events.calibSaveFailed',
        });
      
  }

  if (savePairings.fulfilled.match(action)) {

        const directoryKey = activeClientDirectoryKey(draft.context);
        const deviceId = action.payload.device_id;
        draft.context.recentDevices = markStepDone(
          draft.context.recentDevices, directoryKey, deviceId, 'pairing',
        );
        saveContextToStorage(draft.context);
      
  }

  if (savePairings.rejected.match(action)) {

        log.error(`Save pairings failed: ${action.error.message}`);
        openSaveFeedback(draft, {
          variant: 'error',
          errorMessage: action.error.message ?? i18n.t('saveFeedback.pairing.error.subtitle'),
        });
      
  }

  if (launchJob.pending.match(action)) {

        draft.absmap.job = { id: '', status: 'pending' };
        coalesceTrailingAddEvents(draft.absmap);
        coalesceTrailingCropEvents(draft.absmap);
        /* Keep slots + editHistory so Undo still works while the job runs. */
        draft.absmap.detectionOverlay = null;
        draft.absmap.postprocessOverlay = null;
        draft.absmap.overlayVisibility = defaultOverlayVisibility(draft.absmap.crops.length > 0);
      
  }

  if (launchJob.fulfilled.match(action)) {

        draft.absmap.job = action.payload;
        draft.absmap.overlayVisibility = defaultOverlayVisibility(draft.absmap.crops.length > 0);
      
  }

  if (launchJob.rejected.match(action)) {

        draft.absmap.job = {
          id: '',
          status: 'failed',
          error: action.error.message ?? 'Failed to submit job',
        };
      
  }

  if (saveSlotsToB2b.pending.match(action)) {

        draft.absmap.isSaving = true;
        draft.absmap.saveError = null;
        ensureManualSessionJob(draft.absmap);
        backupAbsmapPreSave(draft);
      
  }

  if (saveSlotsToB2b.fulfilled.match(action)) {

        draft.absmap.isSaving = false;
        if (action.payload.skipped) return;
        const { result, expectsCreates } = action.payload;
        const refreshed = (result.results as Slot[]).map(normalizeSlotParkingType);
        applyProdDisplay(draft, refreshed);
        draft.absmap.preSaveBackup = null;
        log.info(`[b2b] Save confirmed prod overlay — ${refreshed.length} slot(s)`);
        draft.absmap.lastSavedAt = new Date().toISOString();
        draft.absmap.saveError = result.warning ?? null;
        log.info(
          `[b2b] Save ok — create:${result.save_summary.created} update:${result.save_summary.updated} delete:${result.save_summary.deleted}`,
        );
        const summary = result.save_summary;
        if (result.warning) {
          openSaveFeedback(draft, {
            variant: 'warning',
            summary,
            errorMessage: result.warning,
          });
          notifySession(draft, {
            category: 'sync',
            titleKey: 'notifications.events.saveB2bFailed',
          });
        } else if (summary.created === 0 && expectsCreates) {
          openSaveFeedback(draft, { variant: 'empty', summary });
          notifySession(draft, {
            category: 'sync',
            titleKey: 'notifications.events.saveB2bNoCreates',
          });
        } else {
          openSaveFeedback(draft, { variant: 'success', summary });
          notifySession(draft, {
            category: 'save',
            titleKey: 'notifications.events.saveB2bSuccess',
            titleParams: { total: refreshed.length, created: summary.created },
          });
        }
      
  }

  if (loadClientSlots.pending.match(action)) {

        draft.absmap.isRefreshingReferenceOverlay = true;
      
  }

  if (loadClientSlots.fulfilled.match(action)) {

        draft.absmap.isRefreshingReferenceOverlay = false;
        if (draft.absmap.isDirty) return;
        const normalized = action.payload.map(normalizeSlotParkingType);
        draft.absmap.b2bSnapshotAtLoad = cloneSlotsSnapshot(normalized);
        // Hydrate baseline when the workspace is empty so prod slots are editable
        // (copy, modify, delete, straighten) without running a pipeline job first.
        if (
          normalized.length > 0
          && draft.absmap.slots.length === 0
          && draft.absmap.baselineSlots.length === 0
        ) {
          draft.absmap.baselineSlots = cloneSlotsSnapshot(normalized);
        }
        if (
          draft.calib.calibrationLoadedFromDb
          && draft.pairing.links.length === 0
          && draft.calib.bboxes.some((b) => (b.slot_id ?? '').trim())
        ) {
          hydratePairingLinksFromDbCalibration(draft, 'replace');
        }
      
  }

  if (loadClientSlots.rejected.match(action)) {

        draft.absmap.isRefreshingReferenceOverlay = false;
      
  }

  if (saveSlotsToB2b.rejected.match(action)) {

        draft.absmap.isSaving = false;
        const backup = draft.absmap.preSaveBackup;
        if (backup) {
          draft.absmap.slots = backup.slots;
          draft.absmap.dirtyProdSlotIds = backup.dirtyProdSlotIds;
          draft.absmap.deletedProdIds = backup.deletedProdIds;
          draft.absmap.isDirty = true;
          draft.absmap.slotMapDisplayMode = 'workspace';
          draft.absmap.preSaveBackup = null;
        }
        draft.absmap.saveError = action.error.message ?? 'Save failed';
        log.error(`[b2b] Save failed: ${draft.absmap.saveError}`);
        openSaveFeedback(draft, {
          variant: 'error',
          errorMessage: draft.absmap.saveError,
        });
        notifySession(draft, {
          category: 'error',
          titleKey: 'notifications.events.saveB2bFailed',
        });
      
  }

  if (fetchJobResult.fulfilled.match(action)) {

        const jobId = action.payload.job_id;
        draft.absmap.job = { id: jobId, status: 'done' };
        const slotsBefore = draft.absmap.slots.map(cloneSlotForHistory);
        const baselineBefore = draft.absmap.baselineSlots.map(cloneSlotForHistory);
        const overlaysBefore = capturePipelineOverlaysSnapshot(draft.absmap);
        const prodIds = new Set(draft.absmap.b2bSnapshotAtLoad.map((s) => s.slot_id.trim()).filter(Boolean));
        const incomingSlots = action.payload.slots
          .map(normalizeSlotParkingType)
          .map((s) => (prodIds.has(s.slot_id.trim()) ? s : ensureDraftSlot({ ...s, slot_id: '' })));
        const existingFootprints = mergeSlotsForPlacementHints(
          slotsBefore,
          baselineBefore,
          draft.absmap.b2bSnapshotAtLoad,
        );
        const dedupedIncoming = excludeSlotsOverlappingExisting(
          incomingSlots,
          existingFootprints,
        );
        const incomingBaselines = action.payload.baseline_slots.map(normalizeSlotParkingType);
        const hadPriorWork = existingFootprints.length > 0;
        const slotsAfter = hadPriorWork
          ? mergePipelineSlots(slotsBefore, dedupedIncoming)
          : dedupedIncoming;
        let baselineAfter = hadPriorWork
          ? mergePipelineSlots(baselineBefore, incomingBaselines)
          : incomingBaselines;
        baselineAfter = excludeSlotsOverlappingExisting(baselineAfter, slotsAfter);
        draft.absmap.slots = slotsAfter;
        draft.absmap.baselineSlots = baselineAfter;
        draft.absmap.detectionOverlay = hadPriorWork
          ? mergePipelineOverlay(draft.absmap.detectionOverlay, action.payload.detection_overlay)
          : (action.payload.detection_overlay ?? null);
        draft.absmap.postprocessOverlay = hadPriorWork
          ? mergePipelineOverlay(
              draft.absmap.postprocessOverlay,
              action.payload.postprocess_overlay,
            )
          : (action.payload.postprocess_overlay ?? null);
        const overlaysAfter = capturePipelineOverlaysSnapshot(draft.absmap);
        const { markDirty } = parseFetchJobResultArg(action.meta.arg);
        let pipelineCropCount = 0;
        if (markDirty) {
          markAbsmapDirty(draft.absmap);
          coalesceTrailingAddEvents(draft.absmap);
          coalesceTrailingCropEvents(draft.absmap);

          const { launchCrops, cropsBeforeDraw } = absorbCropEventsFromHistory(draft.absmap);
          while (draft.absmap.editIndex > 0) {
            const trailing = draft.absmap.editHistory[draft.absmap.editIndex - 1];
            if (trailing?.type === 'add' || trailing?.type === 'tile_row') {
              draft.absmap.editIndex -= 1;
              draft.absmap.editHistory = draft.absmap.editHistory.slice(0, draft.absmap.editIndex);
              continue;
            }
            break;
          }

          const slotIdsBefore = new Set(slotsBefore.map((s) => s.slot_id));
          const slotIdsAfter = new Set(slotsAfter.map((s) => s.slot_id));
          const slotsChanged =
            slotIdsBefore.size !== slotIdsAfter.size ||
            [...slotIdsBefore].some((id) => !slotIdsAfter.has(id));
          const baselineIdsBefore = new Set(baselineBefore.map((s) => s.slot_id));
          const baselineIdsAfter = new Set(baselineAfter.map((s) => s.slot_id));
          const baselineChanged =
            baselineIdsBefore.size !== baselineIdsAfter.size ||
            [...baselineIdsBefore].some((id) => !baselineIdsAfter.has(id));
          const hadPriorEdits = draft.absmap.editIndex > 0;
          if (slotsChanged || baselineChanged || hadPriorEdits || launchCrops.length > 0) {
            truncateFuture(draft.absmap);
            const allIds = new Set([
              ...slotsBefore.map((s) => s.slot_id),
              ...slotsAfter.map((s) => s.slot_id),
            ]);
            const evt: EditEvent = {
              type: 'modify',
              timestamp: Date.now(),
              slot_ids: [...allIds],
              before: slotsBefore.map(cloneSlotForHistory),
              after: slotsAfter.map(cloneSlotForHistory),
              baseline_before: baselineBefore,
              baseline_after: baselineAfter.map(cloneSlotForHistory),
              // Use launch ROIs (crops_after), not crops_before from the first draw step (often []).
              crops_before:
                launchCrops.length > 0
                  ? launchCrops.map(cloneCropForHistory)
                  : cropsBeforeDraw,
              crops_after: [],
              pipeline_overlays_before: overlaysBefore,
              pipeline_overlays_after: overlaysAfter,
            };
            draft.absmap.editHistory.push(evt);
            draft.absmap.editIndex++;
            log.info(
              `Pipeline result loaded — undoable (${slotsBefore.length}→${slotsAfter.length} slots, ${launchCrops.length} ROI, history=${draft.absmap.editIndex})`,
            );
          } else {
            log.info('Pipeline result loaded — session marked dirty (save to persist + B2B)');
          }
          pipelineCropCount = launchCrops.length;
          draft.absmap.crops = [];
          draft.absmap.overlayVisibility.roi = false;
        }
        draft.context.recentDevices = markStepDone(
          draft.context.recentDevices,
          activeClientDirectoryKey(draft.context),
          draft.context.deviceId,
          'absmap',
        );
        saveContextToStorage(draft.context);

        if (markDirty) {
          const pipelineDetected =
            action.payload.slots.length + action.payload.baseline_slots.length;
          const added = Math.max(0, slotsAfter.length - slotsBefore.length);
          const tiles = pipelineCropCount;
          if (pipelineDetected === 0) {
            showAlertModal({
              variant: 'warning',
              titleKey: 'alerts.jobDoneEmpty.title',
              messageKey: 'alerts.jobDoneEmpty.message',
            });
            notifySession(draft, {
              category: 'pipeline',
              titleKey: 'notifications.events.pipelineEmpty',
            });
          } else {
            showAlertModal({
              variant: 'success',
              titleKey: 'alerts.jobDone.title',
              messageKey: 'alerts.jobDone.message',
              messageParams: { added, tiles, count: added },
            });
            notifySession(draft, {
              category: 'pipeline',
              titleKey: 'notifications.events.pipelineDone',
              titleParams: { added, tiles, count: added },
            });
          }
        }
      
  }

  if (fetchJobResult.rejected.match(action)) {

        const { jobId, markDirty } = parseFetchJobResultArg(action.meta.arg as FetchJobResultArg);
        const notFound =
          action.meta.rejectedWithValue &&
          (action.payload as FetchJobResultReject | undefined)?.code === 'JOB_NOT_FOUND';

        if (notFound) {
          if (!markDirty) {
            if (draft.absmap.job?.id === jobId) {
              draft.absmap.job = null;
            }
            return;
          }
          log.warn(`Job ${jobId.slice(0, 8)}… not found on API — run Launch again`);
          draft.absmap.job = {
            id: jobId,
            status: 'failed',
            error: 'Job expired (API restarted). Run Launch again.',
          };
          return;
        }

        log.error(`Fetch job result failed: ${action.error.message}`);
        if (draft.absmap.job?.id === jobId) {
          draft.absmap.job = {
            ...draft.absmap.job,
            status: 'failed',
            error: action.error.message ?? 'Failed to load result',
          };
        }
      
  }

  if (reprocessArea.pending.match(action)) {

        draft.absmap.reprocessLoading = true;
        draft.absmap.reprocessError = null;
      
  }

  if (reprocessArea.fulfilled.match(action)) {

        draft.absmap.reprocessLoading = false;
        draft.absmap.reprocessProposedSlots = action.payload;
        if (action.payload.length === 0) {
          draft.absmap.reprocessError = 'No slots proposed for this area. Try a different reference slot or wider scope.';
        }
      
  }

  if (reprocessArea.rejected.match(action)) {

        draft.absmap.reprocessLoading = false;
        draft.absmap.reprocessError = action.error.message ?? 'Reprocess failed';
        log.error(`Reprocess failed: ${action.error.message}`);
      
  }

  if (straightenRow.pending.match(action)) {

        ensureManualSessionJob(draft.absmap);
        draft.absmap.straightenLoading = true;
        draft.absmap.straightenError = null;
      
  }

  if (straightenRow.fulfilled.match(action)) {

        draft.absmap.straightenLoading = false;
        const { proposed } = action.payload;
        if (proposed.length === 0) {
          draft.absmap.straightenError =
            'No slots aligned for this pair. Pick two markers on the same row, or different anchors.';
          /* Keep straightenAnchorSlotId so the user can click another second slot. */
          return;
        }
        draft.absmap.straightenAnchorSlotId = null;
        draft.absmap.straightenError = null;
        commitStraightenAligned(draft.absmap, proposed);
      
  }

  if (straightenRow.rejected.match(action)) {

        draft.absmap.straightenLoading = false;
        /* Keep first anchor so user can retry the second pick without starting over. */
        draft.absmap.straightenError = action.error.message ?? 'Straighten failed';
        log.error(`Straighten failed: ${action.error.message}`);
  }
}

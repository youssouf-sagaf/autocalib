import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import type { RootState } from './store';
import {
  calibAddBbox,
  calibBulkRemove,
  calibMarkFailed,
  calibModifyBbox,
  calibMultiResize,
  calibRedo,
  calibRemoveBbox,
  calibSetActiveFrame,
  calibSetConfidence,
  calibSetPan,
  calibSetZoom,
  calibToggleLock,
  calibUndo,
  calibUpdateProgress,
  calibRevealEditorResult,
  fetchCalibResult,
  loadDeviceCalibration,
  setDeviceContext,
  setWorkspaceMode,
  submitCalibJob,
} from './autocalib-slice';
import { buildCalibLocalSnapshot, saveCalibLocalCache } from '../utils/calibLocalCache';

const DEBOUNCE_MS = 380;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistNow(getState: () => RootState) {
  const s = getState().autocalib;
  const client = s.calib.client || s.context.clientName || s.context.clientId;
  const deviceId = s.calib.deviceId || s.context.deviceId;
  if (!client || !deviceId) return;
  saveCalibLocalCache(
    client,
    deviceId,
    buildCalibLocalSnapshot(client, deviceId, {
      bboxes: s.calib.bboxes,
      frameCount: s.calib.frameCount,
      totalDetections: s.calib.totalDetections,
      jobId: s.calib.jobId,
      jobStatus: s.calib.jobStatus,
      activeFrameIndex: s.calib.activeFrameIndex,
      lockedBboxIds: s.calib.lockedBboxIds,
      editHistory: s.calib.editHistory,
      editIndex: s.calib.editIndex,
      confidenceThreshold: s.calib.confidenceThreshold,
      canvasZoom: s.calib.canvasZoom,
      canvasPanX: s.calib.canvasPanX,
      canvasPanY: s.calib.canvasPanY,
    }),
  );
}

function debouncedPersist(getState: () => RootState) {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow(getState);
  }, DEBOUNCE_MS);
}

export const calibCacheListener = createListenerMiddleware();

calibCacheListener.startListening({
  predicate: (action, _currentState, originalState): boolean => {
    if (!setDeviceContext.match(action)) return false;
    const prev = (originalState as RootState).autocalib.context;
    const payload = action.payload as {
      clientId: string;
      clientName: string;
      deviceId: string;
    };
    const prevKey = prev.clientId || prev.clientName;
    const nextKey = payload.clientId || payload.clientName;
    return prevKey !== nextKey || prev.deviceId !== payload.deviceId;
  },
  effect: async (action, listenerApi) => {
    const payload = action.payload as {
      clientId: string;
      clientName: string;
      deviceId: string;
    };
    const { clientName, deviceId, clientId } = payload;
    const cacheKey = clientName || clientId;
    if (!cacheKey || !deviceId) return;
    await listenerApi.dispatch(loadDeviceCalibration({ client: cacheKey, deviceId })).unwrap();
    const st = listenerApi.getState() as RootState;
    const ctxKey = st.autocalib.context.clientId || st.autocalib.context.clientName;
    if (ctxKey !== cacheKey || st.autocalib.context.deviceId !== deviceId) return;
    const { calib } = st.autocalib;
    const hasProdCalib =
      calib.bboxes.length > 0 &&
      (calib.calibrationLoadedFromDb || calib.jobId === 'db-static');
    if (hasProdCalib) {
      if (!calib.showCalibEditorResult) {
        listenerApi.dispatch(calibRevealEditorResult());
      }
      return;
    }
    const hasCachedCalib = calib.jobStatus === 'done' && calib.bboxes.length > 0;
    if (hasCachedCalib) {
      if (!calib.showCalibEditorResult) {
        listenerApi.dispatch(calibRevealEditorResult());
      }
      return;
    }
  },
});

calibCacheListener.startListening({
  matcher: isAnyOf(
    fetchCalibResult.fulfilled,
    submitCalibJob.fulfilled,
    calibSetConfidence,
    calibSetActiveFrame,
    calibToggleLock,
    calibAddBbox,
    calibRemoveBbox,
    calibModifyBbox,
    calibBulkRemove,
    calibMultiResize,
    calibUndo,
    calibRedo,
    calibSetZoom,
    calibSetPan,
    calibUpdateProgress,
    calibMarkFailed,
  ),
  effect: (_action, listenerApi) => {
    debouncedPersist(listenerApi.getState as () => RootState);
  },
});

calibCacheListener.startListening({
  actionCreator: setWorkspaceMode,
  effect: (_action, listenerApi) => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
      persistNow(listenerApi.getState as () => RootState);
    }
  },
});

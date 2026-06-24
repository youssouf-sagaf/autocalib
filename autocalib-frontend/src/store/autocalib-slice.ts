/**
 * Backward-compatible barrel — re-exports actions, thunks, and types from split store modules.
 */
export type {
  AutoSuggestProposal,
  AutoSuggestState,
  CalibState,
  PairingState,
} from './autocalib-state-types';

export type { FetchDevicesForClientArg } from './autocalib-thunks';

export {
  submitCalibJob,
  fetchCalibResult,
  hydrateCalibFromLocalCache,
  loadDeviceCalibration,
  saveDeviceCalibration,
  saveCalibrationFromState,
  fetchClients,
  fetchDevicesForClient,
  savePairings,
  loadPairings,
  launchJob,
  fetchJobResult,
  parseFetchJobResultArg,
  restoreAbsmapJobFromCache,
  saveSlotsToB2b,
  loadClientSlots,
  reprocessArea,
  straightenRow,
} from './autocalib-thunks';

export type { FetchJobResultArg, FetchJobResultReject } from './autocalib-thunks';

export { beginSaveProdDisplay, setActiveClient, setDeviceContext } from './cross-slice-reducer';

export { closeSaveFeedback, setWorkspaceMode } from './slices/ui-slice';

export {
  setDeviceId,
  removeRecentDevice,
  toggleSidebar,
} from './slices/context-slice';

export {
  directorySeedStaleDevices,
  invalidateDirectoryListing,
} from './slices/directory-slice';

export {
  setAbsmapViewState,
  setImagerySource,
  setMapDisplayLayer,
  addCrop,
  removeCrop,
  clearCrops,
  updateJobProgress,
  markJobFailed,
  toggleDualMap,
  toggleOverlay,
  setEditMode,
  straightenSetAnchor,
  addSlot,
  deleteMapSlot,
  bulkDeleteSlots,
  modifySlot,
  setSlotParkingType,
  bulkSetSlotsParkingType,
  undo,
  redo,
  rejectStraighten,
  reprocessSetRef,
  reprocessSetScope,
  reprocessAccept,
  reprocessReject,
  reprocessReset,
  tileRowSetROI,
  tileRowPushSeed,
  tileRowPopSeed,
  tileRowSetProposed,
  tileRowAccept,
  cloneRowAccept,
  tileRowReject,
  tileRowReset,
  setSlotSelection,
  toggleSlotInSelection,
  clearSlotSelection,
  setMarkerDisplayMode,
} from './slices/absmap-slice';

export {
  calibSetDevice,
  calibSetConfidence,
  calibSetActiveFrame,
  calibSetEditMode,
  calibSelectBbox,
  calibSetSelection,
  calibClearSelection,
  calibToggleLock,
  calibAddBbox,
  calibRemoveBbox,
  calibModifyBbox,
  calibBulkRemove,
  calibMultiResize,
  calibUndo,
  calibRedo,
  calibUpdateProgress,
  calibMarkFailed,
  calibReset,
  calibRevealEditorResult,
  calibSetViewTab,
  calibSetZoom,
  calibSetPan,
  calibAlignBboxesToImageSize,
} from './slices/calib-slice';

export {
  pairingSetTool,
  pairingSelectSlot,
  pairingSelectBbox,
  pairingAddDrawingPoint,
  pairingSetDrawingPoints,
  pairingClearDrawing,
  pairingCommitZone,
  pairingDismissMismatchError,
  pairingSetActiveZone,
  pairingSetFocusedPanel,
  pairingReverseZoneLinks,
  pairingDeleteZone,
  pairingSuggestForZone,
  pairingConfirmSuggestion,
  pairingRejectSuggestion,
  pairingUnpairActiveZone,
  pairingUndo,
  pairingRedo,
  pairingReset,
  pairingBulkAddLinks,
  pairingToggleAutoSuggestMode,
  pairingAcceptAutoSuggestion,
  pairingRejectAutoSuggestion,
  pairingCancelAutoSuggest,
} from './slices/pairing-slice';

export { pairingAutoSuggestZoneDrawn } from './cross-slice-reducer';

export {
  markSessionNotificationRead,
  markAllSessionNotificationsRead,
} from './cross-slice-reducer';

/** @deprecated Bridge removed — use autocalib root reducer from autocalib-root.ts */
export { default as legacyAutocalibReducer } from './autocalib-root';

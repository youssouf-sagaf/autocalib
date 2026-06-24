import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from './store/hooks';
import {
  addCrop,
  undo,
  redo,
  launchJob,
  restoreAbsmapJobFromCache,
  setAbsmapViewState,
  bulkSetSlotsParkingType,
  bulkDeleteSlots,
  clearSlotSelection,
  toggleSlotInSelection,
  setSlotSelection,
  toggleOverlay,
} from './store/autocalib-slice';
import { activeClientDirectoryKey } from './utils/clientContext';
import { slotKey, normalizeSlotId } from './utils/slot-key';
import { usePolygonDraw } from './hooks/usePolygonDraw';
import { createLogger } from './utils/logger';

const roiLog = createLogger('roi');
import { useAddSlot } from './hooks/useAddSlot';
import { useEraserSlot } from './hooks/useEraserSlot';
import { useBulkDelete } from './hooks/useBulkDelete';
import { useCopySlot } from './hooks/useCopySlot';
import { useModifySlot } from './hooks/useModifySlot';
import { useStraightenSlot } from './hooks/useStraightenSlot';
import { useReprocessSlot } from './hooks/useReprocessSlot';
import { useTileRow } from './hooks/useTileRow';
import { useCloneRow } from './hooks/useCloneRow';
import { useAbsmapDisplaySlots } from './hooks/useAbsmapDisplaySlots';
import { usePrefetchReferenceSlots } from './hooks/usePrefetchReferenceSlots';
import { useJobStream } from './hooks/useJobStream';
import { AppShell } from './features/layout/AppShell';
import { AbsmapDualMapViewport, AbsmapMapViewport } from './map/AbsmapMapViewport';
import type { MapViewState } from './map/MapPanel';
import { AbsmapEditRail } from './features/toolbar/AbsmapEditRail';
import { AbsmapBottomBar } from './features/toolbar/AbsmapBottomBar';
import { AbsmapSessionHeader } from './features/toolbar/AbsmapSessionHeader';
import { BulkDeleteConfirmModal } from './features/absmap/BulkDeleteConfirmModal';
import { AbsmapStatusBar } from './features/absmap/AbsmapStatusBar';
import { useKeyboardShortcuts, SHORTCUT_PRIORITY } from './keyboard/useKeyboardShortcuts';
import type { WorkspaceCommandActions } from './features/command-palette/commandRegistry';
import { SlotTypePopover } from './features/toolbar/SlotTypePopover';
import type { EditMode } from './types';
import { mapEventShiftKey, slotIdFromMapEvent } from './map/mapPointer';
import './App.css';

export default function App() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const dualMapActive = useAppSelector((s) => s.autocalib.absmap.dualMapActive);
  const editMode = useAppSelector((s) => s.autocalib.absmap.editMode);
  const editIndex = useAppSelector((s) => s.autocalib.absmap.editIndex);
  const editHistoryLen = useAppSelector((s) => s.autocalib.absmap.editHistory.length);
  const canUndo = editIndex > 0;
  const canRedo = editIndex < editHistoryLen;
  const job = useAppSelector((s) => s.autocalib.absmap.job);
  const crops = useAppSelector((s) => s.autocalib.absmap.crops);
  const pipelineBusy = job?.status === 'running' || job?.status === 'pending';

  const savedView = useAppSelector((s) => s.autocalib.absmap.absmapViewState);
  const [externalViewCommand, setExternalViewCommand] = useState(0);
  const [externalViewState, setExternalViewState] = useState<MapViewState | null>(null);

  const persistViewState = useCallback(
    (viewState: MapViewState) => {
      dispatch(
        setAbsmapViewState({
          longitude: viewState.longitude,
          latitude: viewState.latitude,
          zoom: viewState.zoom,
        }),
      );
    },
    [dispatch],
  );

  const commandViewState = useCallback((next: MapViewState) => {
    setExternalViewState(next);
    setExternalViewCommand((n) => n + 1);
    dispatch(
      setAbsmapViewState({
        longitude: next.longitude,
        latitude: next.latitude,
        zoom: next.zoom,
      }),
    );
  }, [dispatch]);

  const handleFlyTo = useCallback(
    (lng: number, lat: number) => {
      commandViewState({ longitude: lng, latitude: lat, zoom: 17 });
    },
    [commandViewState],
  );

  /* Auto-center: prod/session slots first, else B2B client location. */
  const contextDirectoryKey = useAppSelector((s) => activeClientDirectoryKey(s.autocalib.context));
  const contextClientName = useAppSelector((s) => s.autocalib.context.clientName);
  const contextB2bClientId = useAppSelector((s) => s.autocalib.context.clientId.trim());
  const contextClientNameForRef = useAppSelector((s) => s.autocalib.context.clientName.trim());
  const contextDeviceId = useAppSelector((s) => s.autocalib.context.deviceId);
  const workspaceMode = useAppSelector((s) => s.autocalib.ui.workspaceMode);
  const slots = useAppSelector((s) => s.autocalib.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.autocalib.absmap.baselineSlots);
  const b2bSnapshotAtLoad = useAppSelector((s) => s.autocalib.absmap.b2bSnapshotAtLoad);
  const displaySlots = useAbsmapDisplaySlots();
  const clientLocation = useAppSelector(
    (s) =>
      contextDirectoryKey
        ? s.autocalib.directory.clientLocations[contextDirectoryKey] ?? null
        : null,
  );
  const mapAutoFitClientKeyRef = useRef<string | null>(null);
  useEffect(() => {
    mapAutoFitClientKeyRef.current = null;
  }, [contextDirectoryKey]);
  useEffect(() => {
    if (savedView) return;
    if (!contextDirectoryKey) return;
    if (displaySlots.length > 0) {
      if (mapAutoFitClientKeyRef.current === contextDirectoryKey) return;
      mapAutoFitClientKeyRef.current = contextDirectoryKey;
      let sumLng = 0;
      let sumLat = 0;
      for (const slot of displaySlots) {
        sumLng += slot.center.lng;
        sumLat += slot.center.lat;
      }
      commandViewState({
        longitude: sumLng / displaySlots.length,
        latitude: sumLat / displaySlots.length,
        zoom: 19,
      });
      return;
    }
    if (!clientLocation) return;
    commandViewState({
      longitude: clientLocation.lng,
      latitude: clientLocation.lat,
      zoom: clientLocation.zoom,
    });
  }, [
    savedView,
    displaySlots,
    clientLocation,
    contextDirectoryKey,
    commandViewState,
  ]);

  /**
   * After a full reload, Redux has no job/slots. If we bookmarked the last successful
   * pipeline job for this client+device, refetch merged GeoJSON from the API.
   */
  useEffect(() => {
    if (workspaceMode !== 'absmap') return;
    if (!contextClientName || !contextDeviceId) return;
    void dispatch(restoreAbsmapJobFromCache({ clientName: contextClientName, deviceId: contextDeviceId }));
  }, [dispatch, workspaceMode, contextClientName, contextDeviceId]);

  const onCropComplete = useCallback(
    (polygon: GeoJSON.Polygon) => {
      const t0 = performance.now();
      dispatch(addCrop({ polygon }));
      const ring = polygon.coordinates[0] ?? [];
      roiLog.info(
        `addCrop dispatched (${Math.max(0, ring.length - 1)} vertices) in ${Math.round(performance.now() - t0)}ms`,
      );
    },
    [dispatch],
  );

  const {
    isDrawing,
    startDrawing,
    stopDrawing,
    undoDrawingStep,
    previewFeature,
    edgeFeature,
    vertexFeatures,
    handleClick,
    handleMouseMove,
    handleKeyDown,
    cursor,
  } = usePolygonDraw({ onComplete: onCropComplete });

  const {
    isAddMode,
    addDragSlot,
    isAddDragLocked,
    handleMouseDown: handleAddMouseDown,
    handleMouseUp: handleAddMouseUp,
    handleMouseMove: handleAddMouseMove,
    handleKeyDown: handleAddKeyDown,
    toggleAddMode: rawToggleAddMode,
    cancelSlot,
  } = useAddSlot();

  const [browseSelectedId, setBrowseSelectedId] = useState<string | null>(null);
  /** Screen position for the slot-type popover (viewport coords). */
  const [slotTypePopAnchor, setSlotTypePopAnchor] = useState<{ clientX: number; clientY: number } | null>(null);
  /** Slot ids targeted by the open type popover (selection or single right-click). */
  const [slotTypePopTargetIds, setSlotTypePopTargetIds] = useState<string[]>([]);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);

  const slotSelection = useAppSelector((s) => s.autocalib.absmap.selection);
  const isDirty = useAppSelector((s) => s.autocalib.absmap.isDirty);

  const {
    isEraserMode,
    handleMouseDown: handleEraserMouseDown,
    handleKeyDown: handleEraserKeyDown,
    toggleEraserMode: rawToggleEraserMode,
    cancelEraser,
  } = useEraserSlot();

  const [selectionDeleteOpen, setSelectionDeleteOpen] = useState(false);

  const {
    isBulkDeleteMode,
    isBulkLassoDragging,
    bulkDeletePhase,
    bulkDeletePendingCount,
    bulkPreviewSlotIds,
    previewFeature: bulkPreviewFeature,
    edgeFeature: bulkEdgeFeature,
    vertexFeatures: bulkVertexFeatures,
    toggleBulkDeleteMode: rawToggleBulkDeleteMode,
    cancelBulkDelete,
    confirmBulkDelete,
    cancelBulkDeleteConfirm,
    handleMouseDown: handleBulkMouseDown,
    handleMouseMove: handleBulkMouseMove,
    handleKeyDown: handleBulkKeyDown,
    cursor: bulkDeleteCursor,
  } = useBulkDelete();

  const {
    isModifyMode,
    modifyDragSlot,
    isModifyDragLocked,
    handleMapClick: handleModifyClick,
    handleMouseDown: handleModifyMouseDown,
    handleMouseUp: handleModifyMouseUp,
    handleMouseMove: handleModifyMouseMove,
    handleKeyDown: handleModifyKeyDown,
    toggleModifyMode: rawToggleModifyMode,
    selectSlotById: modifySelectSlotById,
    cancelModify,
  } = useModifySlot();

  const {
    isCopyMode,
    handleMapClick: handleCopyClick,
    handleKeyDown: handleCopyKeyDown,
    toggleCopyMode: rawToggleCopyMode,
  } = useCopySlot(modifySelectSlotById);

  const dismissSlotTypePopover = useCallback(() => {
    setSlotTypePopAnchor(null);
    setSlotTypePopTargetIds([]);
  }, []);

  const clearBrowseSelection = useCallback(() => {
    setBrowseSelectedId(null);
    dismissSlotTypePopover();
  }, [dismissSlotTypePopover]);

  const {
    isStraightenMode,
    handleMapClick: handleStraightenClick,
    handleKeyDown: handleStraightenKeyDown,
    toggleStraightenMode: rawToggleStraightenMode,
    cancelStraighten,
  } = useStraightenSlot({ onStraightenApplied: clearBrowseSelection });

  const {
    isReprocessMode,
    reprocessProposedSlots,
    pendingRefSlot,
    handleMapClick: handleReprocessClick,
    handleMouseMove: handleReprocessMouseMove,
    handleKeyDown: handleReprocessKeyDown,
    toggleReprocessMode: rawToggleReprocessMode,
    cancelReprocess,
    scopePreviewFeature,
    scopeEdgeFeature,
    scopeVertexFeatures,
    cursor: reprocessCursor,
  } = useReprocessSlot();

  const {
    isTileRowMode,
    tileRowStep,
    proposedSlots: tileRowProposedSlots,
    brushPreviewSlots,
    pendingAnchorSlot: tileRowAnchorPreview,
    handleMapClick: handleTileRowClick,
    handleMouseDown: handleTileRowMouseDown,
    handleMouseMove: handleTileRowMouseMove,
    handleMouseUp: handleTileRowMouseUp,
    handleKeyDown: handleTileRowKeyDown,
    toggleMode: rawToggleTileRowMode,
    cancelMode: cancelTileRow,
    cursor: tileRowCursor,
    isBrushDragging,
  } = useTileRow();

  const {
    isCloneRowMode,
    canCloneRow,
    cloneRowStep,
    proposedSlots: cloneRowProposedSlots,
    isClonePlacingDragging,
    isCloneLassoDragging,
    edgeFeature: cloneRowEdgeFeature,
    handleMouseDown: handleCloneRowMouseDown,
    handleMouseUp: handleCloneRowMouseUp,
    handleMouseMove: handleCloneRowMouseMove,
    handleKeyDown: handleCloneRowKeyDown,
    toggleMode: rawToggleCloneRowMode,
    cancelMode: cancelCloneRow,
    cursor: cloneRowCursor,
  } = useCloneRow();

  const rowGhostSlots = isCloneRowMode ? cloneRowProposedSlots : tileRowProposedSlots;
  const tileRowExtendGhostSlots =
    isTileRowMode && !isCloneRowMode
      ? brushPreviewSlots.length > 0
        ? brushPreviewSlots
        : tileRowStep === 'review' && rowGhostSlots.length > 0
          ? rowGhostSlots
          : undefined
      : undefined;
  const cloneRowGhostSlots =
    isCloneRowMode && cloneRowProposedSlots.length > 0
      ? cloneRowProposedSlots
      : undefined;
  const mapGhostSlots = cloneRowGhostSlots ?? tileRowExtendGhostSlots;
  const tileRowShowAnchorGhost =
    isTileRowMode &&
    !isCloneRowMode &&
    tileRowStep === 'orient' &&
    tileRowAnchorPreview != null;

  const exitCurrentMode = useCallback(() => {
    if (isDrawing) stopDrawing();
    if (isAddMode) cancelSlot();
    if (isEraserMode) cancelEraser();
    if (isCopyMode) rawToggleCopyMode();
    if (isModifyMode) cancelModify();
    if (isStraightenMode) cancelStraighten();
    if (isBulkDeleteMode) cancelBulkDelete();
    if (isReprocessMode) cancelReprocess();
    if (isTileRowMode) cancelTileRow();
    if (isCloneRowMode) cancelCloneRow();
  }, [
    isDrawing, stopDrawing, isAddMode, cancelSlot, isEraserMode, cancelEraser,
    isCopyMode, rawToggleCopyMode, isModifyMode, cancelModify,
    isStraightenMode, cancelStraighten, isBulkDeleteMode, cancelBulkDelete,
    isReprocessMode, cancelReprocess,
    isTileRowMode, cancelTileRow,
    isCloneRowMode, cancelCloneRow,
  ]);

  const enterMode = useCallback(
    (toggle: () => void) => {
      exitCurrentMode();
      setBrowseSelectedId(null);
      dismissSlotTypePopover();
      toggle();
    },
    [exitCurrentMode, dismissSlotTypePopover],
  );

  const toggleAddMode = useCallback(() => enterMode(rawToggleAddMode), [enterMode, rawToggleAddMode]);
  const toggleCopyMode = useCallback(() => enterMode(rawToggleCopyMode), [enterMode, rawToggleCopyMode]);
  const toggleModifyMode = useCallback(() => enterMode(rawToggleModifyMode), [enterMode, rawToggleModifyMode]);
  const toggleStraightenMode = useCallback(() => enterMode(rawToggleStraightenMode), [enterMode, rawToggleStraightenMode]);
  const toggleReprocessMode = useCallback(() => enterMode(rawToggleReprocessMode), [enterMode, rawToggleReprocessMode]);
  const toggleBulkDeleteMode = useCallback(() => enterMode(rawToggleBulkDeleteMode), [enterMode, rawToggleBulkDeleteMode]);
  const toggleEraserMode = useCallback(() => enterMode(rawToggleEraserMode), [enterMode, rawToggleEraserMode]);
  const exitToSelectMode = useCallback(() => {
    exitCurrentMode();
    dispatch(clearSlotSelection());
  }, [exitCurrentMode, dispatch]);
  const toggleTileRowMode = useCallback(() => enterMode(rawToggleTileRowMode), [enterMode, rawToggleTileRowMode]);
  const toggleCloneRowMode = useCallback(() => enterMode(rawToggleCloneRowMode), [enterMode, rawToggleCloneRowMode]);
  const startDrawingExclusive = useCallback(() => {
    const t0 = performance.now();
    exitCurrentMode();
    const exitMs = Math.round(performance.now() - t0);
    startDrawing();
    roiLog.info(`Draw ROI activated: exitCurrentMode=${exitMs}ms, total=${Math.round(performance.now() - t0)}ms`);
  }, [exitCurrentMode, startDrawing]);

  const isAnyEditMode =
    isAddMode || isEraserMode || isBulkDeleteMode || isCopyMode || isModifyMode || isStraightenMode || isReprocessMode || isTileRowMode || isCloneRowMode;

  const straightenAnchorSlotId = useAppSelector((s) => s.autocalib.absmap.straightenAnchorSlotId);
  const activeSelectedSlotId =
    isStraightenMode && straightenAnchorSlotId
      ? straightenAnchorSlotId
      : slotSelection.length === 1
        ? slotSelection[0]!
        : browseSelectedId;

  const canBrowseSelectSlots =
    editMode === 'none' && !isAnyEditMode && !isDrawing;

  const handleBrowseSlotSelection = useCallback(
    (slotId: string, additive: boolean) => {
      if (!canBrowseSelectSlots) return;
      if (additive) {
        dispatch(toggleSlotInSelection(slotId));
      } else {
        dispatch(setSlotSelection([slotId]));
      }
      setBrowseSelectedId(slotId);
      dismissSlotTypePopover();
    },
    [canBrowseSelectSlots, dispatch, dismissSlotTypePopover],
  );

  const openSlotTypePopover = useCallback((slotId: string, clientX: number, clientY: number) => {
    const targetIds = slotSelection.length > 0 ? slotSelection : [slotId];
    setSlotTypePopTargetIds(targetIds);
    setBrowseSelectedId(slotId);
    setSlotTypePopAnchor({ clientX, clientY });
  }, [slotSelection]);

  const composedMapContextMenu = useCallback(
    (e: Parameters<typeof handleClick>[0]) => {
      const oe = e.originalEvent;
      if (!(oe instanceof MouseEvent)) return;
      oe.preventDefault();

      const slotId = normalizeSlotId(
        e.features?.[0]?.properties?.slot_id as string | undefined,
      );
      if (!slotId) return;

      openSlotTypePopover(slotId, oe.clientX, oe.clientY);
    },
    [openSlotTypePopover],
  );

  const composedMapClick = useCallback(
    (e: Parameters<typeof handleClick>[0]) => {
      if (isAddMode) return;
      if (isEraserMode) return;
      if (isBulkDeleteMode) return;
      if (isCopyMode) { handleCopyClick(e); return; }
      if (isModifyMode) { handleModifyClick(e); return; }
      if (isStraightenMode) { handleStraightenClick(e); return; }
      if (isReprocessMode) { handleReprocessClick(e); return; }
      if (isTileRowMode) { handleTileRowClick(e); return; }
      if (isCloneRowMode) return;

      // Shift+click is handled on mouseUp (Mapbox box-zoom intercepts shift+click).
      if (mapEventShiftKey(e)) {
        handleClick(e);
        return;
      }

      const slotId = slotIdFromMapEvent(e);
      if (slotId) {
        handleBrowseSlotSelection(slotId, false);
      } else if (canBrowseSelectSlots) {
        dispatch(clearSlotSelection());
        setBrowseSelectedId(null);
        dismissSlotTypePopover();
      }
      handleClick(e);
    },
    [isAddMode, isEraserMode, isBulkDeleteMode, isCopyMode, isModifyMode, isStraightenMode, isReprocessMode, isTileRowMode, isCloneRowMode,
      canBrowseSelectSlots, dispatch, handleClick, handleCopyClick, handleModifyClick, handleStraightenClick, handleReprocessClick, handleTileRowClick,
      handleBrowseSlotSelection, dismissSlotTypePopover],
  );

  const composedMouseMove = useCallback(
    (e: Parameters<typeof handleMouseMove>[0]) => {
      if (isAddMode) handleAddMouseMove(e);
      if (isBulkDeleteMode) handleBulkMouseMove(e);
      if (isModifyMode) handleModifyMouseMove(e);
      if (isReprocessMode) handleReprocessMouseMove(e);
      if (isTileRowMode) handleTileRowMouseMove(e);
      if (isCloneRowMode) handleCloneRowMouseMove(e);

      const features = e.features;
      if (features && features.length > 0) {
        const slotId = features[0]?.properties?.slot_id as string | undefined;
        setHoveredSlotId(slotId ?? null);
      } else {
        setHoveredSlotId(null);
      }
      handleMouseMove(e);
    },
    [isAddMode, isBulkDeleteMode, isModifyMode, isReprocessMode, isTileRowMode, isCloneRowMode, handleAddMouseMove, handleBulkMouseMove, handleModifyMouseMove, handleReprocessMouseMove, handleTileRowMouseMove, handleCloneRowMouseMove, handleMouseMove],
  );

  const composedMouseDown = useCallback(
    (e: Parameters<typeof handleClick>[0]) => {
      if (isAddMode) handleAddMouseDown(e);
      if (isEraserMode) handleEraserMouseDown(e);
      if (isModifyMode) handleModifyMouseDown(e);
      if (isTileRowMode) handleTileRowMouseDown(e);
      if (isCloneRowMode) handleCloneRowMouseDown(e);
      if (isBulkDeleteMode) handleBulkMouseDown(e);
    },
    [isAddMode, isEraserMode, isModifyMode, isTileRowMode, isCloneRowMode, isBulkDeleteMode, handleAddMouseDown, handleEraserMouseDown, handleModifyMouseDown, handleTileRowMouseDown, handleCloneRowMouseDown, handleBulkMouseDown],
  );

  const composedMouseUp = useCallback(
    (e: Parameters<typeof handleClick>[0]) => {
      if (isAddMode) handleAddMouseUp();
      if (isModifyMode) handleModifyMouseUp();
      if (isTileRowMode) handleTileRowMouseUp(e);
      if (isCloneRowMode) handleCloneRowMouseUp(e);

      if (mapEventShiftKey(e)) {
        const slotId = slotIdFromMapEvent(e);
        if (slotId) {
          handleBrowseSlotSelection(slotId, true);
        }
      }
    },
    [isAddMode, isModifyMode, isTileRowMode, isCloneRowMode, handleAddMouseUp, handleModifyMouseUp, handleTileRowMouseUp, handleCloneRowMouseUp, handleBrowseSlotSelection],
  );

  const drawPreviewFeature = isReprocessMode
    ? scopePreviewFeature
    : isBulkDeleteMode
      ? bulkPreviewFeature
      : previewFeature;
  const drawEdgeFeature = isReprocessMode
    ? scopeEdgeFeature
    : isBulkDeleteMode
      ? bulkEdgeFeature
      : isCloneRowMode && cloneRowStep === 'pickRow'
        ? cloneRowEdgeFeature
        : edgeFeature;
  const drawVertexFeatures = isReprocessMode
    ? scopeVertexFeatures
    : isBulkDeleteMode
      ? bulkVertexFeatures
      : vertexFeatures;

  const composedCursor = (() => {
    if (isAddMode) return isAddDragLocked ? 'grabbing' : 'crosshair';
    if (isEraserMode) return 'crosshair';
    if (isBulkDeleteMode) return bulkDeleteCursor || 'crosshair';
    if (isCopyMode) return 'copy';
    if (isModifyMode) return isModifyDragLocked ? 'grabbing' : 'grab';
    if (isStraightenMode) return 'crosshair';
    if (isReprocessMode) return reprocessCursor || 'crosshair';
    if (isTileRowMode) return tileRowCursor || 'crosshair';
    if (isCloneRowMode) return cloneRowCursor || 'crosshair';
    return cursor;
  })();

  useJobStream();

  const overlayVisibility = useAppSelector((s) => s.autocalib.absmap.overlayVisibility);
  const detectionOverlay = useAppSelector((s) => s.autocalib.absmap.detectionOverlay);
  const postprocessOverlay = useAppSelector((s) => s.autocalib.absmap.postprocessOverlay);

  const overlays = useMemo(() => {
    const data: Record<string, GeoJSON.FeatureCollection> = {};
    if (overlayVisibility.detection && detectionOverlay) data.detection = detectionOverlay;
    if (overlayVisibility.postprocess && postprocessOverlay) data.postprocess = postprocessOverlay;
    return Object.keys(data).length > 0 ? data : undefined;
  }, [overlayVisibility, detectionOverlay, postprocessOverlay]);

  const confirmSelectionDelete = useCallback(() => {
    if (slotSelection.length === 0) return;
    if (slotSelection.length === 1) {
      dispatch(bulkDeleteSlots(slotSelection));
      dispatch(clearSlotSelection());
      setSelectionDeleteOpen(false);
      return;
    }
    setSelectionDeleteOpen(true);
  }, [dispatch, slotSelection]);

  const modeKeyMap: Record<string, () => void> = {
    a: toggleAddMode,
    e: toggleEraserMode,
    l: toggleBulkDeleteMode,
    c: toggleCopyMode,
    m: toggleModifyMode,
    y: toggleStraightenMode,
    b: toggleReprocessMode,
    t: toggleTileRowMode,
  };

  /** Prod slots from B2B — load when client (and B2B location when needed) is known. */
  usePrefetchReferenceSlots();

  const composedKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      const lowerKey = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && lowerKey === 'k') return false;
      const target = e.target as HTMLElement;
      if (target.closest('[data-command-palette="true"]')) return false;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        handleKeyDown(e);
        return false;
      }

      const key = lowerKey;

      if (
        key === 'escape' &&
        !isAnyEditMode &&
        !isDrawing &&
        !isBulkDeleteMode
      ) {
        if (slotTypePopAnchor) {
          e.preventDefault();
          dismissSlotTypePopover();
          return true;
        }
        if (browseSelectedId) {
          e.preventDefault();
          setBrowseSelectedId(null);
          return true;
        }
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch(redo());
        } else if (editIndex > 0) {
          dispatch(undo());
        } else if (isDrawing) {
          undoDrawingStep();
        } else {
          dispatch(undo());
        }
        return true;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        dispatch(redo());
        return true;
      }

      if (isBulkDeleteMode && e.key === 'Escape') {
        handleBulkKeyDown(e);
        return true;
      }

      if (!mod && !e.altKey && (key === 'delete' || key === 'backspace')) {
        if (editMode === 'none' && slotSelection.length > 0) {
          e.preventDefault();
          confirmSelectionDelete();
          return true;
        }
        return false;
      }

      if (!mod && !e.altKey && key === 'v') {
        e.preventDefault();
        exitToSelectMode();
        return true;
      }

      if (!mod && !e.altKey && key === 'r') {
        if (e.shiftKey) {
          e.preventDefault();
          toggleCloneRowMode();
          return true;
        }
        e.preventDefault();
        if (isDrawing) {
          stopDrawing();
          return true;
        }
        if (pipelineBusy) return false;
        startDrawingExclusive();
        return true;
      }
      if (!mod && !e.altKey && key === 'j') {
        if (crops.length === 0 || pipelineBusy) return false;
        e.preventDefault();
        dispatch(launchJob());
        return true;
      }

      const modeToggle = modeKeyMap[key];
      if (modeToggle && !mod && !e.altKey) {
        e.preventDefault();
        modeToggle();
        return true;
      }

      handleAddKeyDown(e);
      handleEraserKeyDown(e);
      handleCopyKeyDown(e);
      handleModifyKeyDown(e);
      handleStraightenKeyDown(e);
      handleReprocessKeyDown(e);
      handleTileRowKeyDown(e);
      handleCloneRowKeyDown(e);
      handleKeyDown(e);
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, browseSelectedId, slotTypePopAnchor, dismissSlotTypePopover, isAnyEditMode, editIndex, isDrawing, crops.length, pipelineBusy,
      toggleAddMode, toggleBulkDeleteMode, toggleEraserMode, toggleCopyMode, toggleModifyMode,
      toggleStraightenMode, toggleReprocessMode, toggleTileRowMode, toggleCloneRowMode, stopDrawing, startDrawingExclusive,
      undoDrawingStep, editMode, slotSelection, confirmSelectionDelete, exitToSelectMode,
      isBulkDeleteMode, handleBulkKeyDown, handleAddKeyDown, handleEraserKeyDown,
      handleCopyKeyDown, handleModifyKeyDown, handleStraightenKeyDown, handleReprocessKeyDown, handleTileRowKeyDown, handleCloneRowKeyDown, handleKeyDown],
  );

  const handleUndo = useCallback(() => {
    if (editIndex > 0) {
      dispatch(undo());
      return;
    }
    if (isDrawing) {
      undoDrawingStep();
      return;
    }
    dispatch(undo());
  }, [dispatch, editIndex, isDrawing, undoDrawingStep]);
  const handleRedo = useCallback(() => dispatch(redo()), [dispatch]);

  const handleToggleMode = useCallback(
    (mode: EditMode) => {
      if (mode === 'none') { exitToSelectMode(); return; }
      if (editMode === mode) { exitCurrentMode(); return; }
      const toggleMap: Record<string, () => void> = {
        add: toggleAddMode,
        eraser: toggleEraserMode,
        bulk_delete: toggleBulkDeleteMode,
        copy: toggleCopyMode,
        modify: toggleModifyMode,
        straighten: toggleStraightenMode,
        reprocess: toggleReprocessMode,
        tile_row: toggleTileRowMode,
        clone_row: toggleCloneRowMode,
      };
      toggleMap[mode]?.();
    },
    [editMode, exitCurrentMode, exitToSelectMode, toggleAddMode, toggleEraserMode, toggleBulkDeleteMode, toggleCopyMode, toggleModifyMode, toggleStraightenMode, toggleReprocessMode, toggleTileRowMode, toggleCloneRowMode],
  );
  const slotCount = slots.length;
  const baselineCount = baselineSlots.length;
  const b2bProdCount = b2bSnapshotAtLoad.length;
  const displayCount = slotCount || baselineCount || b2bProdCount;
  const hasSlots = displayCount > 0;
  const hasResults = job?.status === 'done' && displayCount > 0;
  /** ROI polygons — visible while drawn; hidden after pipeline completes (toggle in header). */
  const showCropPolygons = crops.length > 0 && overlayVisibility.roi;

  /** Manual slots without waiting for AI — only block while Launch job is active */
  const addSlotToolEnabled = !pipelineBusy;

  const pendingOrModifyingSlot =
    addDragSlot ??
    (tileRowShowAnchorGhost ? tileRowAnchorPreview : null) ??
    pendingRefSlot;

  const slotsForTypePopover = useMemo(() => {
    if (slotTypePopTargetIds.length === 0) return [];
    return slotTypePopTargetIds
      .map(
        (id) =>
          slots.find((s) => slotKey(s) === id) ??
          baselineSlots.find((s) => slotKey(s) === id) ??
          b2bSnapshotAtLoad.find((s) => slotKey(s) === id) ??
          null,
      )
      .filter((s): s is NonNullable<typeof s> => s != null);
  }, [slotTypePopTargetIds, slots, baselineSlots, b2bSnapshotAtLoad]);

  const leftRail = (
    <AbsmapEditRail
      editMode={editMode}
      hasSlots={hasSlots}
      canCloneRow={canCloneRow}
      canAddSlot={addSlotToolEnabled}
      hasResults={hasResults}
      canUndo={canUndo || isDrawing}
      canRedo={canRedo}
      onToggleMode={handleToggleMode}
      onToggleEraserMode={toggleEraserMode}
      onUndo={handleUndo}
      onRedo={handleRedo}
    />
  );

  const bottomBar = (
    <AbsmapBottomBar
      isDrawing={isDrawing}
      onStartDraw={startDrawingExclusive}
      onStopDraw={stopDrawing}
    />
  );

  const mapInner = dualMapActive ? (
    <AbsmapDualMapViewport
      initialViewState={savedView}
      externalViewCommand={externalViewCommand}
      externalViewState={externalViewState}
      onViewPersist={persistViewState}
      referencePanelProps={{
        showCrops: showCropPolygons,
        showSlots: false,
        showCentroids: false,
        label: t('map.reference'),
      }}
      detectionPanelProps={{
        onMapClick: composedMapClick,
        onMouseMove: composedMouseMove,
        onMouseDown: composedMouseDown,
        onMouseUp: composedMouseUp,
        onContextMenu: composedMapContextMenu,
        cursor: composedCursor,
        previewFeature: drawPreviewFeature,
        edgeFeature: drawEdgeFeature,
        vertexFeatures: drawVertexFeatures,
        showCrops: showCropPolygons,
        showSlots: true,
        showCentroids: true,
        label: t('map.detections'),
        overlays,
        pendingSlot: pendingOrModifyingSlot,
        selectedSlotId: activeSelectedSlotId,
        hoveredSlotId: hoveredSlotId,
        modifyDragSlot: modifyDragSlot,
        dragPanEnabled:
          !isAddDragLocked &&
          !isModifyDragLocked &&
          !(isModifyMode && hoveredSlotId) &&
          !(isEraserMode && hoveredSlotId) &&
          !isBrushDragging &&
          !isBulkLassoDragging &&
          !isCloneLassoDragging &&
          !isClonePlacingDragging,
        pendingShowsBbox: !isAddMode,
        reprocessProposedSlots: reprocessProposedSlots.length > 0 ? reprocessProposedSlots : undefined,
        tileRowGhostSlots: mapGhostSlots,
        tileRowGhostShowFootprint: !isCloneRowMode,
        bulkPreviewSlotIds: isBulkDeleteMode ? bulkPreviewSlotIds : null,
      }}
    />
  ) : (
    <AbsmapMapViewport
      initialViewState={savedView}
      externalViewCommand={externalViewCommand}
      externalViewState={externalViewState}
      onViewPersist={persistViewState}
      onMapClick={composedMapClick}
      onMouseMove={composedMouseMove}
      onMouseDown={composedMouseDown}
      onMouseUp={composedMouseUp}
      onContextMenu={composedMapContextMenu}
      cursor={composedCursor}
      previewFeature={drawPreviewFeature}
      edgeFeature={drawEdgeFeature}
      vertexFeatures={drawVertexFeatures}
      showCrops={showCropPolygons}
      showSlots
      showCentroids
      overlays={overlays}
      pendingSlot={pendingOrModifyingSlot}
      selectedSlotId={activeSelectedSlotId}
      hoveredSlotId={hoveredSlotId}
      modifyDragSlot={modifyDragSlot}
      dragPanEnabled={
        !isAddDragLocked &&
        !isModifyDragLocked &&
        !(isModifyMode && hoveredSlotId) &&
        !(isEraserMode && hoveredSlotId) &&
        !isBrushDragging &&
        !isBulkLassoDragging &&
        !isCloneLassoDragging &&
        !isClonePlacingDragging
      }
      pendingShowsBbox={!isAddMode}
      reprocessProposedSlots={reprocessProposedSlots.length > 0 ? reprocessProposedSlots : undefined}
      tileRowGhostSlots={mapGhostSlots}
      tileRowGhostShowFootprint={!isCloneRowMode}
      bulkPreviewSlotIds={isBulkDeleteMode ? bulkPreviewSlotIds : null}
    />
  );

  const bulkDeleteConfirmOpen =
    isBulkDeleteMode && bulkDeletePhase === 'confirm' && bulkDeletePendingCount > 0;
  const bulkDeleteClientLabel =
    contextClientName.trim() || contextClientNameForRef || contextB2bClientId;

  const pipelineHint =
    !hasResults && crops.length === 0 && !isDrawing
      ? t('statusBar.absmap.needRoi')
      : null;

  const workspaceCommands = useMemo<WorkspaceCommandActions>(
    () => ({
      absmap: {
        addSlot: toggleAddMode,
        eraser: toggleEraserMode,
        lasso: toggleBulkDeleteMode,
        drawRoi: () => {
          if (isDrawing) stopDrawing();
          else if (!pipelineBusy) startDrawingExclusive();
        },
        launchPipeline: () => {
          if (crops.length > 0 && !pipelineBusy) dispatch(launchJob());
        },
        straighten: toggleStraightenMode,
        reprocess: toggleReprocessMode,
        toggleOverlayDet: () => dispatch(toggleOverlay('detection')),
        toggleOverlayPost: () => dispatch(toggleOverlay('postprocess')),
      },
    }),
    [
      toggleAddMode,
      toggleEraserMode,
      toggleBulkDeleteMode,
      isDrawing,
      stopDrawing,
      pipelineBusy,
      startDrawingExclusive,
      crops.length,
      dispatch,
      toggleStraightenMode,
      toggleReprocessMode,
    ],
  );

  useKeyboardShortcuts([
    {
      priority: SHORTCUT_PRIORITY.workspace,
      handler: composedKeyDown,
    },
  ]);

  const statusBar = (
    <AbsmapStatusBar
      editMode={bulkDeleteConfirmOpen ? 'none' : editMode}
      isDrawing={isDrawing}
      selectionCount={slotSelection.length}
      isDirty={isDirty}
      pipelineHint={pipelineHint}
    />
  );

  return (
    <AppShell
      leftRail={leftRail}
      floatingToolbar={bottomBar}
      statusBar={statusBar}
      headerCenter={<AbsmapSessionHeader hasResults={hasResults} />}
      onFlyTo={handleFlyTo}
      workspaceCommands={workspaceCommands}
    >
      <BulkDeleteConfirmModal
        open={bulkDeleteConfirmOpen}
        count={bulkDeletePendingCount}
        clientLabel={bulkDeleteClientLabel}
        onConfirm={confirmBulkDelete}
        onCancel={cancelBulkDeleteConfirm}
      />
      <BulkDeleteConfirmModal
        open={selectionDeleteOpen}
        count={slotSelection.length}
        clientLabel={bulkDeleteClientLabel}
        onConfirm={() => {
          dispatch(bulkDeleteSlots(slotSelection));
          dispatch(clearSlotSelection());
          setSelectionDeleteOpen(false);
        }}
        onCancel={() => setSelectionDeleteOpen(false)}
      />
      <div className="absmapStage">
        {mapInner}
        {slotTypePopAnchor && slotsForTypePopover.length > 0 && (
          <SlotTypePopover
            anchor={slotTypePopAnchor}
            slots={slotsForTypePopover}
            onPickType={(slotType) => {
              dispatch(bulkSetSlotsParkingType({ slotIds: slotTypePopTargetIds, slot_type: slotType }));
              dismissSlotTypePopover();
            }}
            onDismiss={dismissSlotTypePopover}
          />
        )}
      </div>
    </AppShell>
  );
}

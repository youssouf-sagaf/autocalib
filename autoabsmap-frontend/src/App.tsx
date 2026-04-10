import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { addCrop, undo, redo } from './store/autoabsmap-slice';
import { usePolygonDraw } from './hooks/usePolygonDraw';
import { useAddSlot } from './hooks/useAddSlot';
import { useDeleteSlot } from './hooks/useDeleteSlot';
import { useBulkDelete } from './hooks/useBulkDelete';
import { useCopySlot } from './hooks/useCopySlot';
import { useModifySlot } from './hooks/useModifySlot';
import { useStraightenSlot } from './hooks/useStraightenSlot';
import { useReprocessSlot } from './hooks/useReprocessSlot';
import { useJobStream } from './hooks/useJobStream';
import { AppShell } from './features/layout/AppShell';
import { MapPanel, type MapViewState } from './map/MapPanel';
import { CropPanel } from './features/crops/CropPanel';
import './App.css';

export default function App() {
  const dispatch = useAppDispatch();
  const dualMapActive = useAppSelector((s) => s.absmap.dualMapActive);
  const editMode = useAppSelector((s) => s.absmap.editMode);
  const editIndex = useAppSelector((s) => s.absmap.editIndex);
  const editHistoryLen = useAppSelector((s) => s.absmap.editHistory.length);
  const canUndo = editIndex > 0;
  const canRedo = editIndex < editHistoryLen;

  /* ── Shared viewState for synced maps ── */
  const [viewState, setViewState] = useState<MapViewState>({
    longitude: 2.3488,
    latitude: 48.8534,
    zoom: 12,
  });
  const handleMove = useCallback(
    (evt: { viewState: MapViewState }) => setViewState(evt.viewState),
    [],
  );
  const handleFlyTo = useCallback(
    (lng: number, lat: number) =>
      setViewState((prev) => ({ ...prev, longitude: lng, latitude: lat, zoom: 17 })),
    [],
  );

  /* ── Polygon drawing ── */
  const onCropComplete = useCallback(
    (polygon: GeoJSON.Polygon) => dispatch(addCrop({ polygon })),
    [dispatch],
  );

  const {
    isDrawing,
    startDrawing,
    stopDrawing,
    previewFeature,
    edgeFeature,
    vertexFeatures,
    handleClick,
    handleMouseMove,
    handleKeyDown,
    cursor,
  } = usePolygonDraw({ onComplete: onCropComplete });

  /* ── Add slot mode ── */
  const {
    isAddMode,
    pendingSlot,
    hasPending,
    handleMapClick: handleAddClick,
    handleMouseMove: handleAddMouseMove,
    handleKeyDown: handleAddKeyDown,
    toggleAddMode: rawToggleAddMode,
    confirmSlot,
    cancelSlot,
  } = useAddSlot();

  /* ── General selection (browse mode) ── */
  const [browseSelectedId, setBrowseSelectedId] = useState<string | null>(null);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);

  /* ── Delete slot mode ── */
  const {
    isDeleteMode,
    selectedSlotId: deleteSelectedId,
    handleMapClick: handleDeleteClick,
    handleKeyDown: handleDeleteKeyDown,
    toggleDeleteMode: rawToggleDeleteMode,
    confirmDelete,
    cancelDelete,
  } = useDeleteSlot();

  /* ── Bulk delete (lasso) ── */
  const {
    isBulkDeleteMode,
    previewIds: bulkPreviewSlotIds,
    previewFeature: bulkPreviewFeature,
    edgeFeature: bulkEdgeFeature,
    vertexFeatures: bulkVertexFeatures,
    toggleBulkDeleteMode: rawToggleBulkDeleteMode,
    confirmBulkDelete,
    cancelBulkDelete,
    handleMapClick: handleBulkMapClick,
    handleMouseMove: handleBulkMouseMove,
    handleKeyDown: handleBulkKeyDown,
  } = useBulkDelete();

  /* ── Modify slot mode ── */
  const {
    isModifyMode,
    modifyingSlot,
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

  /* ── Copy slot mode (needs modifySelectSlotById for auto-switch) ── */
  const {
    isCopyMode,
    handleMapClick: handleCopyClick,
    handleKeyDown: handleCopyKeyDown,
    toggleCopyMode: rawToggleCopyMode,
  } = useCopySlot(modifySelectSlotById);

  /* ── Straighten mode ── */
  const {
    isStraightenMode,
    handleMapClick: handleStraightenClick,
    handleKeyDown: handleStraightenKeyDown,
    toggleStraightenMode: rawToggleStraightenMode,
    cancelStraighten,
  } = useStraightenSlot();

  /* ── Reprocess mode ── */
  const {
    isReprocessMode,
    reprocessStep,
    reprocessProposedSlots,
    pendingRefSlot,
    hasPendingRef,
    loading: reprocessLoading,
    error: reprocessError,
    handleMapClick: handleReprocessClick,
    handleMouseMove: handleReprocessMouseMove,
    handleKeyDown: handleReprocessKeyDown,
    toggleReprocessMode: rawToggleReprocessMode,
    cancelReprocess,
    acceptProposed,
    rejectProposed,
    scopePreviewFeature,
    scopeEdgeFeature,
    scopeVertexFeatures,
    cursor: reprocessCursor,
  } = useReprocessSlot();

  /* ── Mutual exclusion: exit whichever mode is active ── */
  const exitCurrentMode = useCallback(() => {
    if (isDrawing) stopDrawing();
    if (isAddMode) cancelSlot();
    if (isDeleteMode) cancelDelete();
    if (isCopyMode) rawToggleCopyMode();
    if (isModifyMode) cancelModify();
    if (isStraightenMode) cancelStraighten();
    if (isBulkDeleteMode) cancelBulkDelete();
    if (isReprocessMode) cancelReprocess();
  }, [
    isDrawing,
    stopDrawing,
    isAddMode,
    cancelSlot,
    isDeleteMode,
    cancelDelete,
    isCopyMode,
    rawToggleCopyMode,
    isModifyMode,
    cancelModify,
    isStraightenMode,
    cancelStraighten,
    isBulkDeleteMode,
    cancelBulkDelete,
    isReprocessMode,
    cancelReprocess,
  ]);

  const enterMode = useCallback(
    (toggle: () => void) => {
      exitCurrentMode();
      setBrowseSelectedId(null);
      toggle();
    },
    [exitCurrentMode],
  );

  const toggleAddMode = useCallback(() => enterMode(rawToggleAddMode), [enterMode, rawToggleAddMode]);
  const toggleDeleteMode = useCallback(() => enterMode(rawToggleDeleteMode), [enterMode, rawToggleDeleteMode]);
  const toggleCopyMode = useCallback(() => enterMode(rawToggleCopyMode), [enterMode, rawToggleCopyMode]);
  const toggleModifyMode = useCallback(() => enterMode(rawToggleModifyMode), [enterMode, rawToggleModifyMode]);
  const toggleStraightenMode = useCallback(() => enterMode(rawToggleStraightenMode), [enterMode, rawToggleStraightenMode]);
  const toggleReprocessMode = useCallback(() => enterMode(rawToggleReprocessMode), [enterMode, rawToggleReprocessMode]);
  const toggleBulkDeleteMode = useCallback(
    () => enterMode(rawToggleBulkDeleteMode),
    [enterMode, rawToggleBulkDeleteMode],
  );
  const startDrawingExclusive = useCallback(() => { exitCurrentMode(); startDrawing(); }, [exitCurrentMode, startDrawing]);

  const isAnyEditMode =
    isAddMode || isDeleteMode || isBulkDeleteMode || isCopyMode || isModifyMode || isStraightenMode || isReprocessMode;

  /* ── Unified selectedSlotId (browse or delete mode) ── */
  const straightenAnchorSlotId = useAppSelector((s) => s.absmap.straightenAnchorSlotId);
  const activeSelectedSlotId =
    isDeleteMode
      ? deleteSelectedId
      : isStraightenMode && straightenAnchorSlotId
        ? straightenAnchorSlotId
        : browseSelectedId;

  /* ── Composed map click ── */
  const composedMapClick = useCallback(
    (e: Parameters<typeof handleClick>[0]) => {
      if (isAddMode) { handleAddClick(e); return; }
      if (isDeleteMode) { handleDeleteClick(e); return; }
      if (isBulkDeleteMode) { handleBulkMapClick(e); return; }
      if (isCopyMode) { handleCopyClick(e); return; }
      if (isModifyMode) { handleModifyClick(e); return; }
      if (isStraightenMode) { handleStraightenClick(e); return; }
      if (isReprocessMode) { handleReprocessClick(e); return; }

      const features = e.features;
      if (features && features.length > 0) {
        const slotId = features[0]?.properties?.slot_id as string | undefined;
        if (slotId) {
          setBrowseSelectedId((prev) => prev === slotId ? null : slotId);
        }
      } else {
        setBrowseSelectedId(null);
      }

      handleClick(e);
    },
    [
      isAddMode,
      isDeleteMode,
      isBulkDeleteMode,
      isCopyMode,
      isModifyMode,
      isStraightenMode,
      isReprocessMode,
      handleClick,
      handleAddClick,
      handleDeleteClick,
      handleBulkMapClick,
      handleCopyClick,
      handleModifyClick,
      handleStraightenClick,
      handleReprocessClick,
    ],
  );

  /* ── Composed mouse move (hover tracking + mode handlers) ── */
  const composedMouseMove = useCallback(
    (e: Parameters<typeof handleMouseMove>[0]) => {
      if (isAddMode) handleAddMouseMove(e);
      if (isBulkDeleteMode) handleBulkMouseMove(e);
      if (isModifyMode) handleModifyMouseMove(e);
      if (isReprocessMode) handleReprocessMouseMove(e);

      const features = e.features;
      if (features && features.length > 0) {
        const slotId = features[0]?.properties?.slot_id as string | undefined;
        setHoveredSlotId(slotId ?? null);
      } else {
        setHoveredSlotId(null);
      }

      handleMouseMove(e);
    },
    [isAddMode, isBulkDeleteMode, isModifyMode, isReprocessMode, handleAddMouseMove, handleBulkMouseMove, handleModifyMouseMove, handleReprocessMouseMove, handleMouseMove],
  );

  /* ── Composed mousedown / mouseup (modify drag-and-drop) ── */
  const composedMouseDown = useCallback(
    (e: Parameters<typeof handleClick>[0]) => {
      if (isModifyMode) handleModifyMouseDown(e);
    },
    [isModifyMode, handleModifyMouseDown],
  );

  const composedMouseUp = useCallback(
    () => {
      if (isModifyMode) handleModifyMouseUp();
    },
    [isModifyMode, handleModifyMouseUp],
  );

  const drawPreviewFeature = isReprocessMode ? scopePreviewFeature : isBulkDeleteMode ? bulkPreviewFeature : previewFeature;
  const drawEdgeFeature = isReprocessMode ? scopeEdgeFeature : isBulkDeleteMode ? bulkEdgeFeature : edgeFeature;
  const drawVertexFeatures = isReprocessMode ? scopeVertexFeatures : isBulkDeleteMode ? bulkVertexFeatures : vertexFeatures;

  /* ── Composed cursor ── */
  const composedCursor = (() => {
    if (isAddMode) return 'crosshair';
    if (isDeleteMode) return 'crosshair';
    if (isBulkDeleteMode) return 'crosshair';
    if (isCopyMode) return 'copy';
    if (isModifyMode) return 'move';
    if (isStraightenMode) return 'crosshair';
    if (isReprocessMode) return reprocessCursor || 'crosshair';
    return cursor;
  })();

  /* ── SSE progress stream ── */
  useJobStream();

  /* ── Overlay data for right map ── */
  const overlayVisibility = useAppSelector((s) => s.absmap.overlayVisibility);
  const maskPolygons = useAppSelector((s) => s.absmap.maskPolygons);
  const detectionOverlay = useAppSelector((s) => s.absmap.detectionOverlay);
  const postprocessOverlay = useAppSelector((s) => s.absmap.postprocessOverlay);

  const overlays = useMemo(() => {
    const data: Record<string, GeoJSON.FeatureCollection> = {};
    if (overlayVisibility.detection && detectionOverlay) {
      data.detection = detectionOverlay;
    }
    if (overlayVisibility.mask && maskPolygons) {
      data.mask = maskPolygons;
    }
    if (overlayVisibility.postprocess && postprocessOverlay) {
      data.postprocess = postprocessOverlay;
    }
    return Object.keys(data).length > 0 ? data : undefined;
  }, [overlayVisibility, detectionOverlay, maskPolygons, postprocessOverlay]);

  /* ── Keyboard shortcuts ── */
  const modeKeyMap: Record<string, () => void> = {
    a: toggleAddMode,
    d: toggleDeleteMode,
    b: toggleBulkDeleteMode,
    c: toggleCopyMode,
    m: toggleModifyMode,
    s: toggleStraightenMode,
    r: toggleReprocessMode,
  };

  const composedKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        handleKeyDown(e);
        return;
      }

      const key = e.key.toLowerCase();

      if (key === 'z' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (e.shiftKey) dispatch(redo());
        else dispatch(undo());
        return;
      }

      if (isBulkDeleteMode && (e.key === 'Enter' || e.key === 'Escape')) {
        handleBulkKeyDown(e);
        return;
      }

      const modeToggle = modeKeyMap[key];
      if (modeToggle) {
        e.preventDefault();
        modeToggle();
        return;
      }

      handleAddKeyDown(e);
      handleDeleteKeyDown(e);
      handleCopyKeyDown(e);
      handleModifyKeyDown(e);
      handleStraightenKeyDown(e);
      handleReprocessKeyDown(e);
      handleKeyDown(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      dispatch,
      toggleAddMode,
      toggleDeleteMode,
      toggleBulkDeleteMode,
      toggleCopyMode,
      toggleModifyMode,
      toggleStraightenMode,
      toggleReprocessMode,
      isBulkDeleteMode,
      handleBulkKeyDown,
      handleAddKeyDown,
      handleDeleteKeyDown,
      handleCopyKeyDown,
      handleModifyKeyDown,
      handleStraightenKeyDown,
      handleReprocessKeyDown,
      handleKeyDown,
    ],
  );

  useEffect(() => {
    window.addEventListener('keydown', composedKeyDown);
    return () => window.removeEventListener('keydown', composedKeyDown);
  }, [composedKeyDown]);

  const handleUndo = useCallback(() => dispatch(undo()), [dispatch]);
  const handleRedo = useCallback(() => dispatch(redo()), [dispatch]);

  /* ── Sidebar ── */
  const sidebar = (
    <CropPanel
      isDrawing={isDrawing}
      onStartDraw={startDrawingExclusive}
      onStopDraw={stopDrawing}
      onToggleAddMode={toggleAddMode}
      onConfirmAdd={confirmSlot}
      onCancelAdd={cancelSlot}
      hasPendingSlot={hasPending}
      onToggleDeleteMode={toggleDeleteMode}
      onConfirmDelete={confirmDelete}
      onCancelDelete={cancelDelete}
      onToggleBulkDeleteMode={toggleBulkDeleteMode}
      onConfirmBulkDelete={confirmBulkDelete}
      onCancelBulkDelete={cancelBulkDelete}
      bulkPreviewCount={bulkPreviewSlotIds?.length ?? 0}
      bulkHasPreview={bulkPreviewSlotIds !== null}
      onToggleCopyMode={toggleCopyMode}
      onToggleModifyMode={toggleModifyMode}
      onCancelModify={cancelModify}
      onToggleStraightenMode={toggleStraightenMode}
      onCancelStraighten={cancelStraighten}
      onToggleReprocessMode={toggleReprocessMode}
      onAcceptReprocess={acceptProposed}
      onRejectReprocess={rejectProposed}
      onCancelReprocess={cancelReprocess}
      reprocessStep={reprocessStep}
      hasPendingRef={hasPendingRef}
      reprocessProposedCount={reprocessProposedSlots.length}
      reprocessLoading={reprocessLoading}
      reprocessError={reprocessError}
      onUndo={handleUndo}
      onRedo={handleRedo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  );

  const pendingOrModifyingSlot = pendingSlot ?? modifyingSlot ?? pendingRefSlot;

  return (
    <AppShell isDrawing={isDrawing} editMode={editMode} sidebar={sidebar} onFlyTo={handleFlyTo}>
      {dualMapActive ? (
        <div className="dualMapContainer">
          <MapPanel
            viewState={viewState}
            onMove={handleMove}
            showCrops
            showSlots={false}
            showCentroids={false}
            label="Reference"
          />
          <div className="dualMapDivider" />
          <MapPanel
            viewState={viewState}
            onMove={handleMove}
            onMapClick={composedMapClick}
            onMouseMove={composedMouseMove}
            onMouseDown={composedMouseDown}
            onMouseUp={composedMouseUp}
            cursor={composedCursor}
            previewFeature={drawPreviewFeature}
            edgeFeature={drawEdgeFeature}
            vertexFeatures={drawVertexFeatures}
            bulkPreviewSlotIds={bulkPreviewSlotIds}
            showCrops
            showSlots
            showCentroids
            label="Detections"
            overlays={overlays}
            pendingSlot={pendingOrModifyingSlot}
            selectedSlotId={activeSelectedSlotId}
            hoveredSlotId={hoveredSlotId}
            modifyingSlot={modifyingSlot}
            isEditMode={isAnyEditMode}
            dragPanEnabled={!isModifyDragLocked}
            reprocessProposedSlots={reprocessProposedSlots.length > 0 ? reprocessProposedSlots : undefined}
          />
        </div>
      ) : (
        <MapPanel
          viewState={viewState}
          onMove={handleMove}
          onMapClick={composedMapClick}
          onMouseMove={composedMouseMove}
          onMouseDown={composedMouseDown}
          onMouseUp={composedMouseUp}
          cursor={composedCursor}
          previewFeature={drawPreviewFeature}
          edgeFeature={drawEdgeFeature}
          vertexFeatures={drawVertexFeatures}
          bulkPreviewSlotIds={bulkPreviewSlotIds}
          showCrops
          showSlots
          showCentroids
          pendingSlot={pendingOrModifyingSlot}
          selectedSlotId={activeSelectedSlotId}
          hoveredSlotId={hoveredSlotId}
          modifyingSlot={modifyingSlot}
          isEditMode={isAnyEditMode}
          dragPanEnabled={!isModifyDragLocked}
          reprocessProposedSlots={reprocessProposedSlots.length > 0 ? reprocessProposedSlots : undefined}
        />
      )}
    </AppShell>
  );
}

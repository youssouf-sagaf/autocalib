import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { addCrop, undo, redo } from './store/autoabsmap-slice';
import { usePolygonDraw } from './hooks/usePolygonDraw';
import { useAddSlot } from './hooks/useAddSlot';
import { useDeleteSlot } from './hooks/useDeleteSlot';
import { useCopySlot } from './hooks/useCopySlot';
import { useModifySlot } from './hooks/useModifySlot';
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

  /* ── Modify slot mode ── */
  const {
    isModifyMode,
    modifyingSlot,
    handleMapClick: handleModifyClick,
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

  /* ── Mutual exclusion: exit whichever mode is active ── */
  const exitCurrentMode = useCallback(() => {
    if (isDrawing) stopDrawing();
    if (isAddMode) cancelSlot();
    if (isDeleteMode) cancelDelete();
    if (isCopyMode) rawToggleCopyMode();
    if (isModifyMode) cancelModify();
  }, [isDrawing, stopDrawing, isAddMode, cancelSlot, isDeleteMode, cancelDelete, isCopyMode, rawToggleCopyMode, isModifyMode, cancelModify]);

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
  const startDrawingExclusive = useCallback(() => { exitCurrentMode(); startDrawing(); }, [exitCurrentMode, startDrawing]);

  const isAnyEditMode = isAddMode || isDeleteMode || isCopyMode || isModifyMode;

  /* ── Unified selectedSlotId (browse or delete mode) ── */
  const activeSelectedSlotId = isDeleteMode ? deleteSelectedId : browseSelectedId;

  /* ── Composed map click ── */
  const composedMapClick = useCallback(
    (e: Parameters<typeof handleClick>[0]) => {
      if (isAddMode) { handleAddClick(e); return; }
      if (isDeleteMode) { handleDeleteClick(e); return; }
      if (isCopyMode) { handleCopyClick(e); return; }
      if (isModifyMode) { handleModifyClick(e); return; }

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
    [isAddMode, isDeleteMode, isCopyMode, isModifyMode, handleClick, handleAddClick, handleDeleteClick, handleCopyClick, handleModifyClick],
  );

  /* ── Composed mouse move (hover tracking + mode handlers) ── */
  const composedMouseMove = useCallback(
    (e: Parameters<typeof handleMouseMove>[0]) => {
      if (isAddMode) handleAddMouseMove(e);
      if (isModifyMode) handleModifyMouseMove(e);

      const features = e.features;
      if (features && features.length > 0) {
        const slotId = features[0]?.properties?.slot_id as string | undefined;
        setHoveredSlotId(slotId ?? null);
      } else {
        setHoveredSlotId(null);
      }

      handleMouseMove(e);
    },
    [isAddMode, isModifyMode, handleAddMouseMove, handleModifyMouseMove, handleMouseMove],
  );

  /* ── Composed cursor ── */
  const composedCursor = (() => {
    if (isAddMode) return 'crosshair';
    if (isDeleteMode) return 'crosshair';
    if (isCopyMode) return 'copy';
    if (isModifyMode) return 'move';
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
    c: toggleCopyMode,
    m: toggleModifyMode,
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
      handleKeyDown(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, toggleAddMode, toggleDeleteMode, toggleCopyMode, toggleModifyMode,
     handleAddKeyDown, handleDeleteKeyDown, handleCopyKeyDown, handleModifyKeyDown, handleKeyDown],
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
      onToggleCopyMode={toggleCopyMode}
      onToggleModifyMode={toggleModifyMode}
      onCancelModify={cancelModify}
      onUndo={handleUndo}
      onRedo={handleRedo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  );

  const pendingOrModifyingSlot = pendingSlot ?? modifyingSlot;

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
            cursor={composedCursor}
            previewFeature={previewFeature}
            edgeFeature={edgeFeature}
            vertexFeatures={vertexFeatures}
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
          />
        </div>
      ) : (
        <MapPanel
          viewState={viewState}
          onMove={handleMove}
          onMapClick={composedMapClick}
          onMouseMove={composedMouseMove}
          cursor={composedCursor}
          previewFeature={previewFeature}
          edgeFeature={edgeFeature}
          vertexFeatures={vertexFeatures}
          showCrops
          showSlots
          showCentroids
          pendingSlot={pendingOrModifyingSlot}
          selectedSlotId={activeSelectedSlotId}
          hoveredSlotId={hoveredSlotId}
          modifyingSlot={modifyingSlot}
          isEditMode={isAnyEditMode}
        />
      )}
    </AppShell>
  );
}

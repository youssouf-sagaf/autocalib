import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { addCrop } from './store/autoabsmap-slice';
import { useRectangleDraw } from './hooks/useRectangleDraw';
import { useJobStream } from './hooks/useJobStream';
import { AppShell } from './features/layout/AppShell';
import { MapPanel, type MapViewState } from './map/MapPanel';
import { CropPanel } from './features/crops/CropPanel';
import './App.css';

export default function App() {
  const dispatch = useAppDispatch();
  const dualMapActive = useAppSelector((s) => s.absmap.dualMapActive);

  /* ── Shared viewState for synced maps ── */
  const [viewState, setViewState] = useState<MapViewState>({
    longitude: 2.3522,
    latitude: 48.8566,
    zoom: 17,
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

  /* ── Rectangle drawing ── */
  const onCropComplete = useCallback(
    (polygon: GeoJSON.Polygon) => dispatch(addCrop({ polygon })),
    [dispatch],
  );

  const {
    isDrawing,
    startDrawing,
    stopDrawing,
    previewFeature,
    handleClick,
    handleMouseMove,
    handleKeyDown,
    cursor,
  } = useRectangleDraw({ onComplete: onCropComplete });

  /* ── SSE progress stream ── */
  useJobStream();

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  /* ── Sidebar ── */
  const sidebar = (
    <CropPanel
      isDrawing={isDrawing}
      onStartDraw={startDrawing}
      onStopDraw={stopDrawing}
    />
  );

  return (
    <AppShell isDrawing={isDrawing} sidebar={sidebar} onFlyTo={handleFlyTo}>
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
            onMapClick={handleClick}
            onMouseMove={handleMouseMove}
            cursor={cursor}
            previewFeature={previewFeature}
            showCrops
            showSlots
            showCentroids
            label="Detections"
          />
        </div>
      ) : (
        <MapPanel
          viewState={viewState}
          onMove={handleMove}
          onMapClick={handleClick}
          onMouseMove={handleMouseMove}
          cursor={cursor}
          previewFeature={previewFeature}
          showCrops
          showSlots
          showCentroids
        />
      )}
    </AppShell>
  );
}

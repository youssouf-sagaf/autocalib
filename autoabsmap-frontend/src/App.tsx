import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { addCrop } from './store/autoabsmap-slice';
import { usePolygonDraw } from './hooks/usePolygonDraw';
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
            edgeFeature={edgeFeature}
            vertexFeatures={vertexFeatures}
            showCrops
            showSlots
            showCentroids
            label="Detections"
            overlays={overlays}
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
          edgeFeature={edgeFeature}
          vertexFeatures={vertexFeatures}
          showCrops
          showSlots
          showCentroids
        />
      )}
    </AppShell>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import Map, { Layer, NavigationControl, Source } from 'react-map-gl/mapbox';
import type { MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client';
import { AnnotationPanel } from '../features/annotation-canvas/AnnotationPanel';
import { AnnotationStage } from '../features/annotation-canvas/AnnotationStage';
import { CropControls } from '../features/annotation-canvas/CropControls';
import { useRoiRectDraw, TRAINING_ROI_SIZE_M, type RoiVertex } from '../features/annotation-canvas/useRoiRectDraw';
import { DatasetExplorer } from '../features/dataset-explorer/DatasetExplorer';
import { TrainingDashboard } from '../features/training-dashboard/TrainingDashboard';
import { EvaluationView } from '../features/evaluation-view/EvaluationView';
import { useActivityFeed } from './ActivityFeed';
import { SearchBar } from './SearchBar';
import { RightPanel } from './RightPanel';
import { useWorkspaceLayoutVersion } from './WorkspaceLayoutContext';
import { WorkspaceShell, type WorkspaceTab } from './WorkspaceShell';
import { isEditableTarget } from '../utils/isEditableTarget';
import { MapLayerControl } from '../map/MapLayerControl';
import {
  buildIgnTileUrl,
  IGN_LAYER_PRESETS,
  mapStyleForImagery,
} from '../map/imageryLayers';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setMapViewState, setTiles } from '../store/studio-slice';
import type { ObAnnotation, ObAnnotationClass, TileDetail, TileSummary } from '../types';
import { obbToWire, tileRowToDetail } from '../utils/annotationWire';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

const EMPTY_FC = {
  type: 'FeatureCollection' as const,
  features: [],
};

type LngLat = { lng: number; lat: number };

function uuid(): string {
  return crypto.randomUUID();
}

function obbFromThreePoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): [number, number, number, number, number] {
  const cx = p1.x;
  const cy = p1.y;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const width = Math.hypot(dx, dy) * 2;
  const angle = Math.atan2(dy, dx);
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);
  const halfH = Math.abs((p3.x - cx) * perpX + (p3.y - cy) * perpY) || 20;
  return [cx, cy, width, halfH * 2, angle];
}

const PLACE_TILE_SHORTCUT = 't';

export function WorkspacePage() {
  const { t } = useTranslation();
  const { log } = useActivityFeed();
  const dispatch = useAppDispatch();
  const imagerySource = useAppSelector((s) => s.studio.imagerySource);
  const mapViewState = useAppSelector((s) => s.studio.mapViewState);
  const currentTileId = useAppSelector((s) => s.studio.currentTileId);
  const tiles = useAppSelector((s) => s.studio.tiles);
  const [tab, setTab] = useState<WorkspaceTab>('crop');

  const roiRect = useRoiRectDraw();
  const { drawing: drawingRoi, dragging: draggingRoi, isAnchored } = roiRect;
  const [savingRing, setSavingRing] = useState<LngLat[]>([]);
  const [tile, setTile] = useState<TileDetail | null>(null);
  const [annotations, setAnnotations] = useState<ObAnnotation[]>([]);
  const [selectedClass, setSelectedClass] = useState<ObAnnotationClass>('vehicle');
  const [obbClicks, setObbClicks] = useState<{ x: number; y: number }[]>([]);
  const [pendingObb, setPendingObb] = useState<
    [number, number, number, number, number] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MapRef>(null);
  const mapStageRef = useRef<HTMLDivElement>(null);
  const layoutVersion = useWorkspaceLayoutVersion();

  const scheduleMapResize = useCallback(() => {
    mapRef.current?.resize();
    window.setTimeout(() => mapRef.current?.resize(), 220);
  }, []);

  useEffect(() => {
    const el = mapStageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => scheduleMapResize());
    observer.observe(el);
    scheduleMapResize();
    return () => observer.disconnect();
  }, [scheduleMapResize]);

  useEffect(() => {
    scheduleMapResize();
  }, [layoutVersion, imagerySource, scheduleMapResize]);

  const refreshTiles = useCallback(async () => {
    try {
      const { data } = await apiClient.get<TileSummary[]>('/api/tiles');
      dispatch(setTiles(data));
    } catch {
      /* offline */
    }
  }, [dispatch]);

  useEffect(() => {
    void refreshTiles();
  }, [refreshTiles]);

  const loadTileForAnnotation = useCallback(async (tileId: string) => {
    setLoading(true);
    try {
      const { data: detail } = await apiClient.get<Record<string, unknown>>(
        `/api/tiles/${tileId}`,
      );
      const tileDetail = tileRowToDetail(detail);
      const flags = detail.flags as Record<string, string> | undefined;
      setTile(tileDetail);
      setAnnotations(flags?.background === 'true' ? [] : (tileDetail.annotations ?? []));
      setObbClicks([]);
      setPendingObb(null);
    } catch (err) {
      console.error(err);
      setTile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentTileId) {
      setTile(null);
      setAnnotations([]);
      return;
    }
    void loadTileForAnnotation(currentTileId);
  }, [currentTileId, loadTileForAnnotation]);

  const handleFlyTo = useCallback(
    (lng: number, lat: number, label?: string) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 1200 });
      dispatch(setMapViewState({ longitude: lng, latitude: lat, zoom: 17 }));
      log(label ? `Navigate → ${label}` : `Navigate → ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    },
    [dispatch, log],
  );

  const initialView = mapViewState ?? {
    longitude: 2.3522,
    latitude: 48.8566,
    zoom: 16,
  };

  const saveCurrentCrop = useCallback(async (corners?: RoiVertex[]) => {
    const ring = corners ?? roiRect.getSaveCorners();
    if (ring.length < 4 || loading) return;
    setLoading(true);
    setSavingRing(ring);
    log(`Crop — source ${imagerySource}`);
    try {
      const coords = ring.map((p) => [p.lng, p.lat]);
      coords.push([ring[0]!.lng, ring[0]!.lat]);
      const { data: crop } = await apiClient.post<{
        crop_id: string;
        tiles: { id: string }[];
      }>('/api/crops/fetch', {
        roi_polygon: { type: 'Polygon', coordinates: [coords] },
        source: imagerySource,
        target_gsd: 0.05,
      });
      await refreshTiles();
      roiRect.clearRect();
      roiRect.stopDrawing();
      log(t('crop.saved', { count: crop.tiles.length }));
    } catch (err) {
      log(`Fetch failed: ${String(err)}`);
      console.error(err);
    } finally {
      setSavingRing([]);
      setLoading(false);
    }
  }, [imagerySource, loading, log, refreshTiles, roiRect, t]);

  const onMapMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (!drawingRoi || loading) return;
      const action = roiRect.handleMapMouseDown(e);
      if (action?.action === 'place') {
        void saveCurrentCrop(action.corners);
      }
    },
    [drawingRoi, loading, roiRect, saveCurrentCrop],
  );

  const onMapMouseUp = useCallback(() => {
    roiRect.handleMapMouseUp();
  }, [roiRect]);

  const onMapMove = useCallback(
    (e: MapMouseEvent) => {
      roiRect.handleMapMove(e);
    },
    [roiRect],
  );

  const activateDrawRoi = useCallback(() => {
    roiRect.clearRect();
    roiRect.startDrawing();
    log(t('annotate.drawRoiActive', { meters: TRAINING_ROI_SIZE_M.toFixed(1) }));
  }, [log, roiRect, t]);

  const toggleDrawRoi = useCallback(() => {
    if (drawingRoi) {
      roiRect.stopDrawing();
    } else {
      activateDrawRoi();
    }
  }, [activateDrawRoi, drawingRoi, roiRect]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape' && drawingRoi) {
        roiRect.stopDrawing();
        e.preventDefault();
        return;
      }

      if (e.key.toLowerCase() !== PLACE_TILE_SHORTCUT) return;

      e.preventDefault();
      if (tab !== 'crop') {
        setTab('crop');
      }
      if (loading) return;
      if (drawingRoi) {
        roiRect.stopDrawing();
      } else {
        activateDrawRoi();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activateDrawRoi, drawingRoi, loading, roiRect, tab]);

  useEffect(() => {
    if (!draggingRoi) return;
    const onUp = () => roiRect.handleMapMouseUp();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [draggingRoi, roiRect]);

  const onCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!tile?.width || !tile?.height) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * tile.width;
    const y = ((ev.clientY - rect.top) / rect.height) * tile.height;
    const next = [...obbClicks, { x, y }];
    if (next.length < 3) {
      setObbClicks(next);
      return;
    }
    setPendingObb(obbFromThreePoints(next[0]!, next[1]!, next[2]!));
    setObbClicks([]);
  };

  const commitObb = () => {
    if (!pendingObb) return;
    setAnnotations((prev) => [
      ...prev,
      { id: uuid(), class: selectedClass, obb: pendingObb },
    ]);
    setPendingObb(null);
    log(`OBB added (${selectedClass})`);
  };

  const markBackground = async () => {
    if (!currentTileId) return;
    setLoading(true);
    try {
      await apiClient.post(`/api/annotations/${currentTileId}/flags`, {
        flag: 'background',
        value: 'true',
      });
      setAnnotations([]);
      setPendingObb(null);
      setObbClicks([]);
      log('Tile marked background (hard-negative)');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveAnnotations = async () => {
    if (!currentTileId) return;
    setLoading(true);
    try {
      const wire = annotations.filter((a) => a.class !== 'background').map(obbToWire);
      await apiClient.put(`/api/annotations/${currentTileId}`, { annotations: wire });
      log(t('annotate.saved', { count: wire.length }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };


  const savingRingFeature =
    savingRing.length === 4
      ? {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [...savingRing, savingRing[0]!].map((v) => [v.lng, v.lat] as [number, number]),
            ],
          },
        }
      : null;

  const leftPanel = (tab: WorkspaceTab) => {
    if (tab === 'crop') {
      return (
        <CropControls
          drawingRoi={drawingRoi}
          loading={loading}
          tileCount={tiles.length}
          recentTiles={tiles}
          onToggleDrawRoi={toggleDrawRoi}
          shortcutKey={PLACE_TILE_SHORTCUT.toUpperCase()}
        />
      );
    }
    if (tab === 'annotation') {
      return (
        <AnnotationPanel
          selectedClass="vehicle"
          onSelectClass={() => setSelectedClass('vehicle')}
          loading={loading}
          hasPendingObb={!!pendingObb}
          onCommitObb={commitObb}
          onMarkBackground={() => void markBackground()}
          onSave={() => void saveAnnotations()}
          onRefreshTiles={() => void refreshTiles()}
        />
      );
    }
    if (tab === 'inference') {
      return <TrainingDashboard embedded />;
    }
    return (
      <>
        <DatasetExplorer embedded />
        <EvaluationView embedded />
      </>
    );
  };

  const centerPanel = (tab: WorkspaceTab) => {
    if (tab === 'annotation') {
      return (
        <AnnotationStage
          tile={tile}
          tileId={currentTileId}
          annotations={annotations}
          obbClicks={obbClicks}
          pendingObb={pendingObb}
          onCanvasClick={onCanvasClick}
        />
      );
    }

    return (
      <div className={`map-stage ${drawingRoi ? 'map-stage-drawing' : ''}`} ref={mapStageRef}>
        <SearchBar onFlyTo={handleFlyTo} />
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={initialView}
          onLoad={scheduleMapResize}
          onMoveEnd={(evt) =>
            dispatch(
              setMapViewState({
                longitude: evt.viewState.longitude,
                latitude: evt.viewState.latitude,
                zoom: evt.viewState.zoom,
              }),
            )
          }
          mapStyle={mapStyleForImagery(imagerySource)}
          dragPan={!(tab === 'crop' && drawingRoi)}
          doubleClickZoom={!(tab === 'crop' && drawingRoi)}
          onMouseDown={tab === 'crop' ? onMapMouseDown : undefined}
          onMouseUp={tab === 'crop' ? onMapMouseUp : undefined}
          onMouseMove={tab === 'crop' ? onMapMove : undefined}
          cursor={
            tab === 'crop' && drawingRoi
              ? loading
                ? 'wait'
                : draggingRoi
                  ? 'grabbing'
                  : isAnchored
                    ? 'grab'
                    : 'crosshair'
              : 'grab'
          }
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="bottom-right" />
          <MapLayerControl />

          <Source id="map-anchor" type="geojson" data={EMPTY_FC}>
            <Layer id="map-anchor-fill" type="fill" paint={{ 'fill-opacity': 0 }} />
          </Source>

          {imagerySource !== 'mapbox' && (() => {
            const preset = IGN_LAYER_PRESETS[imagerySource];
            return (
              <Source
                id="imagery-overlay"
                key={`ign-${imagerySource}`}
                type="raster"
                tiles={[buildIgnTileUrl(preset.layer, preset.format)]}
                tileSize={256}
                attribution="© IGN/Géoportail"
                maxzoom={preset.maxZoom}
              >
                <Layer
                  id="imagery-overlay-layer"
                  type="raster"
                  beforeId="map-anchor-fill"
                />
              </Source>
            );
          })()}

          {tab === 'crop' && roiRect.edgeFeature && (
            <Source id="roi-edges" type="geojson" data={roiRect.edgeFeature}>
              <Layer
                id="roi-edges-line"
                type="line"
                paint={{
                  'line-color': '#37bc9b',
                  'line-width': 2,
                  'line-dasharray': isAnchored ? [1, 0] : [2, 2],
                }}
              />
            </Source>
          )}

          {tab === 'crop' && savingRingFeature && (
            <Source id="roi-saving" type="geojson" data={savingRingFeature}>
              <Layer
                id="roi-saving-fill"
                type="fill"
                paint={{ 'fill-color': '#37bc9b', 'fill-opacity': 0.35 }}
              />
              <Layer
                id="roi-saving-line"
                type="line"
                paint={{ 'line-color': '#37bc9b', 'line-width': 2 }}
              />
            </Source>
          )}

          {tab === 'crop' && roiRect.fillFeature && !savingRingFeature && (
            <Source id="roi" type="geojson" data={roiRect.fillFeature}>
              <Layer
                id="roi-fill"
                type="fill"
                paint={{ 'fill-color': '#37bc9b', 'fill-opacity': isAnchored ? 0.22 : 0.12 }}
              />
              <Layer
                id="roi-line"
                type="line"
                paint={{ 'line-color': '#37bc9b', 'line-width': 2 }}
              />
            </Source>
          )}
        </Map>
        {!MAPBOX_TOKEN && (
          <div className="map-warning">{t('workspace.noMapboxToken')}</div>
        )}
      </div>
    );
  };

  return (
    <WorkspaceShell
      tab={tab}
      onTabChange={setTab}
      leftPanel={leftPanel}
      centerPanel={centerPanel}
      rightPanel={<RightPanel />}
    />
  );
}

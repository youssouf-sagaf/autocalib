import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, NavigationControl, Source } from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client';
import { MapLayerControl } from '../../map/MapLayerControl';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setCurrentTileId, setMapViewState, setTiles } from '../../store/studio-slice';
import type { ObAnnotation, ObAnnotationClass, TileDetail } from '../../types';
import { obbToWire, tileRowToDetail } from '../../utils/annotationWire';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

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
  const halfH =
    Math.abs((p3.x - cx) * perpX + (p3.y - cy) * perpY) || 20;
  const height = halfH * 2;
  return [cx, cy, width, height, angle];
}

function drawObbOnCanvas(
  ctx: CanvasRenderingContext2D,
  obb: [number, number, number, number, number],
  stroke: string,
) {
  const [cx, cy, w, h, angle] = obb;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const localCorners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const corners = localCorners.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
  ctx.beginPath();
  ctx.moveTo(corners[0]!.x, corners[0]!.y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i]!.x, corners[i]!.y);
  }
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function AnnotationWorkspace() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const imagerySource = useAppSelector((s) => s.studio.imagerySource);
  const mapViewState = useAppSelector((s) => s.studio.mapViewState);
  const currentTileId = useAppSelector((s) => s.studio.currentTileId);

  const [roiRing, setRoiRing] = useState<LngLat[]>([]);
  const [drawingRoi, setDrawingRoi] = useState(false);
  const [tile, setTile] = useState<TileDetail | null>(null);
  const [annotations, setAnnotations] = useState<ObAnnotation[]>([]);
  const [selectedClass, setSelectedClass] = useState<ObAnnotationClass>('vehicle');
  const [obbClicks, setObbClicks] = useState<{ x: number; y: number }[]>([]);
  const [pendingObb, setPendingObb] = useState<
    [number, number, number, number, number] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const initialView = mapViewState ?? {
    longitude: 2.3522,
    latitude: 48.8566,
    zoom: 16,
  };

  const roiGeoJson = useMemo(() => {
    if (roiRing.length < 3) return null;
    const ring = [...roiRing, roiRing[0]!].map((p) => [p.lng, p.lat]);
    return {
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
      properties: {},
    };
  }, [roiRing]);

  const onMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (!drawingRoi) return;
      setRoiRing((prev) => [...prev, { lng: e.lngLat.lng, lat: e.lngLat.lat }]);
    },
    [drawingRoi],
  );

  const fetchTile = async () => {
    if (roiRing.length < 3) return;
    setLoading(true);
    try {
      const ring = roiRing.map((p) => [p.lng, p.lat]);
      ring.push([roiRing[0]!.lng, roiRing[0]!.lat]);
      const { data: crop } = await apiClient.post<{
        crop_id: string;
        tiles: { id: string; name?: string }[];
      }>('/api/crops/fetch', {
        roi_polygon: { type: 'Polygon', coordinates: [ring] },
        source: imagerySource,
        target_gsd: 0.05,
      });
      const first = crop.tiles[0];
      if (!first) return;
      const { data: detail } = await apiClient.get<Record<string, unknown>>(
        `/api/tiles/${first.id}`,
      );
      const tileDetail = tileRowToDetail(detail);
      const flags = detail.flags as Record<string, string> | undefined;
      const isBackground = flags?.background === 'true';
      setTile(tileDetail);
      setAnnotations(isBackground ? [] : (tileDetail.annotations ?? []));
      dispatch(setCurrentTileId(tileDetail.id));
      dispatch(setTiles([{ id: tileDetail.id, name: tileDetail.name }]));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const onCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!tile?.width || !tile.height) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * tile.width;
    const y = ((ev.clientY - rect.top) / rect.height) * tile.height;
    const next = [...obbClicks, { x, y }];
    if (next.length < 3) {
      setObbClicks(next);
      return;
    }
    const obb = obbFromThreePoints(next[0]!, next[1]!, next[2]!);
    setPendingObb(obb);
    setObbClicks([]);
  };

  const commitObb = () => {
    if (!pendingObb) return;
    setAnnotations((prev) => [
      ...prev,
      { id: uuid(), class: selectedClass, obb: pendingObb },
    ]);
    setPendingObb(null);
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
      const wire = annotations
        .filter((a) => a.class !== 'background')
        .map(obbToWire);
      await apiClient.put(`/api/annotations/${currentTileId}`, {
        annotations: wire,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tile?.width || !tile?.height) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const classColor: Record<'vehicle', string> = {
      vehicle: '#da4453',
    };
    for (const ann of annotations) {
      if (ann.class === 'background') continue;
      drawObbOnCanvas(ctx, ann.obb, classColor[ann.class]);
    }
    if (pendingObb) {
      drawObbOnCanvas(ctx, pendingObb, '#3bafda');
    }
    ctx.fillStyle = '#f6bb42';
    for (const p of obbClicks) {
      const sx = (p.x / tile.width) * canvas.width;
      const sy = (p.y / tile.height) * canvas.height;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [annotations, obbClicks, pendingObb, tile]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas, tile?.image_url]);

  return (
    <div className="annotate-layout">
      <aside className="annotate-toolbar">
        <button
          type="button"
          className={drawingRoi ? 'btn primary' : 'btn'}
          onClick={() => setDrawingRoi((d) => !d)}
        >
          {t('annotate.drawRoi')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={roiRing.length < 3 || loading}
          onClick={() => void fetchTile()}
        >
          {t('annotate.fetchTile')}
        </button>
        <p className="hint">{t('annotate.clickObbHint')}</p>
        <div className="class-picker">
          <button
            type="button"
            className={selectedClass === 'vehicle' ? 'chip active' : 'chip'}
            onClick={() => setSelectedClass('vehicle')}
          >
            {t('annotate.classVehicle')}
          </button>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!currentTileId || loading}
          onClick={() => void markBackground()}
        >
          {t('annotate.markBackground')}
        </button>
        {pendingObb && (
          <button type="button" className="btn primary" onClick={commitObb}>
            Add OBB
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={!currentTileId || loading}
          onClick={() => void saveAnnotations()}
        >
          {t('annotate.save')}
        </button>
      </aside>
      <div className="map-stack">
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={initialView}
          onMoveEnd={(evt) =>
            dispatch(
              setMapViewState({
                longitude: evt.viewState.longitude,
                latitude: evt.viewState.latitude,
                zoom: evt.viewState.zoom,
              }),
            )
          }
          mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
          onClick={onMapClick}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="bottom-right" />
          <MapLayerControl />
          {roiGeoJson && (
            <Source id="roi" type="geojson" data={roiGeoJson}>
              <Layer
                id="roi-fill"
                type="fill"
                paint={{ 'fill-color': '#37bc9b', 'fill-opacity': 0.25 }}
              />
              <Layer
                id="roi-line"
                type="line"
                paint={{ 'line-color': '#37bc9b', 'line-width': 2 }}
              />
            </Source>
          )}
        </Map>
        {tile?.image_url && (
          <div className="tile-overlay">
            <img src={tile.image_url} alt="" className="tile-image" />
            <canvas
              ref={canvasRef}
              width={tile.width ?? 640}
              height={tile.height ?? 640}
              className="tile-canvas"
              onClick={onCanvasClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}

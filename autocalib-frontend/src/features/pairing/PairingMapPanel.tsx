import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Map, {
  Source,
  Layer,
  NavigationControl,
  type MapMouseEvent,
  type MapRef,
} from 'react-map-gl/mapbox';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  pairingSelectSlot,
  pairingSetDrawingPoints,
  pairingSetActiveZone,
} from '../../store/autocalib-slice';
import { useAbsmapDisplaySlots } from '../../hooks/useAbsmapDisplaySlots';
import { useAbsmapSyncedMapView } from '../../hooks/useAbsmapSyncedMapView';
import { usePairingVisuals } from '../../hooks/usePairingVisuals';
import { PAIR_PALETTE } from '../../types';
import { SLOT_MARKER_ICON_SIZE, SLOT_TYPE_ICON_IMAGE } from '../../theme/slotTypes';
import { useMapSlotPinLayers } from '../../map/useMapSlotPinLayers';
import { slotTypeForMapIcon } from '../../theme/slotTypes';
import { usePairingDeviceContext } from '../../hooks/usePairingDeviceContext';
import { useFreehandLasso } from '../../hooks/useFreehandLasso';
import { pointInRing } from '../../utils/geoHitTest';
import { Kbd } from '../../ui/Kbd';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import styles from './PairingMapPanel.module.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface PreviewZoneMap {
  polygon: { points: [number, number][] };
  slotIds: string[];
}

interface PairingMapPanelProps {
  panelRef?: RefObject<HTMLDivElement | null>;
  onFinishDrawing?: () => void;
  previewZone?: PreviewZoneMap;
}

export function PairingMapPanel({ panelRef, onFinishDrawing, previewZone }: PairingMapPanelProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const mapRef = useRef<MapRef>(null);
  const { showPinLayers: pinsReady, onMapLoad } = useMapSlotPinLayers(mapRef);
  const slots = useAbsmapDisplaySlots();
  const { viewState, onMove, onMoveEnd } = useAbsmapSyncedMapView();
  const pairing = useAppSelector((s) => s.autocalib.pairing);
  const { activeTool, selectedSlotId, zones, activeZoneId, drawingMapPoints } = pairing;
  const isDrawZone = activeTool === 'draw_zone';
  const {
    linkedSlotIds,
    slotColorMap,
    selectionPreviewColor,
  } = usePairingVisuals();

  const onLassoComplete = useCallback(
    (polygon: GeoJSON.Polygon) => {
      const ring = polygon.coordinates[0] ?? [];
      const points =
        ring.length > 1 ? (ring.slice(0, -1) as [number, number][]) : (ring as [number, number][]);
      dispatch(pairingSetDrawingPoints({ target: 'map', points }));
      if (points.length >= 3) {
        onFinishDrawing?.();
      }
    },
    [dispatch, onFinishDrawing],
  );

  const {
    startDrawing: startMapLasso,
    stopDrawing: stopMapLasso,
    previewFeature: lassoPreviewFeature,
    edgeFeature: lassoEdgeFeature,
    handleMouseDown: lassoMouseDown,
    handleMouseMove: lassoMouseMove,
  } = useFreehandLasso({ onComplete: onLassoComplete });

  useEffect(() => {
    if (isDrawZone) {
      startMapLasso();
      return () => stopMapLasso();
    }
    stopMapLasso();
  }, [isDrawZone, startMapLasso, stopMapLasso]);

  const {
    hasClient,
    hasCocospot,
    client: ctxClient,
    deviceId: ctxDeviceId,
    cocospotLabel,
  } = usePairingDeviceContext();
  const previewSlotSet = useMemo(
    () => new Set(previewZone?.slotIds ?? []),
    [previewZone?.slotIds],
  );

  const slotsGeoJson: FeatureCollection<Point> = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: slots.map(
        (s): Feature<Point> => ({
          type: 'Feature',
          id: s.slot_id,
          geometry: { type: 'Point', coordinates: [s.center.lng, s.center.lat] },
          properties: {
            slot_id: s.slot_id,
            slot_type: slotTypeForMapIcon(s.slot_type),
            isSelected: s.slot_id === selectedSlotId,
            isLinked: linkedSlotIds.has(s.slot_id),
            linkColor: slotColorMap[s.slot_id] ?? null,
            previewColor:
              activeTool === 'pair'
              && s.slot_id === selectedSlotId
              && !linkedSlotIds.has(s.slot_id)
              && selectionPreviewColor
                ? selectionPreviewColor
                : null,
            isPreview: previewSlotSet.has(s.slot_id),
          },
        }),
      ),
    }),
    [slots, selectedSlotId, activeTool, linkedSlotIds, slotColorMap, selectionPreviewColor, previewSlotSet],
  );

  const drawingGeoJson = useMemo((): FeatureCollection<LineString | Polygon> => {
    const features: Feature<LineString | Polygon>[] = [];
    if (lassoPreviewFeature) features.push(lassoPreviewFeature);
    if (lassoEdgeFeature) features.push(lassoEdgeFeature);

    if (features.length > 0) {
      return { type: 'FeatureCollection', features };
    }

    if (drawingMapPoints.length === 0) return { type: 'FeatureCollection', features: [] };
    const coords = drawingMapPoints.map((p) => p as [number, number]);

    if (coords.length >= 3) {
      const first = coords[0]!;
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...coords, first]] },
        properties: {},
      });
    }
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      });
    }
    return { type: 'FeatureCollection', features };
  }, [drawingMapPoints, lassoPreviewFeature, lassoEdgeFeature]);

  /** Committed zone polygons — one feature per zone, each with its palette color. */
  const zonesGeoJson = useMemo((): FeatureCollection<Polygon> => ({
    type: 'FeatureCollection',
    features: zones.map((z): Feature<Polygon> => {
      const pts = z.mapPolygon.points;
      if (pts.length < 3) return null!;
      const first = pts[0]!;
      const zColor = PAIR_PALETTE[z.colorIndex % PAIR_PALETTE.length] ?? '#37bc9b';
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...pts, first]] },
        properties: { zoneId: z.id, color: zColor, isActive: z.id === activeZoneId },
      };
    }).filter(Boolean),
  }), [zones, activeZoneId]);

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      if (isDrawZone) {
        lassoMouseDown(e);
      }
    },
    [isDrawZone, lassoMouseDown],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (isDrawZone) {
        lassoMouseMove(e);
      }
    },
    [isDrawZone, lassoMouseMove],
  );

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      if (activeTool === 'draw_zone') return;

      if (activeTool === 'pair' || activeTool === 'unpair') {
        const tol = 8;
        const bbox: [[number, number], [number, number]] = [
          [e.point.x - tol, e.point.y - tol],
          [e.point.x + tol, e.point.y + tol],
        ];
        const features = e.target.queryRenderedFeatures(bbox, { layers: ['pairing-slots-circle'] });
        const hit = features[0];
        if (hit) {
          const slotId = hit.properties?.slot_id;
          if (slotId) dispatch(pairingSelectSlot(slotId));
        }
        return;
      }

      if (activeTool === 'none') {
        const lng = e.lngLat.lng;
        const lat = e.lngLat.lat;
        for (const zone of zones) {
          if (zone.mapPolygon.points.length >= 3 && pointInRing(lng, lat, zone.mapPolygon.points)) {
            const toggle = zone.id === activeZoneId;
            dispatch(pairingSetActiveZone({ zoneId: toggle ? null : zone.id, side: toggle ? null : 'map' }));
            return;
          }
        }
        if (activeZoneId) dispatch(pairingSetActiveZone({ zoneId: null, side: null }));
      }
    },
    [activeTool, dispatch, zones, activeZoneId],
  );

  return (
    <div
      className={styles.panel}
      ref={(el) => {
        if (panelRef && 'current' in panelRef) {
          (panelRef as { current: HTMLDivElement | null }).current = el;
        }
      }}
    >
      <div className={styles.canvasWrap}>
        {slots.length === 0 ? (
          <div className={styles.emptyState}>
            {hasCocospot ? (
              <>
                <p className={styles.emptyTitle}>{t('pairingMap.noSlotsTitle')}</p>
                <p className={styles.emptyDeviceLine}>
                  <strong>{cocospotLabel}</strong>
                  <span className={styles.emptyMeta}> · {ctxClient}</span>
                </p>
                <small className={styles.emptyHint} title={t('calib.deviceIdLine', { id: ctxDeviceId })}>
                  {t('pairingMap.noSlotsHint')}
                </small>
              </>
            ) : hasClient ? (
              <>
                <p className={styles.emptyTitle}>{t('pairingMap.noSlotsClientTitle')}</p>
                <p className={styles.emptyDeviceLine}>
                  <strong>{ctxClient}</strong>
                </p>
                <small className={styles.emptyHint}>{t('pairingMap.noSlotsClientHint')}</small>
              </>
            ) : (
              <>
                <p className={styles.emptyTitle}>{t('pairingMap.selectClientTitle')}</p>
                <small className={styles.emptyHint}>
                  <Trans i18nKey="pairingMap.selectClientHint" components={{ kCmdD: <Kbd size="sm">⌘D</Kbd> }} />
                </small>
              </>
            )}
          </div>
        ) : (
          <Map
            {...viewState}
            ref={mapRef}
            onMove={onMove}
            onMoveEnd={onMoveEnd}
            mapboxAccessToken={MAPBOX_TOKEN}
            mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
            style={{ width: '100%', height: '100%' }}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onLoad={onMapLoad}
            dragPan={!isDrawZone}
            doubleClickZoom={!isDrawZone}
            interactiveLayerIds={['pairing-slots-circle']}
            cursor={isDrawZone ? 'crosshair' : undefined}
          >
            <NavigationControl position="bottom-right" />
            <Source id="pairing-slots" type="geojson" data={slotsGeoJson}>
              {/* Hit-test circle (invisible large target for clicks) + link/selection halo */}
              <Layer
                id="pairing-slots-circle"
                type="circle"
                paint={{
                  'circle-radius': [
                    'case',
                    ['get', 'isSelected'], 16,
                    ['get', 'isLinked'], 13,
                    ['get', 'isPreview'], 13,
                    10,
                  ],
                  'circle-color': 'transparent',
                  'circle-stroke-width': [
                    'case',
                    ['get', 'isSelected'], 3,
                    ['get', 'isLinked'], 2.5,
                    ['get', 'isPreview'], 2.5,
                    0,
                  ],
                  'circle-stroke-color': [
                    'case',
                    ['get', 'isSelected'],
                    [
                      'case',
                      ['all', ['get', 'isLinked'], ['!=', ['get', 'linkColor'], null]],
                      ['get', 'linkColor'],
                      ['!=', ['get', 'previewColor'], null],
                      ['get', 'previewColor'],
                      '#ffffff',
                    ],
                    ['get', 'isPreview'], '#37bc9b',
                    ['all', ['get', 'isLinked'], ['!=', ['get', 'linkColor'], null]],
                    ['get', 'linkColor'],
                    ['get', 'isLinked'], '#37bc9b',
                    'transparent',
                  ],
                }}
              />
              {/* Slot type pin (same as absmap) */}
              {pinsReady && (
                <Layer
                  id="pairing-slots-pin"
                  type="symbol"
                  layout={{
                    'icon-image': SLOT_TYPE_ICON_IMAGE,
                    'icon-size': [
                      'case',
                      ['get', 'isSelected'], SLOT_MARKER_ICON_SIZE.selected,
                      SLOT_MARKER_ICON_SIZE.default,
                    ],
                    'icon-anchor': 'bottom',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                  }}
                />
              )}
            </Source>

            {/* Committed zone overlays */}
            <Source id="zone-polygons" type="geojson" data={zonesGeoJson}>
              <Layer
                id="zone-polygon-fill"
                type="fill"
                paint={{
                  'fill-color': ['get', 'color'],
                  'fill-opacity': ['case', ['get', 'isActive'], 0.25, 0.12],
                }}
              />
              <Layer
                id="zone-polygon-line"
                type="line"
                paint={{
                  'line-color': ['get', 'color'],
                  'line-width': ['case', ['get', 'isActive'], 2.5, 1.5],
                }}
              />
            </Source>

            {/* Auto-suggest preview zone */}
            {previewZone && previewZone.polygon.points.length >= 3 && (
              <Source
                id="preview-zone"
                type="geojson"
                data={{
                  type: 'FeatureCollection',
                  features: [{
                    type: 'Feature',
                    geometry: {
                      type: 'Polygon',
                      coordinates: [[...previewZone.polygon.points, previewZone.polygon.points[0]!]],
                    },
                    properties: {},
                  }],
                }}
              >
                <Layer
                  id="preview-zone-fill"
                  type="fill"
                  paint={{ 'fill-color': '#37bc9b', 'fill-opacity': 0.15 }}
                />
                <Layer
                  id="preview-zone-line"
                  type="line"
                  paint={{ 'line-color': '#37bc9b', 'line-width': 2, 'line-dasharray': [4, 3] }}
                />
              </Source>
            )}

            {/* In-progress lasso */}
            <Source id="drawing-polygon" type="geojson" data={drawingGeoJson}>
              <Layer id="drawing-polygon-fill" type="fill" paint={{ 'fill-color': '#3bafda', 'fill-opacity': 0.15 }} />
              <Layer id="drawing-polygon-line" type="line" paint={{ 'line-color': '#3bafda', 'line-width': 2 }} />
            </Source>
          </Map>
        )}
      </div>
    </div>
  );
}

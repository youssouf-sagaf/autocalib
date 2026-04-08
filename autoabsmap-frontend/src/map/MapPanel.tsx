import { useMemo, useState, useCallback, useRef } from 'react';
import Map, {
  Source,
  Layer,
  NavigationControl,
  Popup,
} from 'react-map-gl/mapbox';
import type { MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import { useAppSelector } from '../store/hooks';
import { tokens } from '../theme/tokens';
import type { Slot } from '../types';
import type { Feature, Polygon, LineString, Point, FeatureCollection } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import styles from './MapPanel.module.css';

const PARKING_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill="#2d3561"/>
  <circle cx="14" cy="13" r="9" fill="#2d3561"/>
  <text x="14" y="17.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="15" fill="white">P</text>
</svg>`;

const PARKING_MARKER_IMG = new Image(28, 36);
PARKING_MARKER_IMG.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PARKING_MARKER_SVG)}`;

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
}

interface OverlayData {
  detection?: GeoJSON.FeatureCollection;
  mask?: GeoJSON.FeatureCollection;
  postprocess?: GeoJSON.FeatureCollection;
}

interface MapPanelProps {
  viewState: MapViewState;
  onMove: (evt: { viewState: MapViewState }) => void;
  onMapClick?: (e: MapMouseEvent) => void;
  onMouseMove?: (e: MapMouseEvent) => void;
  cursor?: string;
  previewFeature?: Feature<Polygon> | null;
  edgeFeature?: Feature<LineString> | null;
  vertexFeatures?: FeatureCollection<Point>;
  showCrops?: boolean;
  showSlots?: boolean;
  showCentroids?: boolean;
  label?: string;
  overlays?: OverlayData;
}

// Data-driven color expression: slot source → color
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOURCE_COLOR: any = [
  'match',
  ['get', 'source'],
  'yolo',            '#37bc9b',
  'row_extension',   '#3bafda',
  'gap_fill',        '#f6bb42',
  'mask_recovery',   '#967adc',
  'auto_reprocess',  '#e17055',
  'manual',          '#636e72',
  '#37bc9b',
];

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const EMPTY_POINT_FC: GeoJSON.FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: [],
};

export function MapPanel({
  viewState,
  onMove,
  onMapClick,
  onMouseMove,
  cursor: externalCursor,
  previewFeature,
  edgeFeature,
  vertexFeatures,
  showCrops = true,
  showSlots = true,
  showCentroids = true,
  label,
  overlays,
}: MapPanelProps) {
  const crops = useAppSelector((s) => s.absmap.crops);
  const finalSlots = useAppSelector((s) => s.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.absmap.baselineSlots);
  const overlayVis = useAppSelector((s) => s.absmap.overlayVisibility);

  const slots = useMemo(() => {
    if (overlays) {
      const detOnly = overlayVis.detection && !overlayVis.postprocess;
      if (detOnly && baselineSlots.length > 0) return baselineSlots;
    }
    return finalSlots.length > 0 ? finalSlots : baselineSlots;
  }, [overlays, overlayVis, finalSlots, baselineSlots]);
  const [popupSlot, setPopupSlot] = useState<Slot | null>(null);
  const [hovering, setHovering] = useState(false);

  /* ── GeoJSON sources ── */

  const cropsGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      showCrops && crops.length > 0
        ? {
            type: 'FeatureCollection',
            features: crops.map((crop, i) => ({
              type: 'Feature' as const,
              properties: { index: i },
              geometry: crop.polygon,
            })),
          }
        : EMPTY_FC,
    [crops, showCrops],
  );

  const slotsGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      showSlots && slots.length > 0
        ? {
            type: 'FeatureCollection',
            features: slots.map((slot) => ({
              type: 'Feature' as const,
              properties: {
                slot_id: slot.slot_id,
                source: slot.source,
                confidence: slot.confidence,
              },
              geometry: slot.polygon,
            })),
          }
        : EMPTY_FC,
    [slots, showSlots],
  );

  const centroidsGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      showCentroids && slots.length > 0
        ? {
            type: 'FeatureCollection',
            features: slots.map((slot) => ({
              type: 'Feature' as const,
              properties: {
                slot_id: slot.slot_id,
                source: slot.source,
              },
              geometry: {
                type: 'Point' as const,
                coordinates: [slot.center.lng, slot.center.lat],
              },
            })),
          }
        : EMPTY_FC,
    [slots, showCentroids],
  );

  const previewGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      previewFeature
        ? { type: 'FeatureCollection', features: [previewFeature] }
        : EMPTY_FC,
    [previewFeature],
  );

  const edgeGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      edgeFeature
        ? { type: 'FeatureCollection', features: [edgeFeature] }
        : EMPTY_FC,
    [edgeFeature],
  );

  const vertexGeoJSON = vertexFeatures ?? EMPTY_POINT_FC;

  /* ── Click handler: slot popup OR external handler ── */

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      if (showSlots && e.features && e.features.length > 0) {
        const slotId = e.features[0]?.properties?.slot_id as string | undefined;
        if (slotId) {
          const slot = slots.find((s) => s.slot_id === slotId);
          if (slot) {
            setPopupSlot(slot);
            return;
          }
        }
      }
      setPopupSlot(null);
      onMapClick?.(e);
    },
    [showSlots, slots, onMapClick],
  );

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      if (showSlots && e.features && e.features.length > 0) {
        setHovering(true);
      } else {
        setHovering(false);
      }
      onMouseMove?.(e);
    },
    [showSlots, onMouseMove],
  );

  const cursor = externalCursor || (hovering ? 'pointer' : '');
  const mapRef = useRef<MapRef>(null);

  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map && !map.hasImage('parking-marker')) {
      map.addImage('parking-marker', PARKING_MARKER_IMG, { sdf: false });
    }
  }, []);

  return (
    <div className={styles.container}>
      {label && <div className={styles.label}>{label}</div>}
      <Map
        ref={mapRef}
        {...viewState}
        onMove={onMove}
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        onClick={handleClick}
        onDblClick={(e) => { if (externalCursor) e.preventDefault(); }}
        onMouseMove={handleMouseMove}
        cursor={cursor}
        doubleClickZoom={!externalCursor}
        interactiveLayerIds={showSlots ? ['slots-fill'] : []}
        onLoad={onMapLoad}
      >
        <NavigationControl position="bottom-right" />

        {/* ── Crop polygons ── */}
        <Source id="crops" type="geojson" data={cropsGeoJSON}>
          <Layer
            id="crops-fill"
            type="fill"
            paint={{ 'fill-color': tokens.primary, 'fill-opacity': 0.15 }}
          />
          <Layer
            id="crops-line"
            type="line"
            paint={{ 'line-color': tokens.primary, 'line-width': 2 }}
          />
          <Layer
            id="crops-label"
            type="symbol"
            layout={{
              'text-field': ['concat', 'Crop ', ['+', ['get', 'index'], 1]],
              'text-size': 13,
              'text-font': ['Open Sans Semibold'],
              'text-anchor': 'center',
            }}
            paint={{
              'text-color': '#fff',
              'text-halo-color': tokens.primaryDark,
              'text-halo-width': 1.5,
            }}
          />
        </Source>

        {/* ── Preview polygon (drawing) ── */}
        <Source id="preview" type="geojson" data={previewGeoJSON}>
          <Layer
            id="preview-fill"
            type="fill"
            paint={{ 'fill-color': tokens.primary, 'fill-opacity': 0.1 }}
          />
          <Layer
            id="preview-line"
            type="line"
            paint={{
              'line-color': tokens.primary,
              'line-width': 2,
              'line-dasharray': [4, 3],
            }}
          />
        </Source>

        {/* ── Drawing edges (solid line following clicks) ── */}
        <Source id="draw-edges" type="geojson" data={edgeGeoJSON}>
          <Layer
            id="draw-edges-line"
            type="line"
            paint={{
              'line-color': tokens.primary,
              'line-width': 2.5,
            }}
          />
        </Source>

        {/* ── Drawing vertices ── */}
        <Source id="draw-vertices" type="geojson" data={vertexGeoJSON}>
          <Layer
            id="draw-vertices-circle"
            type="circle"
            paint={{
              'circle-radius': ['case', ['get', 'isFirst'], 7, 5],
              'circle-color': ['case', ['get', 'isFirst'], tokens.primary, '#ffffff'],
              'circle-stroke-color': tokens.primary,
              'circle-stroke-width': 2,
            }}
          />
        </Source>

        {/* ── Slot fill (invisible, kept for click interaction) ── */}
        <Source id="slots" type="geojson" data={slotsGeoJSON}>
          <Layer
            id="slots-fill"
            type="fill"
            paint={{ 'fill-color': '#000000', 'fill-opacity': 0 }}
          />
        </Source>

        {/* ── Parking markers ── */}
        <Source id="centroids" type="geojson" data={centroidsGeoJSON}>
          <Layer
            id="centroids-symbol"
            type="symbol"
            layout={{
              'icon-image': 'parking-marker',
              'icon-size': 0.85,
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
          />
        </Source>

        {/* ── Overlay: segmentation mask ── */}
        {overlays?.mask && (
          <Source id="overlay-mask" type="geojson" data={overlays.mask}>
            <Layer
              id="overlay-mask-fill"
              type="fill"
              paint={{ 'fill-color': '#27ae60', 'fill-opacity': 0.25 }}
            />
            <Layer
              id="overlay-mask-line"
              type="line"
              paint={{ 'line-color': '#27ae60', 'line-width': 1.5, 'line-opacity': 0.6 }}
            />
          </Source>
        )}

        {/* ── Overlay: detection baselines ── */}
        {overlays?.detection && (
          <Source id="overlay-detection" type="geojson" data={overlays.detection}>
            <Layer
              id="overlay-detection-fill"
              type="fill"
              paint={{ 'fill-color': '#e67e22', 'fill-opacity': 0.15 }}
            />
            <Layer
              id="overlay-detection-line"
              type="line"
              paint={{
                'line-color': '#e67e22',
                'line-width': 1.5,
                'line-opacity': 0.8,
              }}
            />
          </Source>
        )}

        {/* ── Overlay: post-process slots by source ── */}
        {overlays?.postprocess && (
          <Source id="overlay-postprocess" type="geojson" data={overlays.postprocess}>
            <Layer
              id="overlay-postprocess-fill"
              type="fill"
              paint={{ 'fill-color': SOURCE_COLOR, 'fill-opacity': 0.35 }}
            />
            <Layer
              id="overlay-postprocess-line"
              type="line"
              paint={{ 'line-color': SOURCE_COLOR, 'line-width': 1.5, 'line-opacity': 0.8 }}
            />
          </Source>
        )}

        {/* ── Slot info popup ── */}
        {popupSlot && (
          <Popup
            longitude={popupSlot.center.lng}
            latitude={popupSlot.center.lat}
            onClose={() => setPopupSlot(null)}
            closeOnClick={false}
            anchor="bottom"
            offset={10}
          >
            <div className={styles.popup}>
              <div className={styles.popupTitle}>
                Slot {popupSlot.slot_id.slice(0, 8)}…
              </div>
              <table className={styles.popupTable}>
                <tbody>
                  <tr>
                    <td>Source</td>
                    <td><span className={styles.badge}>{popupSlot.source}</span></td>
                  </tr>
                  <tr>
                    <td>Confidence</td>
                    <td>{(popupSlot.confidence * 100).toFixed(0)}%</td>
                  </tr>
                  <tr>
                    <td>Status</td>
                    <td>{popupSlot.status}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}

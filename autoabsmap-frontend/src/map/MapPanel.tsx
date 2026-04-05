import { useMemo, useState, useCallback } from 'react';
import Map, {
  Source,
  Layer,
  NavigationControl,
  Popup,
} from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { useAppSelector } from '../store/hooks';
import { tokens } from '../theme/tokens';
import type { Slot } from '../types';
import type { Feature, Polygon } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import styles from './MapPanel.module.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
}

interface MapPanelProps {
  viewState: MapViewState;
  onMove: (evt: { viewState: MapViewState }) => void;
  onMapClick?: (e: MapMouseEvent) => void;
  onMouseMove?: (e: MapMouseEvent) => void;
  cursor?: string;
  previewFeature?: Feature<Polygon> | null;
  showCrops?: boolean;
  showSlots?: boolean;
  showCentroids?: boolean;
  label?: string;
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

export function MapPanel({
  viewState,
  onMove,
  onMapClick,
  onMouseMove,
  cursor: externalCursor,
  previewFeature,
  showCrops = true,
  showSlots = true,
  showCentroids = true,
  label,
}: MapPanelProps) {
  const crops = useAppSelector((s) => s.absmap.crops);
  const finalSlots = useAppSelector((s) => s.absmap.slots);
  const baselineSlots = useAppSelector((s) => s.absmap.baselineSlots);
  const slots = finalSlots.length > 0 ? finalSlots : baselineSlots;
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

  return (
    <div className={styles.container}>
      {label && <div className={styles.label}>{label}</div>}
      <Map
        {...viewState}
        onMove={onMove}
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        cursor={cursor}
        interactiveLayerIds={showSlots ? ['slots-fill'] : []}
      >
        <NavigationControl position="bottom-right" />

        {/* ── Crop rectangles ── */}
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

        {/* ── Preview rectangle (drawing) ── */}
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

        {/* ── Slot OBBs (oriented bboxes) — colored by source ── */}
        <Source id="slots" type="geojson" data={slotsGeoJSON}>
          <Layer
            id="slots-fill"
            type="fill"
            paint={{ 'fill-color': SOURCE_COLOR, 'fill-opacity': 0.35 }}
          />
          <Layer
            id="slots-outline"
            type="line"
            paint={{ 'line-color': SOURCE_COLOR, 'line-width': 1.5 }}
          />
        </Source>

        {/* ── Centroid dots ── */}
        <Source id="centroids" type="geojson" data={centroidsGeoJSON}>
          <Layer
            id="centroids-circle"
            type="circle"
            paint={{
              'circle-radius': 4,
              'circle-color': '#ffffff',
              'circle-stroke-color': SOURCE_COLOR,
              'circle-stroke-width': 2,
              'circle-opacity': 0.95,
            }}
          />
        </Source>

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

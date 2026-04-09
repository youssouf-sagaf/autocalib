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

const ADD_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill="#2979ff"/>
  <circle cx="14" cy="13" r="9" fill="#2979ff"/>
  <text x="14" y="17.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="16" fill="white">+</text>
</svg>`;

const PARKING_MARKER_IMG = new Image(28, 36);
PARKING_MARKER_IMG.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PARKING_MARKER_SVG)}`;

const ADD_MARKER_IMG = new Image(28, 36);
ADD_MARKER_IMG.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ADD_MARKER_SVG)}`;

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
  onMouseDown?: (e: MapMouseEvent) => void;
  onMouseUp?: (e: MapMouseEvent) => void;
  cursor?: string;
  previewFeature?: Feature<Polygon> | null;
  edgeFeature?: Feature<LineString> | null;
  vertexFeatures?: FeatureCollection<Point>;
  showCrops?: boolean;
  showSlots?: boolean;
  showCentroids?: boolean;
  label?: string;
  overlays?: OverlayData;
  pendingSlot?: Slot | null;
  selectedSlotId?: string | null;
  hoveredSlotId?: string | null;
  modifyingSlot?: Slot | null;
  straightenProposal?: Slot[] | null;
  onConfirmStraighten?: () => void;
  onCancelStraighten?: () => void;
  isEditMode?: boolean;
  /** When false, map dragging is disabled (used during modify drag-and-drop). */
  dragPanEnabled?: boolean;
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
  onMouseDown,
  onMouseUp,
  cursor: externalCursor,
  previewFeature,
  edgeFeature,
  vertexFeatures,
  showCrops = true,
  showSlots = true,
  showCentroids = true,
  label,
  overlays,
  pendingSlot,
  selectedSlotId,
  hoveredSlotId,
  modifyingSlot,
  straightenProposal,
  onConfirmStraighten,
  onCancelStraighten,
  isEditMode = false,
  dragPanEnabled = true,
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
                selected: slot.slot_id === selectedSlotId,
                hovered: slot.slot_id === hoveredSlotId,
              },
              geometry: {
                type: 'Point' as const,
                coordinates: [slot.center.lng, slot.center.lat],
              },
            })),
          }
        : EMPTY_FC,
    [slots, showCentroids, selectedSlotId, hoveredSlotId],
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

  const pendingBboxGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      pendingSlot
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: pendingSlot.polygon,
              },
            ],
          }
        : EMPTY_FC,
    [pendingSlot],
  );

  const pendingMarkerGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      pendingSlot
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: {
                  type: 'Point' as const,
                  coordinates: [pendingSlot.center.lng, pendingSlot.center.lat],
                },
              },
            ],
          }
        : EMPTY_FC,
    [pendingSlot],
  );

  const modifyingBboxGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      modifyingSlot
        ? {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature' as const,
              properties: {},
              geometry: modifyingSlot.polygon,
            }],
          }
        : EMPTY_FC,
    [modifyingSlot],
  );

  const straightenGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      straightenProposal && straightenProposal.length > 0
        ? {
            type: 'FeatureCollection',
            features: straightenProposal.map((slot) => ({
              type: 'Feature' as const,
              properties: { slot_id: slot.slot_id },
              geometry: slot.polygon,
            })),
          }
        : EMPTY_FC,
    [straightenProposal],
  );

  const straightenCenter = useMemo(() => {
    if (!straightenProposal || straightenProposal.length === 0) return null;
    const lng = straightenProposal.reduce((a, s) => a + s.center.lng, 0) / straightenProposal.length;
    const lat = straightenProposal.reduce((a, s) => a + s.center.lat, 0) / straightenProposal.length;
    return { lng, lat };
  }, [straightenProposal]);

  const mapRef = useRef<MapRef>(null);

  /** Mapbox often omits `features` on click; query the centroid layer explicitly in edit modes. */
  const attachPickedSlotFeature = useCallback((e: MapMouseEvent) => {
    if (!showSlots || (e.features && e.features.length > 0)) return;
    const map = mapRef.current?.getMap();
    const pt = e.point;
    if (!map || pt == null) return;
    const hits = map.queryRenderedFeatures([pt.x, pt.y], { layers: ['centroids-symbol'] });
    if (hits.length > 0) {
      (e as MapMouseEvent & { features?: typeof hits }).features = hits;
    }
  }, [showSlots]);

  /* ── Click handler: edit modes forward everything; browse mode shows popup ── */

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      if (isEditMode) {
        setPopupSlot(null);
        attachPickedSlotFeature(e);
        onMapClick?.(e);
        return;
      }

      if (showSlots && e.features && e.features.length > 0) {
        const slotId = e.features[0]?.properties?.slot_id as string | undefined;
        if (slotId) {
          const slot = slots.find((s) => s.slot_id === slotId);
          if (slot) {
            setPopupSlot(slot);
            onMapClick?.(e);
            return;
          }
        }
      }
      setPopupSlot(null);
      onMapClick?.(e);
    },
    [isEditMode, showSlots, slots, onMapClick, attachPickedSlotFeature],
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

  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!map.hasImage('parking-marker')) {
      map.addImage('parking-marker', PARKING_MARKER_IMG, { sdf: false });
    }
    if (!map.hasImage('add-marker')) {
      map.addImage('add-marker', ADD_MARKER_IMG, { sdf: false });
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
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        cursor={cursor}
        doubleClickZoom={!externalCursor}
        dragPan={dragPanEnabled}
        interactiveLayerIds={showSlots ? ['centroids-symbol'] : []}
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

        {/* ── Parking markers (click target + hover/select highlight) ── */}
        <Source id="centroids" type="geojson" data={centroidsGeoJSON}>
          <Layer
            id="centroids-symbol"
            type="symbol"
            layout={{
              'icon-image': 'parking-marker',
              'icon-size': [
                'case',
                ['get', 'selected'], 1.2,
                ['get', 'hovered'], 1.05,
                0.85,
              ],
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

        {/* ── Pending slot bbox (orange dashed) ── */}
        <Source id="pending-bbox" type="geojson" data={pendingBboxGeoJSON}>
          <Layer
            id="pending-bbox-fill"
            type="fill"
            paint={{ 'fill-color': '#f39c12', 'fill-opacity': 0.2 }}
          />
          <Layer
            id="pending-bbox-line"
            type="line"
            paint={{
              'line-color': '#f39c12',
              'line-width': 2.5,
              'line-dasharray': [4, 3],
            }}
          />
        </Source>

        {/* ── Pending slot marker (blue) ── */}
        <Source id="pending-marker" type="geojson" data={pendingMarkerGeoJSON}>
          <Layer
            id="pending-marker-symbol"
            type="symbol"
            layout={{
              'icon-image': 'add-marker',
              'icon-size': 1,
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
          />
        </Source>

        {/* ── Modifying slot preview (cyan dashed) ── */}
        <Source id="modifying-bbox" type="geojson" data={modifyingBboxGeoJSON}>
          <Layer
            id="modifying-bbox-fill"
            type="fill"
            paint={{ 'fill-color': tokens.info, 'fill-opacity': 0.15 }}
          />
          <Layer
            id="modifying-bbox-line"
            type="line"
            paint={{
              'line-color': tokens.info,
              'line-width': 2.5,
              'line-dasharray': [4, 3],
            }}
          />
        </Source>

        {/* ── Straighten proposal preview (green dashed outlines) ── */}
        <Source id="straighten-proposal" type="geojson" data={straightenGeoJSON}>
          <Layer
            id="straighten-proposal-fill"
            type="fill"
            paint={{ 'fill-color': tokens.success, 'fill-opacity': 0.35 }}
          />
          <Layer
            id="straighten-proposal-line"
            type="line"
            paint={{
              'line-color': tokens.success,
              'line-width': 2.5,
              'line-dasharray': [4, 3],
            }}
          />
        </Source>

        {/* ── Straighten confirmation popup ── */}
        {straightenCenter && onConfirmStraighten && (
          <Popup
            longitude={straightenCenter.lng}
            latitude={straightenCenter.lat}
            onClose={() => onCancelStraighten?.()}
            closeOnClick={false}
            anchor="bottom"
            offset={24}
          >
            <div className={styles.straightenPopup}>
              <div className={styles.popupTitle}>
                Align {straightenProposal!.length} slot{straightenProposal!.length !== 1 ? 's' : ''}?
              </div>
              <div className={styles.straightenActions}>
                <button className={styles.acceptBtn} onClick={onConfirmStraighten}>
                  Accept
                </button>
                <button className={styles.rejectBtn} onClick={onCancelStraighten}>
                  Reject
                </button>
              </div>
            </div>
          </Popup>
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

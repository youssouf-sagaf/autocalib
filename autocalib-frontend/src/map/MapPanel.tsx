import { useState, useCallback, useRef } from 'react';
import Map, {
  Source,
  Layer,
  NavigationControl,
} from 'react-map-gl/mapbox';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import { useAppSelector } from '../store/hooks';
import { tokens } from '../theme/tokens';
import {
  SLOT_MARKER_HIT_RADIUS,
  SLOT_MARKER_ICON_SIZE,
  SLOT_TYPE_ICON_IMAGE,
} from '../theme/slotTypes';
import { useMapSlotPinLayers } from './useMapSlotPinLayers';
import type { ImagerySource, Slot } from '../types';
import type { Feature, Polygon, LineString, Point, FeatureCollection } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import styles from './MapPanel.module.css';
import { MapLayerControl } from './MapLayerControl';
import { useAbsmapMapLayers } from './useAbsmapMapLayers';
import { useMapboxResize } from './useMapboxResize';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

/**
 * IGN WMTS layer presets — kept in sync with the backend
 * ``IGN_LAYER_PRESETS`` (see autoabsmap/imagery/ign.py). The frontend only
 * needs them to render the visual overlay; the actual fetch on the backend
 * is driven by the ``imagery_source`` enum on the JobRequest.
 */
const IGN_LAYER_PRESETS: Record<
  Exclude<ImagerySource, 'mapbox'>,
  { layer: string; format: string; maxZoom: number }
> = {
  'ign-current': {
    layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
    format: 'image/jpeg',
    maxZoom: 19,
  },
  'ign-pleiades-2026': {
    layer: 'ORTHOIMAGERY.ORTHO-SAT.PLEIADES.2026',
    format: 'image/png',
    maxZoom: 18,
  },
};

function buildIgnTileUrl(layer: string, format: string): string {
  return (
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    `&LAYER=${layer}&TILEMATRIXSET=PM&TILEMATRIX={z}` +
    `&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(format)}&STYLE=normal`
  );
}

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

export interface MapPanelProps {
  viewState: MapViewState;
  onMove: (evt: { viewState: MapViewState }) => void;
  /** Persist viewport to Redux / parent — fired once per pan or zoom gesture. */
  onMoveEnd?: (evt: { viewState: MapViewState }) => void;
  onMapClick?: (e: MapMouseEvent) => void;
  onMouseMove?: (e: MapMouseEvent) => void;
  onMouseDown?: (e: MapMouseEvent) => void;
  onMouseUp?: (e: MapMouseEvent) => void;
  onContextMenu?: (e: MapMouseEvent) => void;
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
  /** When false, only the pending marker is shown (Add drag preview). */
  pendingShowsBbox?: boolean;
  selectedSlotId?: string | null;
  hoveredSlotId?: string | null;
  /** Slot footprint follows the marker while dragging in Modify mode. */
  modifyDragSlot?: Slot | null;
  /** When false, map dragging is disabled (used during modify drag-and-drop). */
  dragPanEnabled?: boolean;
  /** Slot ids highlighted as pending bulk-delete confirmation (lasso preview). */
  bulkPreviewSlotIds?: string[] | null;
  /** Proposed slots from reprocess — rendered as ghost polygons for review. */
  reprocessProposedSlots?: Slot[];
  /** Extend / clone row proposals — orange dashed ghost bboxes. */
  tileRowGhostSlots?: Slot[];
  /** When false, ghost slots render as P markers only (row duplicate). Default: footprint fill + outline. */
  tileRowGhostShowFootprint?: boolean;
}

// Data-driven color expression: slot source → color
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOURCE_COLOR: any = [
  'match',
  ['get', 'source'],
  'sam3',            '#37bc9b',
  'row_extension',   '#3bafda',
  'gap_fill',        '#f6bb42',
  'mask_recovery',   '#37bc9b',
  'auto_reprocess',  '#e17055',
  'manual',          '#636e72',
  '#37bc9b',
];

/** Invisible fill for hit-testing — overlay polygons are not interactive and lack slot_id. */
const SLOTS_HIT_LAYER_ID = 'slots-hit-fill';
const SLOT_QUERY_LAYER_IDS = ['centroids-symbol', SLOTS_HIT_LAYER_ID] as const;

/** Mapbox filter for GeoJSON boolean `selected` (handles bool or string coercion). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SLOT_SELECTED_FILTER: any = [
  'any',
  ['==', ['get', 'selected'], true],
  ['==', ['get', 'selected'], 'true'],
  ['==', ['get', 'selected'], 1],
];

/** Only query layers that Mapbox has mounted (avoids errors during source key remounts). */
function mountedSlotQueryLayers(map: MapboxMap): string[] {
  return SLOT_QUERY_LAYER_IDS.filter((id) => Boolean(map.getLayer(id)));
}

export function MapPanel({
  viewState,
  onMove,
  onMoveEnd,
  onMapClick,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onContextMenu,
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
  pendingShowsBbox = true,
  selectedSlotId,
  hoveredSlotId,
  modifyDragSlot,
  dragPanEnabled = true,
  bulkPreviewSlotIds = null,
  reprocessProposedSlots,
  tileRowGhostSlots,
  tileRowGhostShowFootprint = true,
}: MapPanelProps) {
  const imagerySource = useAppSelector((s) => s.autocalib.absmap.imagerySource);

  const {
    slots,
    cropsGeoJSON,
    slotsLayerKey,
    centroidsGeoJSON,
    slotsHitGeoJSON,
    tileRowGhostGeoJSON,
    tileRowGhostMarkerGeoJSON,
    previewGeoJSON,
    edgeGeoJSON,
    vertexGeoJSON,
    pendingBboxGeoJSON,
    pendingMarkerGeoJSON,
    reprocessGhostGeoJSON,
  } = useAbsmapMapLayers({
    showCrops,
    showSlots,
    showCentroids,
    previewFeature,
    edgeFeature,
    vertexFeatures,
    pendingSlot,
    pendingShowsBbox,
    selectedSlotId,
    hoveredSlotId,
    modifyDragSlot,
    bulkPreviewSlotIds,
    reprocessProposedSlots,
    tileRowGhostSlots,
    tileRowGhostShowFootprint,
  });

  const [hovering, setHovering] = useState(false);
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { showPinLayers: pinsReady, onMapLoad } = useMapSlotPinLayers(mapRef);
  useMapboxResize(mapRef, containerRef);

  const handleMapLoad = useCallback(() => {
    onMapLoad();
    // Shift+click is used for multi-select — disable Mapbox box-zoom (Shift+drag).
    mapRef.current?.getMap()?.boxZoom.disable();
    mapRef.current?.resize();
  }, [onMapLoad]);

  /** Mapbox often omits `features` on pointer events; query slot layers explicitly. */
  const attachPickedSlotFeature = useCallback((e: MapMouseEvent) => {
    const slotHit = e.features?.find(
      (f) => typeof f.properties?.slot_id === 'string' && f.properties.slot_id.length > 0,
    );
    if (slotHit) {
      (e as MapMouseEvent & { features?: typeof e.features }).features = [slotHit];
      return;
    }
    const map = mapRef.current?.getMap();
    const pt = e.point;
    if (!map || pt == null) return;
    if (!showSlots && slots.length === 0) return;
    const layers = mountedSlotQueryLayers(map);
    if (layers.length === 0) return;
    let hits: GeoJSON.Feature[];
    try {
      hits = map.queryRenderedFeatures([pt.x, pt.y], { layers });
    } catch {
      return;
    }
    const queried = hits.find(
      (f) => typeof f.properties?.slot_id === 'string' && f.properties.slot_id.length > 0,
    );
    if (queried) {
      (e as MapMouseEvent & { features?: MapMouseEvent['features'] }).features = [
        queried as MapMouseEvent['features'] extends (infer F)[] | undefined ? F : never,
      ];
    }
  }, [showSlots, slots.length]);

  /* ── Click handler: edit modes get the picked slot feature; browse mode forwards as-is ── */

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      attachPickedSlotFeature(e);
      onMapClick?.(e);
    },
    [onMapClick, attachPickedSlotFeature],
  );

  const handleContextMenu = useCallback(
    (e: MapMouseEvent) => {
      attachPickedSlotFeature(e);
      onContextMenu?.(e);
    },
    [onContextMenu, attachPickedSlotFeature],
  );

  const handleMouseDown = useCallback(
    (e: MapMouseEvent) => {
      attachPickedSlotFeature(e);
      onMouseDown?.(e);
    },
    [onMouseDown, attachPickedSlotFeature],
  );

  const handleMouseUp = useCallback(
    (e: MapMouseEvent) => {
      attachPickedSlotFeature(e);
      onMouseUp?.(e);
    },
    [onMouseUp, attachPickedSlotFeature],
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
    <div ref={containerRef} className={styles.container}>
      {label && <div className={styles.label}>{label}</div>}
      <Map
        ref={mapRef}
        {...viewState}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        onClick={handleClick}
        onDblClick={(e) => { if (externalCursor) e.preventDefault(); }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        cursor={cursor}
        doubleClickZoom={!externalCursor}
        dragPan={dragPanEnabled}
        interactiveLayerIds={
          showSlots || slots.length > 0
            ? [
                ...(pinsReady && showCentroids && centroidsGeoJSON.features.length > 0
                  ? ['centroids-symbol' as const]
                  : []),
                ...(showSlots && slotsHitGeoJSON.features.length > 0
                  ? [SLOTS_HIT_LAYER_ID]
                  : []),
              ]
            : []
        }
        onLoad={handleMapLoad}
      >
        <NavigationControl position="bottom-right" />

        {/* ── Crop polygons (before IGN so crops-fill always exists as anchor) ── */}
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

        {/* ── IGN orthophoto overlay — below ROI/slots (raster added before vector layers above) ── */}
        {(imagerySource === 'ign-current' || imagerySource === 'ign-pleiades-2026') && (() => {
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
              <Layer id="imagery-overlay-layer" type="raster" beforeId="crops-fill" />
            </Source>
          );
        })()}

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

        {/* ── Slot OBB hit layer (invisible; interactive) — must sit below centroid symbols */}
        <Source key={`slots-hit-${slotsLayerKey}`} id="slots-hit" type="geojson" data={slotsHitGeoJSON}>
          <Layer
            id={SLOTS_HIT_LAYER_ID}
            type="fill"
            paint={{ 'fill-color': '#000000', 'fill-opacity': 0.01 }}
          />
        </Source>

        {/* ── Parking markers — prod (B2B) + session, Cocopilot slot_type colors ── */}
        <Source key={`centroids-${slotsLayerKey}`} id="centroids" type="geojson" data={centroidsGeoJSON}>
          <Layer
            id="centroids-bulk-halo"
            type="circle"
            filter={['==', ['get', 'bulkPreview'], true]}
            paint={{
              'circle-radius': SLOT_MARKER_HIT_RADIUS,
              'circle-color': '#e74c3c',
              'circle-opacity': 0.28,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#c0392b',
            }}
          />
          {pinsReady && (
            <Layer
              id="centroids-symbol"
              type="symbol"
              layout={{
                'icon-image': SLOT_TYPE_ICON_IMAGE,
                'icon-size': [
                  'case',
                  SLOT_SELECTED_FILTER,
                  SLOT_MARKER_ICON_SIZE.selected,
                  ['any', ['==', ['get', 'hovered'], true], ['==', ['get', 'hovered'], 'true']],
                  SLOT_MARKER_ICON_SIZE.hover,
                  SLOT_MARKER_ICON_SIZE.default,
                ],
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
          )}
        </Source>

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
          {pinsReady && (
            <Layer
              id="pending-marker-symbol"
              type="symbol"
              layout={{
                'icon-image': 'add-marker',
                'icon-size': SLOT_MARKER_ICON_SIZE.pending,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
          )}
        </Source>

        {/* ── Row extend ghost proposals (orange dashed footprints) ── */}
        <Source id="tilerow-ghosts" type="geojson" data={tileRowGhostGeoJSON}>
          <Layer
            id="tilerow-ghosts-fill"
            type="fill"
            paint={{ 'fill-color': '#f39c12', 'fill-opacity': 0.2 }}
          />
          <Layer
            id="tilerow-ghosts-line"
            type="line"
            paint={{
              'line-color': '#f39c12',
              'line-width': 2.5,
              'line-dasharray': [4, 3],
            }}
          />
        </Source>

        {/* ── Row duplicate ghost proposals (P markers only) ── */}
        <Source id="tilerow-ghost-markers" type="geojson" data={tileRowGhostMarkerGeoJSON}>
          {pinsReady && (
            <Layer
              id="tilerow-ghost-markers-symbol"
              type="symbol"
              layout={{
                'icon-image': SLOT_TYPE_ICON_IMAGE,
                'icon-size': SLOT_MARKER_ICON_SIZE.default,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
              paint={{ 'icon-opacity': 0.85 }}
            />
          )}
        </Source>

        {/* ── Reprocess proposed slots (orange ghost polygons) ── */}
        <Source id="reprocess-ghosts" type="geojson" data={reprocessGhostGeoJSON}>
          <Layer
            id="reprocess-ghosts-fill"
            type="fill"
            paint={{ 'fill-color': '#e17055', 'fill-opacity': 0.25 }}
          />
          <Layer
            id="reprocess-ghosts-line"
            type="line"
            paint={{
              'line-color': '#e17055',
              'line-width': 2.5,
              'line-dasharray': [4, 3],
            }}
          />
        </Source>

      </Map>

      {/* Imagery layer selector — sits above the NavigationControl. */}
      <MapLayerControl />
    </div>
  );
}

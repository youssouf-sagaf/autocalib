export interface LngLat {
  lng: number;
  lat: number;
}

export type SlotSource =
  | 'sam3'
  | 'row_extension'
  | 'gap_fill'
  | 'mask_recovery'
  | 'manual'
  | 'auto_reprocess';

export type SlotStatus = 'empty' | 'occupied' | 'unknown';

/** Cocoparks / Cocopilot curb slot category (colors aligned with product). */
export type ParkingSlotType =
  | 'common'
  | 'forbidden'
  | 'evh'
  | 'pmr'
  | 'scooter'
  | 'bike'
  | 'bus_stop'
  | 'taxi'
  | 'delivery_dotted'
  | 'delivery_only'
  | 'short_duration'
  | 'to_delete'
  | 'trolley'
  | 'pole';

export interface Slot {
  /** Prod id after absmap Save; empty string for new drafts until reload. */
  slot_id: string;
  /** Ephemeral React/draft key — never sent to B2B. */
  _draftKey?: string;
  center: LngLat;
  polygon: GeoJSON.Polygon;
  source: SlotSource;
  confidence: number;
  status: SlotStatus;
  /** Operator-assigned category; drives map marker color (default: classic). */
  slot_type?: ParkingSlotType;
  /** Exact OBB rotation (radians) as used by buildObbPolygon. Avoids lossy round-trip through extractObbMetrics. */
  obbAngle?: number;
}

export interface HintMasks {
  class_a?: GeoJSON.Polygon;
  class_b?: GeoJSON.Polygon;
}

export interface CropRequest {
  polygon: GeoJSON.Polygon;
  hints?: HintMasks;
}

export type ImagerySource =
  | 'mapbox'
  | 'ign-current'
  | 'ign-pleiades-2026';

export const IMAGERY_SOURCES: readonly ImagerySource[] = [
  'mapbox',
  'ign-current',
  'ign-pleiades-2026',
] as const;

export interface JobRequest {
  crops: CropRequest[];
  imagery_source?: ImagerySource;
}

export interface OrchestratorProgress {
  crop_index: number;
  crop_total: number;
  stage: string;
  percent: number;
}

export type JobStatusValue = 'pending' | 'running' | 'done' | 'failed';

export interface PipelineJob {
  id: string;
  status: JobStatusValue;
  progress?: OrchestratorProgress;
  error?: string;
}

export interface JobResult {
  job_id: string;
  slots: Slot[];
  baseline_slots: Slot[];
  crop_results: unknown[];
  detection_overlay: GeoJSON.FeatureCollection | null;
  postprocess_overlay: GeoJSON.FeatureCollection | null;
}

export type OverlayLayer = 'detection' | 'postprocess' | 'roi';

export interface OverlayVisibility {
  detection: boolean;
  postprocess: boolean;
  /** Drawn ROI polygons on the map — visible by default until pipeline slots load. */
  roi: boolean;
}

/** Detection / postprocess layers — undo Launch restores this (not sent to API). */
export interface PipelineOverlaysSnapshot {
  detection: GeoJSON.FeatureCollection | null;
  postprocess: GeoJSON.FeatureCollection | null;
  visibility: OverlayVisibility;
}

export interface EditEvent {
  type: 'add' | 'tile_row' | 'crops' | 'delete' | 'bulk_delete' | 'modify' | 'reprocess' | 'align';
  timestamp: number;
  slot_ids: string[];
  before: Slot[];
  after: Slot[];
  /** Optional — pipeline Launch result snapshots (not sent to API). */
  baseline_before?: Slot[];
  baseline_after?: Slot[];
  /** Optional — ROI polygons for Launch / draw-ROI undo (not sent to API). */
  crops_before?: CropRequest[];
  crops_after?: CropRequest[];
  /** Optional — overlay GeoJSON + toggle state around Launch (not sent to API). */
  pipeline_overlays_before?: PipelineOverlaysSnapshot;
  pipeline_overlays_after?: PipelineOverlaysSnapshot;
}

export type MarkerDisplayMode = 'auto' | 'pins' | 'footprints' | 'minimal';

export type EditMode =
  | 'none'
  | 'add'
  | 'eraser'
  | 'bulk_delete'
  | 'copy'
  | 'modify'
  | 'straighten'
  | 'reprocess'
  | 'tile_row'
  | 'clone_row';

/**
 * Oriented rectangle in WGS84 used as a multi-row tiling ROI.
 * Stored as the 4 corners (CCW from the start of the long axis) plus the
 * unit vector along the long axis L (in lng/lat space) for tiling direction.
 */
export interface OrientedRect {
  corners: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  /** Center of the rectangle (lng/lat). */
  center: [number, number];
  /** Long axis L expressed as a unit vector in lng/lat (NOT meters). */
  longAxisUnit: [number, number];
  /** Half-length along L, in meters. */
  halfLengthM: number;
  /** Half-length along the short axis S, in meters. */
  halfWidthM: number;
}

export interface StraightenAnchors {
  slot_id_a: string;
  slot_id_b: string;
  /** Current map slots so anchors match baseline view / edits (optional for older clients). */
  slots?: Slot[];
}

export interface StraightenResponse {
  proposed_slots: Slot[];
}

/** Body sent to POST /api/v1/jobs/{job_id}/reprocess. */
export interface ReprocessRequestBody {
  reference_slot: Slot;
  scope_polygon: GeoJSON.Polygon;
}

/** Response from the reprocess endpoint. */
export interface ReprocessResponse {
  proposed_slots: Slot[];
}

/** Mirrors backend ReprocessStep — tracks proposals + what the operator accepted. */
export interface ReprocessStep {
  trigger_slot_id: string;
  scope_polygon: GeoJSON.Polygon;
  proposed: Slot[];
  accepted: Slot[];
}

/* ── Calib workspace types ── */

export interface CalibBbox {
  spot_id: number;
  center_x: number;
  center_y: number;
  x: number;
  y: number;
  width: number;
  height: number;
  n_frames: number;
  confidence: number;
  rotation?: number;
}

/** Calib bbox with optional cocospot static_data slot_id key. */
export interface DeviceCalibBbox extends CalibBbox {
  slot_id?: string | null;
}

export interface CalibrationSlotEntry {
  lat: number;
  lng: number;
  slot_type: string;
}

export interface DeviceCalibrationResponse {
  device_id: string;
  image_width: number;
  image_height: number;
  bboxes: DeviceCalibBbox[];
  slots: Record<string, CalibrationSlotEntry>;
  street_name?: string | null;
  nb_slots?: number;
  polygon?: unknown;
  front_marker?: Record<string, unknown> | null;
}

export interface CalibrationSaveRequest {
  bboxes: DeviceCalibBbox[];
  slots: Record<string, CalibrationSlotEntry>;
  image_width: number;
  image_height: number;
  reset?: boolean;
  /** Pairing save — replace calibration.slots with paired entries only. */
  replace_slots?: boolean;
  street_name?: string | null;
  nb_slots?: number | null;
  polygon?: unknown;
  front_marker?: Record<string, unknown> | null;
}

export interface CalibrationSaveResponse {
  ok: boolean;
  device_id: string;
  result?: unknown;
}

/* ── Calib preview (cv-backend proxy) ── */

export type CalibPreviewRefreshStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface CalibPreviewDetection {
  x_norm: number;
  y_norm: number;
  width_norm: number;
  height_norm: number;
  center_x_norm: number;
  center_y_norm: number;
  confidence: number;
  label: number;
  label_name: string;
}

export interface CalibPreviewImage {
  object_key: string;
  vehicle_count: number;
  rank: number;
  image_width: number;
  image_height: number;
  detections: CalibPreviewDetection[];
}

export interface CalibPreviewResponse {
  top_occupied_images: CalibPreviewImage[];
  refreshed_at: string | null;
  refresh: {
    job_id: string | null;
    status: CalibPreviewRefreshStatus;
  };
}

export interface CalibPreviewRefreshAccepted {
  job_id: string;
  status: string;
}

export interface LastPicObjectResponse {
  object_key: string;
  imgb64: string;
}

export type CalibTab = 'production' | 'generate';

export type CalibEditMode =
  | 'none'
  | 'select'
  /** Freehand closed polygon outline (distinct from rectangular marquee in `select`). */
  | 'lasso_select'
  | 'add'
  | 'modify'
  | 'remove'
  | 'bulk_delete'
  | 'multi_resize';

export interface CalibEditEvent {
  type: 'add' | 'remove' | 'modify' | 'bulk_remove' | 'resize';
  timestamp: number;
  before: CalibBbox[];
  after: CalibBbox[];
}

export type CalibJobStatus = 'idle' | 'pending' | 'running' | 'done' | 'failed';

export interface CalibProgress {
  stage: string;
  percent: number;
}

export interface CalibJobResult {
  job_id: string;
  device_id: string;
  calib_bboxes: CalibBbox[];
  frame_count: number;
  total_detections: number;
}

/* ── Pairing workspace types ── */

export type PairingTool =
  | 'pair'
  | 'unpair'
  | 'draw_zone'
  | 'none';

export interface PairingLink {
  id: string;
  slotId: string;
  bboxSpotId: number;
  colorIndex?: number;
}

export const PAIR_PALETTE = [
  '#37bc9b', '#3bafda', '#f6bb42', '#da4453',
  '#2da58c', '#d770ad', '#4fc1e9', '#a0d468',
  '#ed5565', '#fc6e51', '#48cfad', '#ac92ec',
] as const;

export interface PairingZonePolygon {
  points: [number, number][];
}

export interface PairingZone {
  id: string;
  mapPolygon: PairingZonePolygon;
  imagePolygon: PairingZonePolygon;
  mapSlotIds: string[];
  imageBboxIds: number[];
  matched: boolean;
  colorIndex: number;
}

export interface SuggestedZonePairing {
  zoneId: string;
  links: PairingLink[];
  reversed: boolean;
}

/** Undo/redo stack for pairing edits (links + zones). Separate from absmap slot history. */
export type PairingEditEvent =
  | { type: 'links_added'; links: PairingLink[] }
  | { type: 'links_removed'; links: PairingLink[] }
  | { type: 'zone_added'; zone: PairingZone; autoLinks: PairingLink[] }
  | {
      type: 'zone_reversed';
      zoneId?: string;
      side: 'map' | 'image';
      oldLinks: PairingLink[];
      newLinks: PairingLink[];
    }
  | { type: 'zone_deleted'; zone: PairingZone; links: PairingLink[] };

/* ── Directory (clients + devices) ── */

export interface ClientSummary {
  client_id: string;
  display_name: string;
  device_count: number;
  location?: { lat: number; lng: number } | null;
  zoom_level?: number | null;
}

export interface DeviceSummary {
  device_id: string;
  display_name: string;
  client_id: string;
  lifecycle: string;
  short_name: string;
}

export interface ClientLocation {
  lng: number;
  lat: number;
  zoom: number;
}

/* Wire-level pairing types (snake_case) — POST/GET /api/v1/pairings/{device_id}. */

export interface PairingLinkWire {
  id: string;
  slot_id: string;
  bbox_spot_id: number;
}

export interface PairingZonePolygonWire {
  points: [number, number][];
}

export interface PairingZoneWire {
  id: string;
  map_polygon: PairingZonePolygonWire;
  image_polygon: PairingZonePolygonWire;
  map_slot_ids: string[];
  image_bbox_ids: number[];
  matched: boolean;
}

export interface SavePairingsRequest {
  client: string;
  links: PairingLinkWire[];
  zones: PairingZoneWire[];
}

export interface SavePairingsResponse {
  ok: boolean;
  device_id: string;
  saved_at: string;
  saved_to: string;
  link_count: number;
  zone_count: number;
}

export interface LoadPairingsResponse {
  device_id: string;
  client: string;
  links: PairingLinkWire[];
  zones: PairingZoneWire[];
  saved_at: string | null;
}

/* ── Workspace context types ── */

export interface RecentDevice {
  client: string;
  deviceId: string;
  label?: string;
  lastUsed: number;
  completedSteps?: WorkspaceStep[];
}

export type WorkspaceStep = 'absmap' | 'calib' | 'pairing';

export interface WorkspaceContext {
  /** B2B Firestore client id (empty when the city is not registered in B2B). */
  clientId: string;
  /** Ops city / human label — shown in the UI. */
  clientName: string;
  deviceId: string;
  recentDevices: RecentDevice[];
  /** Directory keys (``clientId`` or ``clientName``) for quick reopen. */
  recentClients: string[];
  sidebarExpanded: boolean;
}

export interface ActiveClientSelection {
  clientId: string;
  clientName: string;
}

export interface SaveSummary {
  created: number;
  updated: number;
  deleted: number;
  total_slots: number;
}

export type SaveFeedbackVariant = 'success' | 'warning' | 'error' | 'empty';

export type SaveFeedbackWorkspace = 'absmap' | 'calib' | 'pairing';

export interface SaveFeedbackState {
  open: boolean;
  variant: SaveFeedbackVariant;
  workspace: SaveFeedbackWorkspace;
  summary?: SaveSummary;
  bboxCount?: number;
  /** Calib/pairing save — bboxes removed from prod static_data. */
  deletedBboxCount?: number;
  deletedBboxKeys?: string[];
  /** Calib save — operator-facing labels (canvas spot #, paired slot id, …). */
  deletedBboxLabels?: string[];
  /** Calib/pairing save — geo slots written to static_data.calibration.slots. */
  slotCount?: number;
  savedSlotLabels?: string[];
  /** Slots present in this save but absent from the last DB snapshot. */
  addedSlotCount?: number;
  addedSlotLabels?: string[];
  /** Pairing save — slot ↔ bbox links persisted. */
  pairedCount?: number;
  pairedLabels?: string[];
  errorMessage?: string;
}

/** Body for POST /api/v1/clients/{client_id}/slots/save */
export interface SlotsSaveRequest {
  slots: Slot[];
  deleted_prod_ids: string[];
  client_display_name?: string;
  job_id?: string;
  baseline_slots?: Slot[];
  edit_events?: EditEvent[];
  reprocessed_steps?: ReprocessStep[];
  difficulty_tags?: string[];
}

export interface SlotsSaveResponse {
  ok: boolean;
  client_id: string;
  results: Slot[];
  save_summary: SaveSummary;
  warning?: string | null;
}

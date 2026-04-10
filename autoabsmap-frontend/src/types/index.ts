export interface LngLat {
  lng: number;
  lat: number;
}

export type SlotSource =
  | 'yolo'
  | 'row_extension'
  | 'gap_fill'
  | 'mask_recovery'
  | 'manual'
  | 'auto_reprocess';

export type SlotStatus = 'empty' | 'occupied' | 'unknown';

export interface Slot {
  slot_id: string;
  center: LngLat;
  polygon: GeoJSON.Polygon;
  source: SlotSource;
  confidence: number;
  status: SlotStatus;
}

export interface HintMasks {
  class_a?: GeoJSON.Polygon;
  class_b?: GeoJSON.Polygon;
}

export interface CropRequest {
  polygon: GeoJSON.Polygon;
  hints?: HintMasks;
}

export interface JobRequest {
  crops: CropRequest[];
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
  mask_polygons: GeoJSON.FeatureCollection | null;
  detection_overlay: GeoJSON.FeatureCollection | null;
  postprocess_overlay: GeoJSON.FeatureCollection | null;
}

export type OverlayLayer = 'detection' | 'mask' | 'postprocess';

export interface OverlayVisibility {
  detection: boolean;
  mask: boolean;
  postprocess: boolean;
}

export interface EditEvent {
  type: 'add' | 'delete' | 'bulk_delete' | 'modify' | 'reprocess' | 'align';
  timestamp: number;
  slot_ids: string[];
  before: Slot[];
  after: Slot[];
}

export type EditMode =
  | 'none'
  | 'add'
  | 'delete'
  | 'bulk_delete'
  | 'copy'
  | 'modify'
  | 'straighten'
  | 'reprocess';

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

/** Body for POST /api/v1/sessions/{session_id}/save (matches API SaveRequest). */
export interface SaveSessionRequest {
  final_slots: Slot[];
  baseline_slots?: Slot[];
  edit_events: EditEvent[];
  reprocessed_steps?: ReprocessStep[];
  difficulty_tags?: string[];
  other_difficulty_note?: string | null;
}

export interface SaveSessionResponse {
  ok: boolean;
  saved_at: string;
  session_id?: string;
  saved_to?: string;
  slot_count?: number;
  delta?: unknown;
}

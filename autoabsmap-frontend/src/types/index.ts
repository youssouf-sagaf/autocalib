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

export type EditMode = 'none' | 'add' | 'delete' | 'copy' | 'modify';

export interface SaveSessionRequest {
  job_id: string;
  slots: Slot[];
  edit_history: EditEvent[];
  saved_at: string;
}

export interface SaveSessionResponse {
  ok: boolean;
  saved_at: string;
}

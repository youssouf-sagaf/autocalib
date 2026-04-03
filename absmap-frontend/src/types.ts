import type { Polygon } from "geojson";

// ── Slot ────────────────────────────────────────────────────────────────

export type SlotSource =
  | "yolo"
  | "row_extension"
  | "gap_fill"
  | "mask_recovery"
  | "manual"
  | "auto_reprocess";

export type SlotStatus = "empty" | "occupied" | "unknown";

export interface Slot {
  slot_id: string;
  center: [number, number]; // [lng, lat]
  polygon: Polygon;
  source: SlotSource;
  confidence: number;
  status: SlotStatus;
}

// ── Crop / Job request ──────────────────────────────────────────────────

export interface HintMasks {
  class_a?: Polygon;
  class_b?: Polygon;
}

export interface CropRequest {
  polygon: Polygon;
  hints?: HintMasks;
}

export interface JobRequest {
  crops: CropRequest[];
}

// ── Edit events ─────────────────────────────────────────────────────────

export type EditEventType =
  | "add"
  | "delete"
  | "bulk_delete"
  | "modify"
  | "reprocess"
  | "align";

export interface EditEvent {
  type: EditEventType;
  timestamp: number;
  slot_ids: string[];
  before: Slot[];
  after: Slot[];
}

// ── Pipeline job ────────────────────────────────────────────────────────

export type JobStatusValue = "pending" | "running" | "done" | "failed";

export interface OrchestratorProgress {
  crop_index: number;
  crop_total: number;
  stage: string;
  percent: number;
}

export interface PipelineJob {
  id: string;
  status: JobStatusValue;
  progress?: OrchestratorProgress;
  error?: string;
}

// ── Job result ──────────────────────────────────────────────────────────

export interface PipelineResult {
  slots: Slot[];
  baseline_slots: Slot[];
  run_meta: Record<string, unknown>;
}

export interface JobResult {
  job_id: string;
  slots: Slot[];
  baseline_slots: Slot[];
  crop_results: PipelineResult[];
}

// ── Session save ────────────────────────────────────────────────────────

export type DifficultyTag =
  | "occlusion"
  | "shadow"
  | "weak_ground_markings"
  | "visual_clutter"
  | "other";

export interface SaveRequest {
  final_slots: Slot[];
  edit_events: EditEvent[];
  reprocessed_steps: unknown[];
  difficulty_tags: DifficultyTag[];
  other_difficulty_note?: string;
}

// ── Map provider ────────────────────────────────────────────────────────

export type BBox = [number, number, number, number]; // [west, south, east, north]

export interface SlotLayerOptions {
  style: "active" | "existing" | "proposed";
  interactive: boolean;
}

export type LayerHandle = string;

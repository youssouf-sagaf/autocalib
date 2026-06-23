import type { CalibBbox, CalibEditEvent, CalibJobStatus } from '../types';
import { createLogger } from './logger';

export interface CalibLocalCacheFields {
  bboxes: CalibBbox[];
  frameCount: number;
  totalDetections: number;
  jobId: string | null;
  jobStatus: CalibJobStatus;
  activeFrameIndex: number;
  lockedBboxIds: number[];
  editHistory: CalibEditEvent[];
  editIndex: number;
  confidenceThreshold: number;
  canvasZoom: number;
  canvasPanX: number;
  canvasPanY: number;
}

const log = createLogger('calibLocalCache');

export const CALIB_LOCAL_CACHE_VERSION = 1 as const;

/** Payload stored at `autocalib:calib:v1:${client}:${deviceId}` */
export interface CalibLocalSnapshotV1 {
  v: typeof CALIB_LOCAL_CACHE_VERSION;
  client: string;
  deviceId: string;
  editedAt: number;
  bboxes: CalibBbox[];
  frameCount: number;
  totalDetections: number;
  jobId: string | null;
  jobStatus: CalibJobStatus;
  activeFrameIndex: number;
  lockedBboxIds: number[];
  editHistory: CalibEditEvent[];
  editIndex: number;
  confidenceThreshold: number;
  canvasZoom: number;
  canvasPanX: number;
  canvasPanY: number;
  /** Optional extra metadata for debugging / future use */
  jobMeta?: { frameCount?: number; totalDetections?: number };
}

function seg(s: string): string {
  return encodeURIComponent(s);
}

export function calibLocalStorageKey(client: string, deviceId: string): string {
  return `autocalib:calib:v1:${seg(client)}:${seg(deviceId)}`;
}

export function parseCalibLocalSnapshot(raw: unknown): CalibLocalSnapshotV1 | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.client !== 'string' || typeof o.deviceId !== 'string') return null;
  if (!Array.isArray(o.bboxes)) return null;
  if (typeof o.editedAt !== 'number') return null;
  return o as unknown as CalibLocalSnapshotV1;
}

export function loadCalibLocalCache(client: string, deviceId: string): CalibLocalSnapshotV1 | null {
  if (!client || !deviceId) return null;
  try {
    const raw = localStorage.getItem(calibLocalStorageKey(client, deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const snap = parseCalibLocalSnapshot(parsed);
    if (!snap) return null;
    if (snap.client !== client || snap.deviceId !== deviceId) {
      log.warn('Cached snapshot client/device mismatch; ignoring entry');
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export function saveCalibLocalCache(client: string, deviceId: string, snapshot: CalibLocalSnapshotV1): void {
  if (!client || !deviceId) return;
  try {
    localStorage.setItem(calibLocalStorageKey(client, deviceId), JSON.stringify(snapshot));
  } catch (e) {
    log.warn('Calib local cache write failed (quota or private mode)', e);
  }
}

export function removeCalibLocalCache(client: string, deviceId: string): void {
  if (!client || !deviceId) return;
  try {
    localStorage.removeItem(calibLocalStorageKey(client, deviceId));
  } catch {
    /* ignore */
  }
}

export function buildCalibLocalSnapshot(
  client: string,
  deviceId: string,
  fields: CalibLocalCacheFields,
): CalibLocalSnapshotV1 {
  return {
    v: 1,
    client,
    deviceId,
    editedAt: Date.now(),
    bboxes: fields.bboxes,
    frameCount: fields.frameCount,
    totalDetections: fields.totalDetections,
    jobId: fields.jobId,
    jobStatus: fields.jobStatus,
    activeFrameIndex: fields.activeFrameIndex,
    lockedBboxIds: fields.lockedBboxIds,
    editHistory: fields.editHistory,
    editIndex: fields.editIndex,
    confidenceThreshold: fields.confidenceThreshold,
    canvasZoom: fields.canvasZoom,
    canvasPanX: fields.canvasPanX,
    canvasPanY: fields.canvasPanY,
    jobMeta: { frameCount: fields.frameCount, totalDetections: fields.totalDetections },
  };
}

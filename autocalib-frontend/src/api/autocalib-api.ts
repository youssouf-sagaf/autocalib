import axios from 'axios';
import { resolveApiBaseUrl } from '../config/apiBaseUrl';
import { isB2bClientId } from '../utils/clientContext';
import { createLogger } from '../utils/logger';
import type {
  CalibJobResult,
  CalibProgress,
  CalibrationSaveRequest,
  CalibrationSaveResponse,
  CalibPreviewRefreshAccepted,
  CalibPreviewResponse,
  ClientSummary,
  DeviceCalibrationResponse,
  DeviceSummary,
  JobRequest,
  JobResult,
  LastPicObjectResponse,
  LoadPairingsResponse,
  OrchestratorProgress,
  PipelineJob,
  ReprocessRequestBody,
  ReprocessResponse,
  SavePairingsRequest,
  SavePairingsResponse,
  SlotsSaveRequest,
  SlotsSaveResponse,
  StraightenAnchors,
  StraightenResponse,
} from '../types';

const client = axios.create({
  baseURL: resolveApiBaseUrl(),
});

const apiLog = createLogger('api');

export async function submitJob(request: JobRequest): Promise<PipelineJob> {
  const { data } = await client.post<PipelineJob>('/api/v1/jobs', request);
  return data;
}

/** Poll job status (SSE may miss `done` under slow links or reconnect storms). */
export async function getPipelineJob(jobId: string): Promise<PipelineJob> {
  const { data } = await client.get<PipelineJob>(`/api/v1/jobs/${jobId}`);
  return data;
}

export async function getJobResult(jobId: string): Promise<JobResult> {
  const { data } = await client.get<JobResult>(`/api/v1/jobs/${jobId}/result`);
  return data;
}

export async function saveClientSlots(
  clientId: string,
  body: SlotsSaveRequest,
  opts?: { displayName?: string },
): Promise<SlotsSaveResponse> {
  const pathId = clientId.trim() || opts?.displayName?.trim() || '_';
  const params: Record<string, string> = {};
  if (opts?.displayName) params.display_name = opts.displayName;
  const { data } = await client.post<SlotsSaveResponse>(
    `/api/v1/clients/${encodeURIComponent(pathId)}/slots/save`,
    body,
    { params: Object.keys(params).length ? params : undefined },
  );
  return data;
}

export async function fetchReferenceSlots(opts: {
  clientId: string;
  displayName?: string;
  cropCenter?: { lat: number; lng: number };
  cropRadiusM?: number;
}): Promise<{ results: Record<string, unknown>[] }> {
  const pathId = opts.clientId.trim() || opts.displayName?.trim() || '_';
  const params: Record<string, string | number> = {};
  if (opts.displayName) params.display_name = opts.displayName;
  /* Geo filter when the server cannot resolve a Firestore client id yet. */
  if (!isB2bClientId(opts.clientId) && opts.cropCenter) {
    params.crop_lat = opts.cropCenter.lat;
    params.crop_lng = opts.cropCenter.lng;
    if (opts.cropRadiusM != null) params.crop_radius_m = opts.cropRadiusM;
  }
  const t0 = performance.now();
  const { data } = await client.get<{ results: Record<string, unknown>[] }>(
    `/api/v1/clients/${encodeURIComponent(pathId)}/reference-slots`,
    { params: Object.keys(params).length ? params : undefined },
  );
  apiLog.info(
    `fetchReferenceSlots HTTP ${Math.round(performance.now() - t0)}ms → ${data.results.length} slot(s)`,
  );
  return data;
}

export async function straightenRow(
  jobId: string,
  anchors: StraightenAnchors,
): Promise<StraightenResponse> {
  try {
    const { data } = await client.post<StraightenResponse>(
      `/api/v1/jobs/${jobId}/straighten`,
      anchors,
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const detail = error.response?.data?.detail;
      if (typeof detail === 'string' && detail.trim().length > 0) {
        throw new Error(detail);
      }
      if (error.response?.status === 404) {
        throw new Error('Session not found on backend (job expired/restarted). Run mapping again.');
      }
    }
    throw error;
  }
}

export async function reprocessArea(
  jobId: string,
  body: ReprocessRequestBody,
): Promise<ReprocessResponse> {
  try {
    const { data } = await client.post<ReprocessResponse>(
      `/api/v1/jobs/${jobId}/reprocess`,
      body,
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const detail = error.response?.data?.detail;
      if (typeof detail === 'string' && detail.trim().length > 0) {
        throw new Error(detail);
      }
      if (error.response?.status === 404) {
        throw new Error('Session not found on backend (job expired/restarted). Run mapping again.');
      }
    }
    throw error;
  }
}

/* ── Calib endpoints ── */

interface CalibJobSubmitRequest {
  device_id: string;
  client: string;
  target_date?: string;
  confidence_threshold?: number;
  top_n_frames?: number;
}

interface CalibJobResponse {
  id: string;
  status: string;
}

export async function submitCalibJob(request: CalibJobSubmitRequest): Promise<CalibJobResponse> {
  const { data } = await client.post<CalibJobResponse>('/api/v1/calib/jobs', request);
  return data;
}

export async function getCalibJobResult(jobId: string): Promise<CalibJobResult> {
  const { data } = await client.get<CalibJobResult>(`/api/v1/calib/jobs/${jobId}/result`);
  return data;
}

export function calibFrameUrl(jobId: string, frameIndex: number): string {
  const baseUrl = resolveApiBaseUrl();
  return `${baseUrl}/api/v1/calib/jobs/${jobId}/frames/${frameIndex}`;
}

/* ── Device calibration (cocospot static_data proxy) ── */

export async function getDeviceCalibration(deviceId: string): Promise<DeviceCalibrationResponse> {
  const { data } = await client.get<DeviceCalibrationResponse>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/calibration`,
  );
  return data;
}

export async function saveDeviceCalibration(
  deviceId: string,
  body: CalibrationSaveRequest,
): Promise<CalibrationSaveResponse> {
  const { data } = await client.post<CalibrationSaveResponse>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/calibration`,
    body,
  );
  return data;
}

export async function getDeviceCalibrationImage(
  deviceId: string,
  draw = true,
): Promise<Record<string, unknown>> {
  const { data } = await client.get<Record<string, unknown>>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/calibration/image`,
    { params: { draw } },
  );
  return data;
}

/** Base64 JPEG from B2B last_processed_image (Cocopilot `last_detected` field). */
export async function deviceCalibrationImageDataUrl(
  deviceId: string,
  draw = false,
): Promise<string | null> {
  try {
    const data = await getDeviceCalibrationImage(deviceId, draw);
    const b64 = data.last_detected;
    if (typeof b64 !== 'string' || !b64) return null;
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    return null;
  }
}

/* ── Calib preview (cv-backend proxy) ── */

export async function getCalibPreview(deviceId: string): Promise<CalibPreviewResponse> {
  const { data } = await client.get<CalibPreviewResponse>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/calib-preview`,
  );
  return data;
}

export async function postCalibPreviewRefresh(
  deviceId: string,
): Promise<{ accepted: boolean; alreadyRunning: boolean; jobId?: string | null }> {
  const { data, status } = await client.post<CalibPreviewRefreshAccepted & { already_running?: boolean }>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/calib-preview/refresh`,
  );
  const alreadyRunning =
    data?.already_running === true || data?.status === 'already_running';
  return {
    accepted: status === 202 && !alreadyRunning,
    alreadyRunning,
    jobId: data?.job_id ?? null,
  };
}

export async function getLastPicObject(
  deviceId: string,
  objectKey: string,
): Promise<LastPicObjectResponse> {
  const { data } = await client.get<LastPicObjectResponse>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/last-pic/object`,
    { params: { object_key: objectKey } },
  );
  return data;
}

export async function lastPicObjectDataUrl(
  deviceId: string,
  objectKey: string,
): Promise<string | null> {
  try {
    const { imgb64 } = await getLastPicObject(deviceId, objectKey);
    if (!imgb64) return null;
    return `data:image/jpeg;base64,${imgb64}`;
  } catch {
    return null;
  }
}

export function streamCalibProgress(
  jobId: string,
  onProgress: (progress: CalibProgress) => void,
  onDone: () => void,
  onFailed: (errorMsg: string) => void,
  onError: (error: Event) => void,
): () => void {
  const baseUrl = resolveApiBaseUrl();
  const source = new EventSource(`${baseUrl}/api/v1/calib/jobs/${jobId}/stream`);

  source.addEventListener('progress', (event: MessageEvent) => {
    onProgress(JSON.parse(event.data) as CalibProgress);
  });

  source.addEventListener('done', () => {
    source.close();
    onDone();
  });

  source.addEventListener('failed', (event: MessageEvent) => {
    source.close();
    onFailed(event.data || 'Pipeline failed');
  });

  source.onerror = (event) => {
    source.close();
    onError(event);
  };

  return () => source.close();
}

/* ── Directory endpoints (clients + devices) ── */

export async function getClients(opts?: { refresh?: boolean; uid?: string }): Promise<ClientSummary[]> {
  const uid = opts?.uid?.trim() || localStorage.getItem('user_id')?.trim() || '';
  const params: Record<string, string | boolean> = {};
  if (opts?.refresh) params.refresh = true;
  if (uid) params.uid = uid;
  const { data } = await client.get<ClientSummary[]>('/api/v1/clients', {
    params: Object.keys(params).length ? params : undefined,
  });
  return data;
}

export async function getDevicesForClient(
  clientId: string,
  opts?: { displayName?: string; refresh?: boolean },
): Promise<DeviceSummary[]> {
  const params: Record<string, string | boolean> = {};
  if (opts?.displayName) params.display_name = opts.displayName;
  if (opts?.refresh) params.refresh = true;
  const { data } = await client.get<DeviceSummary[]>(
    `/api/v1/clients/${encodeURIComponent(clientId || opts?.displayName || '')}/devices`,
    { params: Object.keys(params).length ? params : undefined },
  );
  return data;
}

/* ── Pairing endpoints ── */

export async function savePairings(
  deviceId: string,
  request: SavePairingsRequest,
): Promise<SavePairingsResponse> {
  const { data } = await client.post<SavePairingsResponse>(
    `/api/v1/pairings/${deviceId}`,
    request,
  );
  return data;
}

export async function loadPairings(
  deviceId: string,
): Promise<LoadPairingsResponse | null> {
  try {
    const { data } = await client.get<LoadPairingsResponse>(
      `/api/v1/pairings/${deviceId}`,
    );
    return data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 404 || error.response?.status === 410)
    ) {
      return null;
    }
    throw error;
  }
}

/* ── Absmap SSE stream ── */

export function streamJobProgress(
  jobId: string,
  onProgress: (progress: OrchestratorProgress) => void,
  onDone: () => void,
  onFailed: () => void,
  onError: (error: Event) => void,
): () => void {
  const baseUrl = resolveApiBaseUrl();
  const source = new EventSource(`${baseUrl}/api/v1/jobs/${jobId}/stream`);

  source.addEventListener('progress', (event: MessageEvent) => {
    onProgress(JSON.parse(event.data) as OrchestratorProgress);
  });

  source.addEventListener('done', () => {
    source.close();
    onDone();
  });

  source.addEventListener('failed', () => {
    source.close();
    onFailed();
  });

  source.onerror = (event) => {
    source.close();
    onError(event);
  };

  return () => source.close();
}

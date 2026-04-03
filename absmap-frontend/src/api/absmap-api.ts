import axios from "axios";
import type {
  JobRequest,
  JobResult,
  OrchestratorProgress,
  PipelineJob,
  SaveRequest,
  Slot,
} from "../types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const api = axios.create({ baseURL: BASE });

// ── Jobs ────────────────────────────────────────────────────────────────

export async function submitJob(request: JobRequest): Promise<PipelineJob> {
  const { data } = await api.post<PipelineJob>("/api/v1/jobs", request);
  return data;
}

export async function getJob(jobId: string): Promise<PipelineJob> {
  const { data } = await api.get<PipelineJob>(`/api/v1/jobs/${jobId}`);
  return data;
}

export async function getJobResult(jobId: string): Promise<JobResult> {
  const { data } = await api.get<JobResult>(`/api/v1/jobs/${jobId}/result`);
  return data;
}

/**
 * Subscribe to SSE progress events for a running job.
 * Returns a cleanup function that closes the EventSource.
 */
export function streamJobProgress(
  jobId: string,
  onProgress: (p: OrchestratorProgress) => void,
  onDone: () => void,
  onError?: (e: Event) => void,
): () => void {
  const url = `${BASE}/api/v1/jobs/${jobId}/stream`;
  const es = new EventSource(url);

  es.addEventListener("progress", (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as OrchestratorProgress;
    onProgress(data);
  });

  es.addEventListener("done", () => {
    es.close();
    onDone();
  });

  es.onerror = (ev) => {
    es.close();
    onError?.(ev);
  };

  return () => es.close();
}

// ── Straighten / Reprocess ──────────────────────────────────────────────

export async function straightenRow(
  jobId: string,
  slotId: string,
): Promise<{ proposed_slots: Slot[] }> {
  const { data } = await api.post(`/api/v1/jobs/${jobId}/straighten`, {
    slot_id: slotId,
  });
  return data;
}

export async function reprocessArea(
  jobId: string,
  referenceSlotId: string,
  scopePolygon: GeoJSON.Polygon,
): Promise<{ proposed_slots: Slot[] }> {
  const { data } = await api.post(`/api/v1/jobs/${jobId}/reprocess`, {
    reference_slot_id: referenceSlotId,
    scope_polygon: scopePolygon,
  });
  return data;
}

// ── Sessions ────────────────────────────────────────────────────────────

export async function saveSession(
  sessionId: string,
  request: SaveRequest,
): Promise<Record<string, unknown>> {
  const { data } = await api.post(
    `/api/v1/sessions/${sessionId}/save`,
    request,
  );
  return data;
}

import axios from 'axios';
import type {
  JobRequest,
  JobResult,
  OrchestratorProgress,
  PipelineJob,
  ReprocessRequestBody,
  ReprocessResponse,
  SaveSessionRequest,
  SaveSessionResponse,
  StraightenAnchors,
  StraightenResponse,
} from '../types';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

export async function submitJob(request: JobRequest): Promise<PipelineJob> {
  const { data } = await client.post<PipelineJob>('/api/v1/jobs', request);
  return data;
}

export async function getJob(jobId: string): Promise<PipelineJob> {
  const { data } = await client.get<PipelineJob>(`/api/v1/jobs/${jobId}`);
  return data;
}

export async function getJobResult(jobId: string): Promise<JobResult> {
  const { data } = await client.get<JobResult>(`/api/v1/jobs/${jobId}/result`);
  return data;
}

export async function saveSession(
  sessionId: string,
  body: SaveSessionRequest,
): Promise<SaveSessionResponse> {
  const { data } = await client.post<SaveSessionResponse>(
    `/api/v1/sessions/${sessionId}/save`,
    body,
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

export function streamJobProgress(
  jobId: string,
  onProgress: (progress: OrchestratorProgress) => void,
  onDone: () => void,
  onFailed: () => void,
  onError: (error: Event) => void,
): () => void {
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
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

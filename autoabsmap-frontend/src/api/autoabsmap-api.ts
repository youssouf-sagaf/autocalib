import axios from 'axios';
import type {
  JobRequest,
  JobResult,
  OrchestratorProgress,
  PipelineJob,
  SaveSessionRequest,
  SaveSessionResponse,
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

export async function saveSession(request: SaveSessionRequest): Promise<SaveSessionResponse> {
  const { data } = await client.post<SaveSessionResponse>(
    `/api/v1/jobs/${request.job_id}/save`,
    request,
  );
  return data;
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

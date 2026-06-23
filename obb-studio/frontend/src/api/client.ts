import axios from 'axios';

const baseURL =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:8100';

export const apiClient = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

export function trainingEventsUrl(runId: string): string {
  const base = baseURL.replace(/\/$/, '');
  return `${base}/api/training/runs/${encodeURIComponent(runId)}/metrics/stream`;
}

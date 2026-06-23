/**
 * Resolve the Autocalib API base URL for axios, fetch, and EventSource.
 *
 * Leave `VITE_API_URL` empty when the SPA and API share one origin (Docker / VM).
 * A non-empty value is for local dev (Vite on :5173, API on :8000).
 *
 * If the bundle was built with localhost but the page is served from a remote host,
 * fall back to same-origin relative paths so a misconfigured deploy still works.
 */
export function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
  if (!configured) return '';

  if (typeof window === 'undefined') return configured;

  try {
    const apiUrl = new URL(configured);
    const apiIsLocal =
      apiUrl.hostname === 'localhost' || apiUrl.hostname === '127.0.0.1';
    const pageIsLocal =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (apiIsLocal && !pageIsLocal) return '';
    if (apiUrl.origin === window.location.origin) return '';

    return configured.replace(/\/$/, '');
  } catch {
    return configured;
  }
}

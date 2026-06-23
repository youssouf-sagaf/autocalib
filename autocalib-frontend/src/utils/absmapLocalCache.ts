import { createLogger } from './logger';

/** Last completed absmap pipeline job id for client + device — used to refetch GeoJSON after reload. */
const CACHE_VERSION = 1 as const;

export interface AbsmapLocalSnapshot {
  v: typeof CACHE_VERSION;
  client: string;
  deviceId: string;
  jobId: string;
  savedAt: number;
}

const log = createLogger('absmapLocalCache');

function seg(s: string): string {
  return encodeURIComponent(s);
}

export function absmapLocalStorageKey(client: string, deviceId: string): string {
  return `autocalib:absmap:v${CACHE_VERSION}:${seg(client)}:${seg(deviceId)}`;
}

function parseSnap(raw: unknown): AbsmapLocalSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== CACHE_VERSION || typeof o.jobId !== 'string' || o.jobId.length === 0) return null;
  if (typeof o.client !== 'string' || typeof o.deviceId !== 'string') return null;
  if (typeof o.savedAt !== 'number') return null;
  return o as unknown as AbsmapLocalSnapshot;
}

export function loadAbsmapJobId(client: string, deviceId: string): string | null {
  if (!client || !deviceId) return null;
  try {
    const raw = localStorage.getItem(absmapLocalStorageKey(client, deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const snap = parseSnap(parsed);
    if (!snap || snap.client !== client || snap.deviceId !== deviceId) {
      log.warn('Absmap cache client/device mismatch; ignoring entry');
      return null;
    }
    return snap.jobId;
  } catch {
    return null;
  }
}

export function saveAbsmapJobId(client: string, deviceId: string, jobId: string): void {
  if (!client || !deviceId || !jobId) return;
  try {
    const snapshot: AbsmapLocalSnapshot = {
      v: CACHE_VERSION,
      client,
      deviceId,
      jobId,
      savedAt: Date.now(),
    };
    localStorage.setItem(absmapLocalStorageKey(client, deviceId), JSON.stringify(snapshot));
  } catch (e) {
    log.warn('Absmap local cache write failed', e);
  }
}

export function clearAbsmapJobCache(client: string, deviceId: string): void {
  if (!client || !deviceId) return;
  try {
    localStorage.removeItem(absmapLocalStorageKey(client, deviceId));
  } catch {
    /* ignore */
  }
}

/**
 * Persist client/device directory lists (`autocalib:directoryCache:v1`).
 *
 * Snapshot age is bounded by **`DIRECTORY_SNAPSHOT_TTL_MS` (5 min)**. Older client rows hydrate with
 * `clientsStatus = idle`; older device packs stay visible (`idle`) until `fetchClients` /
 * `fetchDevicesForClient` revalidates (stale‑while‑revalidate + app-level refetch on idle).
 */

import type { ClientSummary, DeviceSummary } from '../types';
import type { DirectoryState } from '../store/directory-state';
import { syncClientLocationsFromRoster } from './clientContext';

const STORAGE_KEY = 'autocalib:directoryCache:v1';

/** How long persisted client + device blobs are trusted before prompting revalidation. */
const DIRECTORY_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

type Snapshot = {
  v: 1;
  clients?: { t: number; rows: ClientSummary[] };
  devices?: Record<string, { t: number; rows: DeviceSummary[] }>;
};

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Snapshot;
    return p?.v === 1 ? p : null;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: Snapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Overlay persisted directory lists onto the slice (see TTL constants at top of file).
 */
export function mergeDirectoryCache(base: DirectoryState): DirectoryState {
  const now = Date.now();
  const snap = readSnapshot();
  const out: DirectoryState = {
    ...base,
    clients: [...base.clients],
    devicesByClient: { ...base.devicesByClient },
    devicesStatus: { ...base.devicesStatus },
    devicesError: { ...base.devicesError },
    clientLocations: { ...base.clientLocations },
    clientLocationStatus: { ...base.clientLocationStatus },
  };

  if (!snap) return out;

  if (snap.clients?.rows?.length) {
    const rows = snap.clients.rows.map((c) => ({ ...c }));
    if (now - snap.clients.t <= DIRECTORY_SNAPSHOT_TTL_MS) {
      out.clients = rows;
      out.clientsStatus = 'ready';
      out.clientsError = null;
    } else {
      out.clients = rows;
      out.clientsStatus = 'idle';
      out.clientsError = null;
    }
    const locations = syncClientLocationsFromRoster(rows);
    for (const [key, location] of Object.entries(locations)) {
      out.clientLocations[key] = location;
      out.clientLocationStatus[key] = 'ready';
    }
  }

  if (snap.devices) {
    for (const [clientId, pack] of Object.entries(snap.devices)) {
      if (!pack.rows?.length) continue;
      const rows = pack.rows.map((d) => ({ ...d }));
      if (now - pack.t <= DIRECTORY_SNAPSHOT_TTL_MS) {
        out.devicesByClient[clientId] = rows;
        out.devicesStatus[clientId] = 'ready';
        out.devicesError[clientId] = null;
      } else {
        out.devicesByClient[clientId] = rows;
        out.devicesStatus[clientId] = 'idle';
        out.devicesError[clientId] = null;
      }
    }
  }

  return out;
}

/** Read persisted devices for `clientId` from localStorage, ignoring TTL (for sync UI seed). */
export function readStaleDevicesFromSnapshot(clientId: string): DeviceSummary[] {
  if (!clientId) return [];
  try {
    const snap = readSnapshot();
    const pack = snap?.devices?.[clientId];
    if (!pack?.rows?.length) return [];
    return pack.rows.map((d) => ({ ...d }));
  } catch {
    return [];
  }
}

export function persistClientsCache(clients: ClientSummary[]): void {
  const prev = readSnapshot();
  writeSnapshot({
    v: 1,
    clients: { t: Date.now(), rows: clients.map((c) => ({ ...c })) },
    devices: prev?.devices ?? {},
  });
}

export function persistDevicesForClient(clientId: string, rows: DeviceSummary[]): void {
  const prev = readSnapshot();
  writeSnapshot({
    v: 1,
    clients: prev?.clients,
    devices: { ...prev?.devices, [clientId]: { t: Date.now(), rows: rows.map((d) => ({ ...d })) } },
  });
}

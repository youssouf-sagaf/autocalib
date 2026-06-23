import type { ClientSummary } from '../types';
import type { DirectoryState } from '../store/directory-state';
import { fetchDevicesForClient } from '../store/autocalib-slice';
import { clientDirectoryKeyFromSummary } from './clientContext';

/** Dispatches parallel-ish preloads before wider stagger (avoid hammering the API). */
const IMMEDIATE_SLOTS = 12;
const STAGGER_MS = 45;

/** Client order: current workspace → récents → rest of directory API order. */
export function orderedClientIdsForDirectoryPrefetch(
  clients: ClientSummary[],
  contextClientId: string,
  recentClientIds: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string | undefined) => {
    const t = id?.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  push(contextClientId);
  for (const id of recentClientIds) push(id);
  for (const c of clients) push(clientDirectoryKeyFromSummary(c));

  return out;
}

/**
 * True only when no device rows to show yet and not already finalized from the API —
 * prefetch helps cold selections; skips stale rows + in-flight loads.
 */
export function isColdDevicesCache(
  clientId: string,
  directory: Pick<DirectoryState, 'devicesByClient' | 'devicesStatus'>,
): boolean {
  const st = directory.devicesStatus[clientId];
  const n = directory.devicesByClient[clientId]?.length ?? 0;
  if (st === 'loading') return false;
  /** Authoritative empty or non-empty answer */
  if (st === 'ready') return false;
  if (n > 0) return false;
  return true;
}

/**
 * Dispatches `fetchDevicesForClient` for every cold client id in priority order.
 * Safe to call multiple times thanks to thunk guards.
 * Dispatch is typed loosely to avoid store ↔ listener circular imports; use AppDispatch when calling from React.
 */
export function scheduleDirectoryDevicePrefetch(
  dispatch: (action: ReturnType<typeof fetchDevicesForClient>) => unknown,
  directory: Pick<DirectoryState, 'clients' | 'devicesByClient' | 'devicesStatus'>,
  contextClientId: string,
  recentClientIds: string[],
): void {
  const order = orderedClientIdsForDirectoryPrefetch(
    directory.clients,
    contextClientId,
    recentClientIds,
  );

  let k = 0;
  for (const cid of order) {
    if (!isColdDevicesCache(cid, directory)) continue;
    const slot = k++;
    if (slot < IMMEDIATE_SLOTS) {
      dispatch(fetchDevicesForClient(cid));
    } else {
      const delay = STAGGER_MS * (slot - IMMEDIATE_SLOTS + 1);
      window.setTimeout(() => dispatch(fetchDevicesForClient(cid)), delay);
    }
  }
}

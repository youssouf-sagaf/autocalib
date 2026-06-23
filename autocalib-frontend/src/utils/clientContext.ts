import type { ClientLocation, ClientSummary, WorkspaceContext } from '../types';

/** B2B Firestore document id pattern (matches backend ``is_b2b_firestore_client_id``). */
export function isB2bClientId(value: string): boolean {
  return /^[A-Za-z0-9]{15,30}$/.test(value.trim());
}

/** Collapse spaces/underscores for ops ↔ B2B label matching. */
export function normalizeClientLabel(label: string): string {
  return label
    .trim()
    .replace(/[\s_-]+/g, ' ')
    .toLocaleLowerCase();
}

/** Stable directory / devices cache key — always the ops city label when present. */
export function clientDirectoryKey(clientId: string, clientName: string): string {
  return clientName.trim() || clientId.trim();
}

export function clientDirectoryKeyFromSummary(c: ClientSummary): string {
  return c.display_name.trim() || c.client_id.trim();
}

/** True when B2B provides a usable map center (not missing or ``0,0``). */
export function isValidClientLocation(
  loc: { lat: number; lng: number } | null | undefined,
): boolean {
  if (!loc) return false;
  const { lat, lng } = loc;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return !(lat === 0 && lng === 0);
}

/** Map roster location + zoom_level to the directory cache shape. */
export function clientLocationFromSummary(c: ClientSummary): ClientLocation | null {
  if (!isValidClientLocation(c.location ?? null)) return null;
  const { lat, lng } = c.location!;
  const zoom = c.zoom_level && c.zoom_level > 0 ? c.zoom_level : 12;
  return { lng, lat, zoom };
}

/** Populate directory clientLocations from the B2B roster (replaces Mapbox geocoding). */
export function syncClientLocationsFromRoster(
  clients: ClientSummary[],
): Record<string, ClientLocation | null> {
  const out: Record<string, ClientLocation | null> = {};
  for (const client of clients) {
    const key = clientDirectoryKeyFromSummary(client);
    if (!key) continue;
    out[key] = clientLocationFromSummary(client);
  }
  return out;
}

/** Human label for headers and breadcrumbs. */
export function clientDisplayName(
  clientId: string,
  clientName: string,
  clients?: ClientSummary[],
): string {
  const name = clientName.trim();
  if (name) return name;
  const id = clientId.trim();
  if (!id) return '';
  const match = clients?.find((c) => c.client_id === id);
  return match?.display_name ?? id;
}

export function activeClientDirectoryKey(ctx: WorkspaceContext): string {
  return clientDirectoryKey(ctx.clientId, ctx.clientName);
}

export function devicesFetchArg(
  c: ClientSummary,
  refreshUpstream?: boolean,
): {
  clientId: string;
  displayName: string;
  directoryKey: string;
  refreshUpstream?: boolean;
} {
  return {
    clientId: c.client_id,
    displayName: c.display_name,
    directoryKey: clientDirectoryKeyFromSummary(c),
    refreshUpstream,
  };
}

/** Find a roster row by ops label, B2B id, or normalized alias. */
export function findClientInDirectory(
  key: string,
  clients: ClientSummary[],
): ClientSummary | undefined {
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  const norm = normalizeClientLabel(trimmed);

  return clients.find((c) => {
    if (c.client_id.trim() === trimmed) return true;
    if (c.display_name.trim() === trimmed) return true;
    if (clientDirectoryKeyFromSummary(c) === trimmed) return true;
    if (normalizeClientLabel(c.display_name) === norm) return true;
    return false;
  });
}

export function resolveClientFromDirectoryKey(
  key: string,
  clients: ClientSummary[],
): { clientId: string; clientName: string } {
  const match = findClientInDirectory(key, clients);
  if (match) {
    return { clientId: match.client_id.trim(), clientName: match.display_name.trim() };
  }
  if (isB2bClientId(key)) {
    return { clientId: key.trim(), clientName: '' };
  }
  return { clientId: '', clientName: key.trim() };
}

/**
 * Merge B2B ``client_id`` from the API roster into workspace context
 * (localStorage may only have the ops display name).
 */
export function syncWorkspaceClientFromDirectory(
  ctx: Pick<WorkspaceContext, 'clientId' | 'clientName'>,
  clients: ClientSummary[],
): Pick<WorkspaceContext, 'clientId' | 'clientName'> {
  const key = clientDirectoryKey(ctx.clientId, ctx.clientName);
  if (!key) return { clientId: ctx.clientId, clientName: ctx.clientName };

  const match = findClientInDirectory(key, clients);
  if (!match) {
    return { clientId: ctx.clientId, clientName: ctx.clientName };
  }

  return {
    clientId: match.client_id.trim() || ctx.clientId,
    clientName: match.display_name.trim() || ctx.clientName,
  };
}

import type { WorkspaceContext } from '../types';

/** Build workspace path with `client` / `device` query params for Cocopilot deep-link parity. */
export function buildWorkspaceHref(
  path: string,
  ctx: Pick<WorkspaceContext, 'clientId' | 'clientName' | 'deviceId'>,
): string {
  const params = new URLSearchParams();
  const client = ctx.clientName.trim() || ctx.clientId.trim();
  if (client) params.set('client', client);
  const device = ctx.deviceId.trim();
  if (device) params.set('device', device);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

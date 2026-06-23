import type { DeviceSummary, RecentDevice } from '../types';

/**
 * Primary line for a recent device row: human name when known, else technical id.
 */
export function getRecentDeviceDisplayName(
  d: RecentDevice,
  devicesByClient: Record<string, DeviceSummary[]>,
): string {
  if (d.label?.trim()) return d.label.trim();
  const devices = devicesByClient[d.client];
  const match = devices?.find((dev) => dev.device_id === d.deviceId);
  if (match) {
    const name = match.display_name?.trim() || match.short_name?.trim();
    if (name) return name;
  }
  return d.deviceId;
}

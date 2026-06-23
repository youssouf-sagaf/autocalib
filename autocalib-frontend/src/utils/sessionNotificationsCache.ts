import type { AppNotification } from '../features/notifications/notification-types';
import { MAX_SESSION_NOTIFICATIONS } from '../features/notifications/notification-types';
import { createLogger } from './logger';

const CACHE_VERSION = 1 as const;

interface SessionNotificationsSnapshot {
  v: typeof CACHE_VERSION;
  client: string;
  deviceId: string;
  items: AppNotification[];
  savedAt: number;
}

const log = createLogger('sessionNotificationsCache');

function seg(s: string): string {
  return encodeURIComponent(s);
}

/** Absmap sessions may have a client without a selected device. */
export function sessionDeviceStorageKey(deviceId: string): string {
  return deviceId.trim() || '__client__';
}

export function sessionNotificationsStorageKey(client: string, deviceId: string): string {
  return `autocalib:session-notifications:v${CACHE_VERSION}:${seg(client)}:${seg(sessionDeviceStorageKey(deviceId))}`;
}

function parseSnap(raw: unknown): SessionNotificationsSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== CACHE_VERSION) return null;
  if (typeof o.client !== 'string' || typeof o.deviceId !== 'string') return null;
  if (!Array.isArray(o.items)) return null;
  return o as unknown as SessionNotificationsSnapshot;
}

export function loadSessionNotifications(client: string, deviceId: string): AppNotification[] {
  if (!client) return [];
  const deviceKey = sessionDeviceStorageKey(deviceId);
  try {
    const raw = localStorage.getItem(sessionNotificationsStorageKey(client, deviceId));
    if (!raw) return [];
    const snap = parseSnap(JSON.parse(raw) as unknown);
    if (!snap || snap.client !== client || snap.deviceId !== deviceKey) return [];
    return snap.items.slice(0, MAX_SESSION_NOTIFICATIONS);
  } catch {
    return [];
  }
}

export function saveSessionNotifications(
  client: string,
  deviceId: string,
  items: AppNotification[],
): void {
  if (!client) return;
  const deviceKey = sessionDeviceStorageKey(deviceId);
  try {
    const snapshot: SessionNotificationsSnapshot = {
      v: CACHE_VERSION,
      client,
      deviceId: deviceKey,
      items: items.slice(0, MAX_SESSION_NOTIFICATIONS),
      savedAt: Date.now(),
    };
    localStorage.setItem(
      sessionNotificationsStorageKey(client, deviceId),
      JSON.stringify(snapshot),
    );
  } catch (e) {
    log.warn('Session notifications cache write failed', e);
  }
}

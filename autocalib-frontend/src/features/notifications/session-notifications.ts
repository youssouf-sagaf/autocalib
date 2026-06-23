import type { AppNotification } from './notification-types';
import { MAX_SESSION_NOTIFICATIONS } from './notification-types';
import {
  loadSessionNotifications,
  saveSessionNotifications,
} from '../../utils/sessionNotificationsCache';

interface SessionContextLike {
  context: {
    clientId: string;
    clientName: string;
    deviceId: string;
  };
  sessionNotifications: AppNotification[];
}

export function sessionDirectoryKey(ctx: SessionContextLike['context']): string {
  return ctx.clientName.trim() || ctx.clientId.trim();
}

export function buildSessionContext(ctx: SessionContextLike['context']): string {
  const client = sessionDirectoryKey(ctx);
  const device = ctx.deviceId.trim();
  if (!client && !device) return '';
  if (!device) return client;
  const shortDevice = device.length > 14 ? `${device.slice(0, 12)}…` : device;
  return client ? `${client} · ${shortDevice}` : shortDevice;
}

export function reloadSessionNotifications(state: SessionContextLike): void {
  const client = sessionDirectoryKey(state.context);
  if (!client) {
    state.sessionNotifications.length = 0;
    return;
  }
  const loaded = loadSessionNotifications(client, state.context.deviceId);
  state.sessionNotifications.length = 0;
  state.sessionNotifications.push(...loaded);
}

function persistSessionNotifications(state: SessionContextLike): void {
  const client = sessionDirectoryKey(state.context);
  if (!client) return;
  saveSessionNotifications(client, state.context.deviceId, state.sessionNotifications);
}

export type NewSessionNotification = Omit<AppNotification, 'id' | 'read' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

export function pushSessionNotification(
  state: SessionContextLike,
  item: NewSessionNotification,
): void {
  const notif: AppNotification = {
    id: item.id ?? `${item.category}-${Date.now()}`,
    read: false,
    category: item.category,
    context: item.context ?? buildSessionContext(state.context),
    titleKey: item.titleKey,
    titleParams: item.titleParams,
    bodyKey: item.bodyKey,
    bodyParams: item.bodyParams,
    createdAt: item.createdAt ?? new Date().toISOString(),
  };
  state.sessionNotifications.unshift(notif);
  if (state.sessionNotifications.length > MAX_SESSION_NOTIFICATIONS) {
    state.sessionNotifications.length = MAX_SESSION_NOTIFICATIONS;
  }
  persistSessionNotifications(state);
}

export function markSessionNotificationRead(state: SessionContextLike, id: string): void {
  for (const n of state.sessionNotifications) {
    if (n.id === id) n.read = true;
  }
  persistSessionNotifications(state);
}

export function markAllSessionNotificationsRead(state: SessionContextLike): void {
  for (const n of state.sessionNotifications) {
    n.read = true;
  }
  persistSessionNotifications(state);
}

export function clearSessionNotifications(state: SessionContextLike): void {
  state.sessionNotifications.length = 0;
  persistSessionNotifications(state);
}

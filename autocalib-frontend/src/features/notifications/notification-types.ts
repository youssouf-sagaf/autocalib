/** In-app activity feed item — scoped to the active client / device session. */

export type NotificationCategory = 'pipeline' | 'save' | 'sync' | 'error';

export interface AppNotification {
  id: string;
  read: boolean;
  category: NotificationCategory;
  /** Client · device context line. */
  context?: string;
  /** i18n key for the main line (see notifications.events.*). */
  titleKey: string;
  titleParams?: Record<string, string | number>;
  bodyKey?: string;
  bodyParams?: Record<string, string | number>;
  createdAt: string;
}

export const MAX_SESSION_NOTIFICATIONS = 3;

export function formatNotificationAge(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t('notifications.ageJustNow');
  if (minutes < 60) return t('notifications.ageMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('notifications.ageHours', { count: hours });
  const days = Math.floor(hours / 24);
  return t('notifications.ageDays', { count: days });
}

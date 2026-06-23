import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { AppNotification } from './notification-types';
import { formatNotificationAge } from './notification-types';
import styles from './NotificationPanel.module.css';

interface NotificationPanelProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  notifications: AppNotification[];
  unreadCount: number;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function NotificationPanel({
  anchorEl,
  open,
  notifications,
  unreadCount,
  onClose,
  onMarkRead,
  onMarkAllRead,
}: NotificationPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorEl || !panelRef.current) return;

    const anchor = anchorEl.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    const pad = 12;

    let left = anchor.right + pad;
    let bottom = window.innerHeight - anchor.bottom;

    if (left + panel.width > window.innerWidth - pad) {
      left = Math.max(pad, anchor.left - panel.width - pad);
    }
    if (bottom + panel.height > window.innerHeight - pad) {
      bottom = pad;
    }

    setPosition({ left, bottom });
  }, [open, anchorEl, notifications.length, unreadCount]);

  if (!open) return null;

  const content = (
    <>
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t('notifications.closeAria')}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ left: position.left, bottom: position.bottom }}
        role="dialog"
        aria-labelledby="notification-panel-title"
        aria-modal="false"
      >
        <header className={styles.header}>
          <h2 id="notification-panel-title" className={styles.title}>
            {t('notifications.title')}
          </h2>
          <div className={styles.headerActions}>
            {unreadCount > 0 && (
              <span className={styles.unreadBadge}>
                <span className={styles.unreadDot} aria-hidden />
                {t('notifications.unread', { count: unreadCount })}
              </span>
            )}
            <button
              type="button"
              className={styles.markAllBtn}
              title={t('notifications.markAllRead')}
              disabled={unreadCount === 0}
              onClick={onMarkAllRead}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M2 8.5l3.5 3.5L14 3.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 4h6M2 7h4" strokeLinecap="round" opacity="0.5" />
              </svg>
            </button>
          </div>
        </header>

        <div className={styles.list}>
          {notifications.length === 0 ? (
            <p className={styles.empty}>{t('notifications.empty')}</p>
          ) : (
            notifications.map((item) => {
              const title = t(item.titleKey, item.titleParams);
              const body = item.bodyKey ? t(item.bodyKey, item.bodyParams) : undefined;
              const age = formatNotificationAge(item.createdAt, t);
              return (
              <div
                key={item.id}
                className={`${styles.item} ${!item.read ? styles.itemUnread : ''}`}
                role="article"
              >
                <span
                  className={`${styles.itemDot} ${!item.read ? styles.itemDotUnread : ''}`}
                  aria-hidden
                />
                <button
                  type="button"
                  className={styles.itemBody}
                  onClick={() => onMarkRead(item.id)}
                >
                  {item.context && <div className={styles.context}>{item.context}</div>}
                  <div className={styles.itemTitle}>{title}</div>
                  {body && <div className={styles.itemSubtitle}>{body}</div>}
                  {age && <div className={styles.itemMeta}>{age}</div>}
                </button>
              </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}

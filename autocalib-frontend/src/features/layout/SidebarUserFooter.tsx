import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NotificationPanel } from '../notifications/NotificationPanel';
import { useNotificationPanel } from '../notifications/useNotificationPanel';
import styles from './SidebarUserFooter.module.css';

interface SidebarUserFooterProps {
  expanded: boolean;
  onOpenShortcuts: () => void;
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M10 2.5a5 5 0 0 0-5 5v2.5l-1.5 2.5h13L15 10V7.5a5 5 0 0 0-5-5z" strokeLinejoin="round" />
      <path d="M8 15a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="10" cy="10" r="8" />
      <path d="M7.5 7.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5" />
      <circle cx="10" cy="14.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function SidebarUserFooter({ expanded, onOpenShortcuts }: SidebarUserFooterProps) {
  const { t } = useTranslation();
  const bellRef = useRef<HTMLButtonElement>(null);

  const {
    open: notifOpen,
    toggle: toggleNotif,
    close: closeNotif,
    notifications,
    unreadCount,
    markRead,
    markAllRead,
  } = useNotificationPanel();

  return (
    <>
      <div className={`${styles.footer} ${expanded ? styles.expanded : ''}`}>
        <button
          ref={bellRef}
          type="button"
          className={`${styles.bellBtn} ${notifOpen ? styles.sideBtnActive : ''}`}
          onClick={toggleNotif}
          title={t('notifications.openPanel')}
          aria-expanded={notifOpen}
          aria-haspopup="dialog"
        >
          <span className={styles.iconSlot}>
            <BellIcon />
          </span>
          {expanded && <span className={styles.label}>{t('notifications.title')}</span>}
          {unreadCount > 0 && (
            <span
              className={styles.badgeDot}
              aria-label={t('notifications.unread', { count: unreadCount })}
            />
          )}
        </button>

        <div className={styles.divider} aria-hidden />

        <button
          type="button"
          className={styles.utilityBtn}
          title={`${t('shortcutOverlay.title')} (?)`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenShortcuts();
          }}
        >
          <span className={styles.iconSlot}>
            <HelpIcon />
          </span>
          {expanded && <span className={styles.label}>{t('nav.shortcuts')}</span>}
        </button>
      </div>

      <NotificationPanel
        anchorEl={bellRef.current}
        open={notifOpen}
        notifications={notifications}
        unreadCount={unreadCount}
        onClose={closeNotif}
        onMarkRead={markRead}
        onMarkAllRead={markAllRead}
      />
    </>
  );
}

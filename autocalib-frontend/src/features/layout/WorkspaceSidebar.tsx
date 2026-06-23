import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { toggleSidebar } from '../../store/autocalib-slice';
import { Kbd } from '../../ui/Kbd';
import { SidebarUserFooter } from './SidebarUserFooter';
import logoSmall from '../../assets/logos/logo-small.png';
import styles from './WorkspaceSidebar.module.css';

const NAV_ITEMS = [
  {
    key: 'absmap' as const,
    labelKey: 'nav.absoluteMap',
    shortcut: '1',
    path: '/absmap',
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="16" height="14" rx="2" />
        <path d="M2 8h16" />
        <path d="M8 8v9" />
      </svg>
    ),
  },
  {
    key: 'calib' as const,
    labelKey: 'nav.calibration',
    shortcut: '2',
    path: '/calib',
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
        <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
        <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
        <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
      </svg>
    ),
  },
  {
    key: 'pairing' as const,
    labelKey: 'nav.pairing',
    shortcut: '3',
    path: '/pairing',
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="10" r="3" />
        <circle cx="14" cy="10" r="3" />
        <path d="M9 10h2" />
      </svg>
    ),
  },
] as const;

interface WorkspaceSidebarProps {
  onOpenShortcuts: () => void;
}

export function WorkspaceSidebar({ onOpenShortcuts }: WorkspaceSidebarProps) {
  const dispatch = useAppDispatch();
  const navigate = useWorkspaceNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const expanded = useAppSelector((s) => s.autocalib.context.sidebarExpanded);

  const activePath = location.pathname;

  const handleNavClick = useCallback(
    (path: string) => navigate(path),
    [navigate],
  );

  const handleToggle = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  return (
    <aside className={`${styles.sidebar} ${expanded ? styles.expanded : styles.collapsed}`}>
      <div className={styles.top}>
        <button className={styles.brandBtn} onClick={() => navigate('/')} title={t('nav.goDashboard')}>
          <img className={styles.logoMark} src={logoSmall} alt="" aria-hidden />
          {expanded && <span className={styles.brandText}>{t('nav.brandTitle')}</span>}
        </button>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={handleToggle}
          title={expanded ? t('nav.collapseSidebar') : t('nav.expandSidebar')}
          aria-expanded={expanded}
        >
          {expanded ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M9 3L5 7l4 4" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M5 3L9 7l-4 4" />
            </svg>
          )}
        </button>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = activePath.startsWith(item.path);
          return (
            <button
              key={item.key}
              className={`${styles.navItem} ${isActive ? styles.navActive : ''}`}
              onClick={() => handleNavClick(item.path)}
              title={expanded ? undefined : `${t(item.labelKey)} (G ${item.shortcut})`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {expanded && <span className={styles.navLabel}>{t(item.labelKey)}</span>}
              {expanded && <span className={styles.navShortcut}><Kbd size="xs">{item.shortcut}</Kbd></span>}
            </button>
          );
        })}
      </nav>

      <div className={styles.spacer} />

      <div className={styles.bottom}>
        <SidebarUserFooter expanded={expanded} onOpenShortcuts={onOpenShortcuts} />
      </div>
    </aside>
  );
}

import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Kbd } from '../../ui/Kbd';
import {
  ABSMAP_SHORTCUTS,
  CALIB_SHORTCUTS,
  PAIRING_SHORTCUTS,
  overlayGroupsForRoute,
  type ShortcutDefinition,
} from '../../keyboard/shortcutRegistry';
import styles from './ShortcutOverlay.module.css';

interface ShortcutOverlayProps {
  onClose: () => void;
}

const SCOPE_TITLE_KEYS: Record<string, string> = {
  global: 'shortcutOverlay.groups.global',
  absmap: 'shortcutOverlay.groups.absmap',
  calib: 'shortcutOverlay.groups.calib',
  pairing: 'shortcutOverlay.groups.pairing',
};

function ShortcutRow({ def, t }: { def: ShortcutDefinition; t: (key: string) => string }) {
  const parts = def.display.split(/\s+/).filter(Boolean);
  return (
    <div className={styles.row}>
      <span className={styles.keys}>
        {parts.map((k, ki) => (
          <Kbd key={ki} size="sm">{k}</Kbd>
        ))}
      </span>
      <span className={styles.desc}>{t(def.descKey)}</span>
    </div>
  );
}

export function ShortcutOverlay({ onClose }: ShortcutOverlayProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const groups = overlayGroupsForRoute(location.pathname);

  const referenceGroups = [
    { scope: 'absmap' as const, shortcuts: ABSMAP_SHORTCUTS },
    { scope: 'calib' as const, shortcuts: CALIB_SHORTCUTS },
    { scope: 'pairing' as const, shortcuts: PAIRING_SHORTCUTS },
  ].filter((g) => !groups.some((active) => active.scope === g.scope));

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>{t('shortcutOverlay.title')}</h2>
            <p className={styles.note}>{t('shortcutOverlay.note')}</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('shortcutOverlay.closeAria')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className={styles.body}>
          {groups.map((group) => (
            <div key={group.scope} className={styles.group}>
              <h3 className={styles.groupTitle}>{t(SCOPE_TITLE_KEYS[group.scope] ?? group.scope)}</h3>
              <div className={styles.shortcuts}>
                {group.shortcuts.map((def) => (
                  <ShortcutRow key={def.id} def={def} t={t} />
                ))}
              </div>
            </div>
          ))}
          {referenceGroups.length > 0 && (
            <details className={styles.otherWorkspaces}>
              <summary>{t('shortcutOverlay.otherWorkspaces')}</summary>
              {referenceGroups.map((group) => (
                <div key={group.scope} className={styles.group}>
                  <h3 className={styles.groupTitle}>{t(SCOPE_TITLE_KEYS[group.scope] ?? group.scope)}</h3>
                  <div className={styles.shortcuts}>
                    {group.shortcuts.map((def) => (
                      <ShortcutRow key={def.id} def={def} t={t} />
                    ))}
                  </div>
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

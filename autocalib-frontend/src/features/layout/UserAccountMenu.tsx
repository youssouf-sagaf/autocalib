import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { useProfileImageUrl } from '../../hooks/useProfileImageUrl';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import styles from './UserAccountMenu.module.css';

function PowerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2v10" strokeLinecap="round" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" strokeLinecap="round" />
    </svg>
  );
}

export function UserAccountMenu() {
  const { t } = useTranslation();
  const { activeProfile, logout } = useAuth();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  const displayName = activeProfile?.display_name ?? t('auth.guest');
  const email = activeProfile?.email ?? '';
  const profileImageUrl = useProfileImageUrl();

  const close = useCallback(() => setOpen(false), []);

  const handleLogout = () => {
    close();
    void logout();
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const pad = 8;
    let top = anchor.bottom + 4;
    let right = window.innerWidth - anchor.right;

    if (top + menu.height > window.innerHeight - pad) {
      top = Math.max(pad, anchor.top - menu.height - 4);
    }
    if (right + menu.width > window.innerWidth - pad) {
      right = window.innerWidth - menu.width - pad;
    }

    setMenuPos({ top, right });
  }, [open, displayName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const dropdown =
    open &&
    createPortal(
      <>
        <button type="button" className={styles.backdrop} aria-label={t('common.close')} onClick={close} />
        <div
          ref={menuRef}
          className={styles.menu}
          style={{ top: menuPos.top, right: menuPos.right }}
          role="menu"
        >
          <div className={styles.menuHeader}>
            <div className={styles.menuName}>{displayName}</div>
            {email ? <div className={styles.menuEmail}>{email}</div> : null}
          </div>
          <LanguageToggle variant="menu" />
          <div className={styles.menuDivider} role="separator" />
          <button type="button" className={styles.menuItem} role="menuitem" onClick={handleLogout}>
            <PowerIcon />
            {t('nav.logout')}
          </button>
        </div>
      </>,
      document.body,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={displayName}
      >
        <span className={styles.avatarWrap}>
          <img className={styles.avatarImg} src={profileImageUrl} alt="" />
          <span className={styles.onlineDot} aria-hidden />
        </span>
        <span className={styles.userName}>{displayName}</span>
      </button>
      {dropdown}
    </>
  );
}

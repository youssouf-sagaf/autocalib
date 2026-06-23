import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './alertModal.module.css';

export type AlertModalVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertModalSpec {
  variant: AlertModalVariant;
  titleKey: string;
  titleParams?: Record<string, string | number>;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  onClose?: () => void;
}

type ActiveAlert = AlertModalSpec & { id: number };

let openAlertGlobal: ((spec: AlertModalSpec) => void) | null = null;

/** Fire-and-forget alert modal from hooks, reducers, or thunks. */
export function showAlertModal(spec: AlertModalSpec): void {
  openAlertGlobal?.(spec);
}

function AlertIcon({ variant }: { variant: AlertModalVariant }) {
  if (variant === 'success') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 11.2l2.4 2.4L15 7.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === 'error') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 8l6 6M14 8l-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }
  if (variant === 'warning') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
        <path
          d="M11 3.5L19 17.5H3L11 3.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M11 9v4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="11" cy="15.75" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 10v5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="11" cy="7.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function AlertModalHost() {
  const { t } = useTranslation();
  const [alert, setAlert] = useState<ActiveAlert | null>(null);
  const onCloseRef = useState<{ fn?: () => void }>({})[0];

  const close = useCallback(() => {
    const onClose = onCloseRef.fn;
    onCloseRef.fn = undefined;
    setAlert(null);
    onClose?.();
  }, [onCloseRef]);

  useEffect(() => {
    openAlertGlobal = (spec) => {
      onCloseRef.fn = spec.onClose;
      setAlert({ ...spec, id: Date.now() });
    };
    return () => {
      openAlertGlobal = null;
    };
  }, [onCloseRef]);

  useEffect(() => {
    if (!alert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'NumpadEnter') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alert, close]);

  if (!alert) return null;

  const message = alert.messageKey ? t(alert.messageKey, alert.messageParams) : null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={close}>
      <div
        className={`${styles.modal} ${styles[alert.variant]}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.iconWrap}>
            <AlertIcon variant={alert.variant} />
          </div>
          <div className={styles.headerText}>
            <h2 id="alert-modal-title" className={styles.title}>
              {t(alert.titleKey, alert.titleParams)}
            </h2>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={close}
            aria-label={t('common.close')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {message ? <p className={styles.messageBox}>{message}</p> : null}

        <footer className={styles.footer}>
          <span className={styles.hint}>{t('alerts.dismissHint')}</span>
          <button type="button" className={styles.okBtn} onClick={close}>
            {t('alerts.ok')}
          </button>
        </footer>
      </div>
    </div>
  );
}

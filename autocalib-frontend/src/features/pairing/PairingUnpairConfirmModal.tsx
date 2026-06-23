import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PairingUnpairConfirmModal.module.css';

interface PairingUnpairConfirmModalProps {
  open: boolean;
  deletedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PairingUnpairConfirmModal({
  open,
  deletedCount,
  onConfirm,
  onCancel,
}: PairingUnpairConfirmModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open || deletedCount <= 0) return null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pairing-unpair-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="pairing-unpair-confirm-title" className={styles.title}>
            {t('pairing.unpairConfirm.title')}
          </h2>
        </header>
        <p className={styles.body}>
          {t('pairing.unpairConfirm.body', { count: deletedCount })}
        </p>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className={styles.confirmBtn} onClick={onConfirm}>
            {t('pairing.unpairConfirm.confirm', { count: deletedCount })}
          </button>
        </footer>
      </div>
    </div>
  );
}

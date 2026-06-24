import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PairingReverseConfirmModal.module.css';

interface PairingReverseConfirmModalProps {
  open: boolean;
  side: 'map' | 'image';
  pairCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PairingReverseConfirmModal({
  open,
  side,
  pairCount,
  onConfirm,
  onCancel,
}: PairingReverseConfirmModalProps) {
  const { t } = useTranslation();
  const sideWord = side === 'map' ? t('pairing.sideMap') : t('pairing.sideImage');

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

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pairing-reverse-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="pairing-reverse-confirm-title" className={styles.title}>
            {t('pairing.reverseConfirm.title')}
          </h2>
        </header>
        <p className={styles.body}>
          {t('pairing.reverseConfirm.body', { side: sideWord, count: pairCount })}
        </p>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className={styles.confirmBtn} onClick={onConfirm}>
            {t('pairing.reverseConfirm.confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PairingZoneConfirmModal.module.css';

interface PairingZoneConfirmModalProps {
  open: boolean;
  slotCount: number;
  bboxCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PairingZoneConfirmModal({
  open,
  slotCount,
  bboxCount,
  onConfirm,
  onCancel,
}: PairingZoneConfirmModalProps) {
  const { t } = useTranslation();

  const countsMatch = slotCount === bboxCount && slotCount > 0;
  const isEmpty = slotCount === 0 && bboxCount === 0;

  const bodyKey = isEmpty
    ? 'pairing.zoneConfirm.bodyEmpty'
    : countsMatch
      ? 'pairing.zoneConfirm.body'
      : 'pairing.zoneConfirm.bodyMismatch';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && countsMatch) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm, countsMatch]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pairing-zone-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="pairing-zone-confirm-title" className={styles.title}>
            {t('pairing.zoneConfirm.title')}
          </h2>
        </header>
        <p className={`${styles.body} ${!countsMatch ? styles.bodyWarning : ''}`}>
          {t(bodyKey, { slots: slotCount, bboxes: bboxCount })}
        </p>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={!countsMatch}
            onClick={onConfirm}
          >
            {t('pairing.savePairings')}
          </button>
        </footer>
      </div>
    </div>
  );
}

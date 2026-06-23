import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './BulkDeleteConfirmModal.module.css';

interface BulkDeleteConfirmModalProps {
  open: boolean;
  count: number;
  clientLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BulkDeleteConfirmModal({
  open,
  count,
  clientLabel,
  onConfirm,
  onCancel,
}: BulkDeleteConfirmModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open || count <= 0) return null;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={onCancel}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="bulk-delete-confirm-title" className={styles.title}>
            {t('bulkDeleteConfirm.title')}
          </h2>
        </header>
        <p className={styles.body}>
          {t('bulkDeleteConfirm.body', { count, client: clientLabel })}
        </p>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className={styles.deleteBtn} onClick={onConfirm}>
            {t('bulkDeleteConfirm.confirm', { count })}
          </button>
        </footer>
      </div>
    </div>
  );
}

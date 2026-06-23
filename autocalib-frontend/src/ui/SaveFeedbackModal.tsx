import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { closeSaveFeedback } from '../store/autocalib-slice';
import styles from './SaveFeedbackModal.module.css';

export function SaveFeedbackModal() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const feedback = useAppSelector((s) => s.autocalib.ui.saveFeedback);

  const onClose = useCallback(() => dispatch(closeSaveFeedback()), [dispatch]);

  useEffect(() => {
    if (!feedback.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedback.open, onClose]);

  if (!feedback.open) return null;

  const isPairing = feedback.workspace === 'pairing';
  const isCalib = feedback.workspace === 'calib';
  const pairedCount = feedback.pairedCount ?? 0;

  const titleKey = `saveFeedback.${feedback.workspace}.${feedback.variant}.title`;

  const subtitleKey = (() => {
    if (isPairing && feedback.variant === 'success' && feedback.summary) {
      return 'saveFeedback.pairing.success.subtitle';
    }
    if (isPairing && feedback.variant === 'success') {
      return 'saveFeedback.pairing.success.subtitleFallback';
    }
    if (isCalib && feedback.variant === 'success' && feedback.summary) {
      return 'saveFeedback.calib.success.subtitle';
    }
    return `saveFeedback.${feedback.workspace}.${feedback.variant}.subtitle`;
  })();

  const pairingSubtitleParams = { paired: pairedCount };

  const summaryParams = feedback.summary
    ? {
        total: feedback.summary.total_slots,
        created: feedback.summary.created,
        updated: feedback.summary.updated,
        deleted: feedback.summary.deleted,
      }
    : undefined;

  const titleParams =
    feedback.summary && (feedback.workspace === 'absmap' || isPairing || isCalib)
      ? summaryParams
      : isPairing
        ? pairingSubtitleParams
        : undefined;

  const subtitle =
    feedback.errorMessage
    ?? (feedback.variant !== 'error' ? t(subtitleKey, titleParams) : t(subtitleKey));

  const showChangeStats =
    feedback.summary != null
    && feedback.variant !== 'error'
    && (feedback.workspace === 'absmap' || isCalib);

  const showPairingStats =
    isPairing && feedback.variant === 'success' && feedback.summary != null;

  const deletedItems = (
    feedback.deletedBboxLabels?.length
      ? feedback.deletedBboxLabels
      : feedback.deletedBboxKeys ?? []
  );
  const deletedItemsPreview = deletedItems.slice(0, 6);
  const deletedItemsOverflow = Math.max(0, deletedItems.length - deletedItemsPreview.length);
  const showDeletedBboxList =
    isCalib
    && (feedback.summary?.deleted ?? 0) > 0
    && deletedItemsPreview.length > 0;

  const totalKey = isCalib
    ? 'saveFeedback.stats.calibTotal'
    : 'saveFeedback.stats.total';

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={`${styles.modal} ${styles[feedback.variant]}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-feedback-title"
      >
        <header className={styles.header}>
          <div>
            <h2 id="save-feedback-title" className={styles.title}>
              {t(titleKey, titleParams)}
            </h2>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('saveFeedback.closeAria')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {showChangeStats && feedback.summary && (
          <div className={styles.body}>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statValue}>{feedback.summary.created}</span>
                <span className={styles.statLabel}>{t('saveFeedback.stats.created')}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{feedback.summary.updated}</span>
                <span className={styles.statLabel}>{t('saveFeedback.stats.updated')}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{feedback.summary.deleted}</span>
                <span className={styles.statLabel}>{t('saveFeedback.stats.deleted')}</span>
              </div>
            </div>
            <p className={styles.totalRow}>
              {t(totalKey, { total: feedback.summary.total_slots })}
            </p>
            {showDeletedBboxList && (
              <p className={styles.deletedKeys}>
                {t('saveFeedback.stats.deletedBboxList', {
                  items: deletedItemsPreview.join(', '),
                })}
                {deletedItemsOverflow > 0 && (
                  <>
                    {' '}
                    {t('saveFeedback.stats.deletedBboxKeysMore', { more: deletedItemsOverflow })}
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {showPairingStats && feedback.summary && (
          <div className={styles.body}>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statValue}>{feedback.summary.created}</span>
                <span className={styles.statLabel}>{t('saveFeedback.stats.pairingNew')}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{feedback.summary.updated}</span>
                <span className={styles.statLabel}>{t('saveFeedback.stats.pairingModified')}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{feedback.summary.deleted}</span>
                <span className={styles.statLabel}>{t('saveFeedback.stats.pairingRemoved')}</span>
              </div>
            </div>
            <p className={styles.totalRow}>
              {t('saveFeedback.stats.pairingTotal', { total: feedback.summary.total_slots })}
            </p>
          </div>
        )}

        <footer className={styles.footer}>
          <button type="button" className={styles.okBtn} onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}

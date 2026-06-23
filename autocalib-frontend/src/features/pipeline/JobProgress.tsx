import { useTranslation } from 'react-i18next';
import { useAppSelector } from '../../store/hooks';
import styles from './JobProgress.module.css';

export function JobProgress() {
  const { t } = useTranslation();
  const job = useAppSelector((s) => s.autocalib.absmap.job);

  if (!job || job.status === 'done') return null;

  if (job.status === 'failed') {
    return (
      <div className={`${styles.container} ${styles.failed}`}>
        <span className={styles.label}>
          {t('jobProgress.failed', { message: job.error ?? t('common.unknownError') })}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <span className={styles.spinner} />
    </div>
  );
}

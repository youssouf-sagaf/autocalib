import { useAppSelector } from '../../store/hooks';
import styles from './JobProgress.module.css';

export function JobProgress() {
  const job = useAppSelector((s) => s.absmap.job);

  if (!job || job.status === 'done') return null;

  if (job.status === 'failed') {
    return (
      <div className={`${styles.container} ${styles.failed}`}>
        <span className={styles.label}>Failed: {job.error ?? 'Unknown error'}</span>
      </div>
    );
  }

  const { progress } = job;
  if (!progress) {
    return (
      <div className={styles.container}>
        <span className={styles.label}>Starting pipeline…</span>
        <div className={styles.track}>
          <div className={styles.barIndeterminate} />
        </div>
      </div>
    );
  }

  const overallPercent = Math.round(
    ((progress.crop_index * 100 + progress.percent) / (progress.crop_total * 100)) * 100,
  );

  return (
    <div className={styles.container}>
      <div className={styles.row}>
        <span className={styles.label}>
          Crop {progress.crop_index + 1}/{progress.crop_total} — {progress.stage}
        </span>
        <span className={styles.percent}>{overallPercent}%</span>
      </div>
      <div className={styles.track}>
        <div className={styles.bar} style={{ width: `${overallPercent}%` }} />
      </div>
    </div>
  );
}

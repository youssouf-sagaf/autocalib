import type { ReactNode } from 'react';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export function StatusBar({ left, center, right }: StatusBarProps) {
  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <div className={styles.left}>{left}</div>
      <div className={styles.center}>{center}</div>
      <div className={styles.right}>{right}</div>
    </div>
  );
}

export function StatusDot() {
  return <span className={styles.dot} aria-hidden>·</span>;
}

export function StatusToolBadge({
  children,
  destructive,
}: {
  children: ReactNode;
  destructive?: boolean;
}) {
  return (
    <span
      className={`${styles.toolBadge} ${destructive ? styles.toolBadgeDestructive : ''}`}
    >
      {children}
    </span>
  );
}

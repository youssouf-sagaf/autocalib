import type { ReactNode } from 'react';
import styles from './banner.module.css';

export type BannerVariant = 'info' | 'primary' | 'warning' | 'danger';

interface BannerProps {
  variant?: BannerVariant;
  /** Main line — typically `<strong>Mode</strong> — action · <Kbd>X</Kbd> desc`. */
  children: ReactNode;
  /** Secondary hints (smaller, dimmer). Optional. */
  subline?: ReactNode;
  className?: string;
}

/** Single banner component used by every workspace. Stack hints inline as a
 * second line via `subline` rather than rendering a second banner. */
export function Banner({ variant = 'info', children, subline, className }: BannerProps) {
  const cls = [styles.banner, styles[variant], className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role="status">
      <div className={styles.bannerLine}>{children}</div>
      {subline ? <div className={styles.subline}>{subline}</div> : null}
    </div>
  );
}

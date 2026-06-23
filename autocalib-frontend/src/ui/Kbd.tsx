import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

type KbdSize = 'xs' | 'sm' | 'md' | 'lg';
type KbdTone = 'auto' | 'accent' | 'muted';

interface KbdProps {
  children: ReactNode;
  /** xs ≈ rail · sm ≈ banner · md ≈ default · lg ≈ CTAs */
  size?: KbdSize;
  /** auto = inherit currentColor · accent = white-on-primary · muted = light surface */
  tone?: KbdTone;
  className?: string;
  title?: string;
  'aria-hidden'?: boolean;
}

/** Single source of truth for keyboard hint pills across the app. */
export function Kbd({
  children,
  size = 'md',
  tone = 'auto',
  className,
  title,
  'aria-hidden': ariaHidden,
}: KbdProps) {
  const cls = [
    styles.kbd,
    styles[size],
    tone === 'accent' ? styles.toneAccent : tone === 'muted' ? styles.toneMuted : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <kbd className={cls} title={title} aria-hidden={ariaHidden}>
      {children}
    </kbd>
  );
}

import calibToolbar from './floatingToolbar.module.css';
import styles from './VerticalZoomBar.module.css';

export interface VerticalZoomBarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Defaults to "Zoom" */
  ariaLabel?: string;
  /** Horizontal edge of the positioned parent. Defaults to left (calib). */
  side?: 'left' | 'right';
}

/** Vertical +/− control, centered on the left or right of the positioned parent. */
export function VerticalZoomBar({
  onZoomIn,
  onZoomOut,
  ariaLabel = 'Zoom',
  side = 'left',
}: VerticalZoomBarProps) {
  const rootClass = side === 'right' ? styles.rootRight : styles.root;
  return (
    <div className={`${calibToolbar.bar} ${rootClass}`} aria-label={ariaLabel}>
      <div className={`${calibToolbar.group} ${styles.group}`}>
        <button
          type="button"
          className={`${calibToolbar.btn} ${styles.btn}`}
          onClick={onZoomIn}
          title="Zoom in (+)"
        >
          <span className={calibToolbar.icon}>+</span>
        </button>
        <button
          type="button"
          className={`${calibToolbar.btn} ${styles.btn}`}
          onClick={onZoomOut}
          title="Zoom out (−)"
        >
          <span className={calibToolbar.icon}>−</span>
        </button>
      </div>
    </div>
  );
}

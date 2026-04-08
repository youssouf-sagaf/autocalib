import type { ReactNode } from 'react';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { toggleDualMap } from '../../store/autoabsmap-slice';
import { SearchBar } from './SearchBar';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  isDrawing?: boolean;
  onFlyTo?: (lng: number, lat: number) => void;
}

export function AppShell({ children, sidebar, isDrawing, onFlyTo }: AppShellProps) {
  const dispatch = useAppDispatch();
  const dualMapActive = useAppSelector((s) => s.absmap.dualMapActive);
  const hasSlots = useAppSelector((s) => s.absmap.slots.length > 0 || s.absmap.baselineSlots.length > 0);

  return (
    <div className={styles.shell}>
      <nav className={styles.navbar}>
        <div className={styles.brand}>
          <span className={styles.logoMark}>C</span>
          <span className={styles.title}>autoabsmap</span>
        </div>
        {onFlyTo && <SearchBar onFlyTo={onFlyTo} />}
        <div className={styles.actions}>
          <button
            className={`${styles.dualBtn} ${dualMapActive ? styles.active : ''}`}
            disabled={!hasSlots}
            onClick={() => dispatch(toggleDualMap())}
            title={hasSlots ? 'Toggle dual map view' : 'Run pipeline first'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Dual Map
          </button>
        </div>
      </nav>

      {isDrawing && (
        <div className={styles.drawBanner}>
          Click to place vertices · Double-click or click first point to close · <kbd>Esc</kbd> to undo
        </div>
      )}

      <div className={styles.content}>
        <div className={styles.mapArea}>{children}</div>
        {sidebar && <aside className={styles.sidebar}>{sidebar}</aside>}
      </div>
    </div>
  );
}

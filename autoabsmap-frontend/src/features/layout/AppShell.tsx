import type { ReactNode } from 'react';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { toggleDualMap } from '../../store/autoabsmap-slice';
import { SearchBar } from './SearchBar';
import type { EditMode } from '../../types';
import styles from './AppShell.module.css';

const MODE_BANNERS: Partial<Record<EditMode, string>> = {
  add: '<strong>Add mode</strong> — Click to place · Move to rotate · Click again to confirm · <kbd>Esc</kbd> to cancel · <kbd>A</kbd> to exit',
  delete: '<strong>Delete mode</strong> — Click a marker to select · Click again to confirm · <kbd>Enter</kbd> to confirm · <kbd>Esc</kbd> to cancel · <kbd>D</kbd> to exit',
  bulk_delete:
    '<strong>Bulk delete</strong> — Draw a lasso (click corners · double-click or snap to first to close) · <kbd>Enter</kbd> to confirm removal · <kbd>Esc</kbd> to redraw or exit · <kbd>B</kbd> to exit',
  copy: '<strong>Copy mode</strong> — Click a marker to duplicate · <kbd>Esc</kbd> to exit · <kbd>C</kbd> to exit',
  modify: '<strong>Modify mode</strong> — Press &amp; hold a marker · Drag to move · Release to lock · Move to rotate · Click to confirm · <kbd>Esc</kbd> to cancel · <kbd>M</kbd> to exit',
  straighten: '<strong>Straighten mode</strong> — Click two slots on the same row · Alignment applies immediately · <kbd>Z</kbd> to undo · <kbd>Esc</kbd> or <kbd>S</kbd> to exit',
  reprocess: '<strong>Reprocess mode</strong> — Trace the zone to fill · Click a reference slot · Review proposals (Accept / Reject) · <kbd>Esc</kbd> to step back · <kbd>R</kbd> to exit',
};

interface AppShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  isDrawing?: boolean;
  editMode?: EditMode;
  onFlyTo?: (lng: number, lat: number) => void;
}

export function AppShell({ children, sidebar, isDrawing, editMode = 'none', onFlyTo }: AppShellProps) {
  const dispatch = useAppDispatch();
  const dualMapActive = useAppSelector((s) => s.absmap.dualMapActive);
  const hasSlots = useAppSelector((s) => s.absmap.slots.length > 0 || s.absmap.baselineSlots.length > 0);

  const bannerHtml = !isDrawing ? MODE_BANNERS[editMode] : undefined;

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

      {bannerHtml && (
        <div
          className={styles.modeBanner}
          dangerouslySetInnerHTML={{ __html: bannerHtml }}
        />
      )}

      <div className={styles.content}>
        <div className={styles.mapArea}>{children}</div>
        {sidebar && <aside className={styles.sidebar}>{sidebar}</aside>}
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CalibPreviewPanel } from './CalibPreviewPanel';
import { useCalibPreview } from './useCalibPreview';
import styles from './CalibPreviewDrawer.module.css';

interface CalibPreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string | null;
  widthPct: number;
  isResizing: boolean;
  onResizeMouseDown: (e: React.MouseEvent) => void;
}

export function CalibPreviewDrawer({
  open,
  onOpenChange,
  deviceId,
  widthPct,
  isResizing,
  onResizeMouseDown,
}: CalibPreviewDrawerProps) {
  const { t } = useTranslation();
  const preview = useCalibPreview(deviceId);
  const isAnalyzing = preview.refreshing || (preview.loading && !preview.loaded);

  if (!deviceId) return null;

  const drawerStyle = open
    ? ({ width: `${widthPct}%`, '--preview-width': `${widthPct}%` } as CSSProperties)
    : undefined;

  return (
    <>
      {open ? (
        <div
          className={`${styles.drawerSlot} ${styles.drawerSlotOpen} ${isResizing ? styles.drawerResizing : ''}`}
          style={drawerStyle}
          aria-hidden={false}
        >
          <button
            type="button"
            className={styles.resizeHandle}
            onMouseDown={onResizeMouseDown}
            aria-label={t('calib.preview.resizeHandle')}
            title={t('calib.preview.resizeHandle')}
          />
          <div className={styles.drawerInner}>
            <CalibPreviewPanel
              preview={preview}
              variant="drawer"
              onClose={() => onOpenChange(false)}
            />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={`${styles.toggle} ${open ? styles.toggleOpen : ''} ${isResizing ? styles.toggleResizing : ''} ${!open && isAnalyzing ? styles.toggleBusy : ''}`}
        style={open ? ({ '--preview-width': `${widthPct}%` } as CSSProperties) : undefined}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="calib-preview-drawer"
        title={
          !open && isAnalyzing
            ? t('calib.preview.analyzingInBackground')
            : open
              ? t('calib.preview.close')
              : t('calib.preview.open')
        }
      >
        {!open && isAnalyzing ? <span className={styles.toggleSpinner} aria-hidden /> : null}
        <span className={styles.toggleIcon} aria-hidden>
          {open ? '›' : '‹'}
        </span>
        {t('calib.preview.toggleLabel')}
      </button>
    </>
  );
}

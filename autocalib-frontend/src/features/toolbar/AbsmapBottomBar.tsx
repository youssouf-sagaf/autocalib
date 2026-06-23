import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { removeCrop, clearCrops, launchJob } from '../../store/autocalib-slice';
import { JobProgress } from '../pipeline/JobProgress';
import { IconPlay, IconRoiPolygon } from '../../ui/ToolbarIcons';
import { Kbd } from '../../ui/Kbd';
import aiAction from '../../ui/aiToolbarAction.module.css';
import styles from '../../ui/floatingToolbar.module.css';

/**
 * Minimal bottom bar: draw ROI, launch, inline job progress.
 */
export function AbsmapBottomBar({
  isDrawing,
  onStartDraw,
  onStopDraw,
}: {
  isDrawing: boolean;
  onStartDraw: () => void;
  onStopDraw: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const crops = useAppSelector((s) => s.autocalib.absmap.crops);
  const job = useAppSelector((s) => s.autocalib.absmap.job);
  const isRunning = job?.status === 'running' || job?.status === 'pending';

  const [cropPopoverOpen, setCropPopoverOpen] = useState(false);
  const cropPopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cropPopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cropPopRef.current && !cropPopRef.current.contains(e.target as Node)) {
        setCropPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [cropPopoverOpen]);

  const handleLaunch = useCallback(() => {
    dispatch(launchJob());
    setCropPopoverOpen(false);
  }, [dispatch]);

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <div className={styles.roiWrap} ref={cropPopRef}>
          <button
            type="button"
            className={`${styles.btn} ${isDrawing ? styles.active : ''}`}
            onClick={isDrawing ? onStopDraw : onStartDraw}
            disabled={isRunning}
            title={
              isRunning
                ? t('absmapBottom.waitPipeline')
                : isDrawing
                  ? t('absmapBottom.stopDraw')
                  : t('absmapBottom.drawRoi')
            }
          >
            <span className={styles.icon}>
              <IconRoiPolygon />
            </span>
            <span className={styles.label}>{isDrawing ? t('common.stop') : t('absmapBottom.drawRoiLabel')}</span>
            {!isRunning && <Kbd size="sm" aria-hidden>R</Kbd>}
          </button>

          {crops.length > 0 && (
            <button
              type="button"
              className={styles.cropToggle}
              onClick={() => setCropPopoverOpen((p) => !p)}
              title={t('absmapBottom.viewRoiList')}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d={cropPopoverOpen ? 'M2 6l3-3 3 3' : 'M2 4l3 3 3-3'} />
              </svg>
            </button>
          )}

          {cropPopoverOpen && crops.length > 0 && (
            <div className={styles.cropPopover}>
              <ul className={styles.cropList}>
                {crops.map((_c, i) => (
                  <li key={i} className={styles.cropItem}>
                    <span>{t('common.roi', { n: i + 1 })}</span>
                    <button
                      type="button"
                      className={styles.cropRemove}
                      onClick={() => dispatch(removeCrop(i))}
                      disabled={isRunning}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {crops.length > 1 && !isRunning && (
                <button
                  type="button"
                  className={styles.cropClear}
                  onClick={() => {
                    dispatch(clearCrops());
                    setCropPopoverOpen(false);
                  }}
                >
                  {t('common.clearAll')}
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`${styles.btn} ${aiAction.toolbar}`}
          disabled={crops.length === 0 || isRunning}
          onClick={handleLaunch}
          title={
            isRunning
              ? t('absmapBottom.pipelineRunning')
              : crops.length === 0
                ? t('absmapBottom.needRoi')
                : t('absmapBottom.launchTitle', { count: crops.length })
          }
        >
          <span className={styles.icon}><IconPlay /></span>
          <span className={styles.label}>{isRunning ? t('common.running') : t('absmapBottom.launch')}</span>
          {!isRunning && <Kbd size="sm" aria-hidden>J</Kbd>}
        </button>
      </div>

      {isRunning && (
        <div className={styles.progressWrap}>
          <JobProgress />
        </div>
      )}
    </div>
  );
}

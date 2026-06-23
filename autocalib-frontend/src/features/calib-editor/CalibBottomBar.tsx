import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { calibMultiResize, calibSetConfidence } from '../../store/autocalib-slice';
import styles from '../../ui/floatingToolbar.module.css';

const REF_INDEX = -1;

interface CalibBottomBarProps {
  frameCount: number;
  activeFrameIndex: number;
  onFrameSelect: (index: number) => void;
  isReference: boolean;
  disabled?: boolean;
}

export function CalibBottomBar({
  frameCount,
  activeFrameIndex,
  onFrameSelect,
  isReference,
  disabled = false,
}: CalibBottomBarProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { bboxes, lockedBboxIds, confidenceThreshold } = useAppSelector((s) => s.autocalib.calib);
  const pct = Math.round(confidenceThreshold * 100);

  const [resizeValue, setResizeValue] = useState('10');
  const [showResizeInput, setShowResizeInput] = useState(false);

  const lockedSet = new Set(lockedBboxIds);
  const unlockedBboxCount = bboxes.filter((b) => !lockedSet.has(b.spot_id)).length;
  const hasBboxes = bboxes.length > 0;

  const handleMultiResize = useCallback(() => {
    const size = Number(resizeValue);
    if (isNaN(size) || size <= 0) return;
    const locked = new Set(lockedBboxIds);
    const spotIds = bboxes.filter((b) => !locked.has(b.spot_id)).map((b) => b.spot_id);
    if (spotIds.length === 0) return;
    dispatch(calibMultiResize({ spotIds, newSize: size }));
    setShowResizeInput(false);
  }, [dispatch, bboxes, lockedBboxIds, resizeValue]);

  const goPrev = () => {
    if (activeFrameIndex === REF_INDEX) return;
    if (activeFrameIndex === 0) {
      onFrameSelect(REF_INDEX);
    } else {
      onFrameSelect(activeFrameIndex - 1);
    }
  };

  const goNext = () => {
    if (activeFrameIndex === REF_INDEX) {
      onFrameSelect(0);
    } else if (activeFrameIndex < frameCount - 1) {
      onFrameSelect(activeFrameIndex + 1);
    }
  };

  const centerLabel =
    activeFrameIndex === REF_INDEX
      ? t('calib.reference')
      : t('calib.frameLabel', { current: activeFrameIndex + 1, total: frameCount });

  return (
    <div className={styles.bar}>
      <div className={styles.frameNav}>
        <button
          type="button"
          className={`${styles.btn} ${styles.frameNavArrow}`}
          onClick={goPrev}
          disabled={activeFrameIndex === REF_INDEX}
          title={t('calib.bottomPrevFrame')}
        >
          <span className={styles.icon}>&lt;</span>
        </button>

        <button
          type="button"
          className={`${styles.frameCenterBtn} ${isReference ? styles.frameCenterBtnActive : ''}`}
          onClick={() => {
            if (activeFrameIndex !== REF_INDEX) onFrameSelect(REF_INDEX);
          }}
          title={
            activeFrameIndex === REF_INDEX
              ? t('calib.bottomRefView')
              : t('calib.bottomBackRef')
          }
          aria-current={activeFrameIndex === REF_INDEX ? 'page' : undefined}
        >
          {centerLabel}
        </button>

        <button
          type="button"
          className={`${styles.btn} ${styles.frameNavArrow}`}
          onClick={goNext}
          disabled={activeFrameIndex === frameCount - 1}
          title={t('calib.bottomNextFrame')}
        >
          <span className={styles.icon}>&gt;</span>
        </button>
      </div>

      <div className={styles.sep} />

      {!showResizeInput ? (
        <button
          type="button"
          className={styles.btn}
          onClick={() => setShowResizeInput(true)}
          disabled={!hasBboxes || !isReference || unlockedBboxCount === 0}
          title={t('calib.resizeTitle')}
        >
          <span className={styles.icon}>↔</span>
          <span className={styles.label}>{t('calib.resize')}</span>
          {unlockedBboxCount > 0 && <span className={styles.badge}>{unlockedBboxCount}</span>}
        </button>
      ) : (
        <div className={styles.inlineInput}>
          <input
            className={styles.resizeInput}
            type="number"
            min={1}
            max={100}
            value={resizeValue}
            onChange={(e) => setResizeValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleMultiResize();
              if (e.key === 'Escape') setShowResizeInput(false);
            }}
            autoFocus
            placeholder="px"
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.applyBtn}`}
            onClick={handleMultiResize}
            disabled={unlockedBboxCount === 0}
          >
            {t('common.apply')}
          </button>
          <button type="button" className={styles.btn} onClick={() => setShowResizeInput(false)}>
            ✕
          </button>
        </div>
      )}

      <div className={styles.sep} />

      <label
        className={styles.confidenceRow}
        htmlFor="calib-confidence-slider"
        title={t('calib.confidenceFilterTitle')}
      >
        <span className={styles.confidenceRowLabel}>{t('calib.confidenceFilter')}</span>
        <input
          id="calib-confidence-slider"
          className={styles.confidenceRowSlider}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidenceThreshold}
          disabled={disabled}
          onChange={(e) => dispatch(calibSetConfidence(Number(e.target.value)))}
          aria-label={t('calib.confidenceAria')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct} %`}
        />
        <output className={styles.confidenceRowValue} htmlFor="calib-confidence-slider">
          {pct}%
        </output>
      </label>
    </div>
  );
}

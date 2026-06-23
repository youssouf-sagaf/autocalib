import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLoader } from '../../ui/ToolbarIcons';
import { CalibPreviewCanvas } from './CalibPreviewCanvas';
import type { UseCalibPreviewResult } from './useCalibPreview';
import {
  isAggregatedPreviewItem,
  PREVIEW_LABEL_COLORS,
  previewImageObjectKey,
} from './calib-preview-utils';
import styles from './CalibPreviewPanel.module.css';

interface CalibPreviewPanelProps {
  preview: UseCalibPreviewResult;
  variant?: 'default' | 'drawer';
  onClose?: () => void;
}

const LEGEND_KEYS = ['car', 'moto', 'van'] as const;

export function CalibPreviewPanel({ preview, variant = 'default', onClose }: CalibPreviewPanelProps) {
  const { t } = useTranslation();
  const {
    data,
    loading,
    refreshing,
    loaded,
    error,
    pollAttempt,
    refreshStatus,
    refreshHint,
    selected,
    setSelected,
    refresh,
    getImageUrl,
    imageCache,
  } = preview;

  const items = useMemo(() => data?.top_occupied_images ?? [], [data?.top_occupied_images]);
  const [mainImageUrl, setMainImageUrl] = useState<string | null>(null);

  const selectedIndex = useMemo(
    () => (selected ? items.findIndex((item) => item.rank === selected.rank) : -1),
    [items, selected],
  );

  const goToIndex = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      setSelected(item);
      void getImageUrl(previewImageObjectKey(item, items));
    },
    [items, setSelected, getImageUrl],
  );

  const goPrev = useCallback(() => {
    if (selectedIndex > 0) goToIndex(selectedIndex - 1);
  }, [selectedIndex, goToIndex]);

  const goNext = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < items.length - 1) goToIndex(selectedIndex + 1);
  }, [selectedIndex, items.length, goToIndex]);

  useEffect(() => {
    if (variant !== 'drawer') return;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, goPrev, goNext, onClose]);

  useEffect(() => {
    if (!selected || !items.length) {
      setMainImageUrl(null);
      return;
    }
    const key = previewImageObjectKey(selected, items);
    const cached = imageCache.get(key);
    if (cached) {
      setMainImageUrl(cached);
      return;
    }
    let cancelled = false;
    void getImageUrl(key).then((url) => {
      if (!cancelled) setMainImageUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, items, getImageUrl, imageCache]);

  const handleRefresh = () => {
    void refresh();
  };

  const hasImages = items.length > 0;
  const showAnalyzing = refreshing || (loading && !loaded);
  const showPromptEmpty =
    loaded &&
    !loading &&
    !refreshing &&
    !hasImages &&
    !error &&
    !data?.refreshed_at &&
    refreshStatus !== 'running';
  const showNoImagesAfterRefresh =
    loaded &&
    !refreshing &&
    !hasImages &&
    !error &&
    (refreshStatus === 'completed' || Boolean(data?.refreshed_at));
  const canGoPrev = selectedIndex > 0;
  const canGoNext = selectedIndex >= 0 && selectedIndex < items.length - 1;

  const rankItems = useMemo(
    () => items.filter((item) => !isAggregatedPreviewItem(item, items)),
    [items],
  );
  const navTotal = rankItems.length || items.length;
  const navRank = selected
    ? isAggregatedPreviewItem(selected, items)
      ? navTotal + 1
      : selected.rank
    : 0;

  const navStatusLabel =
    selected && isAggregatedPreviewItem(selected, items)
      ? `${t('calib.preview.aggregated')} — ${t('calib.preview.rankNav', {
          rank: navRank,
          total: navTotal + (items.length > 5 ? 1 : 0),
          count: selected.vehicle_count,
        })}`
      : selected
        ? t('calib.preview.rankNav', {
            rank: navRank,
            total: navTotal,
            count: selected.vehicle_count,
          })
        : '';

  const errorMessage =
    error && error.startsWith('calib.preview.') ? t(error) : error;

  return (
    <div className={styles.panel} id={variant === 'drawer' ? 'calib-preview-drawer' : undefined}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t('calib.preview.title')}</h3>
        {variant === 'drawer' && onClose ? (
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('calib.preview.close')}>
            ×
          </button>
        ) : null}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleRefresh}
          disabled={showAnalyzing}
        >
          {showAnalyzing
            ? t('calib.preview.scanning')
            : error && !showAnalyzing
              ? t('calib.preview.retry')
              : t('calib.preview.refresh')}
        </button>
        {data?.refreshed_at ? (
          <p className={styles.refreshedAt}>
            {t('calib.preview.refreshedAt', {
              date: new Date(data.refreshed_at).toLocaleString(),
            })}
          </p>
        ) : null}
      </div>

      {showAnalyzing && (
        <div className={styles.analyzingBanner} role="status">
          {loading && !refreshing ? (
            <>
              <IconLoader size={18} />
              <div className={styles.analyzingText}>
                <span>{t('calib.preview.loading')}</span>
              </div>
            </>
          ) : (
            <>
              <IconLoader size={18} />
              <div className={styles.analyzingText}>
                <span>
                  {refreshHint === 'already_running'
                    ? t('calib.preview.alreadyRunning')
                    : t('calib.preview.scanning')}
                </span>
                <span className={styles.statusDetail}>
                  {t('calib.preview.statusLine', {
                    status: t(`calib.preview.status.${refreshStatus}`),
                    attempt: pollAttempt,
                    jobId: data?.refresh?.job_id ?? '—',
                  })}
                </span>
                {refreshHint === 'accepted' && refreshStatus === 'idle' ? (
                  <span className={styles.statusHint}>{t('calib.preview.pollingAfterPost')}</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}

      {error && !showAnalyzing && (
        <div className={styles.messageBox}>
          <p className={styles.error}>{errorMessage}</p>
        </div>
      )}

      {showPromptEmpty && (
        <div className={styles.messageBox}>
          <p>{t('calib.preview.empty')}</p>
        </div>
      )}

      {showNoImagesAfterRefresh && !showPromptEmpty && (
        <div className={styles.messageBox}>
          <p>{t('calib.preview.noImages')}</p>
        </div>
      )}

      {hasImages && selected && (
        <>
          <div className={styles.navBar}>
            <button
              type="button"
              className={styles.navTextBtn}
              onClick={goPrev}
              disabled={!canGoPrev || showAnalyzing}
            >
              {t('calib.preview.prev')}
            </button>
            <span className={styles.navStatus}>{navStatusLabel}</span>
            <button
              type="button"
              className={styles.navTextBtn}
              onClick={goNext}
              disabled={!canGoNext || showAnalyzing}
            >
              {t('calib.preview.next')}
            </button>
          </div>

          <div className={styles.mainCanvas}>
            {refreshing && (
              <div className={styles.refreshOverlay}>
                <IconLoader size={36} />
              </div>
            )}
            <CalibPreviewCanvas
              imageUrl={mainImageUrl}
              imageWidth={selected.image_width}
              imageHeight={selected.image_height}
              detections={selected.detections}
            />
          </div>

          <div className={styles.legend}>
            {LEGEND_KEYS.map((key) => (
              <span key={key} className={styles.legendItem}>
                <span
                  className={styles.legendSwatch}
                  style={{ backgroundColor: PREVIEW_LABEL_COLORS[key] }}
                />
                {t(`calib.preview.legend.${key}`)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

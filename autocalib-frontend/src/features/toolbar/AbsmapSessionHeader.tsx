import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { toggleOverlay } from '../../store/autocalib-slice';
import type { OverlayLayer } from '../../types';
import styles from './AbsmapSessionHeader.module.css';

const PIPELINE_OVERLAYS: { key: OverlayLayer; labelKey: string; color: string }[] = [
  { key: 'detection', labelKey: 'absmapSession.overlayDetection', color: '#e67e22' },
  { key: 'postprocess', labelKey: 'absmapSession.overlayPostFull', color: '#3498db' },
];

const ROI_OVERLAY: { key: OverlayLayer; labelKey: string; color: string } = {
  key: 'roi',
  labelKey: 'absmapSession.overlayRoi',
  color: '#3bafda',
};

interface AbsmapSessionHeaderProps {
  hasResults: boolean;
}

export function AbsmapSessionHeader({ hasResults }: AbsmapSessionHeaderProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const overlayVisibility = useAppSelector((s) => s.autocalib.absmap.overlayVisibility);
  const crops = useAppSelector((s) => s.autocalib.absmap.crops);

  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!layersOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (layersRef.current && !layersRef.current.contains(e.target as Node)) {
        setLayersOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [layersOpen]);

  const overlayItems = [
    ...PIPELINE_OVERLAYS,
    ...(crops.length > 0 ? [ROI_OVERLAY] : []),
  ];

  const activeLayerCount = overlayItems.filter(({ key }) => overlayVisibility[key]).length;

  if (!hasResults) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.layersWrap} ref={layersRef}>
          <button
            type="button"
            className={`${styles.layersBtn} ${layersOpen ? styles.layersBtnOpen : ''}`}
            onClick={() => setLayersOpen((p) => !p)}
            title={t('absmapSession.layersMenuTitle')}
            aria-expanded={layersOpen}
            aria-haspopup="true"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span>{t('absmapSession.layersMenu')}</span>
            {activeLayerCount > 0 && (
              <span className={styles.layersBadge}>{activeLayerCount}</span>
            )}
          </button>
          {layersOpen && (
            <div className={styles.layersPopover} role="menu">
              {overlayItems.map(({ key, labelKey, color }) => (
                <button
                  key={key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={overlayVisibility[key]}
                  className={`${styles.layersItem} ${overlayVisibility[key] ? styles.layersItemOn : ''}`}
                  onClick={() => dispatch(toggleOverlay(key))}
                >
                  <span
                    className={styles.overlayDot}
                    style={{
                      background: overlayVisibility[key] ? color : 'transparent',
                      borderColor: color,
                    }}
                  />
                  <span>{t(labelKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}

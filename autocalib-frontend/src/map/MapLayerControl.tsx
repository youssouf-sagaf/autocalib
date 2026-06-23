import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setImagerySource } from '../store/autocalib-slice';
import { IMAGERY_SOURCES, type ImagerySource } from '../types';
import styles from './MapLayerControl.module.css';

// Pléiades 2026 covers metropolitan France only. Source: GetCapabilities bbox.
const PLEIADES_FR_BBOX = {
  west: -5.17,
  east: 9.58,
  south: 41.3,
  north: 50.1,
};

function isInsideMetropolitanFR(lng: number, lat: number): boolean {
  return (
    lng >= PLEIADES_FR_BBOX.west && lng <= PLEIADES_FR_BBOX.east &&
    lat >= PLEIADES_FR_BBOX.south && lat <= PLEIADES_FR_BBOX.north
  );
}

const SOURCE_LABEL_KEYS: Record<ImagerySource, string> = {
  'mapbox': 'imagerySource.mapbox',
  'ign-current': 'imagerySource.ignCurrent',
  'ign-pleiades-2026': 'imagerySource.ignPleiades2026',
};

const SOURCE_HINT_KEYS: Partial<Record<ImagerySource, string>> = {
  'ign-pleiades-2026': 'imagerySource.hintFranceOnly',
};

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 8.5 12 15 2 8.5 12 2" />
      <polyline points="2 15.5 12 22 22 15.5" />
      <polyline points="2 12 12 18.5 22 12" />
    </svg>
  );
}

/**
 * Satellite imagery picker — what you see on the map is what the pipeline
 * fetches for crops and detection (WYSINWYG).
 */
export function MapLayerControl() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const active = useAppSelector((s) => s.autocalib.absmap.imagerySource);
  const view = useAppSelector((s) => s.autocalib.absmap.absmapViewState);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (fabRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const insideFR = view ? isInsideMetropolitanFR(view.longitude, view.latitude) : true;

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={`${styles.fab} ${open ? styles.active : ''}`}
        title={t('imagerySource.layerControlTitle')}
        aria-label={t('imagerySource.layerControlAria')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <LayersIcon />
      </button>
      {open && (
        <div ref={popoverRef} className={styles.popover} role="menu">
          <div className={styles.popoverHeader}>
            {t('imagerySource.layerControlTitle')}
          </div>
          {IMAGERY_SOURCES.map((src) => {
            const pleiadesBlocked = src === 'ign-pleiades-2026' && !insideFR;
            const disabled = pleiadesBlocked;
            const hintKey = SOURCE_HINT_KEYS[src];
            return (
              <button
                key={src}
                type="button"
                role="menuitemradio"
                aria-checked={active === src}
                disabled={disabled}
                className={`${styles.option} ${active === src ? styles.selected : ''}`}
                onClick={() => {
                  dispatch(setImagerySource(src));
                  setOpen(false);
                }}
                title={pleiadesBlocked ? t('imagerySource.hintFranceOnly') : undefined}
              >
                <span className={styles.optionCheck}>
                  {active === src ? '✓' : ''}
                </span>
                <span className={styles.optionLabel}>
                  {t(SOURCE_LABEL_KEYS[src])}
                  {hintKey && (
                    <>
                      {' '}
                      <span className={styles.optionHint}>
                        ({t(hintKey)})
                      </span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
          <div className={styles.popoverHint}>{t('imagerySource.wysiwygHint')}</div>
        </div>
      )}
    </>
  );
}

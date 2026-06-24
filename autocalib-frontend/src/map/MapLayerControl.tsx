import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setMapDisplayLayer } from '../store/autocalib-slice';
import {
  MAP_CARTE_LAYERS,
  MAP_SATELLITE_LAYERS,
  type MapDisplayLayer,
} from '../types';
import styles from './MapLayerControl.module.css';

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

const DISPLAY_LABEL_KEYS: Record<MapDisplayLayer, string> = {
  streets: 'mapDisplayLayer.streets',
  osm: 'mapDisplayLayer.osm',
  'mapbox-satellite': 'mapDisplayLayer.mapboxSatellite',
  'ign-current': 'mapDisplayLayer.ignCurrent',
  'ign-pleiades-2026': 'mapDisplayLayer.ignPleiades2026',
};

const DISPLAY_HINT_KEYS: Partial<Record<MapDisplayLayer, string>> = {
  'ign-pleiades-2026': 'mapDisplayLayer.hintFranceOnly',
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

function LayerOption({
  layer,
  selected,
  disabled,
  onSelect,
}: {
  layer: MapDisplayLayer;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const hintKey = DISPLAY_HINT_KEYS[layer];
  const pleiadesBlocked = layer === 'ign-pleiades-2026' && disabled;

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      className={`${styles.option} ${selected ? styles.selected : ''}`}
      onClick={onSelect}
      title={pleiadesBlocked ? t('mapDisplayLayer.hintFranceOnly') : undefined}
    >
      <span className={styles.optionCheck}>{selected ? '✓' : ''}</span>
      <span className={styles.optionLabel}>
        {t(DISPLAY_LABEL_KEYS[layer])}
        {hintKey && (
          <>
            {' '}
            <span className={styles.optionHint}>({t(hintKey)})</span>
          </>
        )}
      </span>
    </button>
  );
}

/** Map display layer picker — carte routière vs image satellite / orthophoto. */
export function MapLayerControl() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const active = useAppSelector((s) => s.autocalib.absmap.mapDisplayLayer);
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

  const selectLayer = (layer: MapDisplayLayer) => {
    dispatch(setMapDisplayLayer(layer));
    setOpen(false);
  };

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={`${styles.fab} ${open ? styles.active : ''}`}
        title={t('mapDisplayLayer.layerControlTitle')}
        aria-label={t('mapDisplayLayer.layerControlAria')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <LayersIcon />
      </button>
      {open && (
        <div ref={popoverRef} className={styles.popover} role="menu">
          <div className={styles.popoverHeader}>
            {t('mapDisplayLayer.layerControlTitle')}
          </div>

          <div className={styles.popoverDivider}>{t('mapDisplayLayer.sectionCarte')}</div>
          {MAP_CARTE_LAYERS.map((layer) => (
            <LayerOption
              key={layer}
              layer={layer}
              selected={active === layer}
              disabled={false}
              onSelect={() => selectLayer(layer)}
            />
          ))}

          <div className={styles.popoverDivider}>{t('mapDisplayLayer.sectionSatellite')}</div>
          {MAP_SATELLITE_LAYERS.map((layer) => (
            <LayerOption
              key={layer}
              layer={layer}
              selected={active === layer}
              disabled={layer === 'ign-pleiades-2026' && !insideFR}
              onSelect={() => selectLayer(layer)}
            />
          ))}
        </div>
      )}
    </>
  );
}

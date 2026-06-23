import { useTranslation } from 'react-i18next';
import { TRAINING_GSD_M, TRAINING_ROI_SIZE_M, TRAINING_TILE_PX } from './useRoiRectDraw';
import { IMAGERY_SOURCES, type ImagerySource } from '../../types';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setImagerySource } from '../../store/studio-slice';
import type { TileSummary } from '../../types';

const SOURCE_LABEL_KEYS: Record<ImagerySource, string> = {
  mapbox: 'imagerySource.mapbox',
  'ign-current': 'imagerySource.ignCurrent',
  'ign-pleiades-2026': 'imagerySource.ignPleiades2026',
};

export interface CropControlsProps {
  drawingRoi: boolean;
  loading: boolean;
  tileCount: number;
  recentTiles: TileSummary[];
  onToggleDrawRoi: () => void;
  shortcutKey?: string;
}

export function CropControls({
  drawingRoi,
  loading,
  tileCount,
  recentTiles,
  onToggleDrawRoi,
  shortcutKey = 'T',
}: CropControlsProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const imagerySource = useAppSelector((s) => s.studio.imagerySource);

  const zoneHint = !drawingRoi
    ? t('annotate.drawRoi')
    : loading
      ? t('crop.saving')
      : t('crop.moveHint', {
          px: TRAINING_TILE_PX,
          meters: TRAINING_ROI_SIZE_M.toFixed(1),
        });

  return (
    <div className="config-panel">
      <p className="field-hint">{t('crop.stepHint')}</p>

      <div className="field-group">
        <label className="field-label">{t('workspace.imagerySource')}</label>
        <select
          className="field-select"
          value={imagerySource}
          onChange={(e) => dispatch(setImagerySource(e.target.value as ImagerySource))}
          disabled={loading}
        >
          {IMAGERY_SOURCES.map((src) => (
            <option key={src} value={src}>
              {t(SOURCE_LABEL_KEYS[src])}
            </option>
          ))}
        </select>
      </div>

      <div className="field-group">
        <label className="field-label">GSD</label>
        <input className="field-input" value={`${TRAINING_GSD_M} m/px`} readOnly />
      </div>

      <div className="field-group">
        <label className="field-label">{t('workspace.zone')}</label>
        <p className="field-hint">{zoneHint}</p>
        <button
          type="button"
          className={`btn ${drawingRoi ? 'btn-accent' : 'btn-ghost'}`}
          onClick={onToggleDrawRoi}
          disabled={loading}
          title={t('crop.placeTileShortcut', { key: shortcutKey })}
        >
          {drawingRoi ? t('annotate.stopDraw') : t('annotate.drawRoi')}
          <kbd className="btn-kbd">{shortcutKey}</kbd>
        </button>
      </div>

      <div className="panel-divider" />

      <div className="field-group">
        <label className="field-label">{t('crop.savedTiles')}</label>
        <p className="field-hint">{t('crop.savedCount', { count: tileCount })}</p>
        <ul className="list compact-list">
          {recentTiles.length === 0 && <li className="muted">{t('crop.noTilesYet')}</li>}
          {recentTiles.slice(0, 5).map((tile) => (
            <li key={tile.id} className="list-item static mono">
              {tile.name ?? tile.id.slice(0, 12)}
            </li>
          ))}
        </ul>
        <p className="field-hint">{t('crop.nextStepHint')}</p>
      </div>
    </div>
  );
}

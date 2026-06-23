import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setCurrentTileId } from '../../store/studio-slice';

export interface AnnotationPanelProps {
  selectedClass: 'vehicle';
  onSelectClass: (c: 'vehicle') => void;
  loading: boolean;
  hasPendingObb: boolean;
  onCommitObb: () => void;
  onMarkBackground: () => void;
  onSave: () => void;
  onRefreshTiles: () => void;
}

export function AnnotationPanel({
  selectedClass,
  onSelectClass,
  loading,
  hasPendingObb,
  onCommitObb,
  onMarkBackground,
  onSave,
  onRefreshTiles,
}: AnnotationPanelProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const tiles = useAppSelector((s) => s.studio.tiles);
  const currentTileId = useAppSelector((s) => s.studio.currentTileId);

  return (
    <div className="config-panel">
      <p className="field-hint">{t('annotate.stepHint')}</p>

      <div className="field-group">
        <div className="panel-title-row">
          <h3 className="panel-title">{t('datasets.tiles')}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshTiles}>
            {t('common.refresh')}
          </button>
        </div>
        <ul className="list">
          {tiles.length === 0 && <li className="muted">{t('crop.noTilesYet')}</li>}
          {tiles.map((tile) => (
            <li key={tile.id}>
              <button
                type="button"
                className={currentTileId === tile.id ? 'list-item active' : 'list-item'}
                onClick={() => dispatch(setCurrentTileId(tile.id))}
              >
                {tile.name ?? tile.id.slice(0, 12)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel-divider" />

      <p className="field-hint">{t('annotate.clickObbHint')}</p>
      <div className="class-picker">
        <button
          type="button"
          className={`chip ${selectedClass === 'vehicle' ? 'active' : ''}`}
          onClick={() => onSelectClass('vehicle')}
          disabled={!currentTileId}
        >
          {t('annotate.classVehicle')}
        </button>
      </div>

      {hasPendingObb && (
        <button type="button" className="btn btn-accent" onClick={onCommitObb}>
          {t('workspace.addObb')}
        </button>
      )}

      <button
        type="button"
        className="btn btn-ghost"
        disabled={!currentTileId || loading}
        onClick={onMarkBackground}
      >
        {t('annotate.markBackground')}
      </button>

      <button
        type="button"
        className="btn btn-accent"
        disabled={!currentTileId || loading}
        onClick={onSave}
      >
        {t('annotate.save')}
      </button>
    </div>
  );
}

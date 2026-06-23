import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setCurrentTileId, setTiles } from '../../store/studio-slice';
import type { DatasetSummary, TileSummary } from '../../types';

export function DatasetExplorer({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const tiles = useAppSelector((s) => s.studio.tiles);
  const currentTileId = useAppSelector((s) => s.studio.currentTileId);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetName, setDatasetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [exportAfterCreate, setExportAfterCreate] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [tilesRes, datasetsRes] = await Promise.all([
          apiClient.get<TileSummary[]>('/api/tiles'),
          apiClient.get<DatasetSummary[]>('/api/datasets'),
        ]);
        dispatch(setTiles(tilesRes.data));
        setDatasets(datasetsRes.data);
      } catch {
        /* backend may be offline during dev */
      }
    })();
  }, [dispatch]);

  const createDataset = async () => {
    if (!datasetName.trim()) return;
    setLoading(true);
    setLastExportPath(null);
    try {
      const { data } = await apiClient.post<DatasetSummary>('/api/datasets', {
        name: datasetName.trim(),
        tile_ids: tiles.map((x) => x.id),
      });
      setDatasets((prev) => [...prev, data]);
      setDatasetName('');

      if (exportAfterCreate) {
        const { data: exportReport } = await apiClient.post<{ export_path: string }>(
          `/api/datasets/${data.id}/export/yolo`,
        );
        setLastExportPath(exportReport.export_path);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? 'config-panel' : 'page-panel'}>
      {!embedded && <h1>{t('datasets.title')}</h1>}
      {embedded && <h3 className="panel-title">{t('datasets.title')}</h3>}
      <section>
        <h2>{t('datasets.tiles')}</h2>
        <ul className="list">
          {tiles.length === 0 && <li className="muted">No tiles yet</li>}
          {tiles.map((tile) => (
            <li key={tile.id}>
              <button
                type="button"
                className={
                  currentTileId === tile.id ? 'list-item active' : 'list-item'
                }
                onClick={() => dispatch(setCurrentTileId(tile.id))}
              >
                {tile.name ?? tile.id}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Datasets</h2>
        <ul className="list">
          {datasets.map((d) => (
            <li key={d.id} className="list-item static">
              {d.name}
              {d.tile_count != null ? ` (${d.tile_count})` : ''}
            </li>
          ))}
        </ul>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={exportAfterCreate}
            onChange={(e) => setExportAfterCreate(e.target.checked)}
          />
          Export YOLO pack after create (for training)
        </label>
        {lastExportPath && (
          <p className="hint">Last export: {lastExportPath}</p>
        )}
        <div className="form-row">
          <input
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
            placeholder="Dataset name"
          />
          <button
            type="button"
            className="btn btn-accent"
            disabled={loading}
            onClick={() => void createDataset()}
          >
            {t('datasets.create')}
          </button>
        </div>
      </section>
    </div>
  );
}

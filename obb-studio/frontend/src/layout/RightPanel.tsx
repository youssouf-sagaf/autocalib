import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client';
import type { TileSummary, TrainingRun } from '../types';
import { LiveMetricsPanel } from '../features/training-dashboard/LiveMetricsPanel';
import { useAppSelector } from '../store/hooks';

export function RightPanel() {
  const { t } = useTranslation();
  const currentTileId = useAppSelector((s) => s.studio.currentTileId);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [tiles, setTiles] = useState<TileSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [runsRes, tilesRes] = await Promise.all([
          apiClient.get<TrainingRun[]>('/api/training/runs'),
          apiClient.get<TileSummary[]>('/api/tiles'),
        ]);
        setRuns(runsRes.data);
        setTiles(tilesRes.data);
        if (runsRes.data[0]) setSelectedRunId(runsRes.data[0].id);
      } catch {
        /* offline */
      }
    };
    void load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const activeRun = runs.find((r) => r.status === 'running');

  return (
    <div className="right-panel">
      <section className="panel-block">
        <h3 className="panel-title">{t('workspace.inferenceJobs')}</h3>
        <div className="metrics-grid">
          <div className="metric-cell">
            <span className="metric-label">Status</span>
            <span className="metric-value">
              {activeRun ? t('workspace.live') : t('workspace.idle')}
            </span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Runs</span>
            <span className="metric-value">{runs.length}</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">Tiles</span>
            <span className="metric-value">{tiles.length}</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">{t('workspace.activeTile')}</span>
            <span className="metric-value mono">
              {currentTileId ? currentTileId.slice(0, 8) : '—'}
            </span>
          </div>
        </div>
        {selectedRunId && (
          <div className="metrics-compact">
            <LiveMetricsPanel runId={selectedRunId} compact />
          </div>
        )}
      </section>

      <section className="panel-block panel-grow">
        <h3 className="panel-title">{t('workspace.runBrowser')}</h3>
        <ul className="run-list">
          {runs.length === 0 && (
            <li className="run-item muted">{t('workspace.noRuns')}</li>
          )}
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className={`run-item ${selectedRunId === run.id ? 'active' : ''}`}
                onClick={() => setSelectedRunId(run.id)}
              >
                <span className="run-id">{run.id.slice(0, 12)}…</span>
                <span className={`run-status status-${run.status}`}>{run.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

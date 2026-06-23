import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client';
import type { TrainingRun } from '../../types';
import { LiveMetricsPanel } from './LiveMetricsPanel';

export function TrainingDashboard({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState('');
  const [epochs, setEpochs] = useState(50);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await apiClient.get<TrainingRun[]>('/api/training/runs');
        setRuns(data);
        if (data[0]) setSelectedRunId(data[0].id);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const startTraining = async () => {
    if (!datasetId.trim()) return;
    setLoading(true);
    try {
      let dataYaml = '';
      const { data: exportReport } = await apiClient.post<{ export_path: string }>(
        `/api/datasets/${datasetId.trim()}/export/yolo`,
      );
      dataYaml = `${exportReport.export_path}/data.yaml`;

      const { data } = await apiClient.post<TrainingRun>('/api/training/runs', {
        data_yaml: dataYaml,
        epochs,
      });
      setRuns((prev) => [data, ...prev]);
      setSelectedRunId(data.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? 'config-panel' : 'page-panel'}>
      {!embedded && <h1>{t('train.title')}</h1>}
      {embedded && <h3 className="panel-title">{t('train.title')}</h3>}
      <div className="form-row">
        <input
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
          placeholder="Dataset ID"
        />
        <input
          type="number"
          value={epochs}
          min={1}
          onChange={(e) => setEpochs(Number(e.target.value))}
        />
        <button
          type="button"
          className="btn btn-accent"
          disabled={loading || !datasetId}
          onClick={() => void startTraining()}
        >
          {t('train.start')}
        </button>
      </div>
      {!embedded && (
        <>
          <section>
            <h2>{t('train.runs')}</h2>
            <ul className="list">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    className={
                      selectedRunId === run.id ? 'list-item active' : 'list-item'
                    }
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    {run.id} — {run.status}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <LiveMetricsPanel runId={selectedRunId} />
        </>
      )}
    </div>
  );
}

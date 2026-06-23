import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client';

export function EvaluationView({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [runId, setRunId] = useState('');
  const [split, setSplit] = useState('val');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const runEval = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data } = await apiClient.post<Record<string, unknown>>(
        '/api/evaluation/runs',
        { training_run_id: runId, split },
      );
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? 'config-panel config-panel-nested' : 'page-panel'}>
      {!embedded && <h1>{t('eval.title')}</h1>}
      {embedded && <h3 className="panel-title">{t('eval.title')}</h3>}
      <div className="form-row">
        <input
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          placeholder="Training run ID"
        />
        <select
          className="field-select"
          value={split}
          onChange={(e) => setSplit(e.target.value)}
        >
          <option value="val">val</option>
          <option value="test">test</option>
        </select>
        <button
          type="button"
          className="btn btn-accent"
          disabled={loading || !runId}
          onClick={() => void runEval()}
        >
          {t('eval.run')}
        </button>
      </div>
      {result && (
        <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

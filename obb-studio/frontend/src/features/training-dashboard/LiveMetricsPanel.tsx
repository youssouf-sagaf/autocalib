import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useTrainingStream } from '../../hooks/useTrainingStream';

interface LiveMetricsPanelProps {
  runId: string | null;
  compact?: boolean;
}

export function LiveMetricsPanel({ runId, compact }: LiveMetricsPanelProps) {
  const { t } = useTranslation();
  const { points, connected, error } = useTrainingStream(runId);

  if (compact) {
    const last = points[points.length - 1];
    return (
      <div className="metrics-compact">
        <span className={connected ? 'status ok' : 'status'}>
          {connected ? 'Live' : error ?? 'Idle'}
        </span>
        {last && (
          <span className="mono">
            ep {last.step ?? '—'} · loss {last.loss?.toFixed(3) ?? '—'} · mAP{' '}
            {last.map50?.toFixed(3) ?? '—'}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="metrics-panel">
      <div className="metrics-header">
        <h3>{t('train.liveMetrics')}</h3>
        <span className={connected ? 'status ok' : 'status'}>
          {connected ? 'Live' : error ?? 'Idle'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={points}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="step" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="loss" stroke="#da4453" dot={false} />
          <Line type="monotone" dataKey="map50" stroke="#37bc9b" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

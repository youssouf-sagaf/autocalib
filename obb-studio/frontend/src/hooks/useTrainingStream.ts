import { useEffect, useState } from 'react';
import { trainingEventsUrl } from '../api/client';
import type { TrainingMetricPoint } from '../types';

export function useTrainingStream(runId: string | null) {
  const [points, setPoints] = useState<TrainingMetricPoint[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setPoints([]);
      setConnected(false);
      setError(null);
      return;
    }

    const url = trainingEventsUrl(runId);
    const es = new EventSource(url);

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as TrainingMetricPoint;
        setPoints((prev) => [...prev, data]);
      } catch {
        /* ignore malformed events */
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError('Stream disconnected');
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [runId]);

  return { points, connected, error };
}

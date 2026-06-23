import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface HealthResponse {
  status: string;
  default_yolo_model_label?: string;
}

export function StatusBar() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [modelLabel, setModelLabel] = useState('YOLO11s-OBB');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const { data } = await apiClient.get<HealthResponse>('/health');
        setApiOk(true);
        if (data.default_yolo_model_label) {
          setModelLabel(data.default_yolo_model_label);
        }
      } catch {
        setApiOk(false);
      }
    };
    void check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  const ts = now
    .toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    .toUpperCase();

  return (
    <header className="status-bar">
      <div className="status-bar-left">
        <span className="status-brand">OBB STUDIO</span>
        <span className="status-divider" />
        <span className={`status-pill ${apiOk === true ? 'ok' : apiOk === false ? 'err' : ''}`}>
          API {apiOk === true ? 'OK' : apiOk === false ? 'DOWN' : '…'}
        </span>
        <span className="status-pill muted">TRAINING LOCAL</span>
      </div>
      <div className="status-bar-right">
        <span className="status-metric">{modelLabel}</span>
        <span className="status-metric">GSD 0.05</span>
        <span className="status-clock">{ts}</span>
      </div>
    </header>
  );
}

import { useTranslation } from 'react-i18next';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface ActivityEntry {
  id: string;
  at: string;
  message: string;
}

interface ActivityFeedContextValue {
  entries: ActivityEntry[];
  log: (message: string) => void;
}

const ActivityFeedContext = createContext<ActivityFeedContextValue | null>(null);

export function ActivityFeedProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([
    {
      id: 'boot',
      at: new Date().toISOString(),
      message: 'OBB Studio workspace ready',
    },
  ]);

  const log = useCallback((message: string) => {
    setEntries((prev) => [
      ...prev.slice(-80),
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        message,
      },
    ]);
  }, []);

  const value = useMemo(() => ({ entries, log }), [entries, log]);

  return (
    <ActivityFeedContext.Provider value={value}>
      {children}
    </ActivityFeedContext.Provider>
  );
}

export function useActivityFeed() {
  const ctx = useContext(ActivityFeedContext);
  if (!ctx) throw new Error('useActivityFeed outside provider');
  return ctx;
}

export function ActivityFeedBar() {
  const { t } = useTranslation();
  const { entries } = useActivityFeed();
  const latest = entries.slice(-6);

  return (
    <footer className="activity-feed">
      <span className="activity-feed-label">{t('workspace.activityFeed')}</span>
      <div className="activity-feed-scroll">
        {latest.map((e) => (
          <span key={e.id} className="activity-entry">
            <time>{new Date(e.at).toLocaleTimeString()}</time> {e.message}
          </span>
        ))}
      </div>
    </footer>
  );
}

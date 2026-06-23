import { ActivityFeedProvider } from './layout/ActivityFeed';
import { WorkspacePage } from './layout/WorkspacePage';
import './App.css';

export function App() {
  return (
    <ActivityFeedProvider>
      <WorkspacePage />
    </ActivityFeedProvider>
  );
}

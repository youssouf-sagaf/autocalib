import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityFeedBar } from './ActivityFeed';
import { StatusBar } from './StatusBar';
import { WorkspaceLayoutProvider } from './WorkspaceLayoutContext';

export type WorkspaceTab = 'crop' | 'annotation' | 'inference' | 'resultats';

interface WorkspaceShellProps {
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  leftPanel: (tab: WorkspaceTab) => ReactNode;
  centerPanel: (tab: WorkspaceTab) => ReactNode;
  rightPanel: ReactNode;
}

export function WorkspaceShell({
  tab,
  onTabChange,
  leftPanel,
  centerPanel,
  rightPanel,
}: WorkspaceShellProps) {
  const { t } = useTranslation();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const bumpLayout = () => setLayoutVersion((v) => v + 1);

  const tabs: { id: WorkspaceTab; label: string }[] = [
    { id: 'crop', label: t('workspace.tabCrop') },
    { id: 'annotation', label: t('workspace.tabAnnotation') },
    { id: 'inference', label: t('workspace.tabInference') },
    { id: 'resultats', label: t('workspace.tabResultats') },
  ];

  const bodyClass = [
    'workspace-body',
    leftOpen ? '' : 'left-collapsed',
    rightOpen ? '' : 'right-collapsed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <WorkspaceLayoutProvider layoutVersion={layoutVersion}>
      <div className="workspace">
        <StatusBar />
        <div className={bodyClass}>
          <aside className={`workspace-left ${leftOpen ? '' : 'collapsed'}`}>
            <button
              type="button"
              className="sidebar-toggle sidebar-toggle-left"
              aria-label={leftOpen ? t('workspace.collapseLeft') : t('workspace.expandLeft')}
              aria-expanded={leftOpen}
              onClick={() => {
                setLeftOpen((open) => !open);
                bumpLayout();
              }}
            >
            {leftOpen ? '‹' : '›'}
          </button>
          <div className="workspace-tabs">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`workspace-tab ${tab === id ? 'active' : ''}`}
                onClick={() => onTabChange(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="workspace-panel">{leftPanel(tab)}</div>
        </aside>
        <section className="workspace-center">{centerPanel(tab)}</section>
        <aside className={`workspace-right ${rightOpen ? '' : 'collapsed'}`}>
          <button
            type="button"
            className="sidebar-toggle sidebar-toggle-right"
            aria-label={rightOpen ? t('workspace.collapseRight') : t('workspace.expandRight')}
            aria-expanded={rightOpen}
            onClick={() => {
              setRightOpen((open) => !open);
              bumpLayout();
            }}
          >
            {rightOpen ? '›' : '‹'}
          </button>
          {rightPanel}
        </aside>
      </div>
      <ActivityFeedBar />
    </div>
    </WorkspaceLayoutProvider>
  );
}

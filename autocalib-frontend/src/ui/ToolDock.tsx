import { createContext, type ReactNode, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Kbd } from './Kbd';
import styles from './ToolDock.module.css';

const ToolDockExpandedContext = createContext(false);

export interface ToolDockButtonProps {
  active?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  ai?: boolean;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  title?: string;
  onClick: () => void;
}

export function ToolDockButton({
  active,
  disabled,
  destructive,
  ai,
  icon,
  label,
  shortcut,
  title,
  onClick,
}: ToolDockButtonProps) {
  const expanded = useContext(ToolDockExpandedContext);

  return (
    <button
      type="button"
      className={`${styles.btn} ${active ? styles.active : ''} ${destructive && active ? styles.destructive : ''} ${ai ? styles.ai : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title ?? (shortcut ? `${label} (${shortcut})` : label)}
      aria-pressed={active}
    >
      <span className={styles.icon}>{icon}</span>
      {expanded ? (
        <>
          <span className={styles.label}>{label}</span>
          {shortcut ? (
            <span className={styles.shortcut}>
              <Kbd size="xs">{shortcut}</Kbd>
            </span>
          ) : null}
        </>
      ) : null}
    </button>
  );
}

interface ToolDockProps {
  ariaLabel: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}

export function ToolDock({ ariaLabel, children, defaultExpanded = false }: ToolDockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <ToolDockExpandedContext.Provider value={expanded}>
      <aside
        className={`${styles.dock} ${expanded ? styles.dockExpanded : ''}`}
        aria-label={ariaLabel}
      >
        <div className={styles.header}>
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={() => setExpanded((p) => !p)}
            title={expanded ? t('toolDock.collapse') : t('toolDock.expand')}
            aria-expanded={expanded}
          >
            {expanded ? '‹' : '›'}
          </button>
        </div>
        {children}
      </aside>
    </ToolDockExpandedContext.Provider>
  );
}

export function ToolDockGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      <span className={styles.groupLabel}>{label}</span>
      {children}
    </div>
  );
}

export function ToolDockSep() {
  return <div className={styles.sep} role="separator" />;
}

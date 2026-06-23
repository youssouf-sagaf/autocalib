import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandPaletteCommand } from './commandRegistry';
import { Kbd } from '../../ui/Kbd';
import styles from './CommandPalette.module.css';

interface CommandPaletteProps {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  commands: CommandPaletteCommand[];
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onMoveSelection: (delta: number) => void;
  onExecuteSelected: () => void;
  onExecuteAtIndex: (index: number) => void;
}

export function CommandPalette({
  isOpen,
  query,
  selectedIndex,
  commands,
  onClose,
  onQueryChange,
  onMoveSelection,
  onExecuteSelected,
  onExecuteAtIndex,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  const grouped = useMemo(() => {
    const groups: { category: string; items: { command: CommandPaletteCommand; globalIndex: number }[] }[] = [];
    const catMap = new Map<string, { command: CommandPaletteCommand; globalIndex: number }[]>();

    commands.forEach((cmd, i) => {
      const cat = cmd.category || t('commandCategories.other');
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push({ command: cmd, globalIndex: i });
    });

    for (const [category, items] of catMap) {
      groups.push({ category, items });
    }
    return groups;
  }, [commands, t]);

  if (!isOpen) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMoveSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMoveSelection(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onExecuteSelected();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.searchRow}>
          <svg className={styles.icon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={query}
            placeholder={t('commandPalette.placeholder')}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            data-command-palette="true"
          />
        </div>
        {commands.length > 0 ? (
          <ul className={styles.list}>
            {grouped.map((group) => (
              <li key={group.category}>
                <div className={styles.categoryLabel}>{group.category}</div>
                <ul className={styles.categoryList}>
                  {group.items.map(({ command, globalIndex }) => (
                    <li key={command.id}>
                      <button
                        className={`${styles.item} ${globalIndex === selectedIndex ? styles.itemActive : ''}`}
                        onClick={() => onExecuteAtIndex(globalIndex)}
                        onMouseEnter={() => onMoveSelection(globalIndex - selectedIndex)}
                        data-command-palette="true"
                      >
                        <span className={styles.itemLabel}>{command.label}</span>
                        <span className={styles.itemRight}>
                          {command.shortcut && <Kbd size="sm">{command.shortcut}</Kbd>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>{t('commandPalette.empty')}</div>
        )}
      </div>
    </div>
  );
}

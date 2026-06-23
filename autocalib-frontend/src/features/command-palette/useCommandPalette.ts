import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { CommandPaletteCommand } from './commandRegistry';

export const CommandPaletteVisibilityContext = createContext(false);

export function useCommandPaletteVisibility(): boolean {
  return useContext(CommandPaletteVisibilityContext);
}

interface UseCommandPaletteResult {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  filteredCommands: CommandPaletteCommand[];
  openPalette: () => void;
  closePalette: () => void;
  updateQuery: (nextQuery: string) => void;
  moveSelection: (delta: number) => void;
  executeSelected: () => void;
  executeAtIndex: (index: number) => void;
}

export function useCommandPalette(commands: CommandPaletteCommand[]): UseCommandPaletteResult {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return commands;
    }

    return commands.filter((command) => {
      if (command.label.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      return command.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery));
    });
  }, [commands, query]);

  const openPalette = useCallback(() => {
    setIsOpen(true);
    setSelectedIndex(0);
  }, []);

  const closePalette = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setSelectedIndex(0);
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (filteredCommands.length === 0) {
        return;
      }
      setSelectedIndex((current) => {
        const next = current + delta;
        if (next < 0) {
          return filteredCommands.length - 1;
        }
        if (next >= filteredCommands.length) {
          return 0;
        }
        return next;
      });
    },
    [filteredCommands.length],
  );

  const executeSelected = useCallback(() => {
    if (filteredCommands.length === 0) {
      return;
    }
    const selectedCommand = filteredCommands[selectedIndex];
    if (!selectedCommand) {
      return;
    }
    selectedCommand.run();
    closePalette();
  }, [closePalette, filteredCommands, selectedIndex]);

  const executeAtIndex = useCallback(
    (index: number) => {
      const selectedCommand = filteredCommands[index];
      if (!selectedCommand) {
        return;
      }
      selectedCommand.run();
      closePalette();
    },
    [closePalette, filteredCommands],
  );

  return {
    isOpen,
    query,
    selectedIndex,
    filteredCommands,
    openPalette,
    closePalette,
    updateQuery,
    moveSelection,
    executeSelected,
    executeAtIndex,
  };
}

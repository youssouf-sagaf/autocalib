import { useEffect, useRef } from 'react';
import { isEditableTarget } from './matchShortcut';

export type ShortcutHandler = (event: KeyboardEvent) => void | boolean;

export interface ShortcutLayer {
  priority: number;
  enabled?: boolean;
  handler: ShortcutHandler;
}

/**
 * Central keyboard dispatcher. Handlers run in priority order (highest first).
 * Return true from a handler to stop propagation to lower layers.
 */
export function useKeyboardShortcuts(layers: ShortcutLayer[]) {
  const layersRef = useRef(layers);
  layersRef.current = layers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const sorted = [...layersRef.current]
        .filter((l) => l.enabled !== false)
        .sort((a, b) => b.priority - a.priority);

      for (const layer of sorted) {
        const consumed = layer.handler(event);
        if (consumed === true) return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Priority constants aligned with plan: modal > palette > workspace > global */
export const SHORTCUT_PRIORITY = {
  modal: 400,
  palette: 300,
  workspace: 200,
  global: 100,
} as const;

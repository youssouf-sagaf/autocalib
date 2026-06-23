import { useCallback, useState, type RefObject } from 'react';

export const PREVIEW_DRAWER_DEFAULT_PCT = 50;
export const PREVIEW_DRAWER_MIN_PCT = 20;
export const PREVIEW_DRAWER_MAX_PCT = 80;

export function usePreviewDrawerResize(containerRef: RefObject<HTMLElement | null>) {
  const [widthPct, setWidthPct] = useState(PREVIEW_DRAWER_DEFAULT_PCT);
  const [isResizing, setIsResizing] = useState(false);

  const clampPct = useCallback((pct: number) => {
    return Math.min(PREVIEW_DRAWER_MAX_PCT, Math.max(PREVIEW_DRAWER_MIN_PCT, pct));
  }, []);

  const startResize = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;

      setIsResizing(true);

      const update = (x: number) => {
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;
        const drawerPx = rect.right - x;
        setWidthPct(clampPct((drawerPx / rect.width) * 100));
      };

      update(clientX);

      const onMouseMove = (e: MouseEvent) => update(e.clientX);
      const onMouseUp = () => {
        setIsResizing(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [clampPct, containerRef],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startResize(e.clientX);
    },
    [startResize],
  );

  return {
    widthPct,
    setWidthPct,
    isResizing,
    handleResizeMouseDown,
  };
}

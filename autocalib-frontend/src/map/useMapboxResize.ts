import { useEffect, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';

/** Keep Mapbox canvas in sync when flex layout or sidebar transitions change container size. */
export function useMapboxResize(
  mapRef: RefObject<MapRef | null>,
  containerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resize = () => {
      mapRef.current?.resize();
    };

    resize();
    const rafId = requestAnimationFrame(resize);

    const observer = new ResizeObserver(() => resize());
    observer.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [mapRef, containerRef]);
}

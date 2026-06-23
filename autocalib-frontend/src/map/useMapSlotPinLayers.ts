import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';
import {
  attachSlotPinImages,
  areSlotPinImagesReady,
  slotPinImagesReady,
} from './registerSlotPinImages';

/**
 * Gate symbol pin layers until sprites are decoded and registered on this map instance.
 * Avoids Mapbox "Image parking-slot-common could not be loaded" before onLoad runs.
 */
export function useMapSlotPinLayers(mapRef: RefObject<MapRef | null>) {
  const [cacheReady, setCacheReady] = useState(areSlotPinImagesReady());
  const [mapPinsAttached, setMapPinsAttached] = useState(false);

  useEffect(() => {
    if (cacheReady) return;
    let cancelled = false;
    void slotPinImagesReady.then(() => {
      if (!cancelled) setCacheReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [cacheReady]);

  useEffect(() => () => setMapPinsAttached(false), []);

  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    attachSlotPinImages(map);
    setMapPinsAttached(true);
  }, [mapRef]);

  return {
    showPinLayers: cacheReady && mapPinsAttached,
    onMapLoad,
  };
}

import type { Slot } from '../types';

export interface AbsmapMapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

export const DEFAULT_ABSMAP_MAP_VIEW: AbsmapMapViewState = {
  longitude: 2.3488,
  latitude: 48.8534,
  zoom: 12,
};

export function centroidViewForSlots(slots: Slot[]): AbsmapMapViewState | null {
  if (slots.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const slot of slots) {
    sumLng += slot.center.lng;
    sumLat += slot.center.lat;
  }
  return {
    longitude: sumLng / slots.length,
    latitude: sumLat / slots.length,
    zoom: 19,
  };
}

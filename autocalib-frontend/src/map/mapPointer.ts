import type { MapMouseEvent } from 'react-map-gl/mapbox';
import { normalizeSlotId } from '../utils/slot-key';

/** Shift modifier — Mapbox / react-map-gl may expose it on the event or only on originalEvent. */
export function mapEventShiftKey(e: MapMouseEvent): boolean {
  if ('shiftKey' in e && typeof (e as MapMouseEvent & { shiftKey?: boolean }).shiftKey === 'boolean') {
    return (e as MapMouseEvent & { shiftKey: boolean }).shiftKey;
  }
  const oe = e.originalEvent;
  return oe instanceof MouseEvent ? oe.shiftKey : false;
}

export function slotIdFromMapEvent(e: MapMouseEvent): string | null {
  const raw = e.features?.[0]?.properties?.slot_id as string | undefined;
  const id = normalizeSlotId(raw);
  return id || null;
}

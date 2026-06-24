import { describe, expect, it } from 'vitest';
import type { PairingLink } from '../types';
import { pairingOrderForReverse, resolvePairingReverseSide } from './pairing-map';

const links: PairingLink[] = [
  { id: 'link-1', slotId: 'slot-a', bboxSpotId: 10, colorIndex: 0 },
  { id: 'link-2', slotId: 'slot-b', bboxSpotId: 20, colorIndex: 1 },
  { id: 'link-3', slotId: 'slot-c', bboxSpotId: 30, colorIndex: 2 },
];

const displaySlots = [
  { slot_id: 'slot-a', center: { lng: 2.0, lat: 48.0 } },
  { slot_id: 'slot-b', center: { lng: 2.1, lat: 48.0 } },
  { slot_id: 'slot-c', center: { lng: 2.2, lat: 48.0 } },
];

const bboxes = [{ spot_id: 10 }, { spot_id: 20 }, { spot_id: 30 }];

describe('resolvePairingReverseSide', () => {
  it('prefers active zone side over focused panel', () => {
    expect(resolvePairingReverseSide({ activeZoneSide: 'map', focusedPanel: 'image' })).toBe('map');
  });

  it('falls back to focused panel when zone side is null', () => {
    expect(resolvePairingReverseSide({ activeZoneSide: null, focusedPanel: 'map' })).toBe('map');
  });

  it('defaults to image when both are null', () => {
    expect(resolvePairingReverseSide({ activeZoneSide: null, focusedPanel: null })).toBe('image');
  });
});

describe('pairingOrderForReverse', () => {
  it('reverses slot order when side is map', () => {
    const order = pairingOrderForReverse({
      links,
      slots: displaySlots,
      bboxes,
      side: 'map',
    });
    expect(order).toEqual({
      slotIds: ['slot-c', 'slot-b', 'slot-a'],
      bboxSpotIds: [10, 20, 30],
    });
  });

  it('reverses bbox order when side is image', () => {
    const order = pairingOrderForReverse({
      links,
      slots: displaySlots,
      bboxes,
      side: 'image',
    });
    expect(order).toEqual({
      slotIds: ['slot-a', 'slot-b', 'slot-c'],
      bboxSpotIds: [30, 20, 10],
    });
  });

  it('uses calibrationDbSlots when slot is missing from display list', () => {
    const order = pairingOrderForReverse({
      links: [{ id: 'link-x', slotId: 'slot-db-only', bboxSpotId: 10, colorIndex: 0 }],
      slots: [],
      bboxes: [{ spot_id: 10 }],
      side: 'image',
      dbSlots: { 'slot-db-only': { lat: 48.5, lng: 2.5 } },
    });
    expect(order).toEqual({
      slotIds: ['slot-db-only'],
      bboxSpotIds: [10],
    });
  });

  it('returns null when no resolvable entries remain', () => {
    const order = pairingOrderForReverse({
      links,
      slots: [],
      bboxes,
      side: 'map',
    });
    expect(order).toBeNull();
  });
});

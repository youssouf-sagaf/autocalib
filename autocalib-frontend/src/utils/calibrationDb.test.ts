import { describe, expect, it } from 'vitest';
import {
  buildCalibrationSaveRequest,
  buildCalibrationBboxesByKey,
  countPairingDraftChanges,
  diffCalibrationBboxes,
  diffPairingBySlotId,
  formatDeletedPairingLabels,
  prodPairingBySlotIdFromDb,
  pairingBySlotIdFromDbSnapshot,
} from './calibrationDb';
import type { DeviceCalibBbox, Slot } from '../types';

const absmapSlots = [
  {
    slot_id: 'slot-a',
    center: { lat: 48.1, lng: 2.1 },
    slot_type: 'common',
  },
  {
    slot_id: 'slot-b',
    center: { lat: 48.2, lng: 2.2 },
    slot_type: 'common',
  },
] as Slot[];

const dbSlots = {
  'slot-a': { lat: 48.1, lng: 2.1, slot_type: 'common' as const },
  'slot-b': { lat: 48.2, lng: 2.2, slot_type: 'common' as const },
};

const bboxes: DeviceCalibBbox[] = [
  {
    spot_id: 1,
    slot_id: 'slot-a',
    center_x: 100,
    center_y: 100,
    x: 80,
    y: 80,
    width: 40,
    height: 40,
    n_frames: 1,
    confidence: 1,
    rotation: 0,
  },
  {
    spot_id: 2,
    slot_id: 'slot-b',
    center_x: 200,
    center_y: 100,
    x: 180,
    y: 80,
    width: 40,
    height: 40,
    n_frames: 1,
    confidence: 1,
    rotation: 0,
  },
];

const prodPairing = prodPairingBySlotIdFromDb(bboxes, dbSlots);

describe('buildCalibrationSaveRequest', () => {
  it('keeps prod slots when pairingSave is false and prod snapshot is passed', () => {
    const request = buildCalibrationSaveRequest({
      bboxes,
      pairingBySlotId: prodPairing,
      absmapSlots,
      imageWidth: 1280,
      imageHeight: 480,
      dbSlots,
      pairingSave: false,
    });

    expect(Object.keys(request.slots)).toEqual(['slot-a', 'slot-b']);
    expect(request.replace_slots).toBe(false);
  });

  it('restores slot_id tags from prod snapshot when bboxes lost pairing keys', () => {
    const untaggedBboxes = bboxes.map((bbox) => ({ ...bbox, slot_id: null }));

    const withProdSnapshot = buildCalibrationSaveRequest({
      bboxes: untaggedBboxes,
      pairingBySlotId: prodPairing,
      absmapSlots,
      imageWidth: 1280,
      imageHeight: 480,
      dbSlots,
      pairingSave: false,
    });

    const withEmptyDraft = buildCalibrationSaveRequest({
      bboxes: untaggedBboxes,
      pairingBySlotId: {},
      absmapSlots,
      imageWidth: 1280,
      imageHeight: 480,
      dbSlots,
      pairingSave: false,
    });

    expect(Object.keys(withProdSnapshot.slots)).toHaveLength(2);
    expect(withProdSnapshot.bboxes.map((b) => b.slot_id)).toEqual(['slot-a', 'slot-b']);
    expect(Object.keys(withEmptyDraft.slots)).toHaveLength(0);
  });

  it('replaces slots authoritatively when pairingSave is true', () => {
    const request = buildCalibrationSaveRequest({
      bboxes,
      pairingBySlotId: { 'slot-a': 1 },
      absmapSlots,
      imageWidth: 1280,
      imageHeight: 480,
      dbSlots,
      pairingSave: true,
    });

    expect(Object.keys(request.slots)).toEqual(['slot-a']);
    expect(request.replace_slots).toBe(true);
  });
});

describe('prodPairingBySlotIdFromDb', () => {
  it('ignores bboxes without a matching calibration.slots entry', () => {
    const unpairedOnly = [
      { ...bboxes[1], slot_id: null },
      { ...bboxes[0], slot_id: null, spot_id: 3 },
    ] as DeviceCalibBbox[];

    expect(prodPairingBySlotIdFromDb(unpairedOnly, dbSlots)).toEqual({});
    expect(prodPairingBySlotIdFromDb(bboxes, dbSlots)).toEqual({
      'slot-a': 1,
      'slot-b': 2,
    });
  });

  it('does not treat numeric bbox keys as paired when slot is missing from slots', () => {
    const metaOnlySlots = { 'slot-a': dbSlots['slot-a']! };
    expect(
      pairingBySlotIdFromDbSnapshot(
        ['slot-a', '3'],
        {
          'slot-a': { canvasSpotId: 1, prodKey: 'slot-a' },
          '3': { canvasSpotId: 3, prodKey: '3' },
        },
        metaOnlySlots,
      ),
    ).toEqual({ 'slot-a': 1 });
  });
});

describe('diffCalibrationBboxes', () => {
  it('detects added, modified, and deleted bbox keys', () => {
    const snapshot = buildCalibrationBboxesByKey(bboxes);
    const modifiedBboxes = [
      { ...bboxes[0]!, center_x: 150 },
      { ...bboxes[1]!, spot_id: 4, slot_id: null },
    ] as DeviceCalibBbox[];

    expect(diffCalibrationBboxes(snapshot, bboxes)).toEqual({
      added: 0,
      modified: 0,
      deleted: 0,
    });
    expect(diffCalibrationBboxes(snapshot, modifiedBboxes)).toEqual({
      added: 1,
      modified: 1,
      deleted: 1,
    });
    expect(diffCalibrationBboxes({}, bboxes)).toEqual({
      added: 2,
      modified: 0,
      deleted: 0,
    });
  });
});

describe('pairing diff helpers', () => {
  it('detects deleted prod pairings for confirm modal', () => {
    const draft = { 'slot-a': 1 };
    const diff = diffPairingBySlotId(prodPairing, draft);
    expect(diff.deleted).toBe(1);
    expect(formatDeletedPairingLabels(prodPairing, draft)).toEqual(['slot-b ↔ bbox #2']);
  });

  it('counts pending draft changes', () => {
    expect(countPairingDraftChanges(prodPairing, prodPairing)).toBe(0);
    expect(countPairingDraftChanges(prodPairing, { 'slot-a': 1 })).toBe(1);
  });
});

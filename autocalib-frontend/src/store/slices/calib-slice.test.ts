import { describe, expect, it } from 'vitest';
import { calibReducer } from './calib-slice';
import { calibInitial } from './initial-state';
import type { CalibBbox } from '../../types';

const dbBbox: CalibBbox = {
  spot_id: 1,
  center_x: 205.2,
  center_y: 306.1,
  x: 197.7,
  y: 298.6,
  width: 15,
  height: 15,
  n_frames: 1,
  confidence: 1,
};

describe('calibAlignBboxesToImageSize', () => {
  it('rescales db-static bboxes when natural image size differs from reference', () => {
    const state = {
      ...calibInitial,
      jobId: 'db-static',
      imageWidth: 1280,
      imageHeight: 480,
      bboxes: [{ ...dbBbox }],
      calibrationDbBboxesByKey: { slotA: { ...dbBbox, slot_id: 'slotA' } },
      calibrationLoadedFromDb: true,
    };

    const next = calibReducer(state, {
      type: 'autocalib/calibAlignBboxesToImageSize',
      payload: { width: 2560, height: 960 },
    });

    expect(next.imageWidth).toBe(2560);
    expect(next.imageHeight).toBe(960);
    expect(next.bboxes[0]!.x).toBeCloseTo(395.4);
    expect(next.bboxes[0]!.y).toBeCloseTo(597.2);
    expect(next.calibrationDbBboxesByKey.slotA!.x).toBeCloseTo(395.4);
  });

  it('updates dimensions only for calib_gen jobs without rescaling bboxes', () => {
    const state = {
      ...calibInitial,
      jobId: 'job-uuid-123',
      imageWidth: 1280,
      imageHeight: 480,
      bboxes: [{ ...dbBbox }],
    };

    const next = calibReducer(state, {
      type: 'autocalib/calibAlignBboxesToImageSize',
      payload: { width: 2560, height: 960 },
    });

    expect(next.imageWidth).toBe(2560);
    expect(next.imageHeight).toBe(960);
    expect(next.bboxes[0]!.x).toBe(197.7);
  });

  it('is idempotent when dimensions already match', () => {
    const state = {
      ...calibInitial,
      jobId: 'db-static',
      imageWidth: 1280,
      imageHeight: 480,
      bboxes: [{ ...dbBbox }],
    };

    const next = calibReducer(state, {
      type: 'autocalib/calibAlignBboxesToImageSize',
      payload: { width: 1280, height: 480 },
    });

    expect(next).toBe(state);
  });
});

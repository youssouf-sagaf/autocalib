import { describe, expect, it } from 'vitest';
import type { CalibBbox } from '../types';
import { scaleCalibBbox, scaleCalibBboxesToDimensions } from './calib-geometry';

const sampleBbox: CalibBbox = {
  spot_id: 1,
  center_x: 640,
  center_y: 240,
  x: 620,
  y: 220,
  width: 40,
  height: 40,
  n_frames: 1,
  confidence: 1,
  rotation: 15,
};

describe('scaleCalibBbox', () => {
  it('scales all pixel fields uniformly when sx and sy match', () => {
    const scaled = scaleCalibBbox(sampleBbox, 2, 2);
    expect(scaled.x).toBe(1240);
    expect(scaled.y).toBe(440);
    expect(scaled.width).toBe(80);
    expect(scaled.height).toBe(80);
    expect(scaled.center_x).toBe(1280);
    expect(scaled.center_y).toBe(480);
    expect(scaled.rotation).toBe(15);
    expect(scaled.spot_id).toBe(1);
  });

  it('scales x and y independently when aspect ratios differ', () => {
    const scaled = scaleCalibBbox(sampleBbox, 2, 1.5);
    expect(scaled.x).toBe(1240);
    expect(scaled.y).toBe(330);
    expect(scaled.width).toBe(80);
    expect(scaled.height).toBe(60);
    expect(scaled.center_x).toBe(1280);
    expect(scaled.center_y).toBe(360);
  });
});

describe('scaleCalibBboxesToDimensions', () => {
  it('rescales 1280x480 reference to 2560x960', () => {
    const bboxes = [sampleBbox];
    const result = scaleCalibBboxesToDimensions(bboxes, 1280, 480, 2560, 960);
    expect(result[0]!.center_x).toBe(1280);
    expect(result[0]!.center_y).toBe(480);
    expect(result[0]!.x).toBe(1240);
    expect(result[0]!.y).toBe(440);
  });

  it('returns the same array reference when dimensions already match', () => {
    const bboxes = [sampleBbox];
    const result = scaleCalibBboxesToDimensions(bboxes, 1280, 480, 1280, 480);
    expect(result).toBe(bboxes);
  });

  it('returns the same array reference when from dimensions are invalid', () => {
    const bboxes = [sampleBbox];
    const result = scaleCalibBboxesToDimensions(bboxes, 0, 480, 2560, 960);
    expect(result).toBe(bboxes);
  });
});

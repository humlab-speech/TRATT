import { describe, expect, it } from '@jest/globals';
import { computePeaks } from './peaks';

describe('computePeaks', () => {
  const channel = new Float32Array([0, 1, 2, 3]);
  it('returns min/max per pixel column', () => {
    expect(computePeaks(channel, 1, 0, 4, 2)).toEqual([
      { min: 0, max: 1 },
      { min: 2, max: 3 },
    ]);
  });
  it('maps samples to channel indices through the factor', () => {
    const c = new Float32Array([-1, 1, 0.5]);
    expect(computePeaks(c, 2, 0, 6, 1)).toEqual([{ min: -1, max: 1 }]);
  });
  it('returns zeros outside the channel', () => {
    expect(computePeaks(channel, 1, 10, 14, 2)).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 },
    ]);
    expect(computePeaks(channel, 1, -4, 0, 1)).toEqual([{ min: 0, max: 0 }]);
  });
});

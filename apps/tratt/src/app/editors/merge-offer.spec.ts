import { describe, expect, it } from '@jest/globals';
import { mergeOfferFor } from './merge-offer';

const at = { clientX: 10, clientY: 20 };
const sel = (s: number, e: number) => ({
  start: { samples: s },
  end: { samples: e },
});

describe('mergeOfferFor', () => {
  it('offers the covered range at the pointer', () => {
    expect(mergeOfferFor(at, [100, 200, 300], sel(50, 250))).toEqual({
      x: 10,
      y: 20,
      from: 0,
      to: 2,
    });
  });
  it('offers nothing inside one unit or without selection', () => {
    expect(mergeOfferFor(at, [100, 200, 300], sel(110, 190))).toBeUndefined();
    expect(mergeOfferFor(at, [100, 200, 300], undefined)).toBeUndefined();
  });
});

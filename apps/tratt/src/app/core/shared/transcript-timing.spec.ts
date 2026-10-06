import { describe, expect, it } from '@jest/globals';
import { OLabel, TrattAnnotation } from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { transcriptEnd } from './transcript-timing';

describe('transcriptEnd', () => {
  const withLevels = (...ends: number[][]) => {
    const t = new TrattAnnotation<any>();
    ends.forEach((levelEnds, i) => {
      const level = t.createSegmentLevel(`l${i}`);
      for (const end of levelEnds) {
        level.items.push(
          t.createSegment(new SampleUnit(end, 16000), [
            new OLabel(`l${i}`, 'x'),
          ]),
        );
      }
      t.addLevel(level);
    });
    return t;
  };

  it('is the latest last-segment end over all segment levels', () => {
    const end = transcriptEnd(withLevels([100, 200], [150, 300]));
    expect(end?.samples).toBe(300);
    expect(end?.sampleRate).toBe(16000);
  });

  it('is undefined without timed segments', () => {
    expect(transcriptEnd(withLevels([]))).toBeUndefined();
    expect(transcriptEnd(new TrattAnnotation<any>())).toBeUndefined();
    expect(transcriptEnd(undefined)).toBeUndefined();
  });
});

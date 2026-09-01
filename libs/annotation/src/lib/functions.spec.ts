import { describe, expect, it } from 'vitest';
import { OLabel } from './annotjson';
import { removeSegmentByIndex } from './functions';
import { TrattAnnotationSegment } from './trattAnnotationSegment';
import { SampleUnit } from '@tratt/media';

describe('removeSegmentByIndex', () => {
  it('merges the removed segment transcript into the next segment, not its speaker name', () => {
    // Speaker label listed before the transcript label, so the old
    // 'Spealer' typo (which falls back to labels[0]) would pick this up.
    const entries: TrattAnnotationSegment[] = [
      new TrattAnnotationSegment(1, new SampleUnit(48000, 48000), [
        new OLabel('Speaker', 'Speaker 1'),
        new OLabel('OCTRA_1', 'hello'),
      ]),
      new TrattAnnotationSegment(2, new SampleUnit(96000, 48000), [
        new OLabel('Speaker', 'Speaker 1'),
        new OLabel('OCTRA_1', 'world'),
      ]),
    ];

    removeSegmentByIndex(entries, 0, '<p>', true);

    const survivor = entries[0];
    expect(survivor.getFirstLabelWithoutName('Speaker')?.value).toBe(
      'hello world',
    );
    expect(survivor.getFirstLabelWithoutName('Speaker')?.value).not.toContain(
      'Speaker 1',
    );
  });
});

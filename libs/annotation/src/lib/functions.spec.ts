import { SampleUnit } from '@tratt/media';
import { describe, expect, it } from 'vitest';
import { OLabel } from './annotjson';
import { mergeUnits, removeSegmentByIndex, unitsCoveredBy } from './functions';
import { TrattAnnotationSegment } from './trattAnnotationSegment';

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

const unit = (id: number, end: number, text: string, verified = false) =>
  new TrattAnnotationSegment(
    id,
    new SampleUnit(end, 48000),
    [new OLabel('Speaker', `S${id}`), new OLabel('OCTRA_1', text)],
    verified,
  );
const textOf = (s: TrattAnnotationSegment) =>
  s.getFirstLabelWithoutName('Speaker')?.value;

describe('mergeUnits', () => {
  it('joins texts, keeps first unit and last end', () => {
    const items = [
      unit(1, 100, 'a', true),
      unit(2, 200, 'b', true),
      unit(3, 300, 'c', true),
    ];
    const r = mergeUnits(items, 0, 2);
    expect(r).toHaveLength(1);
    expect(textOf(r[0])).toBe('a b c');
    expect(r[0].time.samples).toBe(300);
    expect(r[0].id).toBe(1);
    expect(r[0].getLabel('Speaker')?.value).toBe('S1');
    expect(r[0].verified).toBe(true);
    expect(items).toHaveLength(3);
  });
  it('skips empty texts, absorbs silence marker, verified needs all', () => {
    const r = mergeUnits(
      [
        unit(1, 100, 'a', true),
        unit(2, 200, ''),
        unit(3, 300, '<p:>'),
        unit(4, 400, 'x', true),
      ],
      0,
      3,
      '<p:>',
    );
    expect(textOf(r[0])).toBe('a x');
    expect(r[0].verified).toBe(false);
  });
  it('merges only the range', () => {
    const r = mergeUnits(
      [unit(1, 100, 'a'), unit(2, 200, 'b'), unit(3, 300, 'c')],
      1,
      2,
    );
    expect(r.map(textOf)).toEqual(['a', 'b c']);
  });
  it('returns unchanged copy for bad range', () => {
    const items = [unit(1, 100, 'a'), unit(2, 200, 'b')];
    expect(mergeUnits(items, 1, 1)).toHaveLength(2);
    expect(mergeUnits(items, 0, 5)).toHaveLength(2);
  });
});

describe('unitsCoveredBy', () => {
  const ends = [100, 200, 300];
  it('covers units around inner boundaries', () => {
    expect(unitsCoveredBy(ends, 50, 250)).toEqual({ from: 0, to: 2 });
    expect(unitsCoveredBy(ends, 50, 150)).toEqual({ from: 0, to: 1 });
    expect(unitsCoveredBy(ends, 100, 250)).toEqual({ from: 1, to: 2 });
  });
  it('is undefined without an inner boundary', () => {
    expect(unitsCoveredBy(ends, 10, 90)).toBeUndefined();
    expect(unitsCoveredBy(ends, 120, 180)).toBeUndefined();
    expect(unitsCoveredBy(ends, 250, 400)).toBeUndefined();
    expect(unitsCoveredBy(ends, 50, 100)).toBeUndefined();
  });
});

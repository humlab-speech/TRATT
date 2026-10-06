import { describe, expect, it } from '@jest/globals';
import { OLabel, TrattAnnotationSegment } from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { mergeEditedSegments } from './merge-edited-segments';

const RATE = 16000;
const at = (samples: number) => new SampleUnit(samples, RATE);
const LEVEL = 'English (en)';

function seg(id: number, end: number, text: string, speaker?: string) {
  return new TrattAnnotationSegment(id, at(end), [
    new OLabel(LEVEL, text),
    ...(speaker ? [new OLabel('Speaker', speaker)] : []),
  ]);
}

let nextId = 100;
const create = (time: SampleUnit, labels: OLabel[]) =>
  new TrattAnnotationSegment(nextId++, time, labels);

describe('mergeEditedSegments (Dictaphone save)', () => {
  // A diarized pipeline result: the text editor shows only the text.
  const previous = [
    seg(1, 8000, 'hello there', 'Speaker 1'),
    seg(2, 16000, 'general', 'Speaker 2'),
  ];

  it('returns undefined when nothing changed, so a flush writes nothing', () => {
    expect(
      mergeEditedSegments(
        previous,
        [
          { time: at(8000), text: 'hello there' },
          { time: at(16000), text: 'general' },
        ],
        LEVEL,
        create,
      ),
    ).toBeUndefined();
  });

  it('keeps ids and Speaker labels when only the text changed', () => {
    const merged = mergeEditedSegments(
      previous,
      [
        { time: at(8000), text: 'hello there!' },
        { time: at(16000), text: 'general' },
      ],
      LEVEL,
      create,
    )!;

    expect(merged.map((s) => s.id)).toEqual([1, 2]);
    expect(merged[0].getLabel(LEVEL)?.value).toBe('hello there!');
    expect(merged[0].getLabel('Speaker')?.value).toBe('Speaker 1');
    expect(merged[1].getLabel('Speaker')?.value).toBe('Speaker 2');
    // The store's segments are not mutated.
    expect(previous[0].getLabel(LEVEL)?.value).toBe('hello there');
  });

  it('a boundary inserted by the user creates a segment that inherits the speaker it was split from', () => {
    const merged = mergeEditedSegments(
      previous,
      [
        { time: at(4000), text: 'hello' },
        { time: at(8000), text: 'there' },
        { time: at(16000), text: 'general' },
      ],
      LEVEL,
      create,
    )!;

    expect(merged).toHaveLength(3);
    expect(merged[0].id).not.toBe(1);
    expect(merged[0].getLabel('Speaker')?.value).toBe('Speaker 1');
    expect(merged[0].getLabel(LEVEL)?.value).toBe('hello');
    expect(merged[1].id).toBe(1);
    expect(merged[1].getLabel(LEVEL)?.value).toBe('there');
  });

  it('removing a boundary keeps the later segment (its id and speaker)', () => {
    const merged = mergeEditedSegments(
      previous,
      [{ time: at(16000), text: 'hello there general' }],
      LEVEL,
      create,
    )!;

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(2);
    expect(merged[0].getLabel('Speaker')?.value).toBe('Speaker 2');
  });

  it('works for segments without a Speaker label', () => {
    const merged = mergeEditedSegments(
      [seg(7, 16000, '')],
      [{ time: at(16000), text: 'typed' }],
      LEVEL,
      create,
    )!;

    expect(merged[0].id).toBe(7);
    expect(merged[0].labels.map((l) => [l.name, l.value])).toEqual([
      [LEVEL, 'typed'],
    ]);
  });
});

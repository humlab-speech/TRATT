import {
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { describe, expect, it } from 'vitest';
import {
  BLACK_TEXT,
  cycleNextSpeaker,
  getSpeakerColor,
  getSpeakerIds,
  getSpeakerTextColor,
  LIGHT_TEXT,
  renameSpeakerInAnnotation,
  SPEAKER_COLORS,
} from './speaker-colors';

function makeAnnotation(
  speakerValues: (string | undefined)[],
): TrattAnnotation<any, TrattAnnotationSegment> {
  const annotation = new TrattAnnotation<any, TrattAnnotationSegment>();
  const items = speakerValues.map((spk, i) => {
    const labels: OLabel[] = [new OLabel('Transcript', 'hello')];
    if (spk) {
      labels.push(new OLabel('Speaker', spk));
    }
    return new TrattAnnotationSegment<any>(
      i + 1,
      new SampleUnit((i + 1) * 16000, 16000),
      labels,
    );
  });
  const level = annotation.createSegmentLevel('Transcript', items);
  annotation.addLevel(level);
  return annotation;
}

describe('SPEAKER_COLORS', () => {
  it('has 17 entries', () => {
    expect(SPEAKER_COLORS).toHaveLength(17);
  });
});

describe('getSpeakerIds', () => {
  it('returns sorted unique non-empty Speaker label values', () => {
    const ann = makeAnnotation([
      'Speaker 2',
      'Speaker 1',
      'Speaker 2',
      undefined,
      '',
    ]);
    expect(getSpeakerIds(ann)).toEqual(['Speaker 1', 'Speaker 2']);
  });

  it('returns empty array when no speakers', () => {
    const ann = makeAnnotation([undefined, undefined]);
    expect(getSpeakerIds(ann)).toEqual([]);
  });
});

describe('getSpeakerColor', () => {
  it('returns the color at sorted index position', () => {
    const ids = ['B', 'A', 'C'];
    expect(getSpeakerColor('A', ids)).toBe(SPEAKER_COLORS[0]);
    expect(getSpeakerColor('B', ids)).toBe(SPEAKER_COLORS[1]);
    expect(getSpeakerColor('C', ids)).toBe(SPEAKER_COLORS[2]);
  });

  it('wraps colors via modulo when more than 17 speakers', () => {
    const ids = Array.from({ length: 18 }, (_, i) => `Speaker ${i + 1}`);
    expect(getSpeakerColor('Speaker 18', ids)).toBe(SPEAKER_COLORS[17 % 17]);
  });

  it('returns first color for unknown id (fallback)', () => {
    expect(getSpeakerColor('Unknown', ['A', 'B'])).toBe(SPEAKER_COLORS[0]);
  });
});

describe('getSpeakerTextColor', () => {
  it('returns beige for dark backgrounds', () => {
    expect(getSpeakerTextColor('#000000')).toBe(LIGHT_TEXT);
    expect(getSpeakerTextColor('#2A4765')).toBe(LIGHT_TEXT);
    expect(getSpeakerTextColor('#3D6B5C')).toBe(LIGHT_TEXT);
  });

  it('returns black for light backgrounds', () => {
    expect(getSpeakerTextColor('#C4D4C0')).toBe(BLACK_TEXT);
    expect(getSpeakerTextColor('#EABAB9')).toBe(BLACK_TEXT);
    expect(getSpeakerTextColor('#D4C7B5')).toBe(BLACK_TEXT);
  });
});

describe('cycleNextSpeaker', () => {
  it('returns the next speaker in sorted order', () => {
    const ids = ['Speaker 1', 'Speaker 2', 'Speaker 3'];
    expect(cycleNextSpeaker('Speaker 1', ids)).toBe('Speaker 2');
    expect(cycleNextSpeaker('Speaker 2', ids)).toBe('Speaker 3');
  });

  it('wraps from last back to first', () => {
    const ids = ['Speaker 1', 'Speaker 2'];
    expect(cycleNextSpeaker('Speaker 2', ids)).toBe('Speaker 1');
  });

  it('returns first speaker if current not found', () => {
    const ids = ['Speaker 1', 'Speaker 2'];
    expect(cycleNextSpeaker('Unknown', ids)).toBe('Speaker 1');
  });
});

describe('renameSpeakerInAnnotation', () => {
  it('renames all Speaker labels with matching value across all levels', () => {
    const ann = makeAnnotation(['Speaker 1', 'Speaker 2', 'Speaker 1']);
    const renamed = renameSpeakerInAnnotation('Speaker 1', 'Alice', ann);
    const ids = getSpeakerIds(renamed);
    expect(ids).toContain('Alice');
    expect(ids).not.toContain('Speaker 1');
    expect(ids).toContain('Speaker 2');
  });

  it('does not mutate the original annotation', () => {
    const ann = makeAnnotation(['Speaker 1', 'Speaker 2']);
    renameSpeakerInAnnotation('Speaker 1', 'Alice', ann);
    expect(getSpeakerIds(ann)).toContain('Speaker 1');
  });

  it('is a no-op if oldId does not exist', () => {
    const ann = makeAnnotation(['Speaker 1']);
    const renamed = renameSpeakerInAnnotation('Ghost', 'Alice', ann);
    expect(getSpeakerIds(renamed)).toEqual(['Speaker 1']);
  });
});

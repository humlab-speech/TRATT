import { describe, expect, it } from '@jest/globals';
import {
  AnnotationLevelType,
  OAnnotJSON,
  OLabel,
  OSegment,
  OSegmentLevel,
} from '@tratt/annotation';
import { AppInfo } from '../../../app.info';
import {
  audioBasename,
  padSegmentLevels,
  sameBasename,
  transcriptBasename,
} from './transcript-pairing';

describe('transcript pairing helpers', () => {
  it('strips the longest known transcript extension', () => {
    const base = (name: string) =>
      transcriptBasename(name, AppInfo.converters);
    expect(base('interview_annot.json')).toBe('interview');
    expect(base('interview.json')).toBe('interview');
    expect(base('interview.TextGrid')).toBe('interview');
    expect(base('interview.textgrid')).toBe('interview');
    expect(base('my.interview.srt')).toBe('my.interview');
    expect(base('notes.unknown')).toBe('notes');
  });

  it('pairs names case-insensitively with the recording minus its extension', () => {
    expect(audioBasename('Interview.WAV')).toBe('Interview');
    expect(sameBasename('Interview', 'interview')).toBe(true);
    expect(sameBasename('interview', 'interview2')).toBe(false);
  });

  it('pads segment levels to cover the whole recording', () => {
    const level = new OSegmentLevel<OSegment>('words', [
      new OSegment(5, 100, 50, [new OLabel('words', 'hi')]),
    ]);
    const annot = new OAnnotJSON('a.wav', 'a', 1000, [level]);
    expect(level.type).toBe(AnnotationLevelType.SEGMENT);

    padSegmentLevels(annot, 400);

    const items = (annot.levels[0] as OSegmentLevel<OSegment>).items;
    expect(items.map((i) => [i.sampleStart, i.sampleDur])).toEqual([
      [0, 100],
      [100, 50],
      [150, 250],
    ]);
    expect(items[1].labels[0].value).toBe('hi');
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('leaves empty levels alone', () => {
    const annot = new OAnnotJSON('a.wav', 'a', 1000, [
      new OSegmentLevel<OSegment>('words', []),
    ]);
    expect(() => padSegmentLevels(annot, 400)).not.toThrow();
  });
});

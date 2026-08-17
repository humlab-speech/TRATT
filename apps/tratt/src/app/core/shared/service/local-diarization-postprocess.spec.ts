import { describe, expect, it } from '@jest/globals';
import {
  normalizePyannoteSpeakerTurns,
  PyannoteSpeakerSegment,
} from './local-diarization-postprocess';

describe('normalizePyannoteSpeakerTurns', () => {
  it('merges the same speaker across a short pause', () => {
    const segments: PyannoteSpeakerSegment[] = [
      { id: 7, start: 0, end: 1 },
      { id: 7, start: 1.4, end: 2 },
    ];

    expect(normalizePyannoteSpeakerTurns(segments)).toEqual([
      { startS: 0, endS: 2, speakerId: '0' },
    ]);
  });

  it('does not merge across a real speaker change', () => {
    const segments: PyannoteSpeakerSegment[] = [
      { id: 7, start: 0, end: 1 },
      { id: 3, start: 1.1, end: 1.8 },
      { id: 7, start: 2, end: 3 },
    ];

    expect(normalizePyannoteSpeakerTurns(segments)).toEqual([
      { startS: 0, endS: 1, speakerId: '0' },
      { startS: 1.1, endS: 1.8, speakerId: '1' },
      { startS: 2, endS: 3, speakerId: '0' },
    ]);
  });

  it('drops tiny turns before renumbering', () => {
    const segments: PyannoteSpeakerSegment[] = [
      { id: 4, start: 0, end: 0.2 },
      { id: 8, start: 0.2, end: 1 },
    ];

    expect(normalizePyannoteSpeakerTurns(segments)).toEqual([
      { startS: 0.2, endS: 1, speakerId: '0' },
    ]);
  });

  it('renumbers speakers by first appearance', () => {
    const segments: PyannoteSpeakerSegment[] = [
      { id: 9, start: 0, end: 1 },
      { id: 2, start: 1.1, end: 2 },
      { id: 9, start: 2.2, end: 3 },
    ];

    expect(normalizePyannoteSpeakerTurns(segments)).toEqual([
      { startS: 0, endS: 1, speakerId: '0' },
      { startS: 1.1, endS: 2, speakerId: '1' },
      { startS: 2.2, endS: 3, speakerId: '0' },
    ]);
  });

  it('keeps long gaps as separate turns for the same speaker', () => {
    const segments: PyannoteSpeakerSegment[] = [
      { id: 4, start: 0, end: 1 },
      { id: 4, start: 2.2, end: 3 },
    ];

    expect(normalizePyannoteSpeakerTurns(segments)).toEqual([
      { startS: 0, endS: 1, speakerId: '0' },
      { startS: 2.2, endS: 3, speakerId: '0' },
    ]);
  });
});

import { describe, expect, it } from '@jest/globals';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import { finalizeTranscriptionAnnotJson } from './local-transcription-finalization';

describe('finalizeTranscriptionAnnotJson', () => {
  it('applies diarization speaker labels when speaker turns are provided', () => {
    const annotJson = new OAnnotJSON('audio.wav', 'audio', 16000, []);
    annotJson.levels = [
      new OSegmentLevel('OCTRA_1', [
        new OSegment(1, 0, 16000, [new OLabel('OCTRA_1', 'Hello')]),
        new OSegment(2, 16000, 16000, [new OLabel('OCTRA_1', 'World')]),
      ]),
    ];

    const result = finalizeTranscriptionAnnotJson(annotJson, {
      language: 'en',
      speakerTurns: [
        { startS: 0, endS: 0.9, speakerId: 'SPEAKER_00' },
        { startS: 0.9, endS: 1.0, speakerId: 'SPEAKER_01' },
        { startS: 1.0, endS: 2.0, speakerId: 'SPEAKER_01' },
      ],
    });
    const level = result.levels[0] as OSegmentLevel<OSegment>;

    expect(level.name).toBe('Transcription level 1');
    expect(
      level.items[0].labels.find(
        (label) => label.name === 'Transcription level 1',
      )?.value,
    ).toBe('Hello');
    expect(
      level.items[1].labels.find(
        (label) => label.name === 'Transcription level 1',
      )?.value,
    ).toBe('World');
    expect(
      level.items[0].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 1');
    expect(
      level.items[1].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 2');
  });
});

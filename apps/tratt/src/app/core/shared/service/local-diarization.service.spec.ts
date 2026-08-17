import { describe, expect, it } from '@jest/globals';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@octra/annotation';
import {
  applySpeakerTurnsToAnnotJson,
  SpeakerTurn,
} from './local-diarization.service';

describe('applySpeakerTurnsToAnnotJson', () => {
  it('adds Speaker labels to transcript segments using dominant overlap', () => {
    const annotJson = new OAnnotJSON('audio.wav', 'audio', 16000, []);
    annotJson.levels = [
      new OSegmentLevel('Transcript', [
        new OSegment(1, 0, 16000, [new OLabel('Transcript', 'Hello')]),
        new OSegment(2, 16000, 16000, [new OLabel('Transcript', 'World')]),
      ]),
    ];

    const turns: SpeakerTurn[] = [
      { startS: 0, endS: 0.9, speakerId: 'SPEAKER_00' },
      { startS: 0.9, endS: 1.0, speakerId: 'SPEAKER_01' },
      { startS: 1.0, endS: 2.0, speakerId: 'SPEAKER_01' },
    ];

    const result = applySpeakerTurnsToAnnotJson(annotJson, turns);
    const level = result.levels[0] as OSegmentLevel<OSegment>;

    expect(
      level.items[0].labels.find((label) => label.name === 'Transcript')?.value,
    ).toBe('Hello');
    expect(
      level.items[1].labels.find((label) => label.name === 'Transcript')?.value,
    ).toBe('World');
    expect(
      level.items[0].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 1');
    expect(
      level.items[1].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 2');
  });
});

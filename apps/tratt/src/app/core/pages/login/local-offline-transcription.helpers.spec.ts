import { describe, expect, it, jest } from '@jest/globals';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@octra/annotation';
import { SpeakerTurn } from '../../shared/service/local-diarization.service';
import { applyOptionalSpeakerSegmentation } from './local-offline-transcription.helpers';

function createAnnotJson(): OAnnotJSON {
  const annotJson = new OAnnotJSON('audio.wav', 'audio', 16000, []);
  annotJson.levels = [
    new OSegmentLevel('Transcript', [
      new OSegment(1, 0, 16000, [new OLabel('Transcript', 'Hello')]),
      new OSegment(2, 16000, 16000, [new OLabel('Transcript', 'World')]),
    ]),
  ];
  return annotJson;
}

describe('applyOptionalSpeakerSegmentation', () => {
  it('runs diarization and applies speaker labels when configured', async () => {
    const runDiarization = jest
      .fn<() => Promise<SpeakerTurn[]>>()
      .mockResolvedValue([
        { startS: 0, endS: 0.9, speakerId: '0' },
        { startS: 1, endS: 2, speakerId: '1' },
      ]);

    const result = await applyOptionalSpeakerSegmentation({
      annotJson: createAnnotJson(),
      diarizationEnabled: true,
      runDiarization,
    });

    const level = result.annotJson.levels[0] as OSegmentLevel<OSegment>;
    expect(runDiarization).toHaveBeenCalledTimes(1);
    expect(result.warning).toBeNull();
    expect(
      level.items[0].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 1');
    expect(
      level.items[1].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 2');
  });

  it('skips diarization when disabled', async () => {
    const runDiarization = jest.fn<() => Promise<SpeakerTurn[]>>();

    const result = await applyOptionalSpeakerSegmentation({
      annotJson: createAnnotJson(),
      diarizationEnabled: false,
      runDiarization,
    });

    const level = result.annotJson.levels[0] as OSegmentLevel<OSegment>;
    expect(runDiarization).not.toHaveBeenCalled();
    expect(result.warning).toBeNull();
    expect(
      level.items[0].labels.find((label) => label.name === 'Speaker'),
    ).toBeUndefined();
  });

  it('degrades gracefully when diarization fails', async () => {
    const runDiarization = jest
      .fn<() => Promise<SpeakerTurn[]>>()
      .mockRejectedValue(new Error('network-ish model failure'));

    const result = await applyOptionalSpeakerSegmentation({
      annotJson: createAnnotJson(),
      diarizationEnabled: true,
      runDiarization,
    });

    const level = result.annotJson.levels[0] as OSegmentLevel<OSegment>;
    expect(result.warning).toContain('Speaker separation failed');
    expect(
      level.items[0].labels.find((label) => label.name === 'Speaker'),
    ).toBeUndefined();
  });
});

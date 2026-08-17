import { describe, expect, it } from '@jest/globals';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import { TrattDropzoneService } from './tratt-dropzone.service';

describe('TrattDropzoneService speaker injection', () => {
  it('applies speaker turns to the current annotation', () => {
    const service = new TrattDropzoneService(
      {} as never,
      {} as never,
      {} as never,
    );
    const annotJson = new OAnnotJSON('audio.wav', 'audio', 16000, []);
    annotJson.levels = [
      new OSegmentLevel('Transcript', [
        new OSegment(1, 0, 16000, [new OLabel('Transcript', 'Hello')]),
        new OSegment(2, 16000, 16000, [new OLabel('Transcript', 'World')]),
      ]),
    ];

    service.setAnnotationFromAnnotJson(annotJson);
    service.applySpeakerTurnsToAnnotation([
      { startS: 0, endS: 0.9, speakerId: 'SPEAKER_00' },
      { startS: 0.9, endS: 1.0, speakerId: 'SPEAKER_01' },
      { startS: 1.0, endS: 2.0, speakerId: 'SPEAKER_01' },
    ]);

    const level = service.oannotation!.levels[0] as OSegmentLevel<OSegment>;
    expect(
      level.items[0].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 1');
    expect(
      level.items[1].labels.find((label) => label.name === 'Speaker')?.value,
    ).toBe('Speaker 2');
  });
});

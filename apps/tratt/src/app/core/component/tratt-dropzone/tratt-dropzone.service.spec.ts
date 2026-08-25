import { describe, expect, it, jest } from '@jest/globals';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import { TrattDropzoneService } from './tratt-dropzone.service';
import { FileInfo } from '@tratt/web-media';

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

describe('TrattDropzoneService openImportOptionsModal', () => {
  it('does not dispatch import options when the modal is cancelled', async () => {
    const dispatch = jest.fn();
    const modService = {
      openModal: jest.fn().mockResolvedValue({ action: 'cancel' } as never),
    };
    const service = new TrattDropzoneService(
      modService as never,
      { dispatch } as never,
      {} as never,
    );

    const fileProgress = {
      id: 1,
      status: 'progress',
      file: new FileInfo('test.srt', 'text/plain', 0),
      converter: { name: 'SRT' } as never,
      checked_converters: 0,
      progress: 0,
    } as never;

    await service.openImportOptionsModal(fileProgress);

    expect(dispatch).not.toHaveBeenCalled();
  });
});

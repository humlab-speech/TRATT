import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import * as webMedia from '@tratt/web-media';
import { AudioManager, FileInfo } from '@tratt/web-media';
import { of, Subject } from 'rxjs';
import { TrattDropzoneService } from './tratt-dropzone.service';

jest.mock('@tratt/web-media', () => {
  const actual: object = jest.requireActual('@tratt/web-media');
  return {
    ...actual,
    readFile: jest.fn(),
  };
});

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

describe('TrattDropzoneService multi-file audio ingest', () => {
  let isValidSpy: jest.SpiedFunction<typeof AudioManager.isValidAudioFileName>;
  let createSpy: jest.SpiedFunction<typeof AudioManager.create> | undefined;

  const makeAudioManager = (id: number) =>
    ({
      id,
      destroy: jest.fn(),
      stopDecoding: jest.fn(),
      resource: { info: { duration: { samples: 1000 } } },
      sampleRate: 16000,
    }) as unknown as AudioManager;

  const makeFile = (name: string, size = 1000): File =>
    new File([new Uint8Array(size)], name, { type: 'audio/wav' });

  const newService = () =>
    new TrattDropzoneService(
      {} as never,
      { dispatch: jest.fn() } as never,
      { translate: (key: string) => key } as never,
    );

  beforeEach(() => {
    isValidSpy = jest
      .spyOn(AudioManager, 'isValidAudioFileName')
      .mockReturnValue(true);
    (webMedia.readFile as jest.Mock).mockReturnValue(
      of({ status: 'success', progress: 1, result: new ArrayBuffer(8) }),
    );
  });

  afterEach(() => {
    isValidSpy.mockRestore();
    createSpy?.mockRestore();
    createSpy = undefined;
  });

  it('retains every valid audio file as a separate entry with a distinct AudioManager', async () => {
    const manager1 = makeAudioManager(1);
    const manager2 = makeAudioManager(2);
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValueOnce(of({ audioManager: manager1, progress: 1 }) as never)
      .mockReturnValueOnce(
        of({ audioManager: manager2, progress: 1 }) as never,
      );

    const service = newService();
    service.add(makeFile('file1.wav'));
    service.add(makeFile('file2.wav'));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.files.length).toBe(2);
    expect(service.files.every((f) => f.status === 'valid')).toBe(true);
    expect((manager1 as any).destroy).not.toHaveBeenCalled();
    expect((manager2 as any).destroy).not.toHaveBeenCalled();

    const entries = service.validAudioEntries;
    expect(entries.length).toBe(2);
    expect(entries[0].audioManager).toBe(manager1);
    expect(entries[1].audioManager).toBe(manager2);
    expect(entries[0].audioManager).not.toBe(entries[1].audioManager);
  });

  it("does not start decoding the second file until the first file's decode chain completes", async () => {
    const manager1 = makeAudioManager(1);
    const manager2 = makeAudioManager(2);
    const firstDecode$ = new Subject<{
      audioManager: AudioManager;
      progress: number;
    }>();

    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValueOnce(firstDecode$.asObservable() as never)
      .mockReturnValueOnce(
        of({ audioManager: manager2, progress: 1 }) as never,
      );

    const service = newService();
    service.add(makeFile('file1.wav'));
    service.add(makeFile('file2.wav'));

    await Promise.resolve();
    await Promise.resolve();

    // First decode still in flight: second file's decode must not have started.
    expect(AudioManager.create).toHaveBeenCalledTimes(1);

    firstDecode$.next({ audioManager: manager1, progress: 1 });
    firstDecode$.complete();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(AudioManager.create).toHaveBeenCalledTimes(2);
    expect(service.validAudioEntries.length).toBe(2);
  });

  it('does not remove the first audio file when a second audio file is dropped', async () => {
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(
        of({ audioManager: makeAudioManager(1), progress: 1 }) as never,
      );

    const service = newService();
    service.add(makeFile('file1.wav'));

    await Promise.resolve();
    await Promise.resolve();

    expect(service.files.length).toBe(1);

    service.add(makeFile('file2.wav'));

    expect(service.files.length).toBe(2);
    expect(service.files.some((f) => f.file.fullname === 'file1.wav')).toBe(
      true,
    );
    expect(service.files.some((f) => f.file.fullname === 'file2.wav')).toBe(
      true,
    );
  });
});

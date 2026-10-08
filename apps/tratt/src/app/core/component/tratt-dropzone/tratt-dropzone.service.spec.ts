import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import { OAudiofile } from '@tratt/media';
import * as webMedia from '@tratt/web-media';
import { AudioManager, FileInfo } from '@tratt/web-media';
import { Observable, of, Subject } from 'rxjs';
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
    service.allowMultipleAudio = true;
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
    service.allowMultipleAudio = true;
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

  it('does not remove the first audio file when a second audio file is dropped and allowMultipleAudio is true', async () => {
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(
        of({ audioManager: makeAudioManager(1), progress: 1 }) as never,
      );

    const service = newService();
    service.allowMultipleAudio = true;
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

  // Fix 4 (fixwave-1): allowMultipleAudio defaults to false, so every
  // consumer that doesn't opt in (reload-file, login) keeps the original
  // single-audio-file eviction behavior — this is the direct regression
  // test protecting those legacy pages.
  it('evicts the first audio file when a second audio file is dropped and allowMultipleAudio is left at its default (false)', async () => {
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(
        of({ audioManager: makeAudioManager(1), progress: 1 }) as never,
      );

    const service = newService();
    expect(service.allowMultipleAudio).toBe(false);
    service.add(makeFile('file1.wav'));

    await Promise.resolve();
    await Promise.resolve();

    expect(service.files.length).toBe(1);

    service.add(makeFile('file2.wav'));

    expect(service.files.length).toBe(1);
    expect(service.files.some((f) => f.file.fullname === 'file1.wav')).toBe(
      false,
    );
    expect(service.files.some((f) => f.file.fullname === 'file2.wav')).toBe(
      true,
    );
  });
});

describe('TrattDropzoneService reset()', () => {
  const newService = () =>
    new TrattDropzoneService(
      {} as never,
      { dispatch: jest.fn() } as never,
      { translate: (key: string) => key } as never,
    );

  const makeAudioManager = () =>
    ({
      id: 1,
      destroy: jest.fn(),
      stopDecoding: jest.fn(),
      resource: { info: { duration: { samples: 1000 } } },
      sampleRate: 16000,
    }) as unknown as AudioManager;

  // Fix 5 (fixwave-1): reset() must clear the pending-file list WITHOUT
  // destroying any AudioManager — ownership has already transferred to
  // AudioService by the time WorkbenchComponent.startSession() calls this.
  it('clears the file list without destroying any retained AudioManager', () => {
    const manager = makeAudioManager();
    const service = newService();
    (service as any)._files = [
      {
        id: 1,
        status: 'valid',
        progress: 1,
        checked_converters: 0,
        file: new FileInfo('a.wav', 'audio/wav', 100),
        audioManager: manager,
      },
    ];

    service.reset();

    expect(service.files.length).toBe(0);
    expect((manager as any).destroy).not.toHaveBeenCalled();
  });
});

describe('consumeEntry', () => {
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

  it('removes only the matching entry, leaving others (including still-decoding ones) untouched', async () => {
    const manager1 = makeAudioManager(1);
    const manager2 = makeAudioManager(2);
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValueOnce(of({ audioManager: manager1, progress: 1 }) as never)
      .mockReturnValueOnce(
        of({ audioManager: manager2, progress: 1 }) as never,
      );

    const service = newService();
    service.allowMultipleAudio = true;
    service.add(new File(['a'], 'a.wav', { type: 'audio/wav' }));
    service.add(new File(['b'], 'b.wav', { type: 'audio/wav' }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const [first, second] = service.files;

    service.consumeEntry(first.id);

    expect(service.files).toEqual([second]);
    expect(service.files.find((f) => f.id === first.id)).toBeUndefined();
  });

  it('does not destroy the consumed entry AudioManager', async () => {
    const manager = makeAudioManager(1);
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(of({ audioManager: manager, progress: 1 }) as never);

    const service = newService();
    service.add(new File(['a'], 'a.wav', { type: 'audio/wav' }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const [entry] = service.files;
    const destroySpy = entry.audioManager
      ? jest.spyOn(entry.audioManager, 'destroy')
      : undefined;

    service.consumeEntry(entry.id);

    expect(destroySpy).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown id', async () => {
    const manager = makeAudioManager(1);
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(of({ audioManager: manager, progress: 1 }) as never);

    const service = newService();
    service.add(new File(['a'], 'a.wav', { type: 'audio/wav' }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const before = service.files.length;

    service.consumeEntry(999999);

    expect(service.files.length).toBe(before);
  });
});

// Workbench: every transcript is paired with the recording of the same
// basename. Used to be one transcript, imported against whichever audio
// decoded last, and only for the first drop.
describe('TrattDropzoneService pairTranscriptsByBasename', () => {
  let createSpy: jest.SpiedFunction<typeof AudioManager.create> | undefined;

  const textGrid = (text: string) => `File type = "ooTextFile"
Object class = "TextGrid"

xmin = 0
xmax = 1
tiers? <exists>
size = 1
item []:
    item [1]:
        class = "IntervalTier"
        name = "words"
        xmin = 0
        xmax = 1
        intervals: size = 1
        intervals [1]:
            xmin = 0
            xmax = 1
            text = "${text}"
`;
  const contents = new Map<string, string>();
  const audioFile = (name: string) =>
    new File([new Uint8Array(100)], name, { type: 'audio/wav' });
  const transcriptFile = (name: string, text: string) => {
    contents.set(name, textGrid(text));
    return new File(['x'], name, { type: '' });
  };
  const manager = (id: number) =>
    ({
      id,
      destroy: jest.fn(),
      stopDecoding: jest.fn(),
      resource: { info: { duration: { samples: 16000 } } },
      sampleRate: 16000,
    }) as unknown as AudioManager;
  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  };
  const newService = () => {
    const service = new TrattDropzoneService(
      {} as never,
      { dispatch: jest.fn() } as never,
      { translate: (key: string) => key } as never,
    );
    service.allowMultipleAudio = true;
    service.pairTranscriptsByBasename = true;
    return service;
  };
  const entry = (service: TrattDropzoneService, name: string) =>
    service.files.find((f) => f.file.fullname === name)!;
  const firstText = (service: TrattDropzoneService, name: string) =>
    (entry(service, name).annotation!.levels[0].items[0] as OSegment).labels[0]
      .value;

  beforeEach(() => {
    contents.clear();
    // Asynchronous like FileReader: every file of a drop is added before
    // the first one has been read.
    (webMedia.readFile as jest.Mock).mockImplementation(
      ((file: File, type: string) =>
        new Observable((subscriber) => {
          void Promise.resolve().then(() => {
            subscriber.next({
              status: 'success',
              progress: 1,
              result:
                type === 'text' ? contents.get(file.name) : new ArrayBuffer(8),
            });
            subscriber.complete();
          });
        })) as never,
    );
  });

  afterEach(() => {
    createSpy?.mockRestore();
    createSpy = undefined;
  });

  it('pairs each transcript with the recording of its name, whatever the decode order', async () => {
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValueOnce(
        of({ audioManager: manager(1), progress: 1 }) as never,
      )
      .mockReturnValueOnce(
        of({ audioManager: manager(2), progress: 1 }) as never,
      );
    const service = newService();

    service.add(transcriptFile('b.TextGrid', 'text of b'));
    service.add(transcriptFile('a.TextGrid', 'text of a'));
    service.add(audioFile('a.wav'));
    service.add(audioFile('b.wav'));
    await flush();

    expect(entry(service, 'a.TextGrid').status).toBe('valid');
    expect(entry(service, 'a.TextGrid').pairedBasename).toBe('a');
    expect(firstText(service, 'a.TextGrid')).toBe('text of a');
    expect(entry(service, 'b.TextGrid').pairedBasename).toBe('b');
    expect(firstText(service, 'b.TextGrid')).toBe('text of b');
    // Both kept (a second transcript no longer evicts the first) and the
    // singular legacy transcript stays unset.
    expect(service.oannotation).toBeUndefined();
  });

  it('waits while its recording is still decoding', async () => {
    const decode$ = new Subject<{
      audioManager: AudioManager;
      progress: number;
    }>();
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValueOnce(decode$.asObservable() as never);
    const service = newService();

    service.add(audioFile('a.wav'));
    service.add(transcriptFile('a.TextGrid', 'hello'));
    await flush();
    // Queued behind the decode (`progress`) or read and waiting — not paired.
    expect(['progress', 'waiting']).toContain(
      entry(service, 'a.TextGrid').status,
    );

    decode$.next({ audioManager: manager(1), progress: 1 });
    decode$.complete();
    await flush();

    expect(entry(service, 'a.TextGrid').status).toBe('valid');
  });

  it('uses a recording already in the list (externalAudioFor)', async () => {
    const service = newService();
    const listed = new OAudiofile();
    listed.name = 'listed.wav';
    listed.sampleRate = 16000;
    listed.duration = 16000;
    service.externalAudioFor = (basename) =>
      basename === 'listed' ? listed : undefined;

    service.add(transcriptFile('listed.TextGrid', 'from disk'));
    await flush();

    expect(entry(service, 'listed.TextGrid').status).toBe('valid');
    expect(firstText(service, 'listed.TextGrid')).toBe('from disk');
  });

  it('waits for a recording resolved asynchronously (restored file)', async () => {
    const service = newService();
    const listed = new OAudiofile();
    listed.name = 'listed.wav';
    listed.sampleRate = 16000;
    listed.duration = 16000;
    let resolve!: (a: OAudiofile) => void;
    service.externalAudioFor = () =>
      new Promise<OAudiofile>((r) => (resolve = r));

    service.add(transcriptFile('listed.TextGrid', 'from disk'));
    await flush();
    expect(entry(service, 'listed.TextGrid').status).toBe('waiting');

    resolve(listed);
    await flush();
    expect(entry(service, 'listed.TextGrid').status).toBe('valid');
    expect(firstText(service, 'listed.TextGrid')).toBe('from disk');
  });

  it('explains when there is no recording of that name, or its audio is missing', async () => {
    const service = newService();
    service.externalAudioFor = (basename) =>
      basename === 'restored' ? 'no-audio' : undefined;

    service.add(transcriptFile('nowhere.TextGrid', 'x'));
    service.add(transcriptFile('restored.TextGrid', 'x'));
    await flush();

    expect(entry(service, 'nowhere.TextGrid').status).toBe('invalid');
    expect(entry(service, 'nowhere.TextGrid').error).toBe(
      'workbench.dropzone.transcript_no_recording',
    );
    expect(entry(service, 'restored.TextGrid').error).toBe(
      'workbench.dropzone.transcript_needs_audio',
    );
  });

  it('uses one transcript per recording and explains the second', async () => {
    createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValueOnce(
        of({ audioManager: manager(1), progress: 1 }) as never,
      );
    const service = newService();

    service.add(audioFile('a.wav'));
    service.add(transcriptFile('a.TextGrid', 'first'));
    contents.set('a_annot.json', '{not json');
    service.add(new File(['x'], 'a.textgrid', { type: '' }));
    contents.set('a.textgrid', textGrid('second'));
    await flush();

    const used = service.files.filter((f) => f.pairedBasename === 'a');
    expect(used).toHaveLength(1);
    expect(entry(service, 'a.textgrid').error).toBe(
      'workbench.dropzone.transcript_already_used',
    );
  });
});

describe('TrattDropzoneService export archives', () => {
  const zipFile = (bytes: Uint8Array) =>
    ({
      name: 'tratt_1_20261008@1910.zip',
      type: 'application/zip',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    }) as unknown as File;
  const newService = () => {
    const service = new TrattDropzoneService(
      {} as never,
      {} as never,
      { translate: (key: string) => key } as never,
    );
    service.acceptExportArchive = true;
    return service;
  };

  it('unpacks an archive: announces it, then adds audio before its annotation', async () => {
    const service = newService();
    const loaded = jest.fn();
    service.archiveLoaded.subscribe(loaded);
    const added: string[] = [];
    jest
      .spyOn(service, 'add')
      .mockImplementationOnce(service.add.bind(service))
      .mockImplementation(((f: File) => added.push(f.name)) as never);
    const { strToU8, zipSync } = await import('fflate');
    await (
      service as unknown as { addArchive(f: File): Promise<void> }
    ).addArchive(
      zipFile(
        zipSync({
          'bundles/a/a_annot.json': strToU8('{}'),
          'bundles/a/a.wav': strToU8('RIFF'),
        }),
      ),
    );
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(added).toEqual(['a.wav', 'a_annot.json']);
  });

  it('lists an unreadable archive as invalid without announcing it', async () => {
    const service = newService();
    const loaded = jest.fn();
    service.archiveLoaded.subscribe(loaded);
    service.add(zipFile(new Uint8Array([1, 2, 3])));
    await new Promise((r) => setTimeout(r));
    expect(loaded).not.toHaveBeenCalled();
    expect(service.files).toHaveLength(1);
    expect(service.files[0].status).toBe('invalid');
  });
});

import { TestBed } from '@angular/core/testing';
import { describe, expect, it, jest } from '@jest/globals';

// Same workaround as pipeline-queue.service.spec.ts: PipelineQueueService is
// imported below only for its DI token/type (it's fully mocked via
// `useValue` in setup()), but the real module still gets pulled into the
// compile graph, and it imports LocalTranscriptionService, which constructs
// its Worker via `new URL('...', import.meta.url)` at module scope — syntax
// ts-jest's CommonJS config cannot compile. Stub it out before anything else
// imports it.
jest.mock('./local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('./local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { provideMockStore } from '@ngrx/store/testing';
import {
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { strFromU8, unzipSync } from 'fflate';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { SessionFile } from '../../obj/SessionFile';
import { RootState } from '../../store/index';
import { localBundleAdapter } from '../../store/login-mode/annotation/local-bundle-collection';
import { AudioService } from './audio.service';
import {
  archiveFileName,
  CatalogueExportService,
} from './catalogue-export.service';
import { PipelineQueueService } from './pipeline-queue.service';

function segmentLevel(id: number, name: string, text: string) {
  return new TrattAnnotationSegmentLevel(id, name, [
    new TrattAnnotationSegment(1, new SampleUnit(16000, 16000), [
      new OLabel(name, text),
    ]),
  ]);
}

function makeBundle(bundleId: string, fileName: string, withText = true) {
  return {
    bundleId,
    sessionFile: new SessionFile(fileName, 10, new Date(), 'audio/wav'),
    audio: { loaded: true, fileName, sampleRate: 16000 },
    // A level-less TrattAnnotation (levels: []) makes level-indexed
    // converters like SRT (which need `levelnum < annotation.levels.length`
    // to produce a named file at all) silently emit an empty filename
    // instead of a real error — one empty SEGMENT level is the minimum
    // realistic shape a bundle's transcript actually has. It carries one
    // unit of text by default: bundles with no transcript are skipped by the
    // export (see the 'no transcript' test).
    transcript: new TrattAnnotation([
      withText
        ? segmentLevel(1, 'OCTRA_1', 'hello')
        : new TrattAnnotationSegmentLevel(1, 'OCTRA_1', []),
    ]),
  } as any;
}

function makeManager(durationSamples: number, sampleRate: number) {
  return {
    sampleRate,
    resource: {
      info: { duration: { samples: durationSamples } },
      getOAudioFile: () => ({
        name: 'x.wav',
        sampleRate,
        duration: durationSamples,
      }),
    },
  } as any;
}

describe('CatalogueExportService', () => {
  function setup(bundles: ReturnType<typeof makeBundle>[]) {
    let bundleCollection = localBundleAdapter.getInitialState();
    for (const b of bundles) {
      bundleCollection = localBundleAdapter.setOne(b, bundleCollection);
    }
    const initialState = {
      // RootState.localMode is top-level (see core/store/index.ts) — not
      // nested under `login.local`.
      localMode: {
        bundles: bundleCollection,
        selectedBundleId: bundles[0].bundleId,
      },
    } as unknown as RootState;

    const audioService = {
      ensureResident: jest.fn(async () => true),
      getManager: jest.fn(() => makeManager(16000, 16000)),
      // No registration-time media info by default, so these tests exercise
      // the ensureResident() path; individual tests override it.
      getMediaInfo: jest.fn((): any => undefined),
      canRestore: jest.fn(() => true),
      getSourceFile: jest.fn((): any => undefined),
    };
    const pipelineQueueService = {
      getTranscribeOptions: jest.fn(() => ({ modelId: 'm1', language: 'en' })),
      getTranslateOptions: jest.fn((): any => null),
    };

    TestBed.configureTestingModule({
      providers: [
        CatalogueExportService,
        provideMockStore({ initialState }),
        { provide: AudioService, useValue: audioService },
        { provide: PipelineQueueService, useValue: pipelineQueueService },
      ],
    });

    return {
      service: TestBed.inject(CatalogueExportService),
      audioService,
    };
  }

  it('archives the source audio and a native annotation next to it', async () => {
    const { service, audioService } = setup([makeBundle('bundle-1', 'a.wav')]);
    // jsdom's File has no arrayBuffer().
    audioService.getSourceFile.mockReturnValue({
      name: 'a.wav',
      type: 'audio/wav',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const last = await lastValueFrom(service.exportBundles(['bundle-1'], []));
    const entries = unzipSync(last.archive!);
    expect(Array.from(entries['bundles/a/a.wav'])).toEqual([1, 2, 3]);
    expect(Object.keys(entries)).toContain('bundles/a/a_annot.json');
    expect(last.exportedCount).toBe(1);
  });

  it('produces one archive entry per bundle per requested converter, plus both manifests', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    expect(last.archive).toBeDefined();
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('manifest.csv');
    expect(
      entries.some((e) => e.startsWith('bundles/a/') && e.endsWith('.json')),
    ).toBe(true);
    expect(
      entries.some((e) => e.startsWith('bundles/b/') && e.endsWith('.json')),
    ).toBe(true);
  });

  it('emits progress once per bundle, ending at completedBundles === totalBundles', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const events = await firstValueFrom(
      service
        .exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON'])
        .pipe(toArray()),
    );

    expect(events.length).toBe(2);
    expect(events[0].completedBundles).toBe(1);
    expect(events[1].completedBundles).toBe(2);
    expect(events[1].totalBundles).toBe(2);
    expect(events[1].archive).toBeDefined();
  });

  it('skips a bundle removed from the store before its turn, with a warning, and continues', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
    // 'bundle-ghost' was never added to the store.
    const last = await lastValueFrom(
      service.exportBundles(['bundle-ghost', 'bundle-1'], ['AnnotJSON']),
    );

    expect(last.warnings.some((w) => w.includes('bundle-ghost'))).toBe(true);
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries.some((e) => e.startsWith('bundles/a/'))).toBe(true);
  });

  it('records a warning and continues when ensureResident() fails for a bundle', async () => {
    const { service, audioService } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);
    audioService.ensureResident.mockImplementationOnce(async () => false);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    expect(last.warnings.some((w) => w.includes('bundle-1'))).toBe(true);
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries.some((e) => e.startsWith('bundles/b/'))).toBe(true);
    expect(entries.some((e) => e.startsWith('bundles/a/'))).toBe(false);
  });

  it('records a warning and continues when one converter errors on one bundle, but still writes files from the other requested converter', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
    const annotJsonConverter = AppInfo.converters.find(
      (c) => c.name === 'AnnotJSON',
    )!;
    const exportSpy = jest
      .spyOn(annotJsonConverter, 'export')
      .mockReturnValueOnce({ error: 'boom' });

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON', 'SRT']),
    );

    expect(last.warnings.some((w) => w.includes('AnnotJSON'))).toBe(true);
    const entries = Object.keys(unzipSync(last.archive!));
    expect(
      entries.some((e) => e.startsWith('bundles/a/') && e.endsWith('.srt')),
    ).toBe(true);
    expect(
      entries.some((e) => e.startsWith('bundles/a/') && e.endsWith('.json')),
    ).toBe(false);

    exportSpy.mockRestore();
  });

  it('deduplicates two bundles that share a basename', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'interview.wav'),
      makeBundle('bundle-2', 'interview.wav'),
    ]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    const entries = Object.keys(unzipSync(last.archive!));
    const interviewDirs = new Set(
      entries
        .filter((e) => e.startsWith('bundles/interview'))
        .map((e) => e.split('/')[1]),
    );
    expect(interviewDirs.size).toBe(2);
  });

  // A failure while preparing ONE bundle is now isolated to that bundle (a
  // warning, the rest of the catalogue still exported) instead of erroring
  // the whole export — see 'records a warning instead of hanging when
  // serializing one bundle throws' below. The Observable still completes,
  // never hangs.
  it('turns a rejection while making one bundle resident into a warning, and still completes', async () => {
    const { service, audioService } = setup([makeBundle('bundle-1', 'a.wav')]);
    audioService.ensureResident.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON']),
    );
    expect(last.archive).toBeDefined();
    expect(last.warnings).toEqual(['Skipped bundle-1 (a.wav): boom.']);
  });

  it('surfaces a failure outside the per-bundle loop as an Observable error, not a silent hang', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
    jest.spyOn(service as any, 'toCsv').mockImplementation(() => {
      throw new Error('csv boom');
    });

    await expect(
      lastValueFrom(service.exportBundles(['bundle-1'], ['AnnotJSON'])),
    ).rejects.toThrow('csv boom');
  });

  it('builds a manifest.json entry with model/language from the queue config and no translation stage', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON']),
    );

    const manifest = JSON.parse(
      new TextDecoder().decode(unzipSync(last.archive!)['manifest.json']),
    );
    expect(manifest[0].model).toBe('m1');
    expect(manifest[0].language).toBe('en');
    expect(manifest[0].stagesRun).toEqual(['asr']);
  });

  it('uses media info captured at registration instead of re-decoding the audio', async () => {
    const { service, audioService } = setup([makeBundle('bundle-1', 'a.wav')]);
    audioService.getMediaInfo.mockReturnValue({
      fullname: 'a.wav',
      sampleRate: 16000,
      duration: new SampleUnit(32000, 16000),
      channels: 1,
      size: 10,
    });

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON']),
    );

    expect(audioService.ensureResident).not.toHaveBeenCalled();
    expect(last.warnings).toEqual([
      expect.stringContaining('audio not attached'),
    ]);
    const manifest = JSON.parse(
      strFromU8(unzipSync(last.archive!)['manifest.json']),
    );
    expect(manifest[0].durationSamples).toBe(32000);
  });

  it('exports a restored bundle whose audio was never re-attached, deriving timing from its transcript', async () => {
    const restored = makeBundle('bundle-1', 'a.wav');
    restored.transcript = new TrattAnnotation([
      new TrattAnnotationSegmentLevel(1, 'OCTRA_1', [
        new TrattAnnotationSegment(1, new SampleUnit(48000, 16000), [
          new OLabel('OCTRA_1', 'hello'),
        ]),
      ]),
    ]);
    const { service, audioService } = setup([restored]);
    audioService.canRestore.mockReturnValue(false);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON']),
    );

    expect(audioService.ensureResident).not.toHaveBeenCalled();
    expect(last.warnings).toEqual([
      expect.stringContaining('audio not attached'),
    ]);
    const manifest = JSON.parse(
      strFromU8(unzipSync(last.archive!)['manifest.json']),
    );
    expect(manifest[0].durationSamples).toBe(48000);
    expect(manifest[0].sampleRate).toBe(16000);
  });

  // Used by the workbench's per-file "Export this transcription".
  describe('uniquePath (zip-slip)', () => {
    it.each(['../../evil.txt', '/etc/passwd', 'a\\..\\b.txt', '..'])(
      'keeps %s inside the bundle directory',
      (name) => {
        const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
        const path = (service as any).uniquePath({}, 'bundles/x', name);
        expect(path.startsWith('bundles/x/')).toBe(true);
        expect(path.slice('bundles/x/'.length)).not.toMatch(/[\\/]|^\.\.$/);
      },
    );
  });

  describe('resolveBundleMedia', () => {
    it("uses the transcript's timing for a file whose audio isn't attached", async () => {
      const restored = makeBundle('bundle-1', 'a.wav');
      restored.transcript = new TrattAnnotation([
        new TrattAnnotationSegmentLevel(1, 'OCTRA_1', [
          new TrattAnnotationSegment(1, new SampleUnit(48000, 16000), []),
        ]),
      ]);
      const { service, audioService } = setup([restored]);
      audioService.canRestore.mockReturnValue(false);

      const media = await service.resolveBundleMedia('bundle-1');

      expect(media?.sampleRate).toBe(16000);
      expect(media?.duration.samples).toBe(48000);
      expect(media?.oAudioFile.name).toBe('a.wav');
      expect(audioService.ensureResident).not.toHaveBeenCalled();
    });

    it('is undefined for an unknown bundle or one with nothing to derive timing from', async () => {
      const empty = makeBundle('bundle-1', 'a.wav');
      empty.transcript = new TrattAnnotation([]);
      const { service, audioService } = setup([empty]);
      audioService.canRestore.mockReturnValue(false);

      expect(await service.resolveBundleMedia('nope')).toBeUndefined();
      expect(await service.resolveBundleMedia('bundle-1')).toBeUndefined();
    });
  });

  it('records a warning instead of hanging when serializing one bundle throws', async () => {
    const broken = makeBundle('bundle-1', 'a.wav');
    broken.transcript = {
      levels: [],
      serialize: () => {
        throw new Error('boom');
      },
    };
    const { service } = setup([broken, makeBundle('bundle-2', 'b.wav')]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    expect(last.archive).toBeDefined();
    expect(last.warnings.some((w) => w.includes('boom'))).toBe(true);
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries.some((e) => e.startsWith('bundles/b/'))).toBe(true);
  });

  it('skips a bundle without any transcript text, with a warning', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'empty.wav', false),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    expect(last.warnings.some((w) => w.includes('empty.wav'))).toBe(true);
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries.some((e) => e.startsWith('bundles/empty/'))).toBe(false);
    expect(entries.some((e) => e.startsWith('bundles/b/'))).toBe(true);
    const manifest = JSON.parse(
      strFromU8(unzipSync(last.archive!)['manifest.json']),
    );
    expect(manifest.map((m: any) => m.sourceFilename)).toEqual(['b.wav']);
  });

  it('writes one single-tier file (e.g. SRT) per segment tier, so a translation tier is not dropped', async () => {
    const bundle = makeBundle('bundle-1', 'a.wav');
    bundle.transcript = new TrattAnnotation([
      segmentLevel(1, 'OCTRA_1', 'hello'),
      segmentLevel(2, 'Spanish (es)', 'hola'),
    ]);
    const { service } = setup([bundle]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT']),
    );

    const files = unzipSync(last.archive!);
    const srts = Object.keys(files).filter(
      (e) => e.startsWith('bundles/a/') && e.endsWith('.srt'),
    );
    expect(srts.length).toBe(2);
    const spanish = srts.find((e) => e.includes('Spanish'));
    expect(spanish).toBeDefined();
    expect(strFromU8(files[spanish!])).toContain('hola');
  });

  it('lists translation among the stages run when the queue is configured to translate', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
    const queue = TestBed.inject(PipelineQueueService) as any;
    queue.getTranslateOptions.mockReturnValue({ targetLanguage: 'en' });

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON']),
    );
    const manifest = JSON.parse(
      strFromU8(unzipSync(last.archive!)['manifest.json']),
    );
    expect(manifest[0].stagesRun).toEqual(['asr', 'translation']);
  });
});

describe('archiveFileName', () => {
  it('encodes name, recording count and local date@time', () => {
    expect(archiveFileName(2, new Date(2026, 9, 8, 19, 10))).toBe(
      'tratt_2_20261008@1910.zip',
    );
    expect(archiveFileName(12, new Date(2026, 0, 3, 4, 5))).toBe(
      'tratt_12_20260103@0405.zip',
    );
  });
});

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
// The transcoder needs libav.js (wasm); every test gets a fake, re-encoded
// file (see beforeEach below) unless it says otherwise.
jest.mock('./media-transcode', () => ({ transcodeForExport: jest.fn() }));

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
  CatalogueExportProgress,
  CatalogueExportService,
  rescaleAnnotation,
} from './catalogue-export.service';
import { exportedMediaName, exportedMediaType } from './exported-media';
import { transcodeForExport } from './media-transcode';
import { PipelineQueueService } from './pipeline-queue.service';

const transcode = transcodeForExport as jest.MockedFunction<
  typeof transcodeForExport
>;

/** What the faked transcoder returns: the exported name, bytes [9, 9]. */
function transcoded(source: File): File {
  // jsdom's File has no arrayBuffer().
  return {
    name: exportedMediaName(source.name),
    type: exportedMediaType(source.name),
    arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
  } as unknown as File;
}

beforeEach(() => {
  transcode.mockReset();
  transcode.mockImplementation(async (source) => transcoded(source));
});

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

/** The final emission's .zip; fails the test when it is a single file. */
function zipBytes(event: CatalogueExportProgress): Uint8Array {
  expect(event.download?.archive).toBe(true);
  return event.download!.bytes;
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
      hasAudioFile: jest.fn((id: string) => !!audioService.getSourceFile(id)),
      getAudioFile: jest.fn(async (id: string) =>
        audioService.getSourceFile(id),
      ),
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
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT']),
    );
    const entries = unzipSync(zipBytes(last));
    expect(Array.from(entries['bundles/a/a.opus'])).toEqual([9, 9]);
    expect(Object.keys(entries)).not.toContain('bundles/a/a.wav');
    expect(Object.keys(entries)).toContain('bundles/a/a_annot.json');
    expect(last.exportedCount).toBe(1);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest[0].audioPath).toBe('bundles/a/a.opus');
    expect(manifest[0].audioType).toBe('audio/ogg');
    expect(
      JSON.parse(strFromU8(entries['bundles/a/a_annot.json'])).annotates,
    ).toBe('a.opus');
  });

  it('exports the original file, saying why, when re-encoding fails, and carries on', async () => {
    const { service, audioService } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);
    audioService.getSourceFile.mockImplementation((id: string) => ({
      name: id === 'bundle-1' ? 'a.wav' : 'b.wav',
      type: 'audio/wav',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    transcode.mockImplementation(async (source) => {
      if (source.name === 'a.wav') {
        throw new Error('Could not transcode a.wav: no audio stream');
      }
      return transcoded(source);
    });

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['SRT']),
    );

    const entries = unzipSync(zipBytes(last));
    expect(Array.from(entries['bundles/a/a.wav'])).toEqual([1, 2, 3]);
    expect(Array.from(entries['bundles/b/b.opus'])).toEqual([9, 9]);
    expect(last.warnings).toEqual([
      'a.wav: could not re-encode (no audio stream); the original file is exported.',
    ]);
    expect(last.exportedCount).toBe(2);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest[0].audioPath).toBe('bundles/a/a.wav');
    expect(manifest[0].audioType).toBe('audio/wav');
    expect(
      JSON.parse(strFromU8(entries['bundles/a/a_annot.json'])).annotates,
    ).toBe('a.wav');
  });

  describe('sample rate of the exported transcript', () => {
    // A WAV recording keeps its own rate in Tratt (44.1 kHz here); anything
    // else, Opus included, is read back at 16 kHz (HtmlAudioMechanism
    // normalizes every non-WAV decode to ML_MODEL_SAMPLE_RATE).
    function wav44k() {
      const bundle = makeBundle('bundle-1', 'a.wav');
      bundle.transcript = new TrattAnnotation([
        new TrattAnnotationSegmentLevel(1, 'OCTRA_1', [
          new TrattAnnotationSegment(1, new SampleUnit(1000, 44100), [
            new OLabel('OCTRA_1', 'hi'),
          ]),
          new TrattAnnotationSegment(2, new SampleUnit(66150, 44100), [
            new OLabel('OCTRA_1', 'there'),
          ]),
        ]),
      ]);
      const { service, audioService } = setup([bundle]);
      audioService.getMediaInfo.mockReturnValue({
        fullname: 'a.wav',
        sampleRate: 44100,
        duration: new SampleUnit(132300, 44100),
        channels: 2,
        size: 10,
      });
      audioService.getSourceFile.mockReturnValue({
        name: 'a.wav',
        type: 'audio/wav',
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
      return service;
    }
    const exported = async (service: CatalogueExportService) => {
      const entries = unzipSync(
        zipBytes(
          await lastValueFrom(service.exportBundles(['bundle-1'], ['SRT'])),
        ),
      );
      return {
        annot: JSON.parse(strFromU8(entries['bundles/a/a_annot.json'])),
        manifest: JSON.parse(strFromU8(entries['manifest.json']))[0],
        srt: strFromU8(entries['bundles/a/a.srt']),
      };
    };

    it('moves every position to the rate Tratt reads the Opus file at', async () => {
      const { annot, manifest, srt } = await exported(wav44k());
      expect(annot.sampleRate).toBe(16000);
      expect(
        annot.levels[0].items.map((i: any) => [i.sampleStart, i.sampleDur]),
      ).toEqual([
        [0, 363], // 1000 * 16000 / 44100 = 362.8
        [363, 23637], // ends at 66150 → 24000
        [24000, 24000], // padding to the end, 132300 → 48000
      ]);
      expect(manifest.sampleRate).toBe(16000);
      expect(manifest.durationSamples).toBe(48000);
      // The other formats are written from the same annotation and rate.
      expect(srt).toContain('00:00:01,500');
    });

    it('keeps the source rate when the original file is exported', async () => {
      const service = wav44k();
      transcode.mockRejectedValue(new Error('Could not transcode a.wav: x'));
      const { annot, manifest } = await exported(service);
      expect(annot.sampleRate).toBe(44100);
      expect(annot.annotates).toBe('a.wav');
      expect(
        annot.levels[0].items.map((i: any) => [i.sampleStart, i.sampleDur]),
      ).toEqual([
        [0, 1000],
        [1000, 65150],
        [66150, 66150],
      ]);
      expect(manifest.sampleRate).toBe(44100);
      expect(manifest.durationSamples).toBe(132300);
    });

    it('gives the manifest the same rate for audio exported without a transcript', async () => {
      const bundle = makeBundle('bundle-1', 'a.wav', false);
      const { service, audioService } = setup([
        bundle,
        makeBundle('bundle-2', 'b.wav'),
      ]);
      audioService.getMediaInfo.mockImplementation((id: string) =>
        id === 'bundle-1'
          ? {
              fullname: 'a.wav',
              sampleRate: 44100,
              duration: new SampleUnit(132300, 44100),
              channels: 2,
              size: 10,
            }
          : undefined,
      );
      audioService.getSourceFile.mockImplementation((id: string) =>
        id === 'bundle-1'
          ? {
              name: 'a.wav',
              type: 'audio/wav',
              arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            }
          : undefined,
      );
      const last = await lastValueFrom(
        service.exportBundles(['bundle-1', 'bundle-2'], ['SRT']),
      );
      const [row] = JSON.parse(
        strFromU8(unzipSync(zipBytes(last))['manifest.json']),
      );
      expect(row.audioPath).toBe('bundles/a/a.opus');
      expect(row.sampleRate).toBe(16000);
      expect(row.durationSamples).toBe(48000);
    });

    it('rescales event points too, and leaves an annotation at the rate alone', () => {
      const annot = {
        sampleRate: 44100,
        levels: [
          { type: 'EVENT', items: [{ samplePoint: 44100 }] },
          { type: 'ITEM', items: [{ id: 1 }] },
        ],
      } as any;
      rescaleAnnotation(annot, 16000);
      expect(annot.sampleRate).toBe(16000);
      expect(annot.levels[0].items[0].samplePoint).toBe(16000);
      expect(annot.levels[1].items[0]).toEqual({ id: 1 });
      rescaleAnnotation(annot, 16000);
      expect(annot.levels[0].items[0].samplePoint).toBe(16000);
    });
  });

  describe('own format is always written', () => {
    const files = (ids: string[], names: string[]) => {
      const { service } = setup(ids.map((id) => makeBundle(id, `${id}.wav`)));
      return lastValueFrom(service.exportBundles(ids, names));
    };
    const entryNames = (last: CatalogueExportProgress) =>
      Object.keys(unzipSync(zipBytes(last)))
        .filter((n) => !n.startsWith('manifest'))
        .sort();

    it('zips DOCX with AnnotJSON for one bundle without audio', async () => {
      expect(entryNames(await files(['b1'], ['DOCX']))).toEqual([
        'bundles/b1/b1_annot.json',
        'bundles/b1/x.docx',
      ]);
    });

    it('writes only b1_annot.json, not zipped, when no format is ticked', async () => {
      const last = await files(['b1'], []);
      expect(last.download?.archive).toBe(false);
      expect(last.download?.name).toBe('b1_annot.json');
    });

    it('gives each of two bundles the same file set', async () => {
      expect(entryNames(await files(['b1', 'b2'], ['DOCX']))).toEqual([
        'bundles/b1/b1_annot.json',
        'bundles/b1/x.docx',
        'bundles/b2/b2_annot.json',
        'bundles/b2/x.docx',
      ]);
    });

    it('zips two bundles with no format ticked, one _annot.json each', async () => {
      expect(entryNames(await files(['b1', 'b2'], []))).toEqual([
        'bundles/b1/b1_annot.json',
        'bundles/b2/b2_annot.json',
      ]);
    });
  });

  it('produces one archive entry per bundle per requested converter, plus both manifests', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    expect(last.download).toBeDefined();
    const entries = Object.keys(unzipSync(zipBytes(last)));
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
    expect(events[1].download).toBeDefined();
  });

  it('skips a bundle removed from the store before its turn, with a warning, and continues', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
    // 'bundle-ghost' was never added to the store.
    const last = await lastValueFrom(
      service.exportBundles(['bundle-ghost', 'bundle-1'], ['AnnotJSON', 'SRT']),
    );

    expect(last.warnings.some((w) => w.includes('bundle-ghost'))).toBe(true);
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.some((e) => e.startsWith('bundles/a/'))).toBe(true);
  });

  it('still exports the transcript of a bundle whose audio cannot be made resident', async () => {
    const { service, audioService } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);
    audioService.ensureResident.mockImplementationOnce(async () => false);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.some((e) => e.startsWith('bundles/b/'))).toBe(true);
    expect(
      entries.some(
        (e) => e.startsWith('bundles/a/') && e.endsWith('_annot.json'),
      ),
    ).toBe(true);
  });

  it('records a warning and continues when one converter errors on one bundle, but still exports the other requested converter', async () => {
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
    // Only the SRT is left, so it downloads as it is.
    expect(last.download?.archive).toBe(false);
    expect(last.download?.name.endsWith('.srt')).toBe(true);

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

    const entries = Object.keys(unzipSync(zipBytes(last)));
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
  it('exports a bundle whose audio rejects while being made resident, and still completes', async () => {
    const { service, audioService } = setup([makeBundle('bundle-1', 'a.wav')]);
    audioService.ensureResident.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON']),
    );
    expect(last.download).toBeDefined();
    expect(last.exportedCount).toBe(1);
    expect(last.warnings.some((w) => w.startsWith('Skipped'))).toBe(false);
  });

  it('surfaces a failure outside the per-bundle loop as an Observable error, not a silent hang', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
    jest.spyOn(service as any, 'toCsv').mockImplementation(() => {
      throw new Error('csv boom');
    });

    await expect(
      lastValueFrom(service.exportBundles(['bundle-1'], ['AnnotJSON', 'SRT'])),
    ).rejects.toThrow('csv boom');
  });

  it('builds a manifest.json entry with model/language from the queue config and no translation stage', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON', 'SRT']),
    );

    const manifest = JSON.parse(
      new TextDecoder().decode(unzipSync(zipBytes(last))['manifest.json']),
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
      service.exportBundles(['bundle-1'], ['AnnotJSON', 'SRT']),
    );

    expect(audioService.ensureResident).not.toHaveBeenCalled();
    expect(last.warnings).toEqual([
      expect.stringContaining('audio not attached'),
    ]);
    const manifest = JSON.parse(
      strFromU8(unzipSync(zipBytes(last))['manifest.json']),
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
      service.exportBundles(['bundle-1'], ['AnnotJSON', 'SRT']),
    );

    expect(audioService.ensureResident).not.toHaveBeenCalled();
    expect(last.warnings).toEqual([
      expect.stringContaining('audio not attached'),
    ]);
    const manifest = JSON.parse(
      strFromU8(unzipSync(zipBytes(last))['manifest.json']),
    );
    expect(manifest[0].durationSamples).toBe(48000);
    expect(manifest[0].sampleRate).toBe(16000);
  });

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
    // Has text, so it gets as far as serializing.
    broken.transcript.serialize = () => {
      throw new Error('boom');
    };
    const { service } = setup([broken, makeBundle('bundle-2', 'b.wav')]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON', 'SRT']),
    );

    expect(last.download).toBeDefined();
    expect(last.warnings.some((w) => w.includes('boom'))).toBe(true);
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.some((e) => e.startsWith('bundles/b/'))).toBe(true);
  });

  it('skips a bundle without any transcript text, with a warning', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'empty.wav', false),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON', 'SRT']),
    );

    expect(last.warnings.some((w) => w.includes('empty.wav'))).toBe(true);
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.some((e) => e.startsWith('bundles/empty/'))).toBe(false);
    expect(entries.some((e) => e.startsWith('bundles/b/'))).toBe(true);
    const manifest = JSON.parse(
      strFromU8(unzipSync(zipBytes(last))['manifest.json']),
    );
    expect(manifest.map((m: any) => m.sourceFilename)).toEqual(['b.wav']);
  });

  it('skips a new bundle holding only its one empty seeded segment, like the list\'s "Not transcribed"', async () => {
    const seeded = makeBundle('bundle-1', 'seeded.wav');
    seeded.transcript = new TrattAnnotation([segmentLevel(1, 'OCTRA_1', '')]);
    const { service } = setup([seeded, makeBundle('bundle-2', 'b.wav')]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['SRT', 'ELAN']),
    );

    expect(last.warnings.some((w) => w.includes('seeded.wav'))).toBe(true);
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.some((e) => e.startsWith('bundles/seeded/'))).toBe(false);
    expect(last.exportedCount).toBe(1);
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

    const files = unzipSync(zipBytes(last));
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
      service.exportBundles(['bundle-1'], ['AnnotJSON', 'SRT']),
    );
    const manifest = JSON.parse(
      strFromU8(unzipSync(zipBytes(last))['manifest.json']),
    );
    expect(manifest[0].stagesRun).toEqual(['asr', 'translation']);
  });
});

describe('CatalogueExportService: one file or a .zip', () => {
  function setup(
    bundles: ReturnType<typeof makeBundle>[],
    source?: any,
    // VISP: no attached file, but the recording is fetched from the server.
    fetched?: any,
  ) {
    let bundleCollection = localBundleAdapter.getInitialState();
    for (const b of bundles) {
      bundleCollection = localBundleAdapter.setOne(b, bundleCollection);
    }
    TestBed.configureTestingModule({
      providers: [
        CatalogueExportService,
        provideMockStore({
          initialState: {
            localMode: {
              bundles: bundleCollection,
              selectedBundleId: bundles[0].bundleId,
            },
          } as unknown as RootState,
        }),
        {
          provide: AudioService,
          useValue: {
            ensureResident: jest.fn(async () => true),
            getManager: jest.fn(() => makeManager(16000, 16000)),
            getMediaInfo: jest.fn((): any => undefined),
            canRestore: jest.fn(() => true),
            getSourceFile: jest.fn((): any => source),
            hasAudioFile: jest.fn(() => !!source || !!fetched),
            getAudioFile: jest.fn(async () => {
              if (fetched instanceof Error) throw fetched;
              return source ?? fetched;
            }),
          },
        },
        {
          provide: PipelineQueueService,
          useValue: {
            getTranscribeOptions: jest.fn((): any => null),
            getTranslateOptions: jest.fn((): any => null),
          },
        },
      ],
    });
    return TestBed.inject(CatalogueExportService);
  }

  const wav = {
    name: 'a.wav',
    type: 'audio/wav',
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  };

  it("zips a single format together with Tratt's own file", async () => {
    const service = setup([makeBundle('bundle-1', 'a.wav')]);
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT'], { includeAudio: false }),
    );
    const entries = unzipSync(zipBytes(last));
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['bundles/a/a_annot.json', 'bundles/a/a.srt']),
    );
    expect(strFromU8(entries['bundles/a/a.srt'])).toContain('hello');
    expect(last.warnings).toEqual([]);
  });

  it("downloads Tratt's own format alone when that is the one file", async () => {
    const service = setup([makeBundle('bundle-1', 'a.wav')]);
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON'], {
        includeAudio: false,
      }),
    );
    expect(last.download?.archive).toBe(false);
    expect(last.download?.name).toMatch(/_annot\.json$/);
  });

  it('makes a .zip with the audio when audio and a format are asked for', async () => {
    const service = setup([makeBundle('bundle-1', 'a.wav')], wav);
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT'], { includeAudio: true }),
    );
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries).toEqual(
      expect.arrayContaining([
        'bundles/a/a.opus',
        'bundles/a/a_annot.json',
        'manifest.json',
      ]),
    );
  });

  it('includes audio fetched from VISP, which has no attached file', async () => {
    const service = setup([makeBundle('bundle-1', 'a.wav')], undefined, wav);
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT'], { includeAudio: true }),
    );
    const entries = unzipSync(zipBytes(last));
    expect(Array.from(entries['bundles/a/a.opus'])).toEqual([9, 9]);
    expect(last.warnings).toEqual([]);
  });

  it('says so, and still exports the transcript, when fetching the audio fails', async () => {
    const service = setup(
      [makeBundle('bundle-1', 'a.wav')],
      undefined,
      new Error('offline'),
    );
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT'], { includeAudio: true }),
    );
    expect(Object.keys(unzipSync(zipBytes(last)))).toContain('bundles/a/a.srt');
    expect(last.warnings).toEqual([
      expect.stringContaining('audio could not be fetched (offline)'),
    ]);
  });

  it('exports the audio alone of a recording without a transcript', async () => {
    const service = setup([makeBundle('bundle-1', 'a.wav', false)], wav);
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT'], { includeAudio: true }),
    );
    expect(last.download?.archive).toBe(false);
    expect(last.download?.name).toBe('a.opus');
    expect(last.exportedCount).toBe(1);
  });

  it('puts only the audio, no blank transcripts, in the folder of a recording without a transcript', async () => {
    const service = setup(
      [makeBundle('bundle-1', 'a.wav', false), makeBundle('bundle-2', 'b.wav')],
      undefined,
      wav,
    );
    // Each recording's own file: the transcript names the file next to it.
    (TestBed.inject(AudioService).getAudioFile as jest.Mock).mockImplementation(
      async (id: unknown) => ({
        ...wav,
        name: id === 'bundle-1' ? 'a.wav' : 'b.wav',
      }),
    );
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['SRT'], {
        includeAudio: true,
      }),
    );
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.filter((e) => e.startsWith('bundles/a/'))).toEqual([
      'bundles/a/a.opus',
    ]);
    expect(entries).toContain('bundles/b/b_annot.json');
    expect(entries).toContain('bundles/b/b.opus');
  });

  it('skips a recording without a transcript whose audio cannot be fetched, saying why', async () => {
    const service = setup(
      [makeBundle('bundle-1', 'a.wav', false)],
      undefined,
      new Error('offline'),
    );
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT'], { includeAudio: true }),
    );
    expect(last.download).toBeUndefined();
    expect(last.warnings).toEqual([
      expect.stringContaining(
        'no transcript yet, and its audio could not be fetched',
      ),
    ]);
  });

  it('leaves the audio out, without a warning, when it is not asked for', async () => {
    const service = setup(
      [makeBundle('bundle-1', 'a.wav'), makeBundle('bundle-2', 'b.wav')],
      wav,
    );
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['SRT'], {
        includeAudio: false,
      }),
    );
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.some((e) => /\.(wav|opus)$/.test(e))).toBe(false);
    expect(transcode).not.toHaveBeenCalled();
    expect(last.warnings).toEqual([]);
  });

  it("does not write Tratt's own file twice when it is ticked", async () => {
    const service = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON'], {
        includeAudio: false,
      }),
    );
    const entries = Object.keys(unzipSync(zipBytes(last)));
    expect(entries.filter((e) => e.startsWith('bundles/a/'))).toHaveLength(1);
  });

  it('puts every tier in one file for a format that holds several (DOCX)', async () => {
    const bundle = makeBundle('bundle-1', 'a.wav');
    bundle.transcript = new TrattAnnotation([
      segmentLevel(1, 'OCTRA_1', 'hello'),
      segmentLevel(2, 'Spanish (es)', 'hola'),
    ]);
    const service = setup([bundle]);
    const docx = AppInfo.converters.find((c) => c.name === 'DOCX')!;
    const spy = jest.spyOn(docx, 'export');

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['DOCX'], { includeAudio: false }),
    );

    expect(last.download?.archive).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][3]).toEqual([0, 1]);
    spy.mockRestore();
  });

  it('downloads nothing when no recording has a transcript', async () => {
    const service = setup([makeBundle('bundle-1', 'a.wav', false)]);
    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['SRT']),
    );
    expect(last.download).toBeUndefined();
    expect(last.exportedCount).toBe(0);
  });

  describe('exportTranscript (the transcript on screen)', () => {
    const audio = { name: 'a.wav', sampleRate: 16000, duration: 16000 } as any;
    function annot() {
      return new TrattAnnotation([
        segmentLevel(1, 'OCTRA_1', 'hello'),
      ]).serialize('a.wav', 16000, new SampleUnit(16000, 16000));
    }

    it('downloads one format as it is', () => {
      const service = setup([makeBundle('bundle-1', 'a.wav')]);
      const { download } = service.exportTranscript(
        annot(),
        audio,
        ['SRT'],
        '<P>',
      );
      expect(download?.archive).toBe(false);
      expect(download?.name).toMatch(/\.srt$/);
    });

    it("zips several formats with Tratt's own file, and no manifests", () => {
      const service = setup([makeBundle('bundle-1', 'a.wav')]);
      const { download } = service.exportTranscript(
        annot(),
        audio,
        ['SRT', 'ELAN'],
        '<P>',
      );
      expect(download?.archive).toBe(true);
      const entries = Object.keys(unzipSync(download!.bytes));
      expect(entries.some((e) => e.endsWith('.srt'))).toBe(true);
      expect(entries.some((e) => e.endsWith('.eaf'))).toBe(true);
      expect(entries.some((e) => e.endsWith('_annot.json'))).toBe(true);
      expect(entries).not.toContain('manifest.json');
    });
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

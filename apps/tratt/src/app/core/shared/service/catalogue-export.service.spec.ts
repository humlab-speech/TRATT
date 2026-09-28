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
import { unzipSync } from 'fflate';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
import { AudioService } from './audio.service';
import { CatalogueExportService } from './catalogue-export.service';
import { PipelineQueueService } from './pipeline-queue.service';
import { RootState } from '../../store/index';
import { localBundleAdapter } from '../../store/login-mode/annotation/local-bundle-collection';
import { TrattAnnotation, TrattAnnotationSegmentLevel } from '@tratt/annotation';
import { SessionFile } from '../../obj/SessionFile';
import { AppInfo } from '../../../app.info';

function makeBundle(bundleId: string, fileName: string) {
  return {
    bundleId,
    sessionFile: new SessionFile(fileName, 10, new Date(), 'audio/wav'),
    audio: { loaded: true, fileName, sampleRate: 16000 },
    // A level-less TrattAnnotation (levels: []) makes level-indexed
    // converters like SRT (which need `levelnum < annotation.levels.length`
    // to produce a named file at all) silently emit an empty filename
    // instead of a real error — one empty SEGMENT level is the minimum
    // realistic shape a bundle's transcript actually has.
    transcript: new TrattAnnotation([
      new TrattAnnotationSegmentLevel(1, 'OCTRA_1', []),
    ]),
  } as any;
}

function makeManager(durationSamples: number, sampleRate: number) {
  return {
    sampleRate,
    resource: {
      info: { duration: { samples: durationSamples } },
      getOAudioFile: () => ({ name: 'x.wav', sampleRate, duration: durationSamples }),
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
    };
    const pipelineQueueService = {
      getTranscribeOptions: jest.fn(() => ({ modelId: 'm1', language: 'en' })),
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
    expect(entries.some((e) => e.startsWith('bundles/a/') && e.endsWith('.json'))).toBe(true);
    expect(entries.some((e) => e.startsWith('bundles/b/') && e.endsWith('.json'))).toBe(true);
  });

  it('emits progress once per bundle, ending at completedBundles === totalBundles', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const events = await firstValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']).pipe(toArray()),
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
    expect(entries.some((e) => e.startsWith('bundles/a/') && e.endsWith('.srt'))).toBe(
      true,
    );
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
});

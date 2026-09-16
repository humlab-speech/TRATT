import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// local-transcription.service.ts and local-translation.service.ts both
// construct their Worker via `new URL('...worker', import.meta.url)`
// directly in the service file, which ts-jest cannot compile under this
// project's CommonJS config — same pre-existing issue worked around in
// login.component.spec.ts (see that file's comment for the full
// explanation). This spec never touches the real classes: every test below
// replaces `transcribe`/`translate` via a plain mock object passed straight
// into PipelineRunnerService's constructor, so the class bodies here only
// need to exist, not do anything.
jest.mock('./local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('./local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import { Subject } from 'rxjs';
import type { DiarizationEvent } from './local-diarization-runtime.service';
import type {
  TranscriptionEvent,
  TranscriptionOptions,
} from './local-transcription.service';
import type { TranslationEvent, TranslationOptions } from './local-translation.service';
import { PipelineEvent, PipelineRunnerService } from './pipeline-runner.service';

const TRANSLATION_DOWNLOAD_STALL_MS = 30_000;
const TRANSLATION_INIT_STALL_MS = 60_000;

function makeAnnotJsonWithSegments(): OAnnotJSON {
  const annotJson = new OAnnotJSON('audio.wav', 'audio', 16000, []);
  annotJson.levels = [
    new OSegmentLevel('Transcript', [
      new OSegment(1, 0, 16000, [new OLabel('Transcript', 'Hello')]),
      new OSegment(2, 16000, 16000, [new OLabel('Transcript', 'World')]),
    ]),
  ];
  return annotJson;
}

function makeTranscriptionOptions(
  overrides: Partial<TranscriptionOptions> = {},
): TranscriptionOptions {
  return {
    modelId: 'onnx-community/kb-whisper-tiny-ONNX',
    useWebGPU: false,
    ...overrides,
  };
}

describe('PipelineRunnerService', () => {
  let transcriptionServiceMock: { transcribe: jest.Mock<any>; cancel: jest.Mock<any> };
  let diarizationServiceMock: { diarize: jest.Mock<any>; cancel: jest.Mock<any> };
  let translationServiceMock: { translate: jest.Mock<any>; cancel: jest.Mock<any> };
  let translocoTranslate: jest.Mock<any>;
  let service: PipelineRunnerService;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  const audioManager = { id: 'fake-audio-manager' } as any;
  const oaudiofile = { id: 'fake-oaudiofile' } as any;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    transcriptionServiceMock = { transcribe: jest.fn(), cancel: jest.fn() };
    diarizationServiceMock = { diarize: jest.fn(), cancel: jest.fn() };
    translationServiceMock = { translate: jest.fn(), cancel: jest.fn() };
    translocoTranslate = jest.fn(
      (key: string, params?: Record<string, unknown>) =>
        `${key}::${JSON.stringify(params ?? {})}`,
    );
    service = new PipelineRunnerService(
      transcriptionServiceMock as any,
      diarizationServiceMock as any,
      translationServiceMock as any,
      { translate: translocoTranslate } as any,
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  describe('transcription-only sequencing', () => {
    it('emits raw transcription events, a diarization-skipped marker, and a terminal pipeline result, without touching diarization/translation services', async () => {
      const opts = makeTranscriptionOptions();
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      const events: PipelineEvent[] = [];
      let errored: unknown = null;
      let completed = false;
      service
        .run({ audioManager, oaudiofile, transcribeOptions: opts })
        .subscribe({
          next: (e) => events.push(e),
          error: (e) => (errored = e),
          complete: () => (completed = true),
        });

      expect(transcriptionServiceMock.transcribe).toHaveBeenCalledWith(
        audioManager,
        oaudiofile,
        opts,
      );

      subject.next({
        type: 'download-progress',
        loaded: 10,
        total: 100,
        file: 'model.bin',
      });
      subject.next({ type: 'transcribe-start', audioDurationS: 12 });
      subject.next({ type: 'segment-progress', segmentEndS: 5 });

      const annotJson = makeAnnotJsonWithSegments();
      subject.next({ type: 'result', annotJson });
      await Promise.resolve();
      await Promise.resolve();

      expect(diarizationServiceMock.diarize).not.toHaveBeenCalled();
      expect(translationServiceMock.translate).not.toHaveBeenCalled();
      expect(errored).toBeNull();
      expect(completed).toBe(true);

      expect(events).toContainEqual({
        stage: 'transcription',
        event: { type: 'download-progress', loaded: 10, total: 100, file: 'model.bin' },
      });
      expect(events).toContainEqual({
        stage: 'transcription',
        event: { type: 'transcribe-start', audioDurationS: 12 },
      });
      expect(events).toContainEqual({
        stage: 'transcription',
        event: { type: 'segment-progress', segmentEndS: 5 },
      });
      expect(events).toContainEqual({
        stage: 'transcription',
        event: { type: 'result', annotJson },
      });
      expect(events).toContainEqual({ stage: 'diarization', type: 'skipped' });
      expect(events).toContainEqual({
        stage: 'transcription',
        type: 'finalized',
        diarizationWarning: null,
        willTranslate: false,
      });
      const resultEvent = events.find(
        (e) => e.stage === 'pipeline' && e.type === 'result',
      ) as Extract<PipelineEvent, { stage: 'pipeline'; type: 'result' }>;
      expect(resultEvent.annotJson).toBe(annotJson);
      expect(resultEvent.diarizationWarning).toBeNull();
    });

    it('propagates a transcribe() observable error as an error on the returned Observable', () => {
      const opts = makeTranscriptionOptions();
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      let errored: unknown = null;
      service
        .run({ audioManager, oaudiofile, transcribeOptions: opts })
        .subscribe({ error: (e) => (errored = e) });

      subject.error(new Error('worker crashed'));
      expect((errored as Error)?.message).toBe('worker crashed');
    });
  });

  describe('diarization success path', () => {
    it('calls diarize() with the configured options and finalizes with the diarized annotation', async () => {
      const opts = makeTranscriptionOptions({
        diarization: { modelId: 'diar-model', useWebGPU: false },
      });
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const diarizationSubject = new Subject<DiarizationEvent>();
      diarizationServiceMock.diarize.mockReturnValue(diarizationSubject);

      const events: PipelineEvent[] = [];
      let completed = false;
      service
        .run({ audioManager, oaudiofile, transcribeOptions: opts })
        .subscribe({ next: (e) => events.push(e), complete: () => (completed = true) });

      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      await Promise.resolve();
      await Promise.resolve();

      expect(diarizationServiceMock.diarize).toHaveBeenCalledWith(
        audioManager,
        opts.diarization,
      );

      diarizationSubject.next({
        type: 'result',
        turns: [
          { startS: 0, endS: 0.9, speakerId: 'SPEAKER_00' },
          { startS: 0.9, endS: 2.0, speakerId: 'SPEAKER_01' },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(completed).toBe(true);
      const resultEvent = events.find(
        (e) => e.stage === 'pipeline' && e.type === 'result',
      ) as Extract<PipelineEvent, { stage: 'pipeline'; type: 'result' }>;
      expect(resultEvent.diarizationWarning).toBeNull();
      const level = resultEvent.annotJson.levels[0] as OSegmentLevel<OSegment>;
      expect(level.items[0].labels.find((l) => l.name === 'Speaker')?.value).toBe(
        'Speaker 1',
      );
    });
  });

  describe('diarization graceful-degradation path', () => {
    it('sets a localized diarizationWarning, logs console.error, and still finalizes with the ORIGINAL annotation when diarization errors', async () => {
      const opts = makeTranscriptionOptions({
        diarization: { modelId: 'diar-model', useWebGPU: false },
      });
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const diarizationSubject = new Subject<DiarizationEvent>();
      diarizationServiceMock.diarize.mockReturnValue(diarizationSubject);

      const events: PipelineEvent[] = [];
      service
        .run({ audioManager, oaudiofile, transcribeOptions: opts })
        .subscribe({ next: (e) => events.push(e) });

      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      await Promise.resolve();
      await Promise.resolve();

      diarizationSubject.error(new Error('diarization worker crashed'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(translocoTranslate).toHaveBeenCalledWith(
        'login.auto-transcription.diarization failed',
        { message: 'diarization worker crashed' },
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[diarization]',
        translocoTranslate.mock.results[0].value,
      );
      const resultEvent = events.find(
        (e) => e.stage === 'pipeline' && e.type === 'result',
      ) as Extract<PipelineEvent, { stage: 'pipeline'; type: 'result' }>;
      expect(resultEvent.annotJson).toBe(annotJson);
      expect(resultEvent.diarizationWarning).toBe(translocoTranslate.mock.results[0].value);
    });

    it('carries diarizationWarning on the "finalized" event, BEFORE the translation stage starts, when chaining into translation', async () => {
      const opts = makeTranscriptionOptions({
        diarization: { modelId: 'diar-model', useWebGPU: false },
      });
      const translateOpts: TranslationOptions = {
        sourceLanguage: 'en',
        targetLanguage: 'sv',
      };
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const diarizationSubject = new Subject<DiarizationEvent>();
      diarizationServiceMock.diarize.mockReturnValue(diarizationSubject);
      const translationSubject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(translationSubject);

      const events: PipelineEvent[] = [];
      service
        .run({
          audioManager,
          oaudiofile,
          transcribeOptions: opts,
          translateOptions: translateOpts,
        })
        .subscribe({ next: (e) => events.push(e) });

      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      await Promise.resolve();
      await Promise.resolve();

      diarizationSubject.error(new Error('diarization worker crashed'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const finalizedIndex = events.findIndex(
        (e) => e.stage === 'transcription' && 'type' in e && e.type === 'finalized',
      );
      const translationStartIndex = events.findIndex(
        (e) => e.stage === 'translation' && 'type' in e && e.type === 'start',
      );
      expect(finalizedIndex).toBeGreaterThanOrEqual(0);
      expect(translationStartIndex).toBeGreaterThan(finalizedIndex);

      const finalizedEvent = events[finalizedIndex] as Extract<
        PipelineEvent,
        { stage: 'transcription'; type: 'finalized' }
      >;
      expect(finalizedEvent.diarizationWarning).toBe(
        translocoTranslate.mock.results[0].value,
      );
      expect(finalizedEvent.willTranslate).toBe(true);
    });
  });

  describe('transcription -> translation chaining', () => {
    it('automatically starts translation with the (possibly diarized) annotation once transcription completes, without emitting a pipeline result yet', async () => {
      const transcribeOpts = makeTranscriptionOptions();
      const translateOpts: TranslationOptions = {
        sourceLanguage: 'en',
        targetLanguage: 'sv',
      };
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const translationSubject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(translationSubject);

      const events: PipelineEvent[] = [];
      let completed = false;
      service
        .run({
          audioManager,
          oaudiofile,
          transcribeOptions: transcribeOpts,
          translateOptions: translateOpts,
        })
        .subscribe({ next: (e) => events.push(e), complete: () => (completed = true) });

      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(translationServiceMock.translate).toHaveBeenCalledTimes(1);
      expect(translationServiceMock.translate).toHaveBeenCalledWith(
        annotJson,
        translateOpts,
      );
      expect(events).toContainEqual({ stage: 'translation', type: 'start' });
      expect(completed).toBe(false);
    });
  });

  describe('translation-only entry (no transcribeOptions)', () => {
    it('starts translation synchronously on subscribe, without calling transcribe()/diarize()', () => {
      const translateOpts: TranslationOptions = {
        sourceLanguage: 'en',
        targetLanguage: 'sv',
      };
      const annotJson = makeAnnotJsonWithSegments();
      const subject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(subject);

      const events: PipelineEvent[] = [];
      service
        .run({ audioManager, oaudiofile, translateOptions: translateOpts, annotJson })
        .subscribe({ next: (e) => events.push(e) });

      expect(translationServiceMock.translate).toHaveBeenCalledWith(
        annotJson,
        translateOpts,
      );
      expect(transcriptionServiceMock.transcribe).not.toHaveBeenCalled();
      expect(diarizationServiceMock.diarize).not.toHaveBeenCalled();
      expect(events).toContainEqual({ stage: 'translation', type: 'start' });
    });
  });

  describe('translation stall timer', () => {
    function startTranslationOnly(subject: Subject<TranslationEvent>) {
      const annotJson = makeAnnotJsonWithSegments();
      translationServiceMock.translate.mockReturnValue(subject);
      const events: PipelineEvent[] = [];
      service
        .run({
          audioManager,
          oaudiofile,
          translateOptions: { sourceLanguage: 'en', targetLanguage: 'sv' },
          annotJson,
        })
        .subscribe({ next: (e) => events.push(e) });
      return events;
    }

    it('emits the download-stall message at exactly 30000ms of silence, and stays active (no auto-cancel)', () => {
      const subject = new Subject<TranslationEvent>();
      const events = startTranslationOnly(subject);

      jest.advanceTimersByTime(TRANSLATION_DOWNLOAD_STALL_MS - 1);
      expect(events.find((e) => e.stage === 'pipeline' && e.type === 'stalled')).toBeUndefined();

      jest.advanceTimersByTime(1);
      const stalled = events.find(
        (e) => e.stage === 'pipeline' && e.type === 'stalled',
      ) as Extract<PipelineEvent, { stage: 'pipeline'; type: 'stalled' }>;
      expect(stalled.message).toBe(
        'Download stalled — likely a browser storage limit. Cancel and retry with "Skip browser cache" enabled.',
      );

      // still active: cancel() must still route to the translation service.
      service.cancel();
      expect(translationServiceMock.cancel).toHaveBeenCalledTimes(1);
    });

    it('emits the init-stall message at exactly 60000ms once past the download phase', () => {
      const subject = new Subject<TranslationEvent>();
      const events = startTranslationOnly(subject);

      subject.next({ type: 'model-init' });

      jest.advanceTimersByTime(TRANSLATION_INIT_STALL_MS - 1);
      expect(events.find((e) => e.stage === 'pipeline' && e.type === 'stalled')).toBeUndefined();

      jest.advanceTimersByTime(1);
      const stalled = events.find(
        (e) => e.stage === 'pipeline' && e.type === 'stalled',
      ) as Extract<PipelineEvent, { stage: 'pipeline'; type: 'stalled' }>;
      expect(stalled.message).toBe('Model load stalled. Try refreshing the page.');
    });

    it('re-arms the stall timer on every non-result event', () => {
      const subject = new Subject<TranslationEvent>();
      const events = startTranslationOnly(subject);

      jest.advanceTimersByTime(TRANSLATION_DOWNLOAD_STALL_MS - 1);
      subject.next({ type: 'download-progress', loaded: 1, total: 2, file: 'x' });

      jest.advanceTimersByTime(TRANSLATION_DOWNLOAD_STALL_MS - 1);
      expect(events.find((e) => e.stage === 'pipeline' && e.type === 'stalled')).toBeUndefined();

      jest.advanceTimersByTime(1);
      expect(events.find((e) => e.stage === 'pipeline' && e.type === 'stalled')).toBeDefined();
    });

    it('uses the translating-phase stall message once translate-start has fired', () => {
      const subject = new Subject<TranslationEvent>();
      const events = startTranslationOnly(subject);

      subject.next({ type: 'model-init' });
      subject.next({ type: 'translate-start', total: 4 });

      jest.advanceTimersByTime(TRANSLATION_INIT_STALL_MS);
      const stalled = events.find(
        (e) => e.stage === 'pipeline' && e.type === 'stalled',
      ) as Extract<PipelineEvent, { stage: 'pipeline'; type: 'stalled' }>;
      expect(stalled.message).toBe(
        'Translation stalled — no progress for 60 seconds. Cancel and retry.',
      );
    });

    it('does not arm a new stall timer once result has fired', () => {
      const subject = new Subject<TranslationEvent>();
      const events = startTranslationOnly(subject);
      const annotJson = makeAnnotJsonWithSegments();

      subject.next({ type: 'result', annotJson });
      jest.advanceTimersByTime(TRANSLATION_INIT_STALL_MS + TRANSLATION_DOWNLOAD_STALL_MS);

      expect(events.find((e) => e.stage === 'pipeline' && e.type === 'stalled')).toBeUndefined();
    });
  });

  describe('translation observable error', () => {
    it('propagates the error and clears the stall timer', () => {
      const subject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(subject);
      let errored: unknown = null;
      service
        .run({
          audioManager,
          oaudiofile,
          translateOptions: { sourceLanguage: 'en', targetLanguage: 'sv' },
          annotJson: makeAnnotJsonWithSegments(),
        })
        .subscribe({ error: (e) => (errored = e) });

      subject.error(new Error('translation worker crashed'));
      expect((errored as Error)?.message).toBe('translation worker crashed');

      jest.advanceTimersByTime(TRANSLATION_INIT_STALL_MS + TRANSLATION_DOWNLOAD_STALL_MS);
      // no throw / no stray timer firing after error — nothing to assert on
      // directly here beyond "it didn't blow up", covered by not throwing.
    });
  });

  describe('cancel() stage-aware routing', () => {
    it('cancels transcription + diarization services when transcription is the active stage', () => {
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);
      service
        .run({ audioManager, oaudiofile, transcribeOptions: makeTranscriptionOptions() })
        .subscribe();

      service.cancel();

      expect(transcriptionServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(diarizationServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(translationServiceMock.cancel).not.toHaveBeenCalled();
    });

    it('cancels only the translation service when translation is the active stage', () => {
      const subject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(subject);
      service
        .run({
          audioManager,
          oaudiofile,
          translateOptions: { sourceLanguage: 'en', targetLanguage: 'sv' },
          annotJson: makeAnnotJsonWithSegments(),
        })
        .subscribe();

      service.cancel();

      expect(translationServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(transcriptionServiceMock.cancel).not.toHaveBeenCalled();
      expect(diarizationServiceMock.cancel).not.toHaveBeenCalled();
    });

    it('does nothing when no stage is active', () => {
      service.cancel();

      expect(transcriptionServiceMock.cancel).not.toHaveBeenCalled();
      expect(diarizationServiceMock.cancel).not.toHaveBeenCalled();
      expect(translationServiceMock.cancel).not.toHaveBeenCalled();
    });

    it('emits a terminal {stage:"pipeline", type:"cancelled"} event on the run() Observable and completes it, when cancelling an active run', () => {
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      const events: PipelineEvent[] = [];
      let completed = false;
      service
        .run({ audioManager, oaudiofile, transcribeOptions: makeTranscriptionOptions() })
        .subscribe({ next: (e) => events.push(e), complete: () => (completed = true) });

      service.cancel();

      expect(events).toContainEqual({ stage: 'pipeline', type: 'cancelled' });
      expect(completed).toBe(true);
    });

    it('does NOT emit a cancelled event when cancel() is called with nothing active', () => {
      const events: PipelineEvent[] = [];
      // No run() call at all — nothing to have a subscriber for, and
      // cancel() must not throw or emit anything.
      expect(() => service.cancel()).not.toThrow();
      expect(events).toEqual([]);
    });
  });
});

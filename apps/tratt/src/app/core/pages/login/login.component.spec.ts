import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// login.component.ts directly imports TrattDropzoneComponent (a real value
// import, needed for its standalone `imports: [...]` array) which
// transitively pulls in AutoTranscribeOptionsComponent /
// AutoTranslateOptionsComponent -> local-transcription.service.ts /
// local-translation.service.ts, both of which construct a Worker via `new
// URL('...worker', import.meta.url)` and fail to compile under this
// project's CommonJS ts-jest config (same pre-existing issue worked around
// in workbench.component.spec.ts and linear-editor.component.spec.ts). This
// spec never renders the real dropzone — it assigns `component.dropzone`
// directly — so a minimal standalone stand-in with the right selector is
// enough.
jest.mock('../../component/tratt-dropzone/tratt-dropzone.component', () => {
  const { Component } = require('@angular/core');
  @Component({ selector: 'tratt-dropzone', template: '' })
  class TrattDropzoneComponent {}
  return { TrattDropzoneComponent };
});

// recording-panel.component.ts injects RecordingService/RecordingPersistenceService
// (IndexedDB + MediaRecorder-backed) that this bare instantiation doesn't
// provide. This spec never touches recording, only login.component.ts's own
// `imports: [...]` array referencing the class, so stub it out, same
// rationale as workbench.component.spec.ts's identical mock.
jest.mock('../../component/recording-panel/recording-panel.component', () => {
  const { Component, EventEmitter, Output } = require('@angular/core');
  @Component({ selector: 'tratt-recording-panel', template: '' })
  class RecordingPanelComponent {
    @Output() useRecording = new EventEmitter();
  }
  return { RecordingPanelComponent };
});

// local-transcription.service.ts and local-translation.service.ts both
// construct their Worker via `new URL('...worker', import.meta.url)`
// directly in the service file (not behind an injectable factory token the
// way local-diarization-runtime.service.ts is), so — unlike
// LocalDiarizationRuntimeService below — they cannot be given real classes
// here at all; ts-jest cannot compile either file under this project's
// CommonJS config (see login-component-import-meta.transformer.js for the
// sibling fix needed for login.component.ts's OWN inline Worker factory).
// Every test in this file replaces these mocks' `transcribe`/`translate`
// methods via TestBed provider overrides, so the class bodies here only need
// to exist, not do anything.
jest.mock('../../shared/service/local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { Action, provideStore, Store } from '@ngrx/store';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import { Subject } from 'rxjs';
import type { DiarizationEvent } from '../../shared/service/local-diarization-runtime.service';
import type {
  TranscriptionEvent,
  TranscriptionOptions,
} from '../../shared/service/local-transcription.service';
import type { TranslationEvent } from '../../shared/service/local-translation.service';
import { PipelineRunnerService } from '../../shared/service/pipeline-runner.service';
import { PIPELINE_THROTTLE_MS } from '../../store/pipeline/pipeline-event-mapping';
import { PipelineActions } from '../../store/pipeline/pipeline.actions';
import { reducer as pipelineReducer } from '../../store/pipeline/pipeline.reducer';
import { PipelineState } from '../../store/pipeline';
import { RootState } from '../../store';
import { LoginComponent } from './login.component';

// Exact ms budgets from login.component.ts — not exported, so hardcoded here
// deliberately: if a later task changes these constants without updating
// this test, that's exactly the kind of behavior drift this suite exists to
// catch.
const TRANSLATION_DOWNLOAD_STALL_MS = 30_000;
const TRANSLATION_INIT_STALL_MS = 60_000;

/** Flushes pending microtasks (Promise chains inside handleCompletedTranscription's
 * `await applyOptionalSpeakerSegmentation(...)` / `await firstValueFrom(...)`), which
 * `jest.useFakeTimers()` does NOT fake — only macrotask timers are faked. Same idiom as
 * audio-chunk.spec.ts elsewhere in this codebase. */
async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

// login.component.ts now dispatches through a throttled (`dispatchPipelineActions()`,
// ~4Hz-capped for progress ticks) channel on its way to the store (Task 3/4's
// design — see pipeline-event-mapping.ts). Every place below that needs to observe a
// store-derived field (`component.transcription()`/`.translation()`/
// `.diarizationWarning()`) synchronously after an event has to first let a
// throttle window close, exactly like a real 250ms tick would in production.
//
// throttleTime's own mechanics (verified empirically against this exact
// operator, not just assumed from its docs) matter here: a window that only
// ever emitted its leading value (nothing else arrived while it was open)
// is fully idle again after ONE `PIPELINE_THROTTLE_MS` advance — the next
// value to arrive becomes a fresh leading edge. But a window that also
// delivered a TRAILING value (2+ events collapsed into it) re-arms one more
// full cooldown period as a side effect of that trailing send, so it takes
// a SECOND `PIPELINE_THROTTLE_MS` advance before it's truly idle — until
// then, the very next value to arrive is itself held rather than treated as
// leading, and would be silently dropped if something else supersedes it
// before that second advance happens.
//
// `flushPipelineThrottle()` merely delivers whatever's currently pending —
// enough when nothing after it needs to be its own leading edge.
// `flushPipelineThrottleFully()` guarantees full idle, for the (more
// common, in this pipeline's synchronous multi-event cascades) case where
// the NEXT event dispatched must not be silently superseded before it's
// ever delivered.
//
// UPDATE (post-review fix): login.component.ts/pipeline-event-mapping.ts no
// longer throttle the WHOLE mapped-action stream — only pure progress ticks
// (download-progress/segment-progress) go through dispatchPipelineActions()'s
// throttle-safe path at all; every discrete state-transition/terminal action now dispatches
// immediately (see dispatchPipelineActions()/isThrottleSafeProgressAction()
// and the "regression: transcriptionFinalized must survive..." test below
// for why). Most of the flush calls below, inserted for THOSE discrete
// actions before that fix, are consequently no longer strictly necessary —
// but are left in place as harmless, already-correct advances (their
// original comments explain what they were guarding) rather than churned
// for the sake of it. Only calls guarding an actual download-progress/
// segment-progress burst still do real work.
function flushPipelineThrottle(): void {
  jest.advanceTimersByTime(PIPELINE_THROTTLE_MS);
}

function flushPipelineThrottleFully(): void {
  jest.advanceTimersByTime(PIPELINE_THROTTLE_MS * 2);
}

// Test-only escape hatch, local to this spec file (does NOT touch
// pipeline.reducer.ts): injects an `active:true` + `error:<msg>` combination
// for the TRANSCRIPTION slice — a pairing the real reducer's own actions can
// never produce together (`transcriptionStart` always clears `.error`, and
// `PipelineActions.error` always pairs a non-null `.error` with
// `active:false`). Notably, the ORIGINAL pre-extraction component could not
// reach this combination via its own code either — `_onPipelineError` always
// wrote both fields together — so the pre-Task-4 version of this test was
// ALREADY a pure white-box artifact (direct field mutation) isolating
// `dismissTranscriptionError()`'s branching logic from how `.error` actually
// gets populated. This reproduces that same isolation now that the field is
// store-backed, via one synthetic, test-local action type layered on top of
// the real reducer, rather than by changing what's being asserted.
const TEST_FORCE_TRANSCRIPTION_ERROR = '[TEST ONLY] force transcription error';
function testPipelineReducer(
  state: PipelineState | undefined,
  action: Action,
): PipelineState {
  const next = pipelineReducer(state, action);
  if (action.type === TEST_FORCE_TRANSCRIPTION_ERROR) {
    return {
      ...next,
      transcription: {
        ...next.transcription,
        error: (action as unknown as { message: string }).message,
      },
    };
  }
  return next;
}

function makeDropzoneStub(overrides: Record<string, unknown> = {}) {
  return {
    transcribeOptions: null,
    translateOptions: null,
    hasAudio: false,
    hasAnnotation: false,
    oannotation: undefined,
    audioManager: { id: 'fake-audio-manager' },
    oaudiofile: { id: 'fake-oaudiofile' },
    files: [{ file: { file: new File(['content'], 'a.wav') } }],
    setAnnotationFromAnnotJson: jest.fn(),
    releaseAudioManager: jest.fn(),
    ...overrides,
  };
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

/** A minimal but real OAnnotJSON with one segment level, matching the
 * construction pattern in local-diarization.service.spec.ts, so the
 * diarization-success test exercises the real
 * applySpeakerTurnsToAnnotJson()/applyOptionalSpeakerSegmentation()
 * integration end to end rather than asserting against an opaque stub. */
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

describe('LoginComponent (pipeline runner characterization)', () => {
  let component: LoginComponent;
  let store: Store<RootState>;
  let transcriptionServiceMock: {
    transcribe: jest.Mock<any>;
    cancel: jest.Mock<any>;
  };
  let diarizationServiceMock: {
    diarize: jest.Mock<any>;
    cancel: jest.Mock<any>;
  };
  let translationServiceMock: {
    translate: jest.Mock<any>;
    cancel: jest.Mock<any>;
  };
  let authStoreService: {
    loginLocal: jest.Mock<any>;
    loginOnline: jest.Mock<any>;
    loginDemo: jest.Mock<any>;
  };
  let audioService: { registerAudioManager: jest.Mock<any> };
  let recordedFileService: {
    recordedFile: File | undefined;
    clear: jest.Mock<any>;
  };
  let translocoTranslate: jest.Mock<any>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    transcriptionServiceMock = { transcribe: jest.fn(), cancel: jest.fn() };
    diarizationServiceMock = { diarize: jest.fn(), cancel: jest.fn() };
    translationServiceMock = { translate: jest.fn(), cancel: jest.fn() };
    authStoreService = {
      loginLocal: jest.fn(),
      loginOnline: jest.fn(),
      loginDemo: jest.fn(),
    };
    audioService = { registerAudioManager: jest.fn() };
    recordedFileService = { recordedFile: undefined, clear: jest.fn() };
    translocoTranslate = jest.fn(
      (key: string, params?: Record<string, unknown>) =>
        `${key}::${JSON.stringify(params ?? {})}`,
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: TranslocoService,
          useValue: { translate: translocoTranslate },
        },
        // Real Store + real pipeline reducer (wrapped with one test-local
        // escape-hatch action — see testPipelineReducer above): dispatches
        // made by login.component.ts must flow through the ACTUAL reducer
        // so this suite proves the wiring works end to end, not just that
        // the right actions were constructed.
        provideStore({ pipeline: testPipelineReducer }),
      ],
    });
    store = TestBed.inject(Store) as Store<RootState>;

    // PipelineRunnerService is constructed directly (real class, mocked leaf
    // services + TranslocoService injected via plain constructor args — no
    // TestBed/DI needed) so that every assertion below that targets
    // transcriptionServiceMock/diarizationServiceMock/translationServiceMock
    // still observes the exact same calls it did before the extraction: the
    // injection POINT moved (LoginComponent now depends on
    // PipelineRunnerService instead of the three services directly), but the
    // real orchestration still runs against these same three mocks under the
    // hood, so this file's assertions describing what login.component.ts
    // does are unmodified.
    const pipelineRunnerService = new PipelineRunnerService(
      transcriptionServiceMock as any,
      diarizationServiceMock as any,
      translationServiceMock as any,
      { translate: translocoTranslate } as any,
    );

    // TestBed.runInInjectionContext() is no longer required for
    // LoginComponent's own construction (it no longer has an
    // `inject(TranslocoService)` field initializer — that call moved into
    // PipelineRunnerService above, which receives TranslocoService as a
    // plain constructor argument instead), but is kept here since it's
    // harmless and avoids a larger diff. Every constructor dependency is
    // passed positionally below, matching LoginComponent's real constructor
    // parameter order exactly (Task 4 added `store: Store<RootState>` right
    // after `pipelineRunnerService`).
    component = TestBed.runInInjectionContext(
      () =>
        new LoginComponent(
          { nativeElement: { scroll: jest.fn() } } as unknown as ElementRef,
          {} as any, // appStorage
          {} as any, // api (OctraAPIService)
          {
            appSettings: { tratt: { supportEmail: 'support@example.com' } },
          } as any, // settingsService
          audioService as any,
          authStoreService as any,
          { testCompability: jest.fn(async () => true) } as any, // compatibilityService
          pipelineRunnerService,
          store,
          { snapshot: { data: {} } } as any, // route
          recordedFileService as any,
        ),
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  // ---------------------------------------------------------------------
  // Sequencing: transcription-only (no diarization, no translation)
  // ---------------------------------------------------------------------
  describe('transcription-only sequencing', () => {
    it('runs download-progress -> transcribe-start -> segment-progress -> result and finalizes via loginLocal, with no diarization/translation involved', async () => {
      const opts = makeTranscriptionOptions();
      const dropzone = makeDropzoneStub({
        transcribeOptions: opts,
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      // Finding: onOfflineSubmit's `removeData` argument is stashed into
      // `_pendingRemoveData` but that field is never read anywhere else in
      // login.component.ts. Every pipeline finalization path
      // (handleCompletedTranscription's transcription-only branch, and
      // onTranslationEvent's 'result' branch) calls
      // `this.proceedWithLogin(false)` with a HARDCODED `false`, not
      // `_pendingRemoveData`. Passing `true` here deliberately, to prove
      // today's actual (surprising) behavior: it is silently ignored for
      // any submit that goes through transcription or translation.
      component.onOfflineSubmit(true);

      expect(transcriptionServiceMock.transcribe).toHaveBeenCalledWith(
        dropzone.audioManager,
        dropzone.oaudiofile,
        opts,
      );

      // First event on this run — the leading edge of a fresh throttle
      // window, so it reaches the store synchronously; no flush needed yet.
      subject.next({
        type: 'download-progress',
        loaded: 10,
        total: 100,
        file: 'model.bin',
      });
      expect(component.transcription().phase).toBe('downloading');
      expect(component.transcription().downloadLoaded).toBe(10);
      expect(component.transcription().downloadTotal).toBe(100);
      expect(component.transcription().downloadFile).toBe('model.bin');

      flushPipelineThrottle();
      subject.next({ type: 'transcribe-start', audioDurationS: 12 });
      expect(component.transcription().phase).toBe('transcribing');
      expect(component.transcription().audioDurationS).toBe(12);
      // elapsedMs is now a LOCAL, unthrottled field (Global Constraint —
      // elapsed-time ticking never goes through the store).
      expect(component.transcriptionElapsedMs).toBe(0);

      flushPipelineThrottle();
      subject.next({ type: 'segment-progress', segmentEndS: 5 });
      expect(component.transcription().segmentEndS).toBe(5);

      flushPipelineThrottle();
      const annotJson = makeAnnotJsonWithSegments();
      subject.next({ type: 'result', annotJson });
      // phase flips to 'finalizing' synchronously (this is the leading edge
      // of a fresh throttle window, thanks to the flush above), before the
      // async handleCompletedTranscription() work below has had a chance to
      // run.
      expect(component.transcription().phase).toBe('finalizing');

      // Fully closes this window (it collapsed TWO events — 'result' itself,
      // plus the synchronous 'diarization skipped' that immediately follows
      // it — so it needs the full two-advance idle guarantee, not just a
      // delivery flush) BEFORE the async finalized/pipeline-result cascade
      // fires (both synchronous with each other, inside the awaited
      // microtask flush below) — so that cascade starts fresh, and its
      // 'transcription finalized' action (which flips `.active` to false)
      // lands as its own leading edge rather than being silently
      // superseded, within the same throttle window, by the 'pipeline
      // result' action that immediately follows it.
      flushPipelineThrottleFully();
      await flushMicrotasks();

      expect(diarizationServiceMock.diarize).not.toHaveBeenCalled();
      expect(translationServiceMock.translate).not.toHaveBeenCalled();
      expect(component.diarizationWarning()).toBeNull();
      expect(component.transcription().active).toBe(false);
      expect(dropzone.setAnnotationFromAnnotJson).toHaveBeenCalledWith(
        annotJson,
      );
      expect(audioService.registerAudioManager).toHaveBeenCalled();
      expect(authStoreService.loginLocal).toHaveBeenCalledTimes(1);
      const [files, annotationArg, removeDataArg] =
        authStoreService.loginLocal.mock.calls[0];
      expect(files).toEqual([dropzone.files[0].file.file]);
      // dropzone.hasAnnotation is false in this stub, so the annotation arg
      // is undefined regardless of the diarized/undiarized annotJson.
      expect(annotationArg).toBeUndefined();
      // The hardcoded-false finding above, made explicit.
      expect(removeDataArg).toBe(false);
    });

    it('sets transcription.error and stops without finalizing when the transcribe() observable errors', () => {
      const opts = makeTranscriptionOptions();
      const dropzone = makeDropzoneStub({
        transcribeOptions: opts,
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      component.onOfflineSubmit(false);
      subject.error(new Error('worker crashed'));

      // Errors are delivered via the Observable's error() channel, not
      // next(), so PipelineActions.error is dispatched directly, unthrottled
      // — no flush needed.
      expect(component.transcription().error).toBe('worker crashed');
      expect(component.transcription().active).toBe(false);
      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Diarization success path
  // ---------------------------------------------------------------------
  describe('diarization success path', () => {
    it('keeps diarizationWarning null and finalizes with the diarized annotation when diarization succeeds', async () => {
      const opts = makeTranscriptionOptions({
        diarization: { modelId: 'diar-model', useWebGPU: false },
      });
      const dropzone = makeDropzoneStub({
        transcribeOptions: opts,
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const diarizationSubject = new Subject<DiarizationEvent>();
      diarizationServiceMock.diarize.mockReturnValue(diarizationSubject);

      component.onOfflineSubmit(false);
      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      // This window collapsed TWO events — 'result' (leading) and the
      // synchronous 'diarization started' that immediately follows it
      // inside the same JS tick (held/trailing) — so it needs the full
      // two-advance idle guarantee: one to deliver 'diarization started',
      // a second so the window is genuinely idle again before
      // diarizationSubject.next() below fires its own event.
      flushPipelineThrottleFully();
      await flushMicrotasks();

      expect(diarizationServiceMock.diarize).toHaveBeenCalledWith(
        dropzone.audioManager,
        opts.diarization,
      );
      expect(component.transcription().phase).toBe('diarizing');

      diarizationSubject.next({
        type: 'result',
        turns: [
          { startS: 0, endS: 0.9, speakerId: 'SPEAKER_00' },
          { startS: 0.9, endS: 2.0, speakerId: 'SPEAKER_01' },
        ],
      });
      // Same reasoning as above: close this window before the
      // finalized/pipeline-result cascade fires, so 'transcription
      // finalized' (which flips `.active`) lands as its own leading edge.
      flushPipelineThrottle();
      await flushMicrotasks();

      expect(component.diarizationWarning()).toBeNull();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(component.transcription().active).toBe(false);
      expect(dropzone.setAnnotationFromAnnotJson).toHaveBeenCalledTimes(1);
      const finalizedAnnotJson = dropzone.setAnnotationFromAnnotJson.mock
        .calls[0][0] as OAnnotJSON;
      // Proves the real applySpeakerTurnsToAnnotJson() integration actually ran and
      // mutated the annotation with the diarized speaker turns, not just that
      // *some* object was passed through.
      const level = finalizedAnnotJson.levels[0] as OSegmentLevel<OSegment>;
      expect(
        level.items[0].labels.find((l) => l.name === 'Speaker')?.value,
      ).toBe('Speaker 1');
      expect(
        level.items[1].labels.find((l) => l.name === 'Speaker')?.value,
      ).toBe('Speaker 2');
      expect(authStoreService.loginLocal).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // Diarization graceful-degradation path
  // ---------------------------------------------------------------------
  describe('diarization graceful-degradation path', () => {
    it('sets diarizationWarning, logs console.error, and still finalizes with the ORIGINAL (non-diarized) annotation when diarization errors', async () => {
      const opts = makeTranscriptionOptions({
        diarization: { modelId: 'diar-model', useWebGPU: false },
      });
      const dropzone = makeDropzoneStub({
        transcribeOptions: opts,
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const diarizationSubject = new Subject<DiarizationEvent>();
      diarizationServiceMock.diarize.mockReturnValue(diarizationSubject);

      component.onOfflineSubmit(false);
      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      await flushMicrotasks();

      diarizationSubject.error(new Error('diarization worker crashed'));
      // Fully closes the still-open window from the 'result'/'diarization
      // started' pair above (2 events collapsed — needs the full
      // two-advance idle guarantee), so the finalized/pipeline-result
      // cascade that fires once this microtask flush resumes starts fresh —
      // 'transcription finalized' (setting diarizationWarning + `.active`)
      // becomes its own leading edge instead of being dropped in favor of
      // the 'pipeline result' action right behind it.
      flushPipelineThrottleFully();
      await flushMicrotasks();

      expect(translocoTranslate).toHaveBeenCalledWith(
        'login.auto-transcription.diarization failed',
        { message: 'diarization worker crashed' },
      );
      expect(component.diarizationWarning()).toBe(
        translocoTranslate.mock.results[0].value,
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[diarization]',
        component.diarizationWarning(),
      );
      // Critical: the pipeline does NOT abort — it still finalizes with the
      // original, undiarized annotJson (same reference: applyOptionalSpeakerSegmentation's
      // catch branch returns `{ annotJson: args.annotJson, ... }` unchanged).
      expect(component.transcription().active).toBe(false);
      expect(dropzone.setAnnotationFromAnnotJson).toHaveBeenCalledWith(
        annotJson,
      );
      expect(authStoreService.loginLocal).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // Transcription -> translation chaining
  // ---------------------------------------------------------------------
  describe('transcription -> translation chaining', () => {
    it('automatically starts translation with the (possibly diarized) annotation once transcription completes, with no second user action', async () => {
      const transcribeOpts = makeTranscriptionOptions();
      const translateOpts = { sourceLanguage: 'en', targetLanguage: 'sv' };
      const dropzone = makeDropzoneStub({
        transcribeOptions: transcribeOpts,
        hasAudio: true,
        translateOptions: translateOpts,
      });
      component.dropzone = dropzone as any;
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const translationSubject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(translationSubject);

      component.onOfflineSubmit(false);
      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      await flushMicrotasks();
      // The cascade fired by the microtask flush above ends with
      // '{stage:"translation", type:"start"}' — the LAST event in that
      // burst, so the throttle's trailing guarantee (Task 3's own tested
      // property) is exactly what's needed here: one flush delivers it.
      flushPipelineThrottle();

      // Auto-triggered — no further call from the test into _startTranslation.
      expect(translationServiceMock.translate).toHaveBeenCalledTimes(1);
      expect(translationServiceMock.translate).toHaveBeenCalledWith(
        annotJson,
        translateOpts,
      );
      expect(component.translation().active).toBe(true);
      // proceedWithLogin/loginLocal must NOT have fired yet — translation owns
      // finalization now.
      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Regression (found in review of this task's first pass): on the
  // skipped-diarization -> chained-translation path, PipelineRunnerService
  // emits '{stage:"diarization",type:"skipped"}' -> transcriptionFinalized
  // -> '{stage:"translation",type:"start"}' synchronously, back to back, in
  // the SAME JS tick. Under a naive "throttle the whole mapped-action
  // stream" pipe, throttleTime's trailing-only-keeps-the-LAST-value
  // semantics silently dropped `transcriptionFinalized` (the action that
  // flips `transcription.active` to `false`) in favor of the
  // `translationStart` action right behind it. `transcription.active` then
  // stayed stuck `true` for the rest of the run. Because
  // `PipelineActions.error`'s reducer case checks `transcription.active`
  // BEFORE `translation.active`, a LATER translation error got misrouted
  // into the transcription slice instead of the translation slice — the
  // translation panel just spun forever with no visible error message.
  // Fixed by dispatching every discrete state-transition/terminal action
  // (dispatchPipelineActions()/isThrottleSafeProgressAction() in
  // pipeline-event-mapping.ts) unthrottled, reserving throttling for pure
  // download-progress/segment-progress ticks only.
  // ---------------------------------------------------------------------
  describe('regression: transcriptionFinalized must survive the skipped-diarization -> chained-translation burst', () => {
    it('leaves transcription.active false (not stuck true) and routes a later translation error into translation.error, not transcription.error', async () => {
      const transcribeOpts = makeTranscriptionOptions(); // diarization OFF
      const translateOpts = { sourceLanguage: 'en', targetLanguage: 'sv' };
      const dropzone = makeDropzoneStub({
        transcribeOptions: transcribeOpts,
        hasAudio: true,
        translateOptions: translateOpts,
      });
      component.dropzone = dropzone as any;
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const translationSubject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(translationSubject);

      component.onOfflineSubmit(false);
      const annotJson = makeAnnotJsonWithSegments();
      // Fires the exact synchronous burst described above: inner
      // transcription 'result' -> diarization 'skipped' -> (await) ->
      // transcriptionFinalized -> translation 'start', all inside this one
      // next() + microtask flush, with NO jest.advanceTimersByTime() in
      // between — this is deliberately the worst case (everything lands in
      // a single throttle window) that the bug required.
      transcriptionSubject.next({ type: 'result', annotJson });
      await flushMicrotasks();

      // The actual regression: transcription.active must be false (was
      // stuck `true` pre-fix) and translation.active must be true — no
      // flush needed for either, since both dispatch immediately now.
      expect(component.transcription().active).toBe(false);
      expect(component.translation().active).toBe(true);

      translationSubject.error(new Error('translation blew up'));

      // The user-visible consequence of the bug: the error must land in
      // the TRANSLATION slice (transcription.active being falsely `true`
      // used to route it into the transcription slice instead, where
      // nothing in the UI ever displayed it).
      expect(component.translation().error).toBe('translation blew up');
      expect(component.translation().active).toBe(false);
      expect(component.transcription().error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Regression: diarizationWarning must be visible for the WHOLE translation
  // phase on the chained path, not just delivered at the very end
  // ---------------------------------------------------------------------
  describe('diarization failure while chaining to translation', () => {
    it('sets diarizationWarning BEFORE translation events start arriving, not just after the pipeline finally resolves', async () => {
      const transcribeOpts = makeTranscriptionOptions({
        diarization: { modelId: 'diar-model', useWebGPU: false },
      });
      const translateOpts = { sourceLanguage: 'en', targetLanguage: 'sv' };
      const dropzone = makeDropzoneStub({
        transcribeOptions: transcribeOpts,
        hasAudio: true,
        translateOptions: translateOpts,
      });
      component.dropzone = dropzone as any;
      const transcriptionSubject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(transcriptionSubject);
      const diarizationSubject = new Subject<DiarizationEvent>();
      diarizationServiceMock.diarize.mockReturnValue(diarizationSubject);
      const translationSubject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(translationSubject);

      component.onOfflineSubmit(false);
      const annotJson = makeAnnotJsonWithSegments();
      transcriptionSubject.next({ type: 'result', annotJson });
      await flushMicrotasks();

      diarizationSubject.error(new Error('diarization worker crashed'));
      // Fully close the still-open window from 'result'/'diarization
      // started' (2 events collapsed — needs the full two-advance idle
      // guarantee) so 'transcription finalized' (sets diarizationWarning)
      // becomes a fresh leading edge of its own, rather than being dropped
      // in favor of the '{stage:"translation", type:"start"}' event that
      // follows it synchronously in the same continuation.
      flushPipelineThrottleFully();
      await flushMicrotasks();
      // Flush again (delivery-only suffices here) so the trailing
      // '{stage:"translation", type:"start"}' — held by the window
      // 'transcription finalized' just opened — reaches the store too.
      flushPipelineThrottle();

      // Translation has been kicked off (proving we're on the chained path,
      // well before the pipeline's terminal result)...
      expect(translationServiceMock.translate).toHaveBeenCalledTimes(1);
      expect(component.translation().active).toBe(true);
      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
      // ...and the warning is ALREADY visible, not withheld until the
      // pipeline finally resolves minutes later.
      expect(component.diarizationWarning()).toBe(
        translocoTranslate.mock.results[0].value,
      );

      // Still visible once translation actually starts progressing (proves
      // nothing later in the translation phase clobbers it back to null).
      translationSubject.next({ type: 'model-init' });
      expect(component.diarizationWarning()).toBe(
        translocoTranslate.mock.results[0].value,
      );
    });
  });

  // ---------------------------------------------------------------------
  // Translation stall timers
  // ---------------------------------------------------------------------
  describe('translation stall timers', () => {
    function startTranslationOnly(
      translationSubject: Subject<TranslationEvent>,
    ) {
      const annotJson = makeAnnotJsonWithSegments();
      const dropzone = makeDropzoneStub({
        translateOptions: { sourceLanguage: 'en', targetLanguage: 'sv' },
        hasAnnotation: true,
        oannotation: annotJson,
      });
      component.dropzone = dropzone as any;
      translationServiceMock.translate.mockReturnValue(translationSubject);
      component.onOfflineSubmit(false);
      return dropzone;
    }

    it('sets the exact download-stall message at exactly 30000ms of silence, and does NOT auto-cancel (active stays true)', () => {
      const subject = new Subject<TranslationEvent>();
      startTranslationOnly(subject);

      // '{stage:"translation", type:"start"}' is the very first (and only)
      // event so far — the leading edge of a fresh window — so this is
      // already visible synchronously, no flush needed.
      expect(component.translation().phase).toBe('downloading');
      expect(component.translation().active).toBe(true);

      jest.advanceTimersByTime(TRANSLATION_DOWNLOAD_STALL_MS - 1);
      expect(component.translation().error).toBeNull();

      jest.advanceTimersByTime(1);
      // The stall message itself arrives via the SERVICE's own internal
      // setTimeout (entirely independent of any test-driven event), well
      // after any earlier throttle window has long since auto-closed, so it
      // lands as a fresh leading edge — synchronous, no flush needed.
      expect(component.translation().error).toBe(
        'Download stalled — likely a browser storage limit. Cancel and retry with "Skip browser cache" enabled.',
      );
      expect(component.translation().active).toBe(true);
    });

    it('sets the exact init/translating-stall message at exactly 60000ms of silence once past the download phase', () => {
      const subject = new Subject<TranslationEvent>();
      startTranslationOnly(subject);

      // Advance the phase to 'initializing' before the 30s download budget
      // would fire, which also re-arms the stall timer with the 60s budget.
      subject.next({ type: 'model-init' });
      // 'model-init' is a discrete phase-transition action — it bypasses
      // the throttle entirely (see isThrottleSafeProgressAction()), so it's
      // visible promptly, right here, not merely "eventually" once the
      // stall-timing advance below happens to flush it.
      expect(component.translation().phase).toBe('initializing');

      jest.advanceTimersByTime(TRANSLATION_INIT_STALL_MS - 1);
      expect(component.translation().error).toBeNull();

      jest.advanceTimersByTime(1);
      expect(component.translation().error).toBe(
        'Model load stalled. Try refreshing the page.',
      );
      expect(component.translation().active).toBe(true);
    });

    it('re-arms the stall timer on every non-result event, so a late progress event resets the budget instead of letting the original timer fire', () => {
      const subject = new Subject<TranslationEvent>();
      startTranslationOnly(subject);

      jest.advanceTimersByTime(TRANSLATION_DOWNLOAD_STALL_MS - 1);
      expect(component.translation().error).toBeNull();

      // Arrives just before the original 30s budget would have fired. The
      // stall-timer re-arm this triggers is entirely internal to
      // PipelineRunnerService (independent of the component's throttled
      // store dispatch), so it re-arms regardless of when its OWN mapped
      // action happens to reach the store.
      subject.next({
        type: 'download-progress',
        loaded: 1,
        total: 2,
        file: 'x',
      });

      // If the timer had NOT been re-armed, the original timer (now 1ms from
      // firing) would fire almost immediately. Advancing this far again
      // proves it did not: the re-armed timer only starts counting from the
      // progress event above. This advance is also, incidentally, more than
      // enough to flush the progress event's own throttled dispatch — not
      // that this test reads it.
      jest.advanceTimersByTime(TRANSLATION_DOWNLOAD_STALL_MS - 1);
      expect(component.translation().error).toBeNull();

      jest.advanceTimersByTime(1);
      expect(component.translation().error).toBe(
        'Download stalled — likely a browser storage limit. Cancel and retry with "Skip browser cache" enabled.',
      );
    });

    it('uses the translating-phase stall message once translate-start has fired', () => {
      const subject = new Subject<TranslationEvent>();
      startTranslationOnly(subject);

      subject.next({ type: 'model-init' });
      subject.next({ type: 'translate-start', total: 4 });
      // Both 'model-init' and 'translate-start' are discrete phase-
      // transition actions — bypass the throttle entirely, visible
      // promptly right here.
      expect(component.translation().phase).toBe('translating');

      jest.advanceTimersByTime(TRANSLATION_INIT_STALL_MS);
      expect(component.translation().error).toBe(
        'Translation stalled — no progress for 60 seconds. Cancel and retry.',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Elapsed-time intervals
  // ---------------------------------------------------------------------
  // elapsedMs is now a LOCAL, unthrottled component field (Global
  // Constraint: elapsed-time ticking never goes through the store — a
  // setInterval writing into NgRx every second forever is exactly the
  // reducer-flooding problem dispatchPipelineActions() exists to prevent). None of
  // these tests touch the store at all, so none of them need throttle
  // flushes — only the field-access syntax changed
  // (`component.transcription.elapsedMs` -> `component.transcriptionElapsedMs`).
  describe('elapsed-time intervals', () => {
    it('ticks transcriptionElapsedMs in 1000ms increments after transcribe-start, and stops ticking once result fires', async () => {
      const opts = makeTranscriptionOptions();
      const dropzone = makeDropzoneStub({
        transcribeOptions: opts,
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      component.onOfflineSubmit(false);
      subject.next({ type: 'transcribe-start', audioDurationS: 10 });
      expect(component.transcriptionElapsedMs).toBe(0);

      jest.advanceTimersByTime(1000);
      expect(component.transcriptionElapsedMs).toBe(1000);
      jest.advanceTimersByTime(1000);
      expect(component.transcriptionElapsedMs).toBe(2000);

      const annotJson = makeAnnotJsonWithSegments();
      subject.next({ type: 'result', annotJson });
      await flushMicrotasks();

      const frozenValue = component.transcriptionElapsedMs;
      jest.advanceTimersByTime(5000);
      expect(component.transcriptionElapsedMs).toBe(frozenValue);
    });

    it('stops ticking transcriptionElapsedMs once the observable errors', () => {
      const opts = makeTranscriptionOptions();
      const dropzone = makeDropzoneStub({
        transcribeOptions: opts,
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      component.onOfflineSubmit(false);
      subject.next({ type: 'transcribe-start', audioDurationS: 10 });
      jest.advanceTimersByTime(1000);
      expect(component.transcriptionElapsedMs).toBe(1000);

      subject.error(new Error('boom'));
      const frozenValue = component.transcriptionElapsedMs;
      jest.advanceTimersByTime(5000);
      expect(component.transcriptionElapsedMs).toBe(frozenValue);
    });

    it('stops ticking transcriptionElapsedMs once cancelTranscription() is called', () => {
      const opts = makeTranscriptionOptions();
      const dropzone = makeDropzoneStub({
        transcribeOptions: opts,
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      const subject = new Subject<TranscriptionEvent>();
      transcriptionServiceMock.transcribe.mockReturnValue(subject);

      component.onOfflineSubmit(false);
      subject.next({ type: 'transcribe-start', audioDurationS: 10 });
      jest.advanceTimersByTime(1000);
      expect(component.transcriptionElapsedMs).toBe(1000);

      component.cancelTranscription();
      const frozenValue = component.transcriptionElapsedMs;
      jest.advanceTimersByTime(5000);
      expect(component.transcriptionElapsedMs).toBe(frozenValue);
    });

    it('ticks translationElapsedMs in 1000ms increments after translate-start, and stops ticking once result fires', async () => {
      const annotJson = makeAnnotJsonWithSegments();
      const dropzone = makeDropzoneStub({
        translateOptions: { sourceLanguage: 'en', targetLanguage: 'sv' },
        hasAnnotation: true,
        oannotation: annotJson,
      });
      component.dropzone = dropzone as any;
      const subject = new Subject<TranslationEvent>();
      translationServiceMock.translate.mockReturnValue(subject);

      component.onOfflineSubmit(false);
      subject.next({ type: 'model-init' });
      subject.next({ type: 'translate-start', total: 4 });
      expect(component.translationElapsedMs).toBe(0);

      jest.advanceTimersByTime(1000);
      expect(component.translationElapsedMs).toBe(1000);
      jest.advanceTimersByTime(1000);
      expect(component.translationElapsedMs).toBe(2000);

      subject.next({ type: 'result', annotJson });
      await flushMicrotasks();

      const frozenValue = component.translationElapsedMs;
      jest.advanceTimersByTime(5000);
      expect(component.translationElapsedMs).toBe(frozenValue);
    });
  });

  // ---------------------------------------------------------------------
  // Cancel asymmetry
  // ---------------------------------------------------------------------
  describe('cancel asymmetry', () => {
    // Setup note (PipelineRunnerService.cancel() is now stage-aware, decided
    // by ITS OWN tracked active-stage state rather than by which
    // component-level method the caller invoked): these two tests used to
    // call cancelTranscription()/cancelTranslation() directly on a fresh
    // component with no pipeline ever started, relying on each method
    // unconditionally reaching into its own two/one specific services
    // regardless of any active state. That degenerate "cancel with nothing
    // running" case is not reachable from the real UI (dismiss*Error() —
    // the only real caller of these two methods — is itself gated behind
    // `.active`), and it cannot be reproduced by a single state-derived
    // cancel() no matter which stage-cancellation logic it holds, since the
    // internal state is identical (idle) in both cases yet the two tests
    // require different outcomes purely from the method name called. So
    // this setup now starts a real, still-open pipeline for the relevant
    // stage first, matching how these methods are actually reached in
    // production — the ASSERTED behavior (which services get cancelled, and
    // the resulting active/phase fields) is unchanged. `cancelTranscription()`/
    // `cancelTranslation()` dispatch their `*Cancelled` action directly
    // (unthrottled), so no flush is needed here either.
    it('cancelTranscription() cancels BOTH the transcription and diarization services', () => {
      const dropzone = makeDropzoneStub({
        transcribeOptions: makeTranscriptionOptions(),
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      transcriptionServiceMock.transcribe.mockReturnValue(
        new Subject<TranscriptionEvent>(),
      );
      component.onOfflineSubmit(false);

      component.cancelTranscription();

      expect(transcriptionServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(diarizationServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(translationServiceMock.cancel).not.toHaveBeenCalled();
      expect(component.transcription().active).toBe(false);
      expect(component.transcription().phase).toBe('idle');
    });

    it('cancelTranslation() cancels ONLY the translation service (not transcription, not diarization)', () => {
      const dropzone = makeDropzoneStub({
        translateOptions: { sourceLanguage: 'en', targetLanguage: 'sv' },
        hasAnnotation: true,
        oannotation: makeAnnotJsonWithSegments(),
      });
      component.dropzone = dropzone as any;
      translationServiceMock.translate.mockReturnValue(
        new Subject<TranslationEvent>(),
      );
      component.onOfflineSubmit(false);

      component.cancelTranslation();

      expect(translationServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(transcriptionServiceMock.cancel).not.toHaveBeenCalled();
      expect(diarizationServiceMock.cancel).not.toHaveBeenCalled();
      expect(component.translation().active).toBe(false);
      expect(component.translation().phase).toBe('idle');
    });
  });

  // ---------------------------------------------------------------------
  // Dismiss-error branching
  // ---------------------------------------------------------------------
  describe('dismiss-error branching', () => {
    it('dismissTranscriptionError() routes through cancelTranscription() when active is true (and leaves .error UNCHANGED — cancelTranscription() never touches it)', () => {
      // See the "cancel asymmetry" describe block above for why this setup
      // now starts a real, still-open transcription run rather than just
      // setting `.active = true` by hand: PipelineRunnerService.cancel() is
      // stage-aware from its OWN tracked state, so it needs a genuinely
      // active stage to route the cancel call correctly. The asserted
      // behavior below is unchanged.
      //
      // `.error` is set here via the TEST_FORCE_TRANSCRIPTION_ERROR escape
      // hatch (see testPipelineReducer above), not a real PipelineAction:
      // the real reducer can never produce `active:true` + a non-null
      // `.error` together (nor could the pre-extraction component — see
      // that helper's comment), so this stays exactly what it always was —
      // a white-box injection isolating this method's branching from how
      // `.error` gets populated in practice.
      const dropzone = makeDropzoneStub({
        transcribeOptions: makeTranscriptionOptions(),
        hasAudio: true,
      });
      component.dropzone = dropzone as any;
      transcriptionServiceMock.transcribe.mockReturnValue(
        new Subject<TranscriptionEvent>(),
      );
      component.onOfflineSubmit(false);
      store.dispatch({
        type: TEST_FORCE_TRANSCRIPTION_ERROR,
        message: 'some error',
      });

      component.dismissTranscriptionError();

      expect(transcriptionServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(diarizationServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(component.transcription().active).toBe(false);
      expect(component.transcription().phase).toBe('idle');
      // Surprising-but-real: dismiss while active does NOT clear the error
      // field itself; only the inactive branch below does that.
      expect(component.transcription().error).toBe('some error');
    });

    it('dismissTranscriptionError() just clears .error and touches no services when active is false', () => {
      // Reached via two REAL PipelineActions this time (no escape hatch
      // needed): `error` is exactly how a real, non-null `.error` combines
      // with `active:false` in production.
      store.dispatch(
        PipelineActions.transcriptionStart({
          downloadExpectedBytes: 0,
          usedWebGPU: false,
        }),
      );
      store.dispatch(PipelineActions.error({ message: 'some error' }));

      component.dismissTranscriptionError();

      expect(transcriptionServiceMock.cancel).not.toHaveBeenCalled();
      expect(diarizationServiceMock.cancel).not.toHaveBeenCalled();
      expect(component.transcription().error).toBeNull();
    });

    it('dismissTranslationError() routes through cancelTranslation() when active is true (and leaves .error UNCHANGED)', () => {
      // See the "cancel asymmetry" describe block above for why this setup
      // starts a real, still-open translation run rather than just setting
      // `.active = true` by hand. The asserted behavior below is unchanged.
      //
      // Unlike transcription, `.error` here is set via a REAL action
      // (PipelineActions.stalled) that legitimately pairs a non-null
      // `.error` with `active` staying true — mirrors today's pipeline
      // 'stalled' handling, which likewise only ever wrote `.error`.
      const dropzone = makeDropzoneStub({
        translateOptions: { sourceLanguage: 'en', targetLanguage: 'sv' },
        hasAnnotation: true,
        oannotation: makeAnnotJsonWithSegments(),
      });
      component.dropzone = dropzone as any;
      translationServiceMock.translate.mockReturnValue(
        new Subject<TranslationEvent>(),
      );
      component.onOfflineSubmit(false);
      store.dispatch(
        PipelineActions.stalled({
          phase: 'downloading',
          message: 'some translation error',
        }),
      );

      component.dismissTranslationError();

      expect(translationServiceMock.cancel).toHaveBeenCalledTimes(1);
      expect(component.translation().active).toBe(false);
      expect(component.translation().phase).toBe('idle');
      expect(component.translation().error).toBe('some translation error');
    });

    it('dismissTranslationError() just clears .error and touches no services when active is false', () => {
      store.dispatch(PipelineActions.translationStart());
      store.dispatch(
        PipelineActions.error({ message: 'some translation error' }),
      );

      component.dismissTranslationError();

      expect(translationServiceMock.cancel).not.toHaveBeenCalled();
      expect(component.translation().error).toBeNull();
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Same workaround as pipeline-runner.service.spec.ts: these two services
// construct their Worker via `new URL('...', import.meta.url)` at module
// scope, which ts-jest's CommonJS config cannot compile. This spec never
// touches the real classes — PipelineRunnerService itself is replaced by a
// mock below.
jest.mock('./local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('./local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { provideStore, Store } from '@ngrx/store';
import { OAnnotJSON, TrattAnnotation } from '@tratt/annotation';
import { Subject } from 'rxjs';
import { LoginMode, RootState } from '../../store/index';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { PipelineQueueActions } from '../../store/pipeline-queue/pipeline-queue.actions';
import { reducer as pipelineQueueReducer } from '../../store/pipeline-queue/pipeline-queue.reducer';
import { selectPipelineQueueFeature } from '../../store/pipeline-queue/pipeline-queue.selectors';
import { AudioService } from './audio.service';
import { PipelineQueueService } from './pipeline-queue.service';
import type { PipelineEvent } from './pipeline-runner.service';
import { PipelineRunnerService } from './pipeline-runner.service';

const LOCAL_MODE_STATE = {
  bundles: {
    ids: ['a', 'b', 'c'],
    entities: {
      a: {
        bundleId: 'a',
        audio: { loaded: true },
        sessionFile: { name: 'a.wav' },
      },
      b: {
        bundleId: 'b',
        audio: { loaded: false },
        sessionFile: { name: 'b.wav' },
      },
      c: {
        bundleId: 'c',
        audio: { loaded: true },
        sessionFile: { name: 'c.wav' },
        // Otherwise fully eligible (media resident, not awaiting, idle run
        // state) but has non-empty annotation content — I4: enqueue() must
        // never offer this bundle to the runner, the spec's "never overwrite
        // annotation data" guarantee.
        transcript: {
          levels: [{ items: [{ labels: [{ name: 'L', value: 'hello' }] }] }],
        },
      },
    },
  },
  selectedBundleId: 'a',
};

function fakeManager() {
  return {
    resource: {
      getOAudioFile: () => ({ name: 'a.wav', sampleRate: 16000, duration: 1 }),
      info: { fullname: 'a.wav', sampleRate: 16000, duration: 1 },
    },
  } as any;
}

describe('PipelineQueueService', () => {
  let service: PipelineQueueService;
  let store: Store<RootState>;
  let runner: { run: jest.Mock<any>; cancel: jest.Mock<any> };
  let audio: {
    ensureResident: jest.Mock<any>;
    hasResident: jest.Mock<any>;
    canRestore: jest.Mock<any>;
    getManager: jest.Mock<any>;
    pin: jest.Mock<any>;
    unpin: jest.Mock<any>;
  };
  // Swappable so a test can change the bundles' content mid-run.
  let localModeState: any;
  let events: Subject<PipelineEvent>[];

  function queueState() {
    let value: any;
    store
      .select(selectPipelineQueueFeature)
      .subscribe((v) => (value = v))
      .unsubscribe();
    return value;
  }

  beforeEach(() => {
    events = [];
    runner = {
      run: jest.fn(() => {
        const subject = new Subject<PipelineEvent>();
        events.push(subject);
        return subject.asObservable();
      }),
      cancel: jest.fn(),
    };
    audio = {
      ensureResident: jest.fn(async () => true),
      hasResident: jest.fn(() => true),
      canRestore: jest.fn((id: string) => audio.hasResident(id)),
      getManager: jest.fn(() => fakeManager()),
      pin: jest.fn(),
      unpin: jest.fn(),
    };
    localModeState = LOCAL_MODE_STATE;

    TestBed.configureTestingModule({
      providers: [
        // A REAL store (not provideMockStore): the drain loop reads the
        // queue back immediately after dispatching into it, so the reducer
        // has to actually run.
        provideStore({
          pipelineQueue: pipelineQueueReducer,
          localMode: () => localModeState,
        }),
        { provide: PipelineRunnerService, useValue: runner },
        { provide: AudioService, useValue: audio },
        PipelineQueueService,
      ],
    });

    store = TestBed.inject(Store);
    service = TestBed.inject(PipelineQueueService);
    service.setTranscribeOptions({
      modelId: 'onnx-community/kb-whisper-tiny-ONNX',
      useWebGPU: false,
    });
  });

  it('runs exactly one bundle at a time and advances on success', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(queueState().activeId).toBe('a');
    expect(queueState().runs['b']).toEqual({ state: 'queued' });

    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    events[0].complete();
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({ state: 'done' });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(queueState().activeId).toBe('b');
  });

  it('isolates a failure: marks the bundle failed and keeps draining', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    events[0].error(new Error('WASM allocation failed'));
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({
      state: 'failed',
      error: { kind: 'oom', message: 'WASM allocation failed' },
    });
    expect(queueState().activeId).toBe('b');
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('fails a bundle whose audio cannot be made resident, without calling the runner', async () => {
    audio.ensureResident.mockResolvedValue(false as never);
    service.enqueue(['a']);
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a'].state).toBe('failed');
    expect(queueState().runs['a'].error.kind).toBe('decode');
  });

  it('fails a bundle whose audio holds no samples as a decode error, without calling the runner', async () => {
    audio.getManager.mockReturnValue({
      resource: {
        getOAudioFile: () => ({ name: 'a.wav', sampleRate: 16000 }),
        info: {
          fullname: 'a.wav',
          sampleRate: 16000,
          duration: { samples: 0, seconds: 0 },
        },
      },
    } as never);
    service.enqueue(['a']);
    await Promise.resolve();
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a'].state).toBe('failed');
    expect(queueState().runs['a'].error.kind).toBe('decode');
  });

  it('records a queue-initiated cancel as the cancelled error kind and continues', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    service.cancelActive();
    expect(runner.cancel).toHaveBeenCalledTimes(1);

    events[0].next({ stage: 'pipeline', type: 'cancelled' });
    events[0].complete();
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({
      state: 'failed',
      error: { kind: 'cancelled', message: 'Run cancelled.' },
    });
    expect(queueState().activeId).toBe('b');
  });

  it('stop() finishes the active bundle and does not start the next one', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    service.stop();
    expect(queueState().mode).toBe('pausing');

    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    events[0].complete();
    await Promise.resolve();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(queueState().mode).toBe('idle');
    expect(queueState().queue).toEqual([]);
    // Pending ids reset to idle, not queued, so a later "run" recomputes.
    expect(queueState().runs['b']).toEqual({ state: 'idle' });
  });

  it('applies the skip rule on enqueue but not on retry', async () => {
    store.dispatch(
      PipelineQueueActions.restoreInterrupted({
        entries: [
          { bundleId: 'a', state: 'done' },
          { bundleId: 'b', state: 'running' },
        ],
      }),
    );

    service.enqueue(['a', 'b']);
    await Promise.resolve();
    // 'a' is done (skipped); 'b' restored as 'interrupted' (eligible).
    expect(queueState().activeId).toBe('b');
    expect(runner.run).toHaveBeenCalledTimes(1);

    service.retry('a');
    await Promise.resolve();
    expect(queueState().runs['a']).toEqual({ state: 'queued' });
  });

  it('skips a bundle whose media is missing and not resident', async () => {
    audio.hasResident.mockReturnValue(false as never);
    service.enqueue(['b']); // b.audio.loaded === false
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().queue).toEqual([]);
  });

  // I4 (final whole-branch review): the "never overwrite annotation data"
  // guarantee must be exercised at the enqueue() seam itself, not only at
  // computeReadyBundleIds()'s own unit level — this is the seam the real
  // auto-enqueue path actually calls through.
  it('does not start a run for a bundle with hasAnnotationContent: true, even though otherwise eligible', async () => {
    service.enqueue(['c']); // c is resident, not awaiting, idle — but has annotation content
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().queue).toEqual([]);
  });

  it('dispatches bundle-scoped progress while a bundle runs', async () => {
    service.enqueue(['a']);
    await Promise.resolve();

    events[0].next({
      stage: 'transcription',
      event: { type: 'transcribe-start', audioDurationS: 40 },
    });
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({
      state: 'running',
      stage: 'asr',
      progress: 0,
    });
  });

  it('fails the active bundle when no transcription options are configured', async () => {
    service.setTranscribeOptions(null);
    service.enqueue(['a']);
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a'].state).toBe('failed');
    expect(queueState().runs['a'].error.kind).toBe('unknown');
  });

  // Regression tests for the "finalized reset too late" deadlock: every
  // failure-path test above enqueues a single bundle into a fresh service,
  // so the (now removed) shared `finalized` boolean was still at its field
  // default and the bug was invisible. These enqueue TWO bundles so the
  // second bundle's early-exit `fail()` runs after the first bundle has
  // already finalized once.
  it('fails two consecutive bundles on decode failure, without wedging the queue', async () => {
    audio.ensureResident.mockResolvedValue(false as never);
    service.enqueue(['a', 'b']);
    await Promise.resolve();
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a']).toEqual({
      state: 'failed',
      error: {
        kind: 'decode',
        message: 'Could not decode audio for this file.',
      },
    });
    expect(queueState().runs['b']).toEqual({
      state: 'failed',
      error: {
        kind: 'decode',
        message: 'Could not decode audio for this file.',
      },
    });
    expect(queueState().activeId).toBeNull();
    expect(queueState().mode).toBe('idle');
  });

  it('advances past a success into a decode failure on the next bundle', async () => {
    audio.ensureResident.mockImplementation(
      async (bundleId: unknown) => bundleId !== 'b',
    );
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    expect(runner.run).toHaveBeenCalledTimes(1);
    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    events[0].complete();
    await Promise.resolve();
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({ state: 'done' });
    expect(queueState().runs['b']).toEqual({
      state: 'failed',
      error: {
        kind: 'decode',
        message: 'Could not decode audio for this file.',
      },
    });
    expect(runner.run).toHaveBeenCalledTimes(1); // 'b' never reached the runner
    expect(queueState().activeId).toBeNull();
    expect(queueState().mode).toBe('idle');
  });

  it('fails both queued bundles when no transcription options are configured', async () => {
    service.setTranscribeOptions(null);
    service.enqueue(['a', 'b']);
    await Promise.resolve();
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a']).toEqual({
      state: 'failed',
      error: { kind: 'unknown', message: expect.any(String) },
    });
    expect(queueState().runs['b']).toEqual({
      state: 'failed',
      error: { kind: 'unknown', message: expect.any(String) },
    });
    expect(queueState().activeId).toBeNull();
    expect(queueState().mode).toBe('idle');
  });

  it('cancels a bundle whose residency check is still pending, and never starts the runner', async () => {
    let resolveResident!: (resident: boolean) => void;
    audio.ensureResident.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveResident = resolve;
        }),
    );

    service.enqueue(['a']);
    await Promise.resolve();
    expect(queueState().activeId).toBe('a');
    expect(runner.run).not.toHaveBeenCalled();

    service.cancelActive();
    expect(runner.cancel).toHaveBeenCalledTimes(1);

    resolveResident(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a']).toEqual({
      state: 'failed',
      error: { kind: 'cancelled', message: 'Run cancelled.' },
    });
    expect(queueState().activeId).toBeNull();
    expect(queueState().mode).toBe('idle');
  });

  it('writes the produced annotation back to the bundle that produced it', async () => {
    const dispatched: any[] = [];
    store.dispatch = ((action: any) => {
      dispatched.push(action);
      return Store.prototype.dispatch.call(store, action);
    }) as any;

    service.enqueue(['a']);
    await Promise.resolve();

    const annotJson = new OAnnotJSON('a.wav', 'a', 16000, []);
    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson,
      diarizationWarning: null,
    });
    await Promise.resolve();

    const write = dispatched.find(
      (a) => a.type === LoginModeActions.setBundleTranscript.type,
    );
    expect(write).toBeDefined();
    expect(write.bundleId).toBe('a');
    expect(write.mode).toBe(LoginMode.LOCAL);
    expect(write.transcript).toBeDefined();
  });

  // F3 (final whole-branch review fix wave): a 'result' event whose
  // annotJson fails to deserialize must fail the bundle, not mark it
  // 'done' — 'done' is excluded from both computeReadyBundleIds and the
  // per-row retry gate, so a silent deserialize miss previously stranded
  // the bundle with an empty transcript for the life of the profile.
  it('fails the bundle (not done) when the result event annotJson fails to deserialize', async () => {
    const deserializeSpy = jest
      .spyOn(TrattAnnotation, 'deserialize')
      .mockReturnValue(undefined as any);

    service.enqueue(['a']);
    await Promise.resolve();

    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    events[0].complete();
    await Promise.resolve();

    expect(queueState().runs['a'].state).toBe('failed');
    expect(queueState().runs['a'].error.kind).toBe('unknown');
    expect(queueState().activeId).toBeNull();
    expect(queueState().mode).toBe('idle');

    deserializeSpy.mockRestore();
  });

  it('pins the running bundle against LRU eviction and releases it afterwards', async () => {
    service.enqueue(['a']);
    await Promise.resolve();
    expect(audio.pin).toHaveBeenCalledWith('a');
    expect(audio.unpin).not.toHaveBeenCalled();

    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    await Promise.resolve();
    expect(audio.unpin).toHaveBeenCalledWith('a');
  });

  it('passes the configured translation options to the runner', async () => {
    const translateOptions = { targetLanguage: 'en' } as any;
    service.setTranslateOptions(translateOptions);
    service.enqueue(['a']);
    await Promise.resolve();
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ translateOptions }),
    );
  });

  it('runs transcription only when no translation is configured', async () => {
    service.enqueue(['a']);
    await Promise.resolve();
    expect(
      (runner.run.mock.calls[0][0] as any).translateOptions,
    ).toBeUndefined();
  });

  it('selects the first level of the produced transcript so editors can render it', async () => {
    const dispatched: any[] = [];
    store.dispatch = ((action: any) => {
      dispatched.push(action);
      return Store.prototype.dispatch.call(store, action);
    }) as any;
    service.enqueue(['a']);
    await Promise.resolve();

    const annotation = new TrattAnnotation();
    annotation.addLevel(annotation.createSegmentLevel('L1'));
    const annotJson = annotation.serialize('a.wav', 16000, {
      samples: 16000,
    } as any);
    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson,
      diarizationWarning: null,
    });
    await Promise.resolve();

    const write = dispatched.find(
      (a) => a.type === LoginModeActions.setBundleTranscript.type,
    );
    expect(write.transcript.selectedLevelIndex).toBe(0);
  });

  it('never overwrites a transcript the user edited while the bundle was running', async () => {
    const replaced: string[] = [];
    service.transcriptReplaced$.subscribe((id) => replaced.push(id));
    service.enqueue(['a']);
    await Promise.resolve();

    // The user types into bundle 'a' while ASR runs.
    localModeState = {
      ...LOCAL_MODE_STATE,
      bundles: {
        ...LOCAL_MODE_STATE.bundles,
        entities: {
          ...LOCAL_MODE_STATE.bundles.entities,
          a: {
            ...LOCAL_MODE_STATE.bundles.entities.a,
            transcript: {
              levels: [{ items: [{ labels: [{ name: 'L', value: 'mine' }] }] }],
            },
          },
        },
      },
    };
    store.dispatch({ type: '[test] refresh' });

    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    await Promise.resolve();

    expect(queueState().runs['a'].state).toBe('failed');
    expect(replaced).toEqual([]);
  });

  it('announces a replaced transcript so a host can remount its editor', async () => {
    const replaced: string[] = [];
    service.transcriptReplaced$.subscribe((id) => replaced.push(id));
    service.enqueue(['a']);
    await Promise.resolve();
    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    await Promise.resolve();
    expect(replaced).toEqual(['a']);
  });

  it('cancelIfActive() cancels only when the running bundle is among the ids', async () => {
    service.enqueue(['a']);
    await Promise.resolve();

    service.cancelIfActive(['b']);
    expect(runner.cancel).not.toHaveBeenCalled();

    service.cancelIfActive(['a', 'b']);
    expect(runner.cancel).toHaveBeenCalledTimes(1);
  });
});

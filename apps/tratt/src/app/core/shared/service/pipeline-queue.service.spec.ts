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
import { OAnnotJSON } from '@tratt/annotation';
import { Subject } from 'rxjs';
import { RootState } from '../../store/index';
import { PipelineQueueActions } from '../../store/pipeline-queue/pipeline-queue.actions';
import { reducer as pipelineQueueReducer } from '../../store/pipeline-queue/pipeline-queue.reducer';
import { selectPipelineQueueFeature } from '../../store/pipeline-queue/pipeline-queue.selectors';
import { AudioService } from './audio.service';
import { PipelineQueueService } from './pipeline-queue.service';
import type { PipelineEvent } from './pipeline-runner.service';
import { PipelineRunnerService } from './pipeline-runner.service';

const LOCAL_MODE_STATE = {
  bundles: {
    ids: ['a', 'b'],
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
    getManager: jest.Mock<any>;
  };
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
      getManager: jest.fn(() => fakeManager()),
    };

    TestBed.configureTestingModule({
      providers: [
        // A REAL store (not provideMockStore): the drain loop reads the
        // queue back immediately after dispatching into it, so the reducer
        // has to actually run.
        provideStore({
          pipelineQueue: pipelineQueueReducer,
          localMode: () => LOCAL_MODE_STATE as any,
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
});

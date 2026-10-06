import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { OLabel, TrattAnnotation } from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { Observable, of, Subject } from 'rxjs';
import { SessionFile } from '../../obj/SessionFile';
import { AudioService } from '../../shared/service/audio.service';
import { IDBService } from '../../shared/service/idb.service';
import { LoginMode, RootState } from '../index';
import { localBundleAdapter } from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { PipelineQueuePersistenceEffects } from './pipeline-queue-persistence.effects';
import { PipelineQueueActions } from './pipeline-queue.actions';

describe('PipelineQueuePersistenceEffects', () => {
  let actions$: Subject<any>;
  let store: MockStore<RootState>;
  let idbService: {
    saveModeOptions: jest.Mock<any>;
    saveAnnotation: jest.Mock<any>;
  };
  let audioService: {
    getManager: jest.Mock<any>;
    getMediaInfo: jest.Mock<any>;
  };
  let effects: PipelineQueuePersistenceEffects;

  const bundleA = {
    bundleId: 'a',
    sessionFile: new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav'),
    importConverter: 'AnnotJSON',
    currentEditor: '2D-Editor',
    transcript: { selectedLevelIndex: 0 },
    logging: { enabled: true },
    currentSession: { loadFromServer: false },
    additionalSpeakerIds: [],
  } as any;

  const initialState = {
    authentication: { me: undefined },
    localMode: {
      bundles: localBundleAdapter.setAll(
        [bundleA],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'a',
    },
    pipelineQueue: {
      queue: [],
      activeId: 'a',
      mode: 'running',
      runs: { a: { state: 'running', stage: 'asr' } },
    },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new Subject<any>();
    idbService = {
      saveModeOptions: jest.fn(() => of(undefined)),
      saveAnnotation: jest.fn(() => of(undefined)),
    };
    audioService = {
      getManager: jest.fn(() => ({
        resource: {
          info: { fullname: 'a.wav', sampleRate: 16000, duration: 1 },
        },
      })),
      getMediaInfo: jest.fn(() => undefined),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        PipelineQueuePersistenceEffects,
        provideMockActions(() => actions$ as Observable<any>),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: idbService },
        { provide: AudioService, useValue: audioService },
      ],
    });

    store = TestBed.inject(MockStore);
    effects = TestBed.inject(PipelineQueuePersistenceEffects);
    effects.saveRunState$.subscribe();
  });

  it("writes the active bundle's full options row including runState on activateNext", () => {
    actions$.next(PipelineQueueActions.activateNext());

    expect(idbService.saveModeOptions).toHaveBeenCalledTimes(1);
    const [mode, options, bundleId] = idbService.saveModeOptions.mock
      .calls[0] as any[];
    expect(mode).toBe(LoginMode.LOCAL);
    expect(bundleId).toBe('a');
    expect(options.runState).toBe('running');
    // The rest of the row must still be there — this write replaces the
    // whole stored value, so a partial write would break bundle restore.
    expect(options.sessionfile).not.toBeNull();
    expect(options.currentEditor).toBe('2D-Editor');
  });

  it("writes the finished bundle's row on bundleDone, keyed by the action's bundleId", () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'running',
        runs: { a: { state: 'done' } },
      },
    } as unknown as RootState);

    actions$.next(PipelineQueueActions.bundleDone({ bundleId: 'a' }));

    const [, options, bundleId] = idbService.saveModeOptions.mock
      .calls[0] as any[];
    expect(bundleId).toBe('a');
    expect(options.runState).toBe('done');
  });

  it('writes nothing for a bundle that has no entity in the store', () => {
    actions$.next(PipelineQueueActions.bundleDone({ bundleId: 'ghost' }));
    expect(idbService.saveModeOptions).not.toHaveBeenCalled();
  });

  it('writes every bundle whose state was reset by stopped', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'idle',
        runs: { a: { state: 'idle' } },
      },
    } as unknown as RootState);

    actions$.next(PipelineQueueActions.stopped());

    expect(idbService.saveModeOptions).toHaveBeenCalledTimes(1);
    const [, options, bundleId] = idbService.saveModeOptions.mock
      .calls[0] as any[];
    expect(bundleId).toBe('a');
    expect(options.runState).toBe('idle');
  });

  // F5 (final whole-branch review fix wave): the reducer's `pause` action
  // can resolve directly to stopNow() (when nothing is active), resetting
  // every queued bundle's run state to 'idle' in-memory — but `pause` was
  // missing from this effect's ofType() list, so that reset was never
  // persisted. Mirrors the `stopped` test above.
  it('writes every bundle whose state was reset by pause resolving to stopNow()', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'idle',
        runs: { a: { state: 'idle' } },
      },
    } as unknown as RootState);

    actions$.next(PipelineQueueActions.pause());

    expect(idbService.saveModeOptions).toHaveBeenCalledTimes(1);
    const [, options, bundleId] = idbService.saveModeOptions.mock
      .calls[0] as any[];
    expect(bundleId).toBe('a');
    expect(options.runState).toBe('idle');
  });

  it("persists a queue-written transcript against that bundle's own id", () => {
    effects.saveBundleTranscript$.subscribe();

    const serialize = jest.fn(() => ({ name: 'a.wav', levels: [] }));
    store.setState({
      ...initialState,
      localMode: {
        ...(initialState as any).localMode,
        bundles: localBundleAdapter.setAll(
          [
            {
              ...bundleA,
              audio: { fileName: 'a.wav' },
              transcript: { serialize },
            },
          ],
          localBundleAdapter.getInitialState(),
        ),
      },
    } as unknown as RootState);

    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript: { serialize } as any,
      }),
    );

    expect(idbService.saveAnnotation).toHaveBeenCalledTimes(1);
    const [mode, , bundleId] = idbService.saveAnnotation.mock.calls[0] as any[];
    expect(mode).toBe(LoginMode.LOCAL);
    expect(bundleId).toBe('a');
  });

  it('persists nothing when there is neither audio nor a timed transcript', () => {
    effects.saveBundleTranscript$.subscribe();
    audioService.getManager.mockReturnValue(undefined);

    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript: { serialize: jest.fn() } as any,
      }),
    );

    expect(idbService.saveAnnotation).not.toHaveBeenCalled();
  });

  it('still persists a result for a bundle whose audio was evicted, from its registration-time media info', () => {
    effects.saveBundleTranscript$.subscribe();
    audioService.getManager.mockReturnValue(undefined);
    audioService.getMediaInfo.mockReturnValue({
      fullname: 'a.wav',
      sampleRate: 16000,
      duration: 1,
      channels: 1,
      size: 1,
    });
    const serialize = jest.fn(() => ({}));

    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript: { serialize } as any,
      }),
    );

    expect(serialize).toHaveBeenCalled();
    expect(idbService.saveAnnotation).toHaveBeenCalledTimes(1);
  });

  it("persists a transcript imported into a restored file (no audio) by the transcript's own end", () => {
    effects.saveBundleTranscript$.subscribe();
    audioService.getManager.mockReturnValue(undefined);
    const transcript = new TrattAnnotation<any>();
    const level = transcript.createSegmentLevel('words');
    level.items.push(
      transcript.createSegment(new SampleUnit(20000, 16000), [
        new OLabel('words', 'first'),
      ]),
      transcript.createSegment(new SampleUnit(39264, 16000), [
        new OLabel('words', 'second'),
      ]),
    );
    transcript.addLevel(level);
    const serialize = jest.spyOn(transcript, 'serialize');

    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript,
      }),
    );

    expect(serialize).toHaveBeenCalledTimes(1);
    const [name, sampleRate, duration] = serialize.mock.calls[0] as any[];
    expect(name).toBe('a.wav');
    expect(sampleRate).toBe(16000);
    expect(duration.samples).toBe(39264);
    expect(idbService.saveAnnotation).toHaveBeenCalledTimes(1);
  });
});

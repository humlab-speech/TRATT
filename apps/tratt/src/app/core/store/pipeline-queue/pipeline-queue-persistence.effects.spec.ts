import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
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
  let audioService: { getManager: jest.Mock<any> };
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

  it('persists nothing when that bundle has no resident audio manager', () => {
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
});

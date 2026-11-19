import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { SessionFile } from '../../obj/SessionFile';
import { AudioService } from '../../shared/service/audio.service';
import { IDBService } from '../../shared/service/idb.service';
import { LoginMode, RootState } from '../index';
import { localBundleAdapter } from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { computeReadyBundleIds } from './index';
import { PipelineQueuePersistenceEffects } from './pipeline-queue-persistence.effects';
import { PipelineQueueActions } from './pipeline-queue.actions';
import { initialState, reducer } from './pipeline-queue.reducer';

/**
 * C1 - a transcript write that fails must not leave the row `done`.
 *
 * `PipelineQueueService.succeed()` dispatches `bundleDone` before the async
 * IndexedDB write settles, and `done` is excluded from `computeReadyBundleIds`,
 * from the per-row retry gate and from `restoreInterrupted`. The persistence
 * effect answered a rejection with `of(undefined)` while declared
 * `{ dispatch: false }`, so nothing happened: green badge, transcript only in
 * memory, no Retry, gone on reload.
 *
 * The fix answers with `PipelineQueueActions.bundleFailed` (which the reducer,
 * the retry gate and `saveRunState$` all already understand) and declares
 * `{ dispatch: true }`.
 *
 * Two sibling paths are deliberately NOT asserted here, because they are
 * deliberate early returns and not this defect, and asserting them kept this
 * spec red after the fix (see the "not fixed here" section of the brief):
 *   - no media info and no transcript end  -> returns EMPTY on purpose,
 *   - `serialize()` throwing              -> returns EMPTY (documented as
 *     protecting the effect from a dead-stream-permanent failure).
 */
describe('C1 - a failed transcript write must leave the row retryable, not done', () => {
  let actions$: Subject<any>;
  let store: MockStore<RootState>;
  let idbService: { saveModeOptions: jest.Mock<any>; saveAnnotation: jest.Mock<any> };
  let audioService: { getManager: jest.Mock<any>; getMediaInfo: jest.Mock<any> };
  let effects: PipelineQueuePersistenceEffects;
  let dispatched: any[];

  const bundleA = {
    bundleId: 'a',
    sessionFile: new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav'),
    importConverter: 'AnnotJSON',
    currentEditor: '2D-Editor',
    transcript: { selectedLevelIndex: 0 },
    logging: { enabled: true },
    currentSession: { loadFromServer: false },
    additionalSpeakerIds: [],
    audio: { fileName: 'a.wav' },
  } as any;

  const initialStateRoot = {
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
      activeId: null,
      mode: 'running',
      runs: { a: { state: 'done' } },
    },
  } as unknown as RootState;

  const setTranscript = (transcript: any) =>
    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript,
      }),
    );

  const failedForA = () =>
    dispatched.filter(
      (a) =>
        a?.type === PipelineQueueActions.bundleFailed.type && a.bundleId === 'a',
    );

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
        provideMockStore({ initialState: initialStateRoot }),
        { provide: IDBService, useValue: idbService },
        { provide: AudioService, useValue: audioService },
      ],
    });

    store = TestBed.inject(MockStore);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    dispatched = [];
    jest.spyOn(store, 'dispatch').mockImplementation(((action: any) => {
      dispatched.push(action);
      return action;
    }) as any);
    effects = TestBed.inject(PipelineQueuePersistenceEffects);
    effects.saveBundleTranscript$.subscribe((action) => {
      if (action) {
        dispatched.push(action);
      }
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers a rejected write with bundleFailed instead of nothing', () => {
    idbService.saveAnnotation.mockReturnValue(
      throwError(() => new Error('QuotaExceededError')),
    );

    setTranscript({ serialize: jest.fn(() => ({ name: 'a.wav', levels: [] })) });
    jest.advanceTimersByTime(1);

    expect(idbService.saveAnnotation).toHaveBeenCalledTimes(1);
    expect(failedForA()).toHaveLength(1);
    // NgRx gives no public API for the dispatch flag, and emitting is only
    // dispatching while the effect is not `{ dispatch: false }` - i.e. this is
    // the one line that stops the fix being undone by a later refactor.
    expect(
      (effects.saveBundleTranscript$ as any)['__@ngrx/effects_create__']
        ?.dispatch,
    ).not.toBe(false);
  });

  it('a successful write still dispatches nothing', () => {
    setTranscript({ serialize: jest.fn(() => ({ name: 'a.wav', levels: [] })) });
    jest.advanceTimersByTime(1);

    expect(idbService.saveAnnotation).toHaveBeenCalledTimes(1);
    expect(failedForA()).toHaveLength(0);
  });

  it("the reducer takes a 'done' row back to 'failed'", () => {
    const after = reducer(
      { ...initialState, runs: { a: { state: 'done' } } },
      PipelineQueueActions.bundleFailed({
        bundleId: 'a',
        error: { kind: 'unknown', message: 'boom' },
      }),
    );
    expect(after.runs['a'].state).toBe('failed');
  });

  it("uses the recovery path the fix relies on: 'failed' is ready, 'done' is not", () => {
    const summaries = [
      { bundleId: 'a', awaitingMedia: false, hasAnnotationContent: false },
    ];
    expect(
      computeReadyBundleIds(summaries, { a: { state: 'failed' } }, () => true),
    ).toEqual(['a']);
    expect(
      computeReadyBundleIds(summaries, { a: { state: 'done' } }, () => true),
    ).toEqual([]);
  });
});

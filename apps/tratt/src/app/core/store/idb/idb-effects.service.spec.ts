import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { SessionStorageService } from 'ngx-webstorage';
import { of, ReplaySubject, throwError } from 'rxjs';
import { AudioService } from '../../shared/service';
import { IDBService } from '../../shared/service/idb.service';
import { RoutingService } from '../../shared/service/routing.service';
import { ApplicationActions } from '../application/application.actions';
import { LoginMode, RootState } from '../index';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { IDBEffects } from './idb-effects.service';
import { IDBActions } from './idb.actions';

// createEffect() returns the raw effect observable (see @ngrx/effects
// createEffect: `effect = source()`, only tagged with dispatch metadata).
// Subscribing to it directly here — as this file's sibling specs do for
// other effects — does NOT route through Store.dispatch; only effects that
// explicitly call `this.store.dispatch(...)` in their body do that (e.g.
// authentication.effects.ts login$). saveAfterUndo$/saveAfterRedo instead
// just emit the resulting action from the stream, so these tests assert on
// what the effect observable itself emits.
describe('IDBEffects undo/redo guards missing audio (C12)', () => {
  let effects: IDBEffects;
  let actions$: ReplaySubject<unknown>;

  // getModeState(appState) switches on appState.application.mode and, for
  // LoginMode.LOCAL, resolves the single bundle out of the entity collection
  // (appState.localMode.bundles.entities[selectedBundleId]) — it must be
  // truthy for saveAfterUndo$/saveAfterRedo to get past their
  // `if (modeState)` check and reach the audioManager guard under test.
  // transcript.links/.serialize are the only members either effect's
  // guarded code path touches.
  const fakeLocalAnnotation = {
    bundleId: DEFAULT_BUNDLE_ID,
    transcript: {
      links: [],
      serialize: jest.fn(),
    },
  } as any;
  const initialState = {
    application: { mode: LoginMode.LOCAL },
    localMode: {
      bundles: localBundleAdapter.setOne(
        fakeLocalAnnotation,
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);

    TestBed.configureTestingModule({
      providers: [
        IDBEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: { saveAnnotation: jest.fn() } },
        { provide: SessionStorageService, useValue: {} },
        { provide: RoutingService, useValue: {} },
        { provide: AudioService, useValue: { audioManager: undefined } },
      ],
    });

    effects = TestBed.inject(IDBEffects);
  });

  it('emits undoFailed instead of throwing when no audio is loaded', (done) => {
    const emitted: unknown[] = [];
    const subscription = effects.saveAfterUndo$.subscribe({
      next: (action) => emitted.push(action),
    });

    actions$.next(ApplicationActions.undo());

    setTimeout(() => {
      expect(
        emitted.some(
          (a) => (a as any).type === ApplicationActions.undoFailed.type,
        ),
      ).toBe(true);
      subscription.unsubscribe();
      done();
    }, 0);
  });

  it('emits redoFailed instead of throwing when no audio is loaded', (done) => {
    const emitted: unknown[] = [];
    const subscription = effects.saveAfterRedo.subscribe({
      next: (action) => emitted.push(action),
    });

    actions$.next(ApplicationActions.redo());

    setTimeout(() => {
      expect(
        emitted.some(
          (a) => (a as any).type === ApplicationActions.redoFailed.type,
        ),
      ).toBe(true);
      subscription.unsubscribe();
      done();
    }, 0);
  });
});

describe('IDBEffects.loadOptions$ (IDB open failure)', () => {
  let effects: IDBEffects;
  let actions$: ReplaySubject<unknown>;
  let idbService: { initialize: jest.Mock };
  let store: Store<RootState>;

  const initialState = {
    application: {
      appConfiguration: {
        tratt: {
          database: {
            name: 'test-db',
          },
        },
      },
    },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);
    idbService = { initialize: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        IDBEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: idbService },
        { provide: SessionStorageService, useValue: {} },
        { provide: RoutingService, useValue: {} },
        { provide: AudioService, useValue: { audioManager: undefined } },
      ],
    });

    effects = TestBed.inject(IDBEffects);
    store = TestBed.inject(Store);
  });

  it('dispatches ApplicationActions.addError (not just the dead-end loadOptions.fail) when IDB init fails', (done) => {
    const simulatedError = 'simulated IDB open failure';
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    idbService.initialize.mockReturnValue(throwError(() => simulatedError));

    const subscription = effects.loadOptions$.subscribe((action) => {
      expect(action).toEqual(
        IDBActions.loadOptions.fail({ error: simulatedError }),
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        ApplicationActions.addError({ error: simulatedError }),
      );
      subscription.unsubscribe();
      done();
    });

    actions$.next(
      ApplicationActions.initApplication.setSessionStorageOptions({
        loggedIn: false,
        reloaded: false,
      }),
    );
  });
});

describe('IDBEffects.getModeStateFromString', () => {
  let effects: IDBEffects;
  let actions$: ReplaySubject<unknown>;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);

    TestBed.configureTestingModule({
      providers: [
        IDBEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState: {} }),
        { provide: IDBService, useValue: { saveAnnotation: jest.fn() } },
        { provide: SessionStorageService, useValue: {} },
        { provide: RoutingService, useValue: {} },
        { provide: AudioService, useValue: { audioManager: undefined } },
      ],
    });

    effects = TestBed.inject(IDBEffects);
  });

  it('local mode: resolves the flat AnnotationState from the entity collection', () => {
    const fakeAnnotation = {
      savingNeeded: true,
      bundleId: DEFAULT_BUNDLE_ID,
    } as any;
    const appState = {
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.setOne(
          fakeAnnotation,
          localBundleAdapter.getInitialState(),
        ),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      },
    } as unknown as RootState;

    expect(effects.getModeStateFromString(appState, LoginMode.LOCAL)).toBe(
      fakeAnnotation,
    );
  });

  it('online mode: unchanged, returns the flat onlineMode slice directly', () => {
    const fakeOnline = { savingNeeded: false } as any;
    const appState = {
      application: { mode: LoginMode.ONLINE },
      onlineMode: fakeOnline,
    } as unknown as RootState;

    expect(effects.getModeStateFromString(appState, LoginMode.ONLINE)).toBe(
      fakeOnline,
    );
  });
});

// Task 3: save-side effects must persist under the REAL selected bundle id,
// not a hardcoded DEFAULT_BUNDLE_ID. Task 2 made selectedBundleId able to
// genuinely vary (e.g. 'bundle-2'); before this fix these effects always
// wrote to 'bundle-1' regardless, corrupting cross-bundle data.
describe('IDBEffects — persists to the real selected bundle (Task 3)', () => {
  let effects: IDBEffects;
  let actions$: ReplaySubject<unknown>;
  let idbService: {
    saveModeOptions: jest.Mock;
    saveAnnotation: jest.Mock;
  };

  const buildState = (selectedBundleId: string): RootState => {
    const fakeAnnotation = {
      bundleId: selectedBundleId,
      sessionFile: undefined,
      importConverter: undefined,
      currentEditor: undefined,
      transcript: {
        selectedLevelIndex: 0,
        serialize: jest.fn().mockReturnValue({ fake: 'annotation-json' }),
      },
      logging: { enabled: false, logs: [] },
      currentSession: undefined,
      additionalSpeakerIds: undefined,
      audio: { fileName: 'fake.wav' },
    } as any;

    return {
      application: { mode: LoginMode.LOCAL },
      authentication: { me: undefined },
      localMode: {
        bundles: localBundleAdapter.setOne(
          fakeAnnotation,
          localBundleAdapter.getInitialState(),
        ),
        selectedBundleId,
      },
      pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
    } as unknown as RootState;
  };

  const setup = (initialState: RootState) => {
    actions$ = new ReplaySubject(1);
    idbService = {
      saveModeOptions: jest.fn().mockReturnValue(of(undefined)),
      saveAnnotation: jest.fn().mockReturnValue(of(undefined)),
    };

    TestBed.configureTestingModule({
      providers: [
        IDBEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: idbService },
        { provide: SessionStorageService, useValue: {} },
        { provide: RoutingService, useValue: {} },
        {
          provide: AudioService,
          useValue: {
            current: {
              resource: {
                info: {
                  fullname: 'fake.wav',
                  sampleRate: 16000,
                  duration: { samples: 1000 },
                },
              },
            },
          },
        },
      ],
    });

    effects = TestBed.inject(IDBEffects);
  };

  describe('savemodeOptions$', () => {
    it('passes the non-default selected bundle id to IDBService.saveModeOptions', (done) => {
      setup(buildState('bundle-2'));

      const subscription = effects.savemodeOptions$.subscribe(() => {
        expect(idbService.saveModeOptions).toHaveBeenCalledWith(
          LoginMode.LOCAL,
          expect.anything(),
          'bundle-2',
        );
        subscription.unsubscribe();
        done();
      });

      actions$.next(
        LoginModeActions.changeComment.do({
          mode: LoginMode.LOCAL,
          comment: 'hello',
        }),
      );
    });

    it('regression: still passes DEFAULT_BUNDLE_ID when that is the selected bundle', (done) => {
      setup(buildState(DEFAULT_BUNDLE_ID));

      const subscription = effects.savemodeOptions$.subscribe(() => {
        expect(idbService.saveModeOptions).toHaveBeenCalledWith(
          LoginMode.LOCAL,
          expect.anything(),
          DEFAULT_BUNDLE_ID,
        );
        subscription.unsubscribe();
        done();
      });

      actions$.next(
        LoginModeActions.changeComment.do({
          mode: LoginMode.LOCAL,
          comment: 'hello',
        }),
      );
    });

    it("forwards the selected bundle's live runState from the pipelineQueue slice", (done) => {
      // Task 2 review F1: without this, `savemodeOptions$` dropping the
      // `runState` argument entirely would leave every other test in this
      // suite green, since buildState()'s default `runs: {}` never
      // populates one.
      const state = buildState('bundle-2');
      state.pipelineQueue = {
        queue: [],
        activeId: null,
        mode: 'idle',
        runs: { 'bundle-2': { state: 'done' } },
      };
      setup(state);

      const subscription = effects.savemodeOptions$.subscribe(() => {
        expect(idbService.saveModeOptions).toHaveBeenCalledWith(
          LoginMode.LOCAL,
          expect.objectContaining({ runState: 'done' }),
          'bundle-2',
        );
        subscription.unsubscribe();
        done();
      });

      actions$.next(
        LoginModeActions.changeComment.do({
          mode: LoginMode.LOCAL,
          comment: 'hello',
        }),
      );
    });

    it('Fix 4: does NOT re-persist for a createBundle dispatch carrying restoredOptions', async () => {
      setup(buildState(DEFAULT_BUNDLE_ID));

      const subscription = effects.savemodeOptions$.subscribe();

      actions$.next(
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-2',
          sessionFile: {} as any,
          restoredOptions: { currentEditor: '2D-Editor', logging: true } as any,
        }),
      );

      // Let the pipe's filter()/withLatestFrom() settle without relying on
      // an emission that (by design) never comes.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(idbService.saveModeOptions).not.toHaveBeenCalled();
      subscription.unsubscribe();
    });

    it('Fix 4: does NOT re-persist for a createBundle dispatch carrying restoredAnnotation', async () => {
      setup(buildState(DEFAULT_BUNDLE_ID));

      const subscription = effects.savemodeOptions$.subscribe();

      actions$.next(
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-2',
          sessionFile: {} as any,
          restoredAnnotation: { levels: [] } as any,
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(idbService.saveModeOptions).not.toHaveBeenCalled();
      subscription.unsubscribe();
    });

    it('Fix 4 regression: still persists for a fresh createBundle without restoredOptions/restoredAnnotation (step 2.7 shape)', (done) => {
      setup(buildState(DEFAULT_BUNDLE_ID));

      const subscription = effects.savemodeOptions$.subscribe(() => {
        expect(idbService.saveModeOptions).toHaveBeenCalled();
        subscription.unsubscribe();
        done();
      });

      actions$.next(
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-2',
          sessionFile: {} as any,
        }),
      );
    });
  });

  describe('saveAnnotation', () => {
    it('passes the non-default selected bundle id to IDBService.saveAnnotation', (done) => {
      setup(buildState('bundle-2'));

      const subscription = effects.saveAnnotation.subscribe(() => {
        expect(idbService.saveAnnotation).toHaveBeenCalledWith(
          LoginMode.LOCAL,
          expect.anything(),
          'bundle-2',
        );
        subscription.unsubscribe();
        done();
      });

      actions$.next(
        AnnotationActions.overwriteTranscript.do({
          transcript: {} as any,
          mode: LoginMode.LOCAL,
          saveToDB: true,
        }),
      );
    });

    it('regression: still passes DEFAULT_BUNDLE_ID when that is the selected bundle', (done) => {
      setup(buildState(DEFAULT_BUNDLE_ID));

      const subscription = effects.saveAnnotation.subscribe(() => {
        expect(idbService.saveAnnotation).toHaveBeenCalledWith(
          LoginMode.LOCAL,
          expect.anything(),
          DEFAULT_BUNDLE_ID,
        );
        subscription.unsubscribe();
        done();
      });

      actions$.next(
        AnnotationActions.overwriteTranscript.do({
          transcript: {} as any,
          mode: LoginMode.LOCAL,
          saveToDB: true,
        }),
      );
    });
  });
});

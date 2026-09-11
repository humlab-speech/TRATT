import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { SessionStorageService } from 'ngx-webstorage';
import { ReplaySubject } from 'rxjs';
import { AudioService } from '../../shared/service';
import { IDBService } from '../../shared/service/idb.service';
import { RoutingService } from '../../shared/service/routing.service';
import { ApplicationActions } from '../application/application.actions';
import { LoginMode, RootState } from '../index';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from '../login-mode/annotation/local-bundle-collection';
import { IDBEffects } from './idb-effects.service';

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
    const fakeAnnotation = { savingNeeded: true } as any;
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

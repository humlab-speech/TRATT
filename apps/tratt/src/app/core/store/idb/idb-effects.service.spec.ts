import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { SessionStorageService } from 'ngx-webstorage';
import { ReplaySubject } from 'rxjs';
import { AudioService } from '../../shared/service';
import { RoutingService } from '../../shared/service/routing.service';
import { IDBService } from '../../shared/service/idb.service';
import { ApplicationActions } from '../application/application.actions';
import { IDBEffects } from './idb-effects.service';
import { LoginMode, RootState } from '../index';

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
  // LoginMode.LOCAL, returns appState.localMode — it must be truthy for
  // saveAfterUndo$/saveAfterRedo to get past their `if (modeState)` check
  // and reach the audioManager guard under test. transcript.links/.serialize
  // are the only members either effect's guarded code path touches.
  const initialState = {
    application: { mode: LoginMode.LOCAL },
    localMode: {
      transcript: {
        links: [],
        serialize: jest.fn(),
      },
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
        emitted.some((a) => (a as any).type === ApplicationActions.undoFailed.type),
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
        emitted.some((a) => (a as any).type === ApplicationActions.redoFailed.type),
      ).toBe(true);
      subscription.unsubscribe();
      done();
    }, 0);
  });
});

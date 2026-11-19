import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { SessionStorageService } from 'ngx-webstorage';
import { ReplaySubject, of } from 'rxjs';
import { AudioService } from '../../shared/service';
import { AnnotationSaveTracker } from '../../shared/service/annotation-save-tracker.service';
import { IDBService } from '../../shared/service/idb.service';
import { RoutingService } from '../../shared/service/routing.service';
import { LoginMode, RootState } from '../index';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from '../login-mode/annotation/local-bundle-collection';
import { IDBEffects } from './idb-effects.service';
import { IDBActions } from './idb.actions';

/**
 * C2 - `IDBEffects.saveAnnotation` answers `saveAnnotation.success` for a
 * write it did not perform, because no audio is loaded.
 *
 * The invariant the rest of the app leans on (annotation-save-triggers.ts,
 * AnnotationSaveTracker): every trigger is answered by exactly one
 * `saveAnnotation.success` (a write happened) or `saveAnnotation.fail`. A fake
 * `success` is exactly what `AppStorageService.changeAnnotationLevel()` waits
 * for: `save()` clears isSaving/savingNeeded and reports `saving('success')`
 * for a transcript that never reached IndexedDB.
 *
 * The file itself treats this branch as an outlier: the identical
 * `!this.audio.current` condition in the undo and redo paths answers
 * `undoFailed` / `redoFailed`.
 *
 * What this spec deliberately does NOT claim: it does not reproduce a user
 * action. The no-audio state is only reachable during bootstrap - the workbench
 * refuses to mount an editor without `audioService.current`, so no keystroke can
 * trigger it. Reach is a startup race, not a workflow (see the brief).
 */
describe('C2 - saveAnnotation must not answer success for a write it skipped', () => {
  let effects: IDBEffects;
  let actions$: ReplaySubject<Action>;
  let idbService: { saveAnnotation: jest.Mock };

  const fakeAnnotation = {
    bundleId: DEFAULT_BUNDLE_ID,
    transcript: {
      selectedLevelIndex: 0,
      serialize: jest.fn().mockReturnValue({ fake: 'annotation-json' }),
    },
    logging: { enabled: false, logs: [] },
    audio: { fileName: 'fake.wav' },
  } as any;

  const initialState = {
    application: { mode: LoginMode.LOCAL },
    localMode: {
      bundles: localBundleAdapter.setOne(
        fakeAnnotation,
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    },
  } as unknown as RootState;

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** The trigger AppStorageService.changeAnnotationLevel() fires for a typed
   *  transcript edit (also covers loginLocal.prepare, the other known trigger). */
  const dispatchChangeLevel = () =>
    actions$.next(
      AnnotationActions.changeAnnotationLevel.do({
        level: {} as any,
        mode: LoginMode.LOCAL,
      }),
    );

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    idbService = { saveAnnotation: jest.fn().mockReturnValue(of(undefined)) };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: TranslocoService,
          useValue: {
            translate: (k: string) => k,
            selectTranslate: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
          },
        },
        IDBEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: idbService },
        { provide: SessionStorageService, useValue: {} },
        { provide: RoutingService, useValue: {} },
        // Nothing decoded for the current selection (right after
        // AudioService.forget(), or loginLocal.prepare before audio loads).
        { provide: AudioService, useValue: { current: undefined } },
      ],
    });

    effects = TestBed.inject(IDBEffects);
  });

  it('writes nothing, so the branch under test is the one being reached', async () => {
    const sub = effects.saveAnnotation.subscribe();
    dispatchChangeLevel();
    await tick();

    expect(idbService.saveAnnotation).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('does NOT answer with saveAnnotation.success when no write happened', async () => {
    const emitted: Action[] = [];
    const sub = effects.saveAnnotation.subscribe((a) => emitted.push(a));
    dispatchChangeLevel();
    await tick();

    expect(
      emitted.some((a) => a.type === IDBActions.saveAnnotation.success.type),
    ).toBe(false);
    sub.unsubscribe();
  });

  it('answers the trigger with saveAnnotation.fail instead', async () => {
    const emitted: Action[] = [];
    const sub = effects.saveAnnotation.subscribe((a) => emitted.push(a));
    dispatchChangeLevel();
    await tick();

    expect(
      emitted.some((a) => a.type === IDBActions.saveAnnotation.fail.type),
    ).toBe(true);
    sub.unsubscribe();
  });

  // Guard, not proof: this passes at base and must stay passing. It is here to
  // block the tempting wrong fix (answer nothing at all), which would leave the
  // leave-page counter incremented forever.
  it('still releases the leave-page tracker for the skipped write', async () => {
    const tracker = TestBed.inject(AnnotationSaveTracker);
    const sub = effects.saveAnnotation.subscribe((a) => actions$.next(a));
    dispatchChangeLevel();
    await tick();

    expect(tracker.inFlight).toBe(0);
    sub.unsubscribe();
  });
});

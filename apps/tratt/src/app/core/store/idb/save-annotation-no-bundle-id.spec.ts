import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { SessionStorageService } from 'ngx-webstorage';
import { EMPTY, ReplaySubject } from 'rxjs';
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
 * C3 - a save that IndexedDB answers with nothing must still be answered.
 *
 * `TrattDatabase.saveModeData()` (shared/tratt-database.ts:557-561) does this
 * for LOCAL mode without a bundleId:
 *
 *     console.error('saveModeData: bundleId is required for LOCAL mode');
 *     return of();            // completes, emits nothing
 *
 * `IDBEffects.saveAnnotation` pipes `map(-> success)` and `catchError(-> fail)`.
 * Neither runs on an EMPTY source, so the trigger is answered by NEITHER action.
 * `AnnotationSaveTracker` counted the trigger and will only be released by
 * `success`/`fail`, so `inFlight` stays above zero for the rest of the session
 * and the leave-page prompt appears on every close from then on. The tracker's
 * own docstring for `beginWrite()` states the rule this path breaks: miss the
 * release and "the leave-page guard sticks forever".
 *
 * This replaces an earlier claim of ours (that the shared counter let one write
 * release another). That was wrong - trigger and answer are 1:1 by construction
 * - and the spec that "proved" it died at dependency injection, never reaching
 * its assertion. See the retraction in the brief.
 */
describe('C3 - an unanswered IndexedDB save must not hang the leave-page guard', () => {
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

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    // What TrattDatabase.saveModeData returns for LOCAL without a bundleId.
    idbService = { saveAnnotation: jest.fn().mockReturnValue(EMPTY) };

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
        // Audio IS loaded here, so the effect reaches the write and the EMPTY
        // answer - not the separate no-audio branch.
        {
          provide: AudioService,
          useValue: {
            current: {
              resource: {
                info: { sampleRate: 16000, duration: { samples: 16000 } },
              },
            },
          },
        },
      ],
    });

    effects = TestBed.inject(IDBEffects);
  });

  it('answers the trigger even though the write completed without emitting', async () => {
    const tracker = TestBed.inject(AnnotationSaveTracker);
    const emitted: Action[] = [];
    const sub = effects.saveAnnotation.subscribe((a) => {
      emitted.push(a);
      actions$.next(a); // what the NgRx runtime does with a dispatched action
    });

    actions$.next(
      AnnotationActions.changeAnnotationLevel.do({
        level: {} as any,
        mode: LoginMode.LOCAL,
      }),
    );
    await tick();

    expect(idbService.saveAnnotation).toHaveBeenCalled();
    expect(emitted.length).toBeGreaterThan(0);
    expect(tracker.inFlight).toBe(0);
    sub.unsubscribe();
  });

  it('that answer is a fail, because nothing was written', async () => {
    const emitted: Action[] = [];
    const sub = effects.saveAnnotation.subscribe((a) => emitted.push(a));

    actions$.next(
      AnnotationActions.changeAnnotationLevel.do({
        level: {} as any,
        mode: LoginMode.LOCAL,
      }),
    );
    await tick();

    expect(emitted.map((a) => a.type)).toEqual([
      IDBActions.saveAnnotation.fail.type,
    ]);
    sub.unsubscribe();
  });
});

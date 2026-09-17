// jsdom's test environment doesn't expose the Node-global structuredClone,
// which fake-indexeddb relies on to clone values on put/add. Polyfill it
// with Node's own implementation before fake-indexeddb installs itself.
// (Same polyfill as tratt-database.spec.ts / tratt-database.dexie-migration.spec.ts.)
if (typeof (globalThis as any).structuredClone === 'undefined') {
  (globalThis as any).structuredClone =
    require('node:util').structuredClone ??
    ((val: unknown) => JSON.parse(JSON.stringify(val)));
}

import 'fake-indexeddb/auto'; // polyfills global indexedDB for this test file
import { TestBed } from '@angular/core/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import Dexie from 'dexie';
import { from, ReplaySubject, throwError } from 'rxjs';
import { IDBService } from '../../../shared/service/idb.service';
import { TrattDatabase } from '../../../shared/tratt-database';
import { IDBActions } from '../../idb/idb.actions';
import { LoginMode, RootState } from '../../index';
import { PipelineQueueActions } from '../../pipeline-queue/pipeline-queue.actions';
import { LoginModeActions } from '../login-mode.actions';
import { BundleRestoreEffects } from './bundle-restore.effects';
import { DEFAULT_BUNDLE_ID } from './local-bundle-collection';

const DB_NAME = 'bundle-restore-effects-test';

describe('BundleRestoreEffects', () => {
  let effects: BundleRestoreEffects;
  let actions$: ReplaySubject<unknown>;
  let db: TrattDatabase;
  let dispatchSpy: jest.Mock;
  // Set by a test before dispatching, to make loadBundle() error for one
  // specific bundleId — exercises the per-bundle catchError branch without
  // aborting the whole restore (Minor 3).
  let failBundleId: string | undefined;

  const initialState = {
    application: { mode: LoginMode.LOCAL },
  } as unknown as RootState;

  beforeEach(async () => {
    db = new TrattDatabase(DB_NAME);
    await db.init();

    // bundle-1 — the pre-existing default bundle, already restored by
    // IDBEffects.loadOptions$/loadAnnotation$. Must NOT be restored again
    // by this effect.
    await db.bundles.bulkPut([
      {
        bundleId: DEFAULT_BUNDLE_ID,
        name: 'options',
        value: {
          sessionfile: { name: 'default.wav', size: 1, type: 'audio/wav' },
        },
      },
      {
        bundleId: DEFAULT_BUNDLE_ID,
        name: 'annotation',
        value: { name: 'default', sampleRate: 16000, levels: [], links: [] },
      },

      // bundle-2 — a real, previously-created bundle with content. Must be
      // restored.
      {
        bundleId: 'bundle-2',
        name: 'options',
        value: {
          sessionfile: { name: 'two.wav', size: 22, type: 'audio/wav' },
          currentEditor: '2D-Editor',
        },
      },
      {
        bundleId: 'bundle-2',
        name: 'annotation',
        value: { name: 'two', sampleRate: 16000, levels: [], links: [] },
      },

      // bundle-3 — another real bundle with content. Must be restored.
      {
        bundleId: 'bundle-3',
        name: 'options',
        value: {
          sessionfile: { name: 'three.wav', size: 33, type: 'audio/wav' },
          currentEditor: 'Dictaphone-Editor',
        },
      },
      {
        bundleId: 'bundle-3',
        name: 'annotation',
        value: { name: 'three', sampleRate: 16000, levels: [], links: [] },
      },

      // bundle-4 — an unused/blank bundle whose options row has no
      // sessionfile. Must be skipped defensively.
      {
        bundleId: 'bundle-4',
        name: 'options',
        value: { sessionfile: null },
      },
    ]);

    actions$ = new ReplaySubject(1);
    dispatchSpy = jest.fn();
    failBundleId = undefined;

    const fakeIdbService = {
      listLocalBundleIds: () => from(db.listLocalBundleIds()),
      loadModeOptions: (mode: LoginMode, bundleId?: string) =>
        bundleId === failBundleId
          ? throwError(
              () => new Error(`simulated load failure for ${bundleId}`),
            )
          : db.loadDataOfMode(mode, 'options', {}, bundleId),
      loadAnnotation: (mode: LoginMode, bundleId?: string) =>
        db.loadDataOfMode(mode, 'annotation', undefined, bundleId),
      saveModeOptions: (
        mode: LoginMode,
        options: Record<string, unknown>,
        bundleId?: string,
      ) => db.saveModeData(mode, 'options', options, false, bundleId),
    };

    TestBed.configureTestingModule({
      providers: [
        BundleRestoreEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: fakeIdbService },
      ],
    });

    effects = TestBed.inject(BundleRestoreEffects);
    const store = TestBed.inject(Store);
    jest.spyOn(store, 'dispatch').mockImplementation(dispatchSpy as any);
  });

  afterEach(async () => {
    db.close();
    await Dexie.delete(DB_NAME);
  });

  it('dispatches createBundle for every LOCAL bundle except bundle-1 and blank ones, then selectBundle(bundle-1) last', (done) => {
    effects.restoreBundles$.subscribe({
      next: () => {
        const createBundleCalls = dispatchSpy.mock.calls
          .map((call) => call[0])
          .filter(
            (action: any) => action.type === LoginModeActions.createBundle.type,
          );

        expect(createBundleCalls).toHaveLength(2);

        const byId = Object.fromEntries(
          createBundleCalls.map((a: any) => [a.bundleId, a]),
        );

        expect(byId['bundle-1']).toBeUndefined();
        expect(byId['bundle-4']).toBeUndefined();

        expect(byId['bundle-2']).toMatchObject({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-2',
          restoredOptions: { currentEditor: '2D-Editor' },
          restoredAnnotation: { name: 'two' },
        });
        expect(byId['bundle-2'].sessionFile).toMatchObject({
          name: 'two.wav',
          size: 22,
          type: 'audio/wav',
        });

        expect(byId['bundle-3']).toMatchObject({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-3',
          restoredOptions: { currentEditor: 'Dictaphone-Editor' },
          restoredAnnotation: { name: 'three' },
        });

        const lastCall =
          dispatchSpy.mock.calls[dispatchSpy.mock.calls.length - 1][0];
        expect(lastCall).toEqual(
          LoginModeActions.selectBundle({
            mode: LoginMode.LOCAL,
            bundleId: DEFAULT_BUNDLE_ID,
          }),
        );

        done();
      },
      error: done,
    });

    actions$.next(
      IDBActions.loadOptions.success({
        applicationOptions: {} as any,
        localOptions: {} as any,
        onlineOptions: {} as any,
        demoOptions: {} as any,
        urlOptions: {} as any,
      }),
    );
  });

  it('Minor 3: zero-bundles-found case still dispatches selectBundle(bundle-1)', (done) => {
    // Only bundle-1's rows exist — no "other" bundle beyond DEFAULT_BUNDLE_ID.
    db.bundles
      .where('bundleId')
      .notEqual(DEFAULT_BUNDLE_ID)
      .delete()
      .then(() => {
        effects.restoreBundles$.subscribe({
          next: () => {
            const createBundleCalls = dispatchSpy.mock.calls
              .map((call) => call[0])
              .filter(
                (action: any) =>
                  action.type === LoginModeActions.createBundle.type,
              );
            expect(createBundleCalls).toHaveLength(0);

            const lastCall =
              dispatchSpy.mock.calls[dispatchSpy.mock.calls.length - 1][0];
            expect(lastCall).toEqual(
              LoginModeActions.selectBundle({
                mode: LoginMode.LOCAL,
                bundleId: DEFAULT_BUNDLE_ID,
              }),
            );
            done();
          },
          error: done,
        });

        actions$.next(
          IDBActions.loadOptions.success({
            applicationOptions: {} as any,
            localOptions: {} as any,
            onlineOptions: {} as any,
            demoOptions: {} as any,
            urlOptions: {} as any,
          }),
        );
      });
  });

  it('Minor 3: a per-bundle load failure (catchError) skips that bundle without aborting the rest', (done) => {
    failBundleId = 'bundle-2';

    effects.restoreBundles$.subscribe({
      next: () => {
        const createBundleCalls = dispatchSpy.mock.calls
          .map((call) => call[0])
          .filter(
            (action: any) => action.type === LoginModeActions.createBundle.type,
          );

        const byId = Object.fromEntries(
          createBundleCalls.map((a: any) => [a.bundleId, a]),
        );

        // The failing bundle never got a createBundle dispatch...
        expect(byId['bundle-2']).toBeUndefined();
        // ...but the other real bundle still restored normally.
        expect(byId['bundle-3']).toMatchObject({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-3',
          restoredOptions: { currentEditor: 'Dictaphone-Editor' },
        });

        const lastCall =
          dispatchSpy.mock.calls[dispatchSpy.mock.calls.length - 1][0];
        expect(lastCall).toEqual(
          LoginModeActions.selectBundle({
            mode: LoginMode.LOCAL,
            bundleId: DEFAULT_BUNDLE_ID,
          }),
        );
        done();
      },
      error: done,
    });

    actions$.next(
      IDBActions.loadOptions.success({
        applicationOptions: {} as any,
        localOptions: {} as any,
        onlineOptions: {} as any,
        demoOptions: {} as any,
        urlOptions: {} as any,
      }),
    );
  });

  it('Minor 3: restores a bundle whose options row was created through the REAL saveModeOptions/IDBService write path, not just a hand-seeded Dexie row', (done) => {
    // Clear the hand-seeded fixture bundles entirely, then drive persistence
    // through the exact same call the real app makes on a fresh bundle save
    // (IDBService.saveModeOptions -> TrattDatabase.saveModeData(..., overwrite=false, ...))
    // — this is the path Fix 1 fixed; exercising it here (rather than a
    // bulkPut fixture shortcut) is what let Fix 1's bug go undetected
    // through this task's own original review.
    db.bundles
      .where('bundleId')
      .notEqual(DEFAULT_BUNDLE_ID)
      .delete()
      .then(async () => {
        await new Promise<void>((resolve, reject) => {
          db.saveModeData(
            LoginMode.LOCAL,
            'options',
            {
              sessionfile: {
                name: 'real-write.wav',
                size: 55,
                type: 'audio/wav',
              },
              currentEditor: '2D-Editor',
            },
            false,
            'bundle-real',
          ).subscribe({ next: () => resolve(), error: reject });
        });
        await new Promise<void>((resolve, reject) => {
          db.saveModeData(
            LoginMode.LOCAL,
            'annotation',
            { name: 'real-write', sampleRate: 16000, levels: [], links: [] },
            true,
            'bundle-real',
          ).subscribe({ next: () => resolve(), error: reject });
        });

        effects.restoreBundles$.subscribe({
          next: () => {
            const createBundleCalls = dispatchSpy.mock.calls
              .map((call) => call[0])
              .filter(
                (action: any) =>
                  action.type === LoginModeActions.createBundle.type,
              );
            const byId = Object.fromEntries(
              createBundleCalls.map((a: any) => [a.bundleId, a]),
            );

            expect(byId['bundle-real']).toMatchObject({
              mode: LoginMode.LOCAL,
              bundleId: 'bundle-real',
              restoredOptions: { currentEditor: '2D-Editor' },
              restoredAnnotation: { name: 'real-write' },
            });
            expect(byId['bundle-real'].sessionFile).toMatchObject({
              name: 'real-write.wav',
              size: 55,
              type: 'audio/wav',
            });
            done();
          },
          error: done,
        });

        actions$.next(
          IDBActions.loadOptions.success({
            applicationOptions: {} as any,
            localOptions: {} as any,
            onlineOptions: {} as any,
            demoOptions: {} as any,
            urlOptions: {} as any,
          }),
        );
      });
  });

  it('rehydrates a persisted queued/running runState as interrupted, for bundle-1 too', (done) => {
    // bundle-1's ENTITY restore is handled by the pre-existing
    // loadOptions$/loadAnnotation$ boot effects (unaffected here), but
    // nothing else restores its persisted runState — this effect must load
    // bundle-1's options row too, purely for that field.
    Promise.all([
      db.bundles.put({
        bundleId: DEFAULT_BUNDLE_ID,
        name: 'options',
        value: {
          sessionfile: { name: 'default.wav', size: 1, type: 'audio/wav' },
          runState: 'running',
        },
      }),
      db.bundles.put({
        bundleId: 'bundle-3',
        name: 'options',
        value: {
          sessionfile: { name: 'three.wav', size: 33, type: 'audio/wav' },
          currentEditor: 'Dictaphone-Editor',
          runState: 'queued',
        },
      }),
    ]).then(() => {
      effects.restoreBundles$.subscribe({
        next: () => {
          expect(dispatchSpy).toHaveBeenCalledWith(
            PipelineQueueActions.restoreInterrupted({
              entries: [
                { bundleId: DEFAULT_BUNDLE_ID, state: 'running' },
                { bundleId: 'bundle-3', state: 'queued' },
              ],
            }),
          );
          done();
        },
        error: done,
      });

      actions$.next(
        IDBActions.loadOptions.success({
          applicationOptions: {} as any,
          localOptions: {} as any,
          onlineOptions: {} as any,
          demoOptions: {} as any,
          urlOptions: {} as any,
        }),
      );
    });
  });

  it('does not dispatch restoreInterrupted when no bundle has a persisted runState', (done) => {
    // Default fixture from beforeEach — none of its options rows carry a
    // runState field.
    effects.restoreBundles$.subscribe({
      next: () => {
        expect(
          dispatchSpy.mock.calls.filter(
            ([a]: any[]) =>
              a.type === PipelineQueueActions.restoreInterrupted.type,
          ),
        ).toEqual([]);
        done();
      },
      error: done,
    });

    actions$.next(
      IDBActions.loadOptions.success({
        applicationOptions: {} as any,
        localOptions: {} as any,
        onlineOptions: {} as any,
        demoOptions: {} as any,
        urlOptions: {} as any,
      }),
    );
  });
});

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
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import Dexie from 'dexie';
import { from, ReplaySubject } from 'rxjs';
import { IDBService } from '../../../shared/service/idb.service';
import { TrattDatabase } from '../../../shared/tratt-database';
import { LoginMode, RootState } from '../../index';
import { DEFAULT_BUNDLE_ID } from './local-bundle-collection';
import { BundleRestoreEffects } from './bundle-restore.effects';
import { LoginModeActions } from '../login-mode.actions';
import { IDBActions } from '../../idb/idb.actions';

const DB_NAME = 'bundle-restore-effects-test';

describe('BundleRestoreEffects', () => {
  let effects: BundleRestoreEffects;
  let actions$: ReplaySubject<unknown>;
  let db: TrattDatabase;
  let dispatchSpy: jest.Mock;

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
        value: { sessionfile: { name: 'default.wav', size: 1, type: 'audio/wav' } },
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

    const fakeIdbService = {
      listLocalBundleIds: () => from(db.listLocalBundleIds()),
      loadModeOptions: (mode: LoginMode, bundleId?: string) =>
        db.loadDataOfMode(mode, 'options', {}, bundleId),
      loadAnnotation: (mode: LoginMode, bundleId?: string) =>
        db.loadDataOfMode(mode, 'annotation', undefined, bundleId),
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
          .filter((action: any) => action.type === LoginModeActions.createBundle.type);

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
});

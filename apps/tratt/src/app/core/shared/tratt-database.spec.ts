import { describe, expect, it, jest, afterEach } from '@jest/globals';

// jsdom's test environment doesn't expose the Node-global structuredClone,
// which fake-indexeddb relies on to clone values on put/add. Polyfill it
// with Node's own implementation before fake-indexeddb installs itself.
if (typeof (globalThis as any).structuredClone === 'undefined') {
  (globalThis as any).structuredClone =
    require('node:util').structuredClone ??
    ((val: unknown) => JSON.parse(JSON.stringify(val)));
}

import 'fake-indexeddb/auto'; // polyfills global indexedDB for this test file
import Dexie from 'dexie';
import { TrattDatabase } from './tratt-database';
import { LoginMode } from '../store';
import { DEFAULT_BUNDLE_ID } from '../store/login-mode/annotation/local-bundle-collection';

describe('TrattDatabase.init()', () => {
  it('rejects when this.open() fails, instead of silently resolving', async () => {
    const db = new TrattDatabase('test-db-init-failure');
    jest.spyOn(db, 'open').mockRejectedValue(new Error('simulated open failure'));

    await expect(db.init()).rejects.toThrow('simulated open failure');
  });
});

describe('TrattDatabase — LOCAL mode routes save/load through the bundles table', () => {
  const DB_NAME = 'tratt-database-bundles-routing-test';

  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('saveModeData(LOCAL, ...) writes to bundles at [bundleId, name], not to local_data', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    await new Promise<void>((resolve, reject) => {
      db.saveModeData(
        LoginMode.LOCAL,
        'annotation',
        { foo: 'bar' },
        true,
        DEFAULT_BUNDLE_ID,
      ).subscribe({ next: () => resolve(), error: reject });
    });

    const bundleRow = await db.bundles.get([DEFAULT_BUNDLE_ID, 'annotation']);
    expect(bundleRow?.value).toEqual({ foo: 'bar' });

    const localDataRow = await db.localData.get('annotation');
    expect(localDataRow).toBeUndefined();

    db.close();
  });

  it('loadDataOfMode(LOCAL, ...) reads from bundles at [bundleId, name], not from local_data', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    await db.bundles.put({
      bundleId: DEFAULT_BUNDLE_ID,
      name: 'annotation',
      value: { foo: 'baz' },
    });
    // A value under the same `name` sitting in local_data must be ignored
    // once routing goes through bundles.
    await db.localData.put({ name: 'annotation', value: { foo: 'wrong-table' } });

    const result = await new Promise((resolve, reject) => {
      db.loadDataOfMode(
        LoginMode.LOCAL,
        'annotation',
        undefined,
        DEFAULT_BUNDLE_ID,
      ).subscribe({ next: resolve, error: reject });
    });

    expect(result).toEqual({ foo: 'baz' });

    db.close();
  });

  it('saveModeData(LOCAL, ..., overwrite=false) updates an existing bundles row', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    await db.bundles.put({
      bundleId: 'bundle-1',
      name: 'options',
      value: { currentEditor: 'old' },
    });

    await new Promise<void>((resolve, reject) => {
      db.saveModeData(
        LoginMode.LOCAL,
        'options',
        { currentEditor: 'new' },
        false,
        'bundle-1',
      ).subscribe({ next: () => resolve(), error: reject });
    });

    const bundleRow = await db.bundles.get(['bundle-1', 'options']);
    expect(bundleRow!.value).toEqual({ currentEditor: 'new' });

    db.close();
  });

  it('saveModeData(LOCAL, ..., overwrite=false) against a missing row falls back to put() and creates it (Fix 1)', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();
    // Dexie's Table.update() silently no-ops on a missing key instead of
    // creating one — a bundle beyond DEFAULT_BUNDLE_ID/URL mode (never
    // pre-seeded by checkAndFillPopulation()) has no row yet on its first
    // save. saveModeData() must fall back to put() so the save actually
    // persists instead of vanishing.
    await db.bundles.delete(['new-bundle-id', 'options']);

    await new Promise<void>((resolve, reject) => {
      db.saveModeData(
        LoginMode.LOCAL,
        'options',
        { currentEditor: 'new' },
        false,
        'new-bundle-id',
      ).subscribe({ next: () => resolve(), error: reject });
    });

    const bundleRow = await db.bundles.get(['new-bundle-id', 'options']);
    expect(bundleRow?.value).toEqual({ currentEditor: 'new' });

    db.close();
  });

  it('saveModeData(LOCAL, ..., overwrite=false) called twice for a new bundle updates in place, not duplicating rows', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();
    await db.bundles.delete(['new-bundle-id', 'options']);

    await new Promise<void>((resolve, reject) => {
      db.saveModeData(
        LoginMode.LOCAL,
        'options',
        { currentEditor: 'first' },
        false,
        'new-bundle-id',
      ).subscribe({ next: () => resolve(), error: reject });
    });
    await new Promise<void>((resolve, reject) => {
      db.saveModeData(
        LoginMode.LOCAL,
        'options',
        { currentEditor: 'second' },
        false,
        'new-bundle-id',
      ).subscribe({ next: () => resolve(), error: reject });
    });

    const allRows = await db.bundles
      .where('bundleId')
      .equals('new-bundle-id')
      .toArray();
    expect(allRows).toHaveLength(1);
    expect(allRows[0].value).toEqual({ currentEditor: 'second' });

    db.close();
  });

  it('saveModeData(LOCAL, ..., overwrite=false) against an EXISTING row updates via update(), never falls through to put() (regression)', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();
    // checkAndFillPopulation() auto-populates DEFAULT_BUNDLE_ID's 'options'
    // row during init() — assert the pre-existing-row path still uses
    // update() and doesn't always fall through to put().
    const existing = await db.bundles.get([DEFAULT_BUNDLE_ID, 'options']);
    expect(existing).toBeDefined();

    const putSpy = jest.spyOn(db.bundles, 'put');

    await new Promise<void>((resolve, reject) => {
      db.saveModeData(
        LoginMode.LOCAL,
        'options',
        { currentEditor: 'updated-via-update' },
        false,
        DEFAULT_BUNDLE_ID,
      ).subscribe({ next: () => resolve(), error: reject });
    });

    expect(putSpy).not.toHaveBeenCalled();
    const bundleRow = await db.bundles.get([DEFAULT_BUNDLE_ID, 'options']);
    expect(bundleRow?.value).toEqual({ currentEditor: 'updated-via-update' });

    putSpy.mockRestore();
    db.close();
  });

  it('saveModeData(ONLINE, ...) is unaffected — still writes to online_data, not bundles', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    await new Promise<void>((resolve, reject) => {
      db.saveModeData(LoginMode.ONLINE, 'annotation', { foo: 'online' }, true).subscribe(
        { next: () => resolve(), error: reject },
      );
    });

    const onlineRow = await db.onlineData.get('annotation');
    expect(onlineRow?.value).toEqual({ foo: 'online' });

    const bundleRow = await db.bundles.get([DEFAULT_BUNDLE_ID, 'annotation']);
    expect(bundleRow).toBeUndefined();

    db.close();
  });
});

describe('TrattDatabase.listLocalBundleIds()', () => {
  const DB_NAME = 'tratt-database-list-local-bundle-ids-test';

  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('returns every distinct bundleId present in the bundles table', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    await db.bundles.bulkPut([
      { bundleId: 'bundle-1', name: 'options', value: { currentEditor: '2D-Editor' } },
      { bundleId: 'bundle-1', name: 'annotation', value: { foo: 'bar' } },
      { bundleId: 'bundle-2', name: 'options', value: { currentEditor: '2D-Editor' } },
      { bundleId: 'bundle-2', name: 'annotation', value: { foo: 'baz' } },
      { bundleId: 'bundle-3', name: 'options', value: { currentEditor: '2D-Editor' } },
    ]);

    const ids = await db.listLocalBundleIds();

    expect([...ids].sort()).toEqual(['bundle-1', 'bundle-2', 'bundle-3'].sort());

    db.close();
  });
});

describe('TrattDatabase.deleteLocalBundles()', () => {
  const DB_NAME = 'tratt-database-delete-local-bundles-test';

  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('deletes every row for the given bundle ids and leaves the rest untouched', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    await db.bundles.bulkPut([
      { bundleId: 'bundle-1', name: 'options', value: { a: 1 } },
      { bundleId: 'bundle-1', name: 'annotation', value: { a: 2 } },
      { bundleId: 'bundle-2', name: 'options', value: { b: 1 } },
      { bundleId: 'bundle-3', name: 'options', value: { c: 1 } },
    ]);

    await db.deleteLocalBundles(['bundle-1', 'bundle-2']);

    const remainingIds = await db.listLocalBundleIds();
    expect(remainingIds).toEqual(['bundle-3']);
    expect(await db.bundles.get(['bundle-1', 'options'])).toBeUndefined();
    expect(await db.bundles.get(['bundle-1', 'annotation'])).toBeUndefined();
    expect(await db.bundles.get(['bundle-2', 'options'])).toBeUndefined();
    expect(await db.bundles.get(['bundle-3', 'options'])).toBeDefined();

    db.close();
  });

  it('is a no-op when none of the given ids are present', async () => {
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    await db.bundles.bulkPut([
      { bundleId: 'bundle-1', name: 'options', value: { a: 1 } },
    ]);

    await expect(
      db.deleteLocalBundles(['does-not-exist']),
    ).resolves.toBeUndefined();
    expect(await db.bundles.get(['bundle-1', 'options'])).toBeDefined();

    db.close();
  });
});

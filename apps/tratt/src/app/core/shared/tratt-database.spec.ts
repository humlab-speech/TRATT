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

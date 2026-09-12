import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

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
import { DEFAULT_BUNDLE_ID } from '../store/login-mode/annotation/local-bundle-collection';

describe('TrattDatabase — v0.5 to v0.6 migration', () => {
  const DB_NAME = 'migration-test-db';

  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('moves an existing local_data session into the bundles table under DEFAULT_BUNDLE_ID', async () => {
    // Seed a v0.5 database directly with Dexie, bypassing TrattDatabase's own
    // (now-v0.6) schema, to simulate a real user's existing database.
    const seedDb = new Dexie(DB_NAME);
    seedDb.version(0.5).stores({
      demo_data: '&name, value',
      online_data: '&name, value',
      local_data: '&name, value',
      url_data: '&name, value',
      app_options: '&name, value',
    });
    await seedDb.open();
    await seedDb.table('local_data').bulkPut([
      {
        name: 'options',
        value: { currentEditor: 'Dictaphone Editor', comment: 'seeded comment' },
      },
      { name: 'annotation', value: { levels: [], links: [] } },
      { name: 'logs', value: [{ type: 'test', timestamp: 123 }] },
      { name: 'importOptions', value: { someOption: true } },
    ]);
    seedDb.close();

    // Now open with TrattDatabase, which should trigger the 0.5 -> 0.6 upgrade.
    const db = new TrattDatabase(DB_NAME);
    await db.init();

    const bundleOptions = await db
      .table('bundles')
      .get([DEFAULT_BUNDLE_ID, 'options']);
    const bundleAnnotation = await db
      .table('bundles')
      .get([DEFAULT_BUNDLE_ID, 'annotation']);
    const bundleLogs = await db.table('bundles').get([DEFAULT_BUNDLE_ID, 'logs']);
    const bundleImportOptions = await db
      .table('bundles')
      .get([DEFAULT_BUNDLE_ID, 'importOptions']);

    expect(bundleOptions?.value).toEqual({
      currentEditor: 'Dictaphone Editor',
      comment: 'seeded comment',
    });
    expect(bundleAnnotation?.value).toEqual({ levels: [], links: [] });
    expect(bundleLogs?.value).toEqual([{ type: 'test', timestamp: 123 }]);
    expect(bundleImportOptions?.value).toEqual({ someOption: true });

    // The original local_data rows must still exist — copy, not move.
    const originalOptions = await db.table('local_data').get('options');
    expect(originalOptions?.value).toEqual({
      currentEditor: 'Dictaphone Editor',
      comment: 'seeded comment',
    });

    db.close();
  });

  it('creates a pre-upgrade backup database when migrating from 0.5', async () => {
    const seedDb = new Dexie(DB_NAME);
    seedDb.version(0.5).stores({
      demo_data: '&name, value',
      online_data: '&name, value',
      local_data: '&name, value',
      url_data: '&name, value',
      app_options: '&name, value',
    });
    await seedDb.open();
    await seedDb.table('local_data').put({ name: 'options', value: {} });
    seedDb.close();

    const db = new TrattDatabase(DB_NAME);
    await db.init();
    db.close();

    // A backup database named `${DB_NAME}_backup_<timestamp>` should now exist.
    const allDbNames = await Dexie.getDatabaseNames();
    expect(allDbNames.some((name) => name.startsWith(`${DB_NAME}_backup_`))).toBe(
      true,
    );
  });
});

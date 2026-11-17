import { ISegmentLevel } from '@tratt/annotation';
import {
  draftDatabaseName,
  legacyDraftDatabaseName,
  MemoryDraftStore,
} from './visp-draft-store';

const level = {
  name: 'Transcription',
  type: 'SEGMENT',
  items: [],
} as unknown as ISegmentLevel;
const base = { name: 'b1', levels: [] } as any;

describe('VISP drafts', () => {
  it('are kept per user: another user on the same browser has a database of their own', () => {
    const a = draftDatabaseName(
      '/annotation-ws',
      'p1',
      'Transcription',
      'user_a',
    );
    const b = draftDatabaseName(
      '/annotation-ws',
      'p1',
      'Transcription',
      'user_b',
    );
    expect(a).not.toBe(b);
    // and neither is the old database without an owner, which is dropped
    expect([a, b]).not.toContain(
      legacyDraftDatabaseName('/annotation-ws', 'p1', 'Transcription'),
    );
    // a user name cannot be made to look like another one's database
    expect(draftDatabaseName('s', 'p', 'l', 'a:user:b')).not.toBe(
      draftDatabaseName('s', 'p', 'l:user:a', 'b'),
    );
  });

  it('keep the version their base had on the server', async () => {
    const store = new MemoryDraftStore();
    await store.put({ session: 's', name: 'b1' }, level, base, 'v1');
    expect((await store.get({ session: 's', name: 'b1' }))?.baseVersion).toBe(
      'v1',
    );
  });

  it('expire: prune drops those not written since the cutoff', async () => {
    const store = new MemoryDraftStore();
    await store.put({ session: 's', name: 'old' }, level, base);
    await store.put({ session: 's', name: 'new' }, level, base);
    store.drafts.get('s\u0000old')!.updatedAt = 1000;
    await store.prune(2000);
    expect(await store.get({ session: 's', name: 'old' })).toBeUndefined();
    expect(await store.get({ session: 's', name: 'new' })).toBeDefined();
  });
});

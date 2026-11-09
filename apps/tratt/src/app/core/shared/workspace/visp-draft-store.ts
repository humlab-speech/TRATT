import { IAnnotJSON, ISegmentLevel } from '@tratt/annotation';
import Dexie from 'dexie';
import { BundleRef } from './bundle-source';

/**
 * Unsaved work on one assigned bundle, kept in the browser until it is saved
 * to VISP or deliberately discarded. `base` is the server annotation the draft
 * started from: a later save is checked against it, so a reload never turns
 * an old draft into a silent overwrite of someone else's newer save.
 */
export interface VispDraft {
  key: string;
  session: string;
  name: string;
  /** The owned level as edited (TRATT convention, plain labels). */
  level: ISegmentLevel;
  base: IAnnotJSON;
  updatedAt: number;
}

export interface VispDraftStore {
  get(ref: BundleRef): Promise<VispDraft | undefined>;
  put(ref: BundleRef, level: ISegmentLevel, base: IAnnotJSON): Promise<void>;
  delete(ref: BundleRef): Promise<void>;
}

export const draftKey = (ref: Pick<BundleRef, 'session' | 'name'>) =>
  `${ref.session}\u0000${ref.name}`;

class DraftDatabase extends Dexie {
  drafts!: Dexie.Table<VispDraft, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ drafts: '&key' });
    this.drafts = this.table('drafts');
  }
}

/**
 * One small database per VISP server and project, next to (not inside) the
 * workspace's TRATT database, so the main schema is untouched.
 */
export class IndexedDbDraftStore implements VispDraftStore {
  private readonly db: DraftDatabase;

  constructor(serverUrl: string, projectId: string) {
    this.db = new DraftDatabase(`tratt-visp-drafts:${serverUrl}:${projectId}`);
  }

  get(ref: BundleRef) {
    return this.db.drafts.get(draftKey(ref));
  }

  async put(ref: BundleRef, level: ISegmentLevel, base: IAnnotJSON) {
    await this.db.drafts.put({
      key: draftKey(ref),
      session: ref.session,
      name: ref.name,
      level,
      base,
      updatedAt: Date.now(),
    });
  }

  async delete(ref: BundleRef) {
    await this.db.drafts.delete(draftKey(ref));
  }
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** For tests, and as a fallback where IndexedDB is unavailable. */
export class MemoryDraftStore implements VispDraftStore {
  readonly drafts = new Map<string, VispDraft>();

  async get(ref: BundleRef) {
    const d = this.drafts.get(draftKey(ref));
    return d ? copy(d) : undefined;
  }

  async put(ref: BundleRef, level: ISegmentLevel, base: IAnnotJSON) {
    this.drafts.set(
      draftKey(ref),
      copy({
        key: draftKey(ref),
        session: ref.session,
        name: ref.name,
        level,
        base,
        updatedAt: Date.now(),
      }),
    );
  }

  async delete(ref: BundleRef) {
    this.drafts.delete(draftKey(ref));
  }
}

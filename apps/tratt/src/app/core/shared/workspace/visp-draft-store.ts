import { IAnnotJSON, ISegmentLevel } from '@tratt/annotation';
import Dexie from 'dexie';
import { BundleRef } from './bundle-source';

/**
 * Unsaved work on one assigned bundle, kept in the browser until it is saved
 * to VISP or deliberately discarded. `base` is the server annotation the draft
 * started from: a later save is checked against it, so a reload never turns
 * an old draft into a silent overwrite of someone else's newer save.
 *
 * Drafts belong to the Visp user who made them (one database per user): on a
 * shared browser, whoever signs in next never sees, nor saves, them.
 */
export interface VispDraft {
  key: string;
  session: string;
  name: string;
  /** The owned level as edited (TRATT convention, plain labels). */
  level: ISegmentLevel;
  base: IAnnotJSON;
  /** The server's version of `base`, if it reported one. */
  baseVersion?: string;
  updatedAt: number;
}

/** A draft not touched for this long is dropped when its user next opens Tratt. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface VispDraftStore {
  get(ref: BundleRef): Promise<VispDraft | undefined>;
  put(
    ref: BundleRef,
    level: ISegmentLevel,
    base: IAnnotJSON,
    baseVersion?: string,
  ): Promise<void>;
  delete(ref: BundleRef): Promise<void>;
  /** Drops drafts last written before `before` (ms since the epoch). */
  prune(before: number): Promise<void>;
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
 * The database name before drafts were kept per user. Its drafts cannot be
 * told apart by owner, so they are dropped rather than shown to whoever is
 * signed in now.
 */
export const legacyDraftDatabaseName = (
  serverUrl: string,
  projectId: string,
  level: string,
) => `tratt-visp-drafts:${serverUrl}:${projectId}:${level}`;

export const draftDatabaseName = (
  serverUrl: string,
  projectId: string,
  level: string,
  user: string,
) =>
  `tratt-visp-drafts:${serverUrl}:${projectId}:${level}:user:${encodeURIComponent(user)}`;

/**
 * One small database per VISP server, project, level and user, next to (not
 * inside) the workspace's TRATT database, so the main schema is untouched.
 */
export class IndexedDbDraftStore implements VispDraftStore {
  private readonly db: DraftDatabase;

  constructor(
    serverUrl: string,
    projectId: string,
    level: string,
    user: string,
  ) {
    // Per level: a draft holds the edited level, which must never be spliced
    // into another level after the user relaunches TRATT on a different one.
    // Per user: see VispDraft.
    this.db = new DraftDatabase(
      draftDatabaseName(serverUrl, projectId, level, user),
    );
    void Dexie.delete(legacyDraftDatabaseName(serverUrl, projectId, level));
  }

  get(ref: BundleRef) {
    return this.db.drafts.get(draftKey(ref));
  }

  async put(
    ref: BundleRef,
    level: ISegmentLevel,
    base: IAnnotJSON,
    baseVersion?: string,
  ) {
    await this.db.drafts.put({
      key: draftKey(ref),
      session: ref.session,
      name: ref.name,
      level,
      base,
      baseVersion,
      updatedAt: Date.now(),
    });
  }

  async delete(ref: BundleRef) {
    await this.db.drafts.delete(draftKey(ref));
  }

  async prune(before: number) {
    await this.db.drafts.filter((d) => !(d.updatedAt >= before)).delete();
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

  async put(
    ref: BundleRef,
    level: ISegmentLevel,
    base: IAnnotJSON,
    baseVersion?: string,
  ) {
    this.drafts.set(
      draftKey(ref),
      copy({
        key: draftKey(ref),
        session: ref.session,
        name: ref.name,
        level,
        base,
        baseVersion,
        updatedAt: Date.now(),
      }),
    );
  }

  async delete(ref: BundleRef) {
    this.drafts.delete(draftKey(ref));
  }

  async prune(before: number) {
    for (const [key, d] of this.drafts) {
      if (!(d.updatedAt >= before)) this.drafts.delete(key);
    }
  }
}

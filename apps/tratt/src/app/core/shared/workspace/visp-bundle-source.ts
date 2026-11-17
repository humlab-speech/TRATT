import { IAnnotJSON, ISegmentLevel } from '@tratt/annotation';
import { Observable, from } from 'rxjs';
import { BundleRef, BundleSource } from './bundle-source';
import {
  Editability,
  EmuDbConfig,
  allowedLabelNames,
  checkEditable,
  extractOwnedLevel,
  spliceOwnedLevel,
  toPlainOwnedLevel,
} from './emu-annotation-splice';
import { EmuServerError, EmuWebsocketClient } from './emu-websocket-client';
import type { Workspace } from './workspace';

type VispWorkspace = Extract<Workspace, { kind: 'visp' }>;

/** Someone else saved the bundle since this draft was loaded. */
export class StaleBundleError extends Error {
  constructor(public readonly serverAnnotation: IAnnotJSON) {
    super('The bundle was changed on the server since it was opened.');
    this.name = 'StaleBundleError';
  }
}

export class UntrustedMediaError extends Error {
  constructor(url: string) {
    super(`Refusing to fetch audio from ${url}`);
    this.name = 'UntrustedMediaError';
  }
}

/**
 * The server returns absolute media URLs on the Artic origin. They are only
 * accepted if that origin is the configured one, and the same path is fetched
 * from our own origin (same-origin requests carry the session cookies even
 * under COEP credentialless).
 */
export function sameOriginMediaUrl(
  mediaUrl: string,
  mediaOrigin: string,
  ownOrigin: string,
): string {
  const parsed = new URL(mediaUrl, ownOrigin);
  const allowed = new URL(mediaOrigin).origin;
  if (parsed.origin !== allowed && parsed.origin !== ownOrigin) {
    throw new UntrustedMediaError(mediaUrl);
  }
  return ownOrigin + parsed.pathname + parsed.search;
}

/** Throws if another tab has switched the shared `projectId` cookie. */
export function projectCookieGuard(
  projectId: string,
  readCookie: () => string,
): () => void {
  return () => {
    const match = /(?:^|;\s*)projectId=([^;]*)/.exec(readCookie());
    const current = match ? decodeURIComponent(match[1]) : undefined;
    if (current !== projectId) {
      throw new Error(
        'Another Visp tab has switched to a different project. Reload Tratt from Visp.',
      );
    }
  };
}

interface BundleData {
  annotation: IAnnotJSON;
  mediaFile: { data: string; encoding: string };
  /** sha256 of the stored file; what SAVEBUNDLE's baseVersion refers to. */
  annotationVersion?: string;
}

/** The server's answer to a save based on an outdated version. */
const STALE_REPLY = /^STALE\b/;

/** One GETBUNDLE: the server's annotation and a way to fetch the audio. */
export interface FetchedBundle {
  annotation: IAnnotJSON;
  /** The server's version of `annotation` (see VispBundleSource.versionOf). */
  version?: string;
  sampleRate: number;
  audio: () => Promise<Blob>;
}

export interface SaveOptions {
  /**
   * Save even if the server file changed since the draft's base: the owned
   * level replaces the server's, everything else stays as the server has it
   * now. The user's explicit "keep my version".
   */
  force?: boolean;
  /** TRATT's break marker, written as an empty label. */
  breakMarker?: string;
}

export class VispBundleSource implements BundleSource {
  readonly canAddBundles = false;

  /** The server annotation each open draft started from. */
  private readonly base = new Map<string, IAnnotJSON>();
  /** The server's version of each base: a save is refused unless it is still current. */
  private readonly baseVersion = new Map<string, string | undefined>();
  private dbConfig?: Promise<EmuDbConfig>;
  private user?: Promise<string>;

  constructor(
    private readonly workspace: VispWorkspace,
    private readonly client: EmuWebsocketClient,
    private readonly ownOrigin: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private key(ref: BundleRef) {
    return `${ref.session}\u0000${ref.name}`;
  }

  getDbConfig(): Promise<EmuDbConfig> {
    return (this.dbConfig ??= this.client
      .request<EmuDbConfig>('GETGLOBALDBCONFIG')
      .catch((e) => {
        this.dbConfig = undefined;
        throw e;
      }));
  }

  async editability(): Promise<Editability> {
    return checkEditable(
      await this.getDbConfig(),
      this.workspace.transcriptionLevel,
    );
  }

  /**
   * Whose sign-in this is. Unsaved work is kept per user and every save says
   * whose it is: on a shared browser, one person's leftovers must not be
   * saved under the next person's sign-in.
   */
  whoAmI(): Promise<string> {
    return (this.user ??= this.client
      .request<{ username?: unknown }>('WHOAMI')
      .then((data) => {
        if (typeof data?.username !== 'string' || data.username === '') {
          throw new Error('Visp did not say who is signed in.');
        }
        return data.username;
      })
      .catch((e) => {
        this.user = undefined;
        throw e;
      }));
  }

  listBundles(): Observable<BundleRef[]> {
    return from(this.client.request<BundleRef[]>('GETBUNDLELIST'));
  }

  private getBundle(ref: BundleRef) {
    return this.client.request<BundleData>('GETBUNDLE', {
      name: ref.name,
      session: ref.session,
    });
  }

  /**
   * Reads the bundle and makes its annotation the base the next save is
   * checked against.
   */
  async fetchBundle(ref: BundleRef): Promise<FetchedBundle> {
    const data = await this.getBundle(ref);
    this.base.set(this.key(ref), data.annotation);
    this.baseVersion.set(this.key(ref), data.annotationVersion);
    const url = sameOriginMediaUrl(
      data.mediaFile.data,
      this.workspace.mediaOrigin,
      this.ownOrigin,
    );
    return {
      annotation: data.annotation,
      version: data.annotationVersion,
      sampleRate: Number((data.annotation as any)?.sampleRate) || 0,
      audio: async () => {
        const res = await this.fetchFn(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Audio request failed (${res.status})`);
        return res.blob();
      },
    };
  }

  /**
   * A draft kept in the browser started from `annotation`, not from what the
   * server has now: the stale check must compare against that.
   */
  adoptBase(ref: BundleRef, annotation: IAnnotJSON, version?: string): void {
    this.base.set(this.key(ref), annotation);
    this.baseVersion.set(this.key(ref), version);
  }

  baseOf(ref: BundleRef): IAnnotJSON | undefined {
    return this.base.get(this.key(ref));
  }

  /** The server's version of the base (undefined from servers that do not report one). */
  versionOf(ref: BundleRef): string | undefined {
    return this.baseVersion.get(this.key(ref));
  }

  /** BundleSource: the owned level and the audio. */
  async loadBundle(
    ref: BundleRef,
    totalSamples = 0,
  ): Promise<{ annotation: ISegmentLevel; audio: () => Promise<Blob> }> {
    const fetched = await this.fetchBundle(ref);
    return {
      annotation: extractOwnedLevel(
        fetched.annotation,
        this.workspace.transcriptionLevel,
        totalSamples,
      ),
      audio: fetched.audio,
    };
  }

  async save(
    ref: BundleRef,
    annotation: unknown,
    meta: { finishedEditing?: boolean; comment?: string } = {},
    options: SaveOptions = {},
  ): Promise<void> {
    const editability = await this.editability();
    if (!editability.editable) {
      throw new Error(`This workspace is read-only (${editability.reason}).`);
    }
    const base = this.base.get(this.key(ref));
    if (!base) {
      throw new Error('Bundle was not loaded before saving.');
    }
    // An early, friendly check. What closes the race is baseVersion below:
    // the server writes only if the file is still the version this save is
    // based on, checked and written in one step.
    const fresh = await this.getBundle(ref);
    const current = fresh.annotation;
    if (!options.force && JSON.stringify(current) !== JSON.stringify(base)) {
      throw new StaleBundleError(current);
    }
    // "Keep my version" is based on what the server has now.
    const baseVersion = options.force
      ? fresh.annotationVersion
      : this.baseVersion.get(this.key(ref));
    const level = toPlainOwnedLevel(annotation as ISegmentLevel, {
      allowedLabels: allowedLabelNames(
        await this.getDbConfig(),
        this.workspace.transcriptionLevel,
      ),
      breakMarker: options.breakMarker,
    });
    const merged = spliceOwnedLevel(current, level);
    let saved: { annotationVersion?: string } | undefined;
    try {
      saved = await this.client.request('SAVEBUNDLE', {
        data: {
          annotation: merged,
          session: ref.session,
          finishedEditing: meta.finishedEditing ?? ref.finishedEditing ?? false,
          comment: meta.comment ?? ref.comment ?? '',
          // never send ssffFiles: existing tracks stay untouched
          // The server refuses the save if the file changed since baseVersion,
          // if it changes any level but this one, or if someone else is now
          // signed in in this browser.
          baseVersion,
          level: this.workspace.transcriptionLevel,
          expectedUser: await this.whoAmI(),
        },
      });
    } catch (e) {
      if (e instanceof EmuServerError && STALE_REPLY.test(e.message)) {
        throw new StaleBundleError((await this.getBundle(ref)).annotation);
      }
      throw e;
    }
    this.base.set(this.key(ref), merged);
    this.baseVersion.set(this.key(ref), saved?.annotationVersion);
  }
}

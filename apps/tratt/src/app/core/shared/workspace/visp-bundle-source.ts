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
import { EmuWebsocketClient } from './emu-websocket-client';
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
        'Another VISP tab has switched to a different project. Reload TRATT from VISP.',
      );
    }
  };
}

interface BundleData {
  annotation: IAnnotJSON;
  mediaFile: { data: string; encoding: string };
}

/** One GETBUNDLE: the server's annotation and a way to fetch the audio. */
export interface FetchedBundle {
  annotation: IAnnotJSON;
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
  private dbConfig?: Promise<EmuDbConfig>;

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
    const url = sameOriginMediaUrl(
      data.mediaFile.data,
      this.workspace.mediaOrigin,
      this.ownOrigin,
    );
    return {
      annotation: data.annotation,
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
  adoptBase(ref: BundleRef, annotation: IAnnotJSON): void {
    this.base.set(this.key(ref), annotation);
  }

  baseOf(ref: BundleRef): IAnnotJSON | undefined {
    return this.base.get(this.key(ref));
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
    // The protocol has no versioning: this narrows the race, it cannot close it.
    const current = (await this.getBundle(ref)).annotation;
    if (!options.force && JSON.stringify(current) !== JSON.stringify(base)) {
      throw new StaleBundleError(current);
    }
    const level = toPlainOwnedLevel(annotation as ISegmentLevel, {
      allowedLabels: allowedLabelNames(
        await this.getDbConfig(),
        this.workspace.transcriptionLevel,
      ),
      breakMarker: options.breakMarker,
    });
    const merged = spliceOwnedLevel(current, level);
    await this.client.request('SAVEBUNDLE', {
      data: {
        annotation: merged,
        session: ref.session,
        finishedEditing: meta.finishedEditing ?? ref.finishedEditing ?? false,
        comment: meta.comment ?? ref.comment ?? '',
        // never send ssffFiles: existing tracks stay untouched
      },
    });
    this.base.set(this.key(ref), merged);
  }
}

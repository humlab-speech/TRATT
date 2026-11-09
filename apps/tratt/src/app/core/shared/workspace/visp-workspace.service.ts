import { Injectable, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  IAnnotJSON,
  ISegmentLevel,
  OAnnotJSON,
  OLabel,
  OSegment,
  OSegmentLevel,
  TrattAnnotation,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { SessionFile } from '../../obj/SessionFile';
import { LoginMode, RootState } from '../../store';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import {
  breakMarkerCodeOf,
  selectLocalMode,
} from '../../store/login-mode/annotation/annotation.selectors';
import {
  DEFAULT_BUNDLE_ID,
  IdentifiedAnnotationState,
  LocalBundleCollectionState,
} from '../../store/login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { AudioService } from '../service/audio.service';
import { PendingEditsService } from '../service/pending-edits.service';
import { BundleRef } from './bundle-source';
import {
  allowedLabelNames,
  extractOwnedLevel,
  hasContent,
  ownedLevelKey,
  toPlainOwnedLevel,
} from './emu-annotation-splice';
import { EmuWebsocketClient } from './emu-websocket-client';
import {
  FetchedBundle,
  StaleBundleError,
  VispBundleSource,
  projectCookieGuard,
} from './visp-bundle-source';
import {
  IndexedDbDraftStore,
  MemoryDraftStore,
  VispDraftStore,
} from './visp-draft-store';
import { VispErrorKind, classifyVispError } from './visp-errors';
import { WorkspaceService } from './workspace.service';

export type SyncState = 'saved' | 'unsaved' | 'saving' | 'failed';

export interface VispBundleInfo {
  ref: BundleRef;
  sync: SyncState;
  /** Whether the store holds this bundle's transcript (from VISP or a draft). */
  opened: boolean;
  /** The annotation's sample rate as VISP has it. */
  sampleRate?: number;
  /**
   * No longer in the user's assignment, but kept because it has unsaved
   * changes: it cannot be saved, only downloaded or removed.
   */
  unassigned?: boolean;
  error?: { kind: VispErrorKind; message: string };
}

export interface VispProblem {
  kind: VispErrorKind;
  message: string;
}

/** The recording's `File` name for an assigned bundle. */
export const bundleFileName = (ref: BundleRef) => `${ref.name}.wav`;

/**
 * The workbench id of an assigned bundle: stable per session and name, so a
 * reload reuses the same entity (and browser storage row) instead of piling
 * up a new one per visit. The first bundle uses DEFAULT_BUNDLE_ID instead,
 * because it starts the session through the login chain.
 */
export const vispBundleId = (ref: BundleRef) =>
  `visp:${encodeURIComponent(ref.session)}/${encodeURIComponent(ref.name)}`;

/** An owned level (TRATT convention) as the annotation the editor loads. */
export function annotationFromOwnedLevel(
  ref: BundleRef,
  level: ISegmentLevel,
  sampleRate: number,
): OAnnotJSON {
  return new OAnnotJSON(
    bundleFileName(ref),
    ref.name,
    sampleRate,
    [
      new OSegmentLevel(
        level.name,
        level.items.map(
          (i) =>
            new OSegment(
              i.id,
              i.sampleStart,
              i.sampleDur,
              i.labels.map((l) => new OLabel(l.name, l.value)),
            ),
        ),
      ),
    ],
    [],
  );
}

/** The owned level of an edited transcript, in TRATT's convention. */
export function ownedLevelOf(
  transcript: TrattAnnotation<any>,
  levelName: string,
  sampleRate: number,
): ISegmentLevel | undefined {
  // SampleUnit(0): never pad a trailing gap — only what the user has is sent.
  const json = transcript.serialize(
    '',
    sampleRate,
    new SampleUnit(0, sampleRate),
  );
  return json.levels.find((l) => l.name === levelName) as
    | ISegmentLevel
    | undefined;
}

const DRAFT_WRITE_DELAY_MS = 400;
const PREPARE_CONCURRENCY = 4;

/**
 * Drives the VISP workspace: mirrors the user's assignment into the workbench's
 * bundle list, keeps unsaved work in the browser, and saves bundles back
 * through `VispBundleSource`.
 *
 * Every assigned bundle's annotation is read when the list loads (audio only
 * when needed), so the list and the Transcribe queue know which bundles
 * already have text in VISP.
 */
@Injectable({ providedIn: 'root' })
export class VispWorkspaceService {
  private readonly store = inject<Store<RootState>>(Store);
  private readonly audio = inject(AudioService);
  private readonly auth = inject(AuthenticationStoreService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly pendingEdits = inject(PendingEditsService);

  private source?: VispBundleSource;
  private client?: EmuWebsocketClient;
  private drafts?: VispDraftStore;
  private started = false;
  private watching = false;
  private allowedLabels?: string[];

  /** GETBUNDLE results, per bundle id. */
  private readonly fetched = new Map<string, FetchedBundle>();
  /** The VISP version (owned level) each bundle's work is based on. */
  private readonly baseline = new Map<string, ISegmentLevel>();
  /** The first bundle's audio, fetched once and handed to the decoder. */
  private readonly primedAudio = new Map<string, File>();
  private readonly draftTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  private readonly _bundles = signal<Record<string, VispBundleInfo>>({});
  private readonly _problem = signal<VispProblem | undefined>(undefined);
  private readonly _readOnly = signal<VispErrorKind | undefined>(undefined);
  private readonly _readOnlyRefs = signal<BundleRef[]>([]);
  private readonly _loading = signal(false);

  readonly bundles = this._bundles.asReadonly();
  readonly problem = this._problem.asReadonly();
  /** Why editing is off (no usable transcription level), if it is. */
  readonly readOnly = this._readOnly.asReadonly();
  /** The assignment, listed by name, when the project cannot be edited. */
  readonly readOnlyRefs = this._readOnlyRefs.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** Bundles kept only because they have unsaved changes. */
  readonly unassignedWithChanges = computed(() =>
    Object.values(this._bundles()).filter((b) => b.unassigned),
  );
  readonly projectId = computed(() => {
    const w = this.workspaceService.workspace();
    return w.kind === 'visp' ? w.projectId : undefined;
  });

  private get workspace() {
    const w = this.workspaceService.workspace();
    if (w.kind !== 'visp') throw new Error('Not in the VISP workspace');
    return w;
  }

  info(bundleId: string): VispBundleInfo | undefined {
    return this._bundles()[bundleId];
  }

  /** Test seam / bootstrap: dependencies can be injected before `start()`. */
  useSource(
    source: VispBundleSource,
    client?: EmuWebsocketClient,
    drafts?: VispDraftStore,
  ) {
    this.source = source;
    this.client = client;
    this.drafts = drafts;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const w = this.workspace;
    this._loading.set(true);
    try {
      if (!this.source) {
        this.client = new EmuWebsocketClient(w.serverUrl, {
          beforeConnect: projectCookieGuard(w.projectId, () => document.cookie),
        });
        this.source = new VispBundleSource(
          w,
          this.client,
          window.location.origin,
        );
      }
      this.drafts ??=
        typeof indexedDB !== 'undefined'
          ? new IndexedDbDraftStore(w.serverUrl, w.projectId)
          : new MemoryDraftStore();

      const editability = await this.source.editability();
      if (!editability.editable) {
        // Nothing TRATT may write to: list the assignment, open no editor.
        this._readOnly.set(
          editability.reason === 'level-linked'
            ? 'level_linked'
            : 'no_transcription_level',
        );
        this._readOnlyRefs.set(await this.listAssignment());
        return;
      }
      this.allowedLabels = allowedLabelNames(
        await this.source.getDbConfig(),
        w.transcriptionLevel,
      );
      await this.loadAssignment();
      this.watchEdits();
    } catch (e) {
      this.fail(e);
    } finally {
      this._loading.set(false);
    }
  }

  /** Re-reads the assignment: new bundles appear, unassigned ones go. */
  async refresh(): Promise<void> {
    if (!this.source) return;
    this._loading.set(true);
    try {
      if (this._readOnly()) {
        this._readOnlyRefs.set(await this.listAssignment());
      } else {
        await this.loadAssignment();
      }
      this._problem.set(undefined);
    } catch (e) {
      this.fail(e);
    } finally {
      this._loading.set(false);
    }
  }

  private listAssignment(): Promise<BundleRef[]> {
    return new Promise<BundleRef[]>((resolve, reject) =>
      this.source!.listBundles().subscribe({ next: resolve, error: reject }),
    );
  }

  private async loadAssignment(): Promise<void> {
    const refs = await this.listAssignment();
    const known = this._bundles();
    const idOf = (r: BundleRef) =>
      Object.entries(known).find(
        ([, b]) => b.ref.session === r.session && b.ref.name === r.name,
      )?.[0];
    const assigned = new Set(
      refs.map((r) => idOf(r)).filter((id): id is string => !!id),
    );

    const next: Record<string, VispBundleInfo> = {};
    const drop: string[] = [];
    for (const [id, b] of Object.entries(known)) {
      if (assigned.has(id)) {
        next[id] = { ...b, unassigned: false };
      } else if (b.sync === 'unsaved' || b.sync === 'failed') {
        // Unsaved work is never dropped silently: keep the row, flagged.
        next[id] = { ...b, unassigned: true };
      } else {
        drop.push(id);
      }
    }
    if (drop.length) {
      this.removeFromWorkbench(drop.map((id) => [id, known[id].ref]));
    }
    // Refresh the server-side finished/comment of bundles already listed.
    for (const ref of refs) {
      const id = idOf(ref);
      if (id && next[id]) {
        next[id] = { ...next[id], ref: { ...next[id].ref, ...ref } };
      }
    }

    const fresh = refs.filter((r) => !idOf(r));
    const hasSession = Object.keys(next).length > 0;
    this._bundles.set(next);
    if (fresh.length && !hasSession) {
      await this.bootstrap(fresh.shift()!);
    }
    for (const ref of fresh) {
      const bundleId = vispBundleId(ref);
      this.registerAudio(bundleId, ref);
      this.store.dispatch(
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId,
          sessionFile: new SessionFile(
            bundleFileName(ref),
            0,
            undefined,
            'audio/wav',
          ),
          selectAfterCreate: false,
          audioLoaded: false,
        }),
      );
      this.setInfo(bundleId, { ref, sync: 'saved', opened: false });
    }
    await this.inPool(fresh, (ref) => this.prepare(vispBundleId(ref), ref));
  }

  /**
   * Reads one bundle's annotation and puts what the user should see into the
   * store: their draft if there is one, else VISP's transcript if it has
   * content. A bundle without either stays unopened (it has nothing to show
   * until its audio is decoded, and counts as not transcribed).
   */
  private async prepare(bundleId: string, ref: BundleRef): Promise<void> {
    try {
      const fetched = await this.fetchFor(bundleId, ref);
      const draft = await this.drafts!.get(ref);
      const sampleRate = fetched.sampleRate;
      if (draft) {
        this.source!.adoptBase(ref, draft.base);
        this.baseline.set(bundleId, this.serverLevel(draft.base, 0));
        this.showLevel(bundleId, ref, draft.level, sampleRate);
        return;
      }
      const level = extractOwnedLevel(
        fetched.annotation,
        this.workspace.transcriptionLevel,
        0,
      );
      this.baseline.set(bundleId, level);
      if (hasContent(level)) {
        this.showLevel(bundleId, ref, level, sampleRate);
      }
    } catch (e) {
      this.patch(bundleId, { error: this.describe(e) });
    }
  }

  /**
   * The first assigned bundle starts the workbench session through the same
   * login chain as a first dropped file, so it needs its audio up front.
   */
  private async bootstrap(ref: BundleRef): Promise<void> {
    const local = this.localState();
    if (local?.bundles.entities[DEFAULT_BUNDLE_ID]?.sessionFile) {
      // A previous visit's first bundle. Its unsaved work, if any, is in the
      // draft store, keyed by session and name, not by this entity.
      this.store.dispatch(
        LoginModeActions.removeBundles({
          mode: LoginMode.LOCAL,
          bundleIds: [DEFAULT_BUNDLE_ID],
        }),
      );
      this.audio.forget(DEFAULT_BUNDLE_ID);
    }
    const bundleId = DEFAULT_BUNDLE_ID;
    this.setInfo(bundleId, { ref, sync: 'saved', opened: false });
    const fetched = await this.fetchFor(bundleId, ref);
    const file = await this.toFile(ref, await fetched.audio());
    this.primedAudio.set(bundleId, file);
    this.registerAudio(bundleId, ref);
    if (!(await this.audio.ensureResident(bundleId))) {
      throw new Error('The recording could not be decoded.');
    }
    const info = this.audio.getMediaInfo(bundleId)!;
    const sampleRate = fetched.sampleRate || info.sampleRate;
    const draft = await this.drafts!.get(ref);
    let level: ISegmentLevel;
    if (draft) {
      this.source!.adoptBase(ref, draft.base);
      this.baseline.set(
        bundleId,
        this.serverLevel(draft.base, info.duration.samples),
      );
      level = draft.level;
    } else {
      level = extractOwnedLevel(
        fetched.annotation,
        this.workspace.transcriptionLevel,
        info.duration.samples,
      );
      this.baseline.set(bundleId, level);
    }
    this.patch(bundleId, { opened: true, sampleRate });
    this.auth.loginLocal(
      [file],
      annotationFromOwnedLevel(ref, level, sampleRate),
      false,
      [bundleId],
    );
  }

  /**
   * Called when the user selects a listed bundle: a bundle that had nothing
   * to show yet gets its (empty) transcript once its audio length is known.
   */
  async open(bundleId: string): Promise<void> {
    const b = this.info(bundleId);
    if (!b || b.opened || b.unassigned) return;
    try {
      if (!(await this.audio.ensureResident(bundleId))) {
        throw new Error('The recording could not be decoded.');
      }
      // A transcript may have arrived meanwhile (a transcription run).
      if (this.info(bundleId)?.opened) return;
      const info = this.audio.getMediaInfo(bundleId)!;
      const fetched = await this.fetchFor(bundleId, b.ref);
      const level = extractOwnedLevel(
        fetched.annotation,
        this.workspace.transcriptionLevel,
        info.duration.samples,
      );
      this.showLevel(
        bundleId,
        b.ref,
        level,
        fetched.sampleRate || info.sampleRate,
      );
      this.patch(bundleId, { error: undefined });
    } catch (e) {
      this.patch(bundleId, { error: this.describe(e) });
      this.fail(e);
    }
  }

  /** Saves a bundle from the store's current transcript. */
  async saveBundle(
    bundleId: string,
    meta: { finishedEditing?: boolean; comment?: string } = {},
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    this.pendingEdits.flush();
    const entity = this.entity(bundleId);
    const b = this.info(bundleId);
    if (!b) return false;
    if (b.unassigned) {
      this.patch(bundleId, {
        sync: 'failed',
        error: {
          kind: 'unassigned',
          message: 'This bundle is no longer assigned to you.',
        },
      });
      return false;
    }
    const level = entity?.transcript
      ? this.plainLevelOf(bundleId, entity)
      : undefined;
    if (!level) {
      this.patch(bundleId, {
        sync: 'failed',
        error: {
          kind: 'unknown',
          message: `The transcript has no "${this.workspace.transcriptionLevel}" tier.`,
        },
      });
      return false;
    }
    this.cancelDraftWrite(bundleId);
    this.patch(bundleId, { sync: 'saving', error: undefined });
    try {
      await this.source!.save(b.ref, level, meta, {
        force: options.force,
        breakMarker: breakMarkerCodeOf(entity!.guidelines),
      });
      this.baseline.set(bundleId, level);
      await this.drafts!.delete(b.ref);
      this.patch(bundleId, {
        sync: 'saved',
        ref: { ...b.ref, ...meta },
      });
      this._problem.set(undefined);
      return true;
    } catch (e) {
      this.patch(bundleId, { sync: 'failed', error: this.describe(e) });
      // A stale bundle is the row's business (it offers the choice).
      if (!(e instanceof StaleBundleError)) this.fail(e);
      return false;
    }
  }

  /**
   * The bundle changed in VISP while the user worked on it.
   * - 'mine': write the user's transcription level into VISP's current file
   *   (other levels stay as VISP has them now);
   * - 'theirs': drop the user's changes and show VISP's version.
   */
  async resolveStale(
    bundleId: string,
    choice: 'mine' | 'theirs',
  ): Promise<void> {
    const b = this.info(bundleId);
    if (!b) return;
    if (choice === 'mine') {
      await this.saveBundle(bundleId, {}, { force: true });
      return;
    }
    try {
      this.cancelDraftWrite(bundleId);
      await this.drafts!.delete(b.ref);
      this.fetched.delete(bundleId);
      const fetched = await this.fetchFor(bundleId, b.ref);
      if (!this.audio.getMediaInfo(bundleId)) {
        await this.audio.ensureResident(bundleId);
      }
      const samples = this.audio.getMediaInfo(bundleId)?.duration.samples ?? 0;
      const level = extractOwnedLevel(
        fetched.annotation,
        this.workspace.transcriptionLevel,
        samples,
      );
      this.baseline.set(bundleId, level);
      this.showLevel(bundleId, b.ref, level, fetched.sampleRate);
      this.patch(bundleId, { sync: 'saved', error: undefined });
    } catch (e) {
      this.patch(bundleId, { error: this.describe(e) });
      this.fail(e);
    }
  }

  /** Removes a bundle that is no longer assigned, discarding its changes. */
  async removeUnassigned(bundleId: string): Promise<void> {
    const b = this.info(bundleId);
    if (!b?.unassigned) return;
    this.removeFromWorkbench([[bundleId, b.ref]]);
    const next = { ...this._bundles() };
    delete next[bundleId];
    this._bundles.set(next);
  }

  /** Tracks edits in the store: sync state per row, drafts in the browser. */
  private watchEdits() {
    if (this.watching) return;
    this.watching = true;
    const seen = new Map<string, unknown>();
    this.store.select(selectLocalMode).subscribe((local) => {
      for (const id of Object.keys(this._bundles())) {
        const entity = local.bundles.entities[id] as
          | IdentifiedAnnotationState
          | undefined;
        const t = entity?.transcript;
        if (t && seen.get(id) !== t) {
          seen.set(id, t);
          this.noteEdited(id, entity!);
        }
      }
    });
  }

  /** Re-evaluates a bundle's sync state against the VISP version. */
  noteEdited(bundleId: string, entity: IdentifiedAnnotationState) {
    const b = this.info(bundleId);
    const base = this.baseline.get(bundleId);
    if (!b || base === undefined || b.sync === 'saving') return;
    const level = this.plainLevelOf(bundleId, entity);
    if (!level) return;
    if (!b.opened) this.patch(bundleId, { opened: true });
    const dirty =
      ownedLevelKey(level) !==
      ownedLevelKey(this.plain(base, breakMarkerCodeOf(entity.guidelines)));
    if (dirty) {
      this.scheduleDraftWrite(bundleId, b.ref, level);
    } else {
      this.cancelDraftWrite(bundleId);
      void this.drafts?.delete(b.ref);
    }
    const current = this.info(bundleId)!;
    // A failed save stays failed (with its message) until it is resolved or
    // the changes are undone.
    if (current.sync === 'failed' && dirty) return;
    const sync: SyncState = dirty ? 'unsaved' : 'saved';
    if (current.sync !== sync) {
      this.patch(bundleId, {
        sync,
        error: sync === 'saved' ? undefined : current.error,
      });
    }
  }

  // --- helpers -------------------------------------------------------------

  private plainLevelOf(
    bundleId: string,
    entity: IdentifiedAnnotationState,
  ): ISegmentLevel | undefined {
    const sampleRate =
      this.info(bundleId)?.sampleRate ||
      this.fetched.get(bundleId)?.sampleRate ||
      this.audio.getMediaInfo(bundleId)?.sampleRate;
    if (!entity.transcript || !sampleRate) return undefined;
    const level = ownedLevelOf(
      entity.transcript,
      this.workspace.transcriptionLevel,
      sampleRate,
    );
    return level
      ? this.plain(level, breakMarkerCodeOf(entity.guidelines))
      : undefined;
  }

  /** A level as it would be written to VISP (see toPlainOwnedLevel). */
  private plain(level: ISegmentLevel, breakMarker?: string): ISegmentLevel {
    return toPlainOwnedLevel(level, {
      allowedLabels: this.allowedLabels,
      breakMarker,
    });
  }

  private serverLevel(
    annotation: IAnnotJSON,
    totalSamples: number,
  ): ISegmentLevel {
    return extractOwnedLevel(
      annotation,
      this.workspace.transcriptionLevel,
      totalSamples,
    );
  }

  /** Puts a level into the store as the bundle's transcript. */
  private showLevel(
    bundleId: string,
    ref: BundleRef,
    level: ISegmentLevel,
    sampleRate: number,
  ) {
    const rate = sampleRate || this.audio.getMediaInfo(bundleId)?.sampleRate;
    if (!rate) throw new Error('The recording has no sample rate.');
    const transcript = TrattAnnotation.deserialize(
      annotationFromOwnedLevel(ref, level, rate),
    );
    if (transcript.levels.length > 0) transcript.changeCurrentLevelIndex(0);
    this.patch(bundleId, { opened: true, sampleRate: rate });
    this.store.dispatch(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId,
        transcript,
      }),
    );
  }

  /** The GETBUNDLE result for a bundle, read once. */
  private async fetchFor(
    bundleId: string,
    ref: BundleRef,
  ): Promise<FetchedBundle> {
    let fetched = this.fetched.get(bundleId);
    if (!fetched) {
      fetched = await this.source!.fetchBundle(ref);
      this.fetched.set(bundleId, fetched);
      this.patch(bundleId, { sampleRate: fetched.sampleRate || undefined });
    }
    return fetched;
  }

  private registerAudio(bundleId: string, ref: BundleRef) {
    this.audio.registerAudioProvider(bundleId, async () => {
      const primed = this.primedAudio.get(bundleId);
      if (primed) {
        this.primedAudio.delete(bundleId);
        return primed;
      }
      const fetched = await this.audioSource(bundleId, ref);
      return this.toFile(ref, await fetched());
    });
  }

  /**
   * The audio fetcher, without moving the stale-check base: re-reading the
   * bundle just for its audio URL must not make an old draft look current.
   */
  private async audioSource(bundleId: string, ref: BundleRef) {
    const cached = this.fetched.get(bundleId);
    if (cached) return cached.audio;
    const base = this.source!.baseOf(ref);
    const fetched = await this.source!.fetchBundle(ref);
    if (base) this.source!.adoptBase(ref, base);
    this.fetched.set(bundleId, fetched);
    return fetched.audio;
  }

  private async toFile(ref: BundleRef, blob: Blob) {
    return new File([blob], bundleFileName(ref), {
      type: blob.type || 'audio/wav',
    });
  }

  private scheduleDraftWrite(
    bundleId: string,
    ref: BundleRef,
    level: ISegmentLevel,
  ) {
    this.cancelDraftWrite(bundleId);
    this.draftTimers.set(
      bundleId,
      setTimeout(() => {
        this.draftTimers.delete(bundleId);
        const base = this.source?.baseOf(ref);
        if (base) void this.drafts?.put(ref, level, base);
      }, DRAFT_WRITE_DELAY_MS),
    );
  }

  private cancelDraftWrite(bundleId: string) {
    const timer = this.draftTimers.get(bundleId);
    if (timer) clearTimeout(timer);
    this.draftTimers.delete(bundleId);
  }

  private removeFromWorkbench(entries: [string, BundleRef][]) {
    this.store.dispatch(
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: entries.map(([id]) => id),
      }),
    );
    for (const [id, ref] of entries) {
      this.cancelDraftWrite(id);
      this.audio.forget(id);
      this.baseline.delete(id);
      this.fetched.delete(id);
      void this.drafts?.delete(ref);
    }
  }

  private async inPool<T>(items: T[], work: (item: T) => Promise<void>) {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        await work(items[next++]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PREPARE_CONCURRENCY, items.length) }, worker),
    );
  }

  private localState(): LocalBundleCollectionState | undefined {
    let state: LocalBundleCollectionState | undefined;
    this.store
      .select(selectLocalMode)
      .subscribe((l) => (state = l))
      .unsubscribe();
    return state;
  }

  private entity(bundleId: string): IdentifiedAnnotationState | undefined {
    return this.localState()?.bundles.entities[bundleId] as
      | IdentifiedAnnotationState
      | undefined;
  }

  private setInfo(bundleId: string, info: VispBundleInfo) {
    this._bundles.set({ ...this._bundles(), [bundleId]: info });
  }

  private patch(bundleId: string, change: Partial<VispBundleInfo>) {
    const cur = this._bundles()[bundleId];
    if (!cur) return;
    this._bundles.set({
      ...this._bundles(),
      [bundleId]: { ...cur, ...change },
    });
  }

  private describe(e: unknown): { kind: VispErrorKind; message: string } {
    return {
      kind: classifyVispError(e),
      message: e instanceof Error ? e.message : String(e),
    };
  }

  private fail(e: unknown) {
    this._problem.set(this.describe(e));
  }

  /** Test helper. */
  _setBundles(b: Record<string, VispBundleInfo>) {
    this._bundles.set(b);
  }
}

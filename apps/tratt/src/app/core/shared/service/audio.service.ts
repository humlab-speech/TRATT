import { HttpClient } from '@angular/common/http';
import {
  effect,
  EventEmitter,
  Injectable,
  isDevMode,
  signal,
  untracked,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskInputOutputDto } from '@octra/api-types';
import { SampleUnit } from '@tratt/media';
import { downloadFile } from '@tratt/ngx-utilities';
import { SubscriptionManager } from '@tratt/utilities';
import { AudioManager } from '@tratt/web-media';
import { filter, firstValueFrom, Subject, Subscription } from 'rxjs';
import { selectSelectedBundleId } from '../../store/login-mode/annotation/annotation.selectors';
import { DEFAULT_BUNDLE_ID } from '../../store/login-mode/annotation/local-bundle-collection';
import { AudioEnvelope, computeAudioEnvelope } from './audio-envelope';

/**
 * Max number of bundles whose `AudioManager` (PCM/blob memory) is kept
 * resident at once. Selecting a 4th distinct bundle evicts the
 * least-recently-selected one; its computed envelope is kept cached so a
 * re-selected bundle can paint instantly while its audio re-decodes.
 */
export const MAX_RESIDENT_BUNDLES = 3;

/**
 * Lightweight, eviction-proof description of a bundle's media, captured
 * once when its `AudioManager` is first registered. Lets consumers that only
 * need metadata (editor header, IDB transcript serialization, catalogue
 * manifest) work without forcing a full re-decode of an evicted bundle.
 */
export interface BundleMediaInfo {
  fullname: string;
  sampleRate: number;
  duration: SampleUnit;
  channels: number;
  size: number;
}

@Injectable()
export class AudioService {
  public missingPermission = new EventEmitter<void>();
  private subscrmanager: SubscriptionManager<Subscription> =
    new SubscriptionManager<Subscription>();
  private afterloaded: EventEmitter<any> = new EventEmitter<any>();

  private _audiomanagers = new Map<string, AudioManager>();
  private _envelopes = new Map<string, AudioEnvelope>();
  private _sourceFiles = new Map<string, File>();
  private _mediaInfo = new Map<string, BundleMediaInfo>();
  private _pendingResidency = new Map<string, Promise<boolean>>();
  /**
   * Bundles that must never be LRU-evicted right now even if they are the
   * least recently used — e.g. the bundle the pipeline queue is currently
   * running (its manager is mid-transcription; destroying it would also
   * drop the result's persistence, see `saveBundleTranscript$`).
   */
  private _pinned = new Set<string>();
  private recentBundleIds: string[] = [];
  private selectedBundleId = this.store.selectSignal(selectSelectedBundleId);

  /**
   * Bumped on every registry change (register / evict / forget / destroy).
   * The registry itself is a plain `Map`, so without this, `computed()`s and
   * `effect()`s reading `hasResident()`/`getManager()`/`current` would never
   * re-run when residency changes (the long-standing "AudioService is not a
   * signal" caveat several components worked around by hand).
   */
  private _registryVersion = signal(0);

  private touchRegistry(): void {
    this._registryVersion.update((v) => v + 1);
  }

  get audiomanagers(): AudioManager[] {
    this._registryVersion();
    return Array.from(this._audiomanagers.values());
  }

  private _loaded = false;

  get loaded(): boolean {
    return this._loaded;
  }

  get current(): AudioManager | undefined {
    this._registryVersion();
    return this._audiomanagers.get(this.selectedBundleId());
  }

  /**
   * Whether `bundleId` currently has a resident AudioManager — a stronger,
   * live signal than the store's `audio.loaded` flag, which only the
   * currently-selected bundle ever has set (see AnnotationActions.loadAudio.success's
   * reducer case). Used to distinguish "genuinely needs re-attach" from
   * "has real audio this session but hasn't been the selected bundle yet."
   * Reactive (reads `_registryVersion`).
   */
  public hasResident(bundleId: string): boolean {
    this._registryVersion();
    return this._audiomanagers.has(bundleId);
  }

  /**
   * Whether `bundleId`'s audio is available this session without asking the
   * user for the file again: either resident right now, or LRU-evicted but
   * re-decodable from its retained source `File`. Only bundles for which
   * this is false (typically: restored from IndexedDB after a reload) really
   * need a re-attach. Reactive (reads `_registryVersion`).
   */
  public canRestore(bundleId: string): boolean {
    this._registryVersion();
    return this._audiomanagers.has(bundleId) || this._sourceFiles.has(bundleId);
  }

  /**
   * The `AudioManager` registered for a SPECIFIC bundle, independent of the
   * current selection (`current` resolves through `selectedBundleId`). The
   * pipeline queue runs bundles the user has not selected, so it cannot use
   * `current`. Reactive (reads `_registryVersion`).
   */
  public getManager(bundleId: string): AudioManager | undefined {
    this._registryVersion();
    return this._audiomanagers.get(bundleId);
  }

  /** Media metadata captured at registration; survives LRU eviction. */
  public getMediaInfo(bundleId: string): BundleMediaInfo | undefined {
    this._registryVersion();
    return this._mediaInfo.get(bundleId);
  }

  /** Protects `bundleId` from LRU eviction until `unpin()`. */
  public pin(bundleId: string): void {
    this._pinned.add(bundleId);
  }

  public unpin(bundleId: string): void {
    this._pinned.delete(bundleId);
  }

  /**
   * @deprecated Use `current` instead. This throws in dev builds when there
   * is no resolvable manager for the current selection, instead of silently
   * returning undefined/wrong data (the old array-index-0 behavior).
   */
  get audioManager(): AudioManager {
    const manager = this.current;
    if (manager === undefined && isDevMode()) {
      throw new Error(
        'AudioService.audioManager accessed with no manager registered for the current selection — use AudioService.current and handle the undefined case.',
      );
    }
    return manager as AudioManager;
  }

  /***
   * Constructor
   */
  constructor(
    private http: HttpClient,
    private store: Store,
  ) {
    effect(() => {
      const id = this.selectedBundleId();
      // untracked: trackSelection()/ensureResident() read and bump
      // `_registryVersion`; tracking it here would re-run this effect on
      // every registry change instead of only on selection changes.
      untracked(() => {
        if (id) {
          this.trackSelection(id);
          void this.ensureResident(id);
        }
      });
    });
  }

  /**
   * Marks `bundleId` as the most-recently-used bundle and evicts the
   * least-recently-used bundle(s) once more than `MAX_RESIDENT_BUNDLES`
   * distinct bundles are tracked.
   *
   * The currently-SELECTED bundle and any pinned bundle (the one the pipeline
   * queue is running) are never evicted, no matter how old: registering a
   * batch of freshly dropped files, or the queue making its next bundle
   * resident, used to evict the bundle the user was looking at — destroying
   * the AudioManager the mounted editor was still playing from and flipping
   * its row to "Attach file…". If everything over the cap is protected, the
   * cap is temporarily exceeded rather than breaking a live editor or run.
   */
  private trackSelection(bundleId: string): void {
    const idx = this.recentBundleIds.indexOf(bundleId);
    if (idx !== -1) {
      this.recentBundleIds.splice(idx, 1);
    }
    this.recentBundleIds.push(bundleId);
    const selected = this.selectedBundleId();
    while (this.recentBundleIds.length > MAX_RESIDENT_BUNDLES) {
      const victimIndex = this.recentBundleIds.findIndex(
        (id) => id !== selected && !this._pinned.has(id),
      );
      if (victimIndex === -1) {
        break;
      }
      const [victim] = this.recentBundleIds.splice(victimIndex, 1);
      this.evict(victim);
    }
  }

  /**
   * loadAudio(url) loads the audio data referred to via the URL in an AJAX call.
   * The audiodata is written to the local audiobuffer field.
   *
   * audio data; for longer data, a MediaElementAudioSourceNode should be used.
   */
  public loadAudio: (
    url: string,
    audioInput: TaskInputOutputDto,
  ) => Subject<any> = (url: string, audioInput: TaskInputOutputDto) => {
    this._loaded = false;

    const subj = new Subject<number>();

    downloadFile<ArrayBuffer>(this.http, url, 'arraybuffer').subscribe({
      next: (event) => {
        subj.next(0.5 * event.progress);
        if (event.progress === 1 && event.result) {
          this.subscrmanager.add(
            AudioManager.create(
              audioInput.filename,
              audioInput.type,
              event.result,
              url,
            ).subscribe({
              next: (result) => {
                if (result.audioManager && result.progress === 1) {
                  // finished
                  result.audioManager.resource.info.url = url;
                  this.registerAudioManager(
                    DEFAULT_BUNDLE_ID,
                    result.audioManager,
                  );
                  this.afterloaded.emit({ status: 'success' });

                  subj.next(result.progress);
                  subj.complete();
                } else {
                  subj.next(result.progress);
                }
              },
              error: (error: any) => {
                subj.error(error);
              },
            }),
          );
        }
      },
      error: (error) => {
        subj.error(error);
      },
    });

    return subj;
  };

  public registerAudioManager(
    bundleId: string,
    manager: AudioManager,
    sourceFile?: File,
  ) {
    if (sourceFile) {
      this._sourceFiles.set(bundleId, sourceFile);
    }
    if (manager !== undefined) {
      const existing = this._audiomanagers.get(bundleId);
      if (existing !== manager) {
        // Replacing a registered manager (re-attach, reload) must release the
        // old one's AudioContext, blob URL and PCM — the Map no longer holds it.
        existing?.destroy().catch(() => undefined);
        this._audiomanagers.set(bundleId, manager);
        const info = manager.resource?.info;
        if (info) {
          this._mediaInfo.set(bundleId, {
            fullname: info.fullname,
            sampleRate: info.sampleRate,
            duration: info.duration,
            channels: info.channels,
            size: info.size,
          });
        }
        // Every path that registers a new manager (background per-file
        // ingestion, bundle-list's completeReattach(), not just explicit
        // user selection) must participate in MAX_RESIDENT_BUNDLES LRU
        // eviction — trackSelection() is idempotent/safe to call more than
        // once, same precedent as ensureResident()'s own call below.
        this.trackSelection(bundleId);
        // Drop the old manager's envelope synchronously so there's no window
        // where getEnvelope(bundleId) returns stale data for the file that's
        // already been replaced, while the new envelope computes async below.
        this._envelopes.delete(bundleId);

        this.subscrmanager.add(
          manager.audioMechanism!.missingPermission.subscribe(() => {
            this.missingPermission.emit();
          }),
        );

        if (manager.channel) {
          computeAudioEnvelope(manager.channel)
            .then((envelope) => {
              this._envelopes.set(bundleId, envelope);
            })
            .catch(() => {
              // envelope computation failed, list/editor fall back to no-envelope rendering
            });
        }
        this.touchRegistry();
      }
    }
  }

  /**
   * Evicts `bundleId`'s resident `AudioManager` — destroys it (freeing
   * PCM/blob memory) and removes it from the registry. Its cached envelope
   * (if computed) is deliberately left intact, so a re-selected bundle can
   * paint instantly from it while its audio re-decodes. No-op if no manager
   * is registered for `bundleId`.
   */
  public evict(bundleId: string): void {
    const manager = this._audiomanagers.get(bundleId);
    if (manager) {
      manager.destroy().catch(() => {
        // best-effort cleanup — destroy() failing shouldn't surface as an
        // unhandled promise rejection
      });
      this._audiomanagers.delete(bundleId);
      this.touchRegistry();
    }
  }

  /**
   * Drops everything this service holds for a REMOVED bundle: its resident
   * manager, its retained source `File` (which otherwise pins the file's
   * bytes for the rest of the session), its envelope, media info and LRU
   * slot. Unlike `evict()`, a forgotten bundle can no longer be re-decoded.
   */
  public forget(bundleId: string): void {
    this.evict(bundleId);
    this._sourceFiles.delete(bundleId);
    this._envelopes.delete(bundleId);
    this._mediaInfo.delete(bundleId);
    this._pinned.delete(bundleId);
    const idx = this.recentBundleIds.indexOf(bundleId);
    if (idx !== -1) {
      this.recentBundleIds.splice(idx, 1);
    }
    this.touchRegistry();
  }

  /**
   * Returns the cached envelope for `bundleId`, if one has been computed —
   * survives eviction of that bundle's `AudioManager`.
   */
  public getEnvelope(bundleId: string): AudioEnvelope | undefined {
    return this._envelopes.get(bundleId);
  }

  /**
   * Re-decodes `bundleId`'s audio from its retained source `File` and
   * re-registers the resulting `AudioManager`, if `bundleId` currently has
   * no resident manager (e.g. it was LRU-evicted by `trackSelection()`) but
   * does have a source `File` on record (registered via
   * `registerAudioManager(..., sourceFile)`).
   *
   * Resolves to whether `bundleId` has a resident manager afterwards. Public
   * (and outcome-reporting) since step 3b-i: the pipeline queue must ensure
   * residency before running a bundle and needs to distinguish "ready" from
   * "could not decode" (its `'decode'` error class) — the selection `effect`
   * in the constructor still calls it fire-and-forget and ignores the
   * result, exactly as before.
   */
  public async ensureResident(bundleId: string): Promise<boolean> {
    if (this._audiomanagers.has(bundleId)) {
      // Already resident — still participate in the LRU cap. See F2 in the
      // step 3b-i final-review fix wave: the queue calls ensureResident()
      // for bundles the user never selected, and trackSelection() is the
      // ONLY place recentBundleIds/eviction bookkeeping happens. Calling it
      // here (as well as from the selection effect) is idempotent — it just
      // moves bundleId to the most-recently-used end, it doesn't push a
      // duplicate entry or evict twice for the same bundle.
      this.trackSelection(bundleId);
      return true;
    }
    // A decode for this bundle is already in flight (e.g. the selection
    // effect started it and the queue now asks too): share its outcome.
    // Returning `false` here used to make the queue fail a perfectly
    // decodable bundle with a 'decode' error just because the user had
    // clicked it a moment earlier.
    const pending = this._pendingResidency.get(bundleId);
    if (pending) {
      return pending;
    }
    const sourceFile = this._sourceFiles.get(bundleId);
    if (!sourceFile) {
      return false;
    }
    const decode = (async (): Promise<boolean> => {
      try {
        const buffer = await sourceFile.arrayBuffer();
        const result = await firstValueFrom(
          AudioManager.create(sourceFile.name, sourceFile.type, buffer).pipe(
            filter((r) => r.progress === 1 && !!r.audioManager),
          ),
        );
        if (result.audioManager) {
          if (this._sourceFiles.get(bundleId) !== sourceFile) {
            // The bundle was removed (forget()) or re-attached to another
            // file while this decode ran — don't resurrect it.
            result.audioManager.destroy().catch(() => undefined);
            return false;
          }
          this.registerAudioManager(bundleId, result.audioManager);
          // Newly made resident by the queue (not via selection) — same LRU
          // accounting as above, at the point residency is freshly achieved.
          this.trackSelection(bundleId);
        }
      } catch (e) {
        // Re-decode failed (corrupted/stale retained File, or the create()
        // stream completed without ever reaching progress===1) — best-effort,
        // matching evict()'s pattern above: leave the bundle unresident rather
        // than surfacing an unhandled rejection. The user sees a no-audio
        // state for that bundle and can retry by reselecting it again; the
        // queue turns the `false` return below into a 'decode' run error.
      } finally {
        this._pendingResidency.delete(bundleId);
      }
      return this._audiomanagers.has(bundleId);
    })();
    this._pendingResidency.set(bundleId, decode);
    return decode;
  }

  public async destroy(disconnect = true) {
    for (const audioManager of this._audiomanagers.values()) {
      await audioManager.destroy(disconnect);
    }
    this._audiomanagers.clear();
    this._envelopes.clear();
    this._sourceFiles.clear();
    this._mediaInfo.clear();
    this._pinned.clear();
    this.recentBundleIds = [];
    this._pendingResidency.clear();
    this.subscrmanager.destroy();
    this.touchRegistry();
  }
}

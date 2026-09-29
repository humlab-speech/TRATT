import { HttpClient } from '@angular/common/http';
import { effect, EventEmitter, Injectable, isDevMode } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskInputOutputDto } from '@octra/api-types';
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

@Injectable()
export class AudioService {
  public missingPermission = new EventEmitter<void>();
  private subscrmanager: SubscriptionManager<Subscription> =
    new SubscriptionManager<Subscription>();
  private afterloaded: EventEmitter<any> = new EventEmitter<any>();

  private _audiomanagers = new Map<string, AudioManager>();
  private _envelopes = new Map<string, AudioEnvelope>();
  private _sourceFiles = new Map<string, File>();
  private _pendingResidency = new Set<string>();
  private recentBundleIds: string[] = [];
  private selectedBundleId = this.store.selectSignal(selectSelectedBundleId);

  get audiomanagers(): AudioManager[] {
    return Array.from(this._audiomanagers.values());
  }

  private _loaded = false;

  get loaded(): boolean {
    return this._loaded;
  }

  get current(): AudioManager | undefined {
    return this._audiomanagers.get(this.selectedBundleId());
  }

  /**
   * Whether `bundleId` currently has a resident AudioManager — a stronger,
   * live signal than the store's `audio.loaded` flag, which only the
   * currently-selected bundle ever has set (see AnnotationActions.loadAudio.success's
   * reducer case). Used to distinguish "genuinely needs re-attach" from
   * "has real audio this session but hasn't been the selected bundle yet."
   */
  public hasResident(bundleId: string): boolean {
    return this._audiomanagers.has(bundleId);
  }

  /**
   * The `AudioManager` registered for a SPECIFIC bundle, independent of the
   * current selection (`current` resolves through `selectedBundleId`). The
   * pipeline queue runs bundles the user has not selected, so it cannot use
   * `current`.
   */
  public getManager(bundleId: string): AudioManager | undefined {
    return this._audiomanagers.get(bundleId);
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
      if (id) {
        this.trackSelection(id);
        void this.ensureResident(id);
      }
    });
  }

  /**
   * Marks `bundleId` as the most-recently-selected bundle and evicts the
   * least-recently-selected bundle(s) once more than `MAX_RESIDENT_BUNDLES`
   * distinct bundles have been selected.
   */
  private trackSelection(bundleId: string): void {
    const idx = this.recentBundleIds.indexOf(bundleId);
    if (idx !== -1) {
      this.recentBundleIds.splice(idx, 1);
    }
    this.recentBundleIds.push(bundleId);
    while (this.recentBundleIds.length > MAX_RESIDENT_BUNDLES) {
      const oldest = this.recentBundleIds.shift();
      if (oldest !== undefined) {
        this.evict(oldest);
      }
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
        this._audiomanagers.set(bundleId, manager);
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
    }
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
    if (this._pendingResidency.has(bundleId)) {
      return false;
    }
    const sourceFile = this._sourceFiles.get(bundleId);
    if (!sourceFile) {
      return false;
    }
    this._pendingResidency.add(bundleId);
    try {
      const buffer = await sourceFile.arrayBuffer();
      const result = await firstValueFrom(
        AudioManager.create(sourceFile.name, sourceFile.type, buffer).pipe(
          filter((r) => r.progress === 1 && !!r.audioManager),
        ),
      );
      if (result.audioManager) {
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
  }

  public async destroy(disconnect = true) {
    for (const audioManager of this._audiomanagers.values()) {
      await audioManager.destroy(disconnect);
    }
    this._audiomanagers.clear();
    this._envelopes.clear();
    this._sourceFiles.clear();
    this.recentBundleIds = [];
    this._pendingResidency.clear();
    this.subscrmanager.destroy();
  }
}

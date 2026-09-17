import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  Signal,
  signal,
} from '@angular/core';
import { AudioManager } from '@tratt/web-media';
import { findWhisperModelSizeMb } from '../../component/tratt-dropzone/whisper-model-sizes';
import { AudioService } from './audio.service';
import type { TranscriptionOptions } from './local-transcription.service';
import type { TranslationAvailability } from './local-translation.service';

/**
 * Decimal megabyte. Every size figure this app already carries is decimal —
 * `KbWhisperModel.sizeMb` (120 MB for kb-whisper-tiny),
 * `OPUS_MT_BYTES_PER_PAIR = 80_000_000` — and `navigator.storage.estimate()`
 * returns plain bytes, so the whole capacity readout is decimal end to end.
 */
const BYTES_PER_MB = 1_000_000;

/** A `Float32Array` sample is 4 bytes. Named so the RAM formula reads. */
const BYTES_PER_FLOAT32_SAMPLE = 4;

/**
 * The working-memory ceiling the RAM bar is drawn against: 2 GB.
 *
 * Deliberately a conservative, device-INDEPENDENT floor. The browser exposes
 * no reliable per-tab memory ceiling to query, and this codebase has no
 * existing `navigator.deviceMemory` sizing convention to extend. Exported as
 * one named constant precisely so that if real-world use shows it wrong, the
 * fix is this one line — not a value buried inside a formula. See the design
 * doc's step 3c section.
 */
export const RAM_BUDGET_BYTES = 2_000_000_000;

/**
 * How often `CapacityService` re-measures BOTH signals, in milliseconds.
 *
 * A deliberate scope ruling, recorded in the design doc's step 3c section:
 * the master plan asked for event-driven refresh ("on mount, after a model
 * download, after a save"), which would mean threading a trigger through
 * every ASR/diarization/translation/IDB completion path across the app — a
 * wide, unrelated surface for a readout that is explicitly labelled an
 * approximation. Polling is a few seconds stale at worst; that is enough for
 * "warn, don't block".
 */
export const CAPACITY_POLL_MS = 5000;

/**
 * Approximate on-disk size of the speaker-diarization model, in bytes.
 *
 * APPROXIMATION, not a measured figure. Unlike ASR (`KbWhisperModel.sizeMb`,
 * real per-model numbers) and translation (`OPUS_MT_BYTES_PER_PAIR`), this
 * app has no per-model size registry for diarization at all — there is one
 * model (`DIARIZATION_DEFAULT_MODEL_ID`) and no size recorded for it
 * anywhere. 90 MB is the same flat placeholder the interactive mockup uses
 * (`docs/superpowers/specs/reference/TRATT Workbench.dc.html`, `renderVals()`).
 * Replace this with a real figure the moment one exists; do not inline it.
 */
export const DIARIZATION_MODEL_ESTIMATE_BYTES = 90 * BYTES_PER_MB;

/** Browser-storage figures backing the storage bar. */
export interface StorageCapacity {
  /** Real bytes in use, straight from `navigator.storage.estimate()`. 0 when unavailable. */
  usedBytes: number;
  /** Real quota, straight from `navigator.storage.estimate()`. 0 when unavailable. */
  quotaBytes: number;
  /**
   * Client-side ESTIMATE of how much of `usedBytes` is cached ML models.
   * Storage cannot be attributed per item in this app — `tratt-database.ts`
   * never records a serialized byte length — so the "annotations" figure the
   * UI shows is `usedBytes - modelsEstimateBytes`, an approximation, not a sum
   * of real per-row sizes.
   */
  modelsEstimateBytes: number;
}

/** Working-memory figures backing the RAM bar. */
export interface ResidentMemoryEstimate {
  /** Sum of `estimateResidentBytes` over every currently-resident AudioManager. */
  estimatedBytes: number;
  /** How many bundles have a resident `AudioManager` right now. */
  residentCount: number;
  /** Always `RAM_BUDGET_BYTES`; carried on the signal so the UI needs no second import. */
  budgetBytes: number;
}

/**
 * Bytes of browser storage the currently-configured pipeline models would
 * occupy once downloaded.
 *
 * Note this is what is CONFIGURED, not what has actually been downloaded —
 * there is no API to ask which models are in the browser's cache. The UI
 * clamps this against the real `usedBytes` before drawing, so a configured-
 * but-not-yet-downloaded model can never make the storage bar overflow.
 *
 * Translation reuses `TranslationAvailability.estimatedBytes` — which
 * `LocalTranslationService.resolveAvailability()` already computes from
 * `OPUS_MT_BYTES_PER_PAIR` (×1 direct, ×2 pivot) — rather than re-deriving
 * the same arithmetic here. As of step 3c nothing on `/workbench` configures
 * translation at all (`pipeline-queue.service.ts` passes no `translateOptions`),
 * so that term is zero there; the parameter exists because this is the
 * app-wide estimator, and it is fully covered by tests.
 */
export function estimateModelBytes(
  transcribe: TranscriptionOptions | null,
  translation: TranslationAvailability | null,
): number {
  let total = 0;

  if (transcribe) {
    const sizeMb = findWhisperModelSizeMb(transcribe.modelId);
    if (sizeMb !== undefined) {
      total += sizeMb * BYTES_PER_MB;
    }
    if (transcribe.diarization) {
      total += DIARIZATION_MODEL_ESTIMATE_BYTES;
    }
  }

  if (translation && translation.kind !== 'unavailable') {
    total += translation.estimatedBytes;
  }

  return total;
}

/**
 * Bytes of working memory the given resident `AudioManager`s hold.
 *
 * Per manager: the source bytes (`resource.size`) plus whatever single PCM
 * array is resident right now (`channel.length * 4`). There is deliberately
 * NO native-rate-plus-16kHz double count: the design doc's 2.5 finding
 * established that at most ONE PCM array is ever resident per manager, and
 * `prepareMonoAudioForMlModel()` builds its 16 kHz copy fresh and uncached per
 * pipeline run.
 *
 * Never throws: `AudioManager.resource` dereferences its mechanism without a
 * guard (`audio-manager.ts:32-34`), so a manager caught mid-construction or
 * mid-destroy can throw from a plain property read. A polled estimate must
 * degrade to "counts zero for that manager", not take the poll down.
 */
export function estimateResidentBytes(
  managers: readonly AudioManager[],
): number {
  let total = 0;
  for (const manager of managers) {
    // Two separate try/catch blocks, not one: a throw reading `.resource`
    // (the riskier, unguarded getter) must not also discard `.channel`'s
    // contribution — normally the dominant term — for the same manager.
    try {
      total += manager.resource?.size ?? 0;
    } catch {
      // See doc comment: a manager whose mechanism/resource is not there
      // contributes nothing for this term rather than breaking the estimate.
    }
    try {
      total += (manager.channel?.length ?? 0) * BYTES_PER_FLOAT32_SAMPLE;
    } catch {
      // Same rationale, independently, for the channel read.
    }
  }
  return total;
}

/**
 * Live, approximate capacity readout for `/workbench`: how much browser
 * storage this app is using, and how much working memory the currently
 * resident decoded audio holds.
 *
 * Both figures refresh together on ONE `CAPACITY_POLL_MS` interval, started
 * on construction (which, for a `providedIn: 'root'` service, is the first
 * time anything injects it — in practice when the capacity indicator first
 * mounts) and torn down with the injector via `DestroyRef`. See
 * `CAPACITY_POLL_MS` for why this is polled rather than event-driven.
 *
 * This service only MEASURES. It never blocks, warns, gates, or intercepts —
 * the "warn, don't block" behaviour of step 3c is entirely the RAM bar's own
 * live colour, in `CapacityIndicatorComponent`.
 */
@Injectable({ providedIn: 'root' })
export class CapacityService {
  /**
   * Bumped on every poll. `residentMemory` depends on it so that a `computed`
   * can re-read `AudioService`'s plain (non-signal) `Map` on each tick.
   */
  private readonly pollTick = signal(0);

  private readonly rawStorage = signal<{
    usedBytes: number;
    quotaBytes: number;
  }>({ usedBytes: 0, quotaBytes: 0 });

  private readonly transcribeOptions = signal<TranscriptionOptions | null>(
    null,
  );
  private readonly translationAvailability =
    signal<TranslationAvailability | null>(null);

  readonly storage: Signal<StorageCapacity> = computed(() => {
    const raw = this.rawStorage();
    return {
      usedBytes: raw.usedBytes,
      quotaBytes: raw.quotaBytes,
      modelsEstimateBytes: estimateModelBytes(
        this.transcribeOptions(),
        this.translationAvailability(),
      ),
    };
  });

  readonly residentMemory: Signal<ResidentMemoryEstimate> = computed(() => {
    this.pollTick();
    const managers = this.audioService.audiomanagers;
    return {
      estimatedBytes: estimateResidentBytes(managers),
      residentCount: managers.length,
      budgetBytes: RAM_BUDGET_BYTES,
    };
  });

  constructor(private audioService: AudioService) {
    void this.refresh();
    const handle = setInterval(() => void this.refresh(), CAPACITY_POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(handle));
  }

  /**
   * Tells the storage bar which pipeline models are currently configured, so
   * it can split "models" from "annotations". Applied immediately — a user
   * ticking a bigger model should not wait up to `CAPACITY_POLL_MS` to see the
   * models segment grow.
   *
   * `translation` is optional and defaults to `null`: `/workbench` configures
   * no translation (see `estimateModelBytes`'s doc comment).
   */
  setConfiguredOptions(
    transcribe: TranscriptionOptions | null,
    translation: TranslationAvailability | null = null,
  ): void {
    this.transcribeOptions.set(transcribe);
    this.translationAvailability.set(translation);
  }

  /**
   * One measurement pass over both figures. `residentMemory` is synchronous
   * and simply re-derives from `pollTick`; storage needs the async browser
   * API, whose failure (or absence) leaves the last known figures in place
   * rather than flashing the bar back to zero.
   */
  private async refresh(): Promise<void> {
    this.pollTick.update((n) => n + 1);
    if (!navigator.storage?.estimate) {
      return;
    }
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      this.rawStorage.set({ usedBytes: usage, quotaBytes: quota });
    } catch {
      // Storage estimation can reject (permissions, private mode). Keep the
      // previous figures — a capacity readout going momentarily blank is
      // worse than one being a few seconds stale.
    }
  }
}

import { Injectable } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { map, Subscription, tap } from 'rxjs';
import { RootState } from '../../store/index';
import { selectAllBundleSummaries } from '../../store/login-mode/annotation/annotation.selectors';
import {
  BundleRunError,
  computeReadyBundleIds,
  runStatusOf,
} from '../../store/pipeline-queue';
import {
  bundleRunErrorFromPipelineEvent,
  classifyBundleRunError,
} from '../../store/pipeline-queue/bundle-run-errors';
import { mapPipelineActionToQueueProgress } from '../../store/pipeline-queue/pipeline-queue-progress';
import { PipelineQueueActions } from '../../store/pipeline-queue/pipeline-queue.actions';
import {
  selectAllRunStatuses,
  selectPipelineQueueFeature,
} from '../../store/pipeline-queue/pipeline-queue.selectors';
import {
  dispatchPipelineActions,
  mapPipelineEventToAction,
} from '../../store/pipeline/pipeline-event-mapping';
import { AudioService } from './audio.service';
import { TranscriptionOptions } from './local-transcription.service';
import type { PipelineEvent } from './pipeline-runner.service';
import { PipelineRunnerService } from './pipeline-runner.service';

const NO_OPTIONS_MESSAGE =
  'No transcription options configured — enable auto transcription first.';

/**
 * FIFO queue over `PipelineRunnerService.run()`: one bundle in flight at a
 * time, a failure never stops the run, retry is per-row.
 *
 * `PipelineRunnerService` and the three worker-wrapper services underneath
 * it are used exactly as step 3a left them — every queued bundle reloads its
 * model from scratch, which is correct, just slow. Warm-worker refcounting
 * is step 3b-ii, deliberately out of scope here.
 *
 * Sequencing is hand-rolled rather than `concatMap`-over-a-source, because
 * the queue's source of truth is the store (`activateNext` pops the head in
 * the reducer), not an Observable of bundle ids — and because
 * `PipelineRunnerService` is a single-subscriber service that must never see
 * two overlapping `run()` calls.
 */
@Injectable({ providedIn: 'root' })
export class PipelineQueueService {
  private runSub: Subscription | null = null;
  private transcribeOptions: TranscriptionOptions | null = null;
  /** Carried across progress ticks within one run — see QueueProgressResult. */
  private audioDurationS = 0;
  /** Guards against double-finalizing one run (result + complete). */
  private finalized = false;

  private queueState = this.store.selectSignal(selectPipelineQueueFeature);
  private runs = this.store.selectSignal(selectAllRunStatuses);
  private summaries = this.store.selectSignal(selectAllBundleSummaries);

  constructor(
    private store: Store<RootState>,
    private pipelineRunnerService: PipelineRunnerService,
    private audioService: AudioService,
  ) {}

  /**
   * The one global pipeline configuration the queue runs every bundle with
   * (the spec's "one global config, run as a queue over all loaded media").
   * `null` disables running — the run button is disabled in that state.
   */
  setTranscribeOptions(options: TranscriptionOptions | null): void {
    this.transcribeOptions = options;
  }

  /** The ids `enqueue()` would actually accept right now. */
  readyBundleIds(): string[] {
    return computeReadyBundleIds(this.summaries(), this.runs(), (bundleId) =>
      this.audioService.hasResident(bundleId),
    );
  }

  enqueue(bundleIds: string[]): void {
    const ready = new Set(this.readyBundleIds());
    const eligible = bundleIds.filter((bundleId) => ready.has(bundleId));
    if (eligible.length === 0) {
      return;
    }
    const wasIdle = this.runSub === null && this.queueState().activeId === null;
    this.store.dispatch(PipelineQueueActions.enqueued({ bundleIds: eligible }));
    if (wasIdle) {
      this.activateNext();
    }
  }

  /**
   * Re-enqueue a single bundle regardless of its current state — an explicit
   * per-row user action, so it deliberately bypasses `enqueue()`'s
   * eligibility filter (the spec's own wording). Residency is still checked
   * before the run itself, so retrying a bundle whose media is gone fails
   * cleanly as a 'decode' error rather than crashing.
   */
  retry(bundleId: string): void {
    const state = runStatusOf(this.runs(), bundleId).state;
    if (state === 'queued' || state === 'running') {
      return;
    }
    const wasIdle = this.runSub === null && this.queueState().activeId === null;
    this.store.dispatch(
      PipelineQueueActions.enqueued({ bundleIds: [bundleId] }),
    );
    if (wasIdle) {
      this.activateNext();
    }
  }

  /** Finish the in-flight bundle, then stop; don't drain the rest. */
  stop(): void {
    this.store.dispatch(PipelineQueueActions.pause());
  }

  /**
   * Cancel just the in-flight bundle. The resulting
   * `{stage:'pipeline', type:'cancelled'}` event is what actually records
   * the failure and advances the queue — `cancel()` emits it synchronously
   * before completing the run Observable (see PipelineRunnerService.cancel),
   * so there is exactly one code path that finalizes a cancelled run.
   */
  cancelActive(): void {
    if (this.queueState().activeId === null) {
      return;
    }
    this.pipelineRunnerService.cancel();
  }

  private activateNext(): void {
    // Read the head BEFORE dispatching so this never depends on how quickly
    // the store signal above reflects the reducer's output.
    const next = this.queueState().queue[0];
    this.store.dispatch(PipelineQueueActions.activateNext());
    if (next === undefined) {
      return;
    }
    void this.runBundle(next);
  }

  private async runBundle(bundleId: string): Promise<void> {
    const options = this.transcribeOptions;
    if (!options) {
      this.fail(bundleId, { kind: 'unknown', message: NO_OPTIONS_MESSAGE });
      return;
    }

    // Residency before running: an LRU-evicted bundle is exactly as
    // re-decodable as a freshly-selected one, and the queue must not skip or
    // crash on a bundle that simply isn't one of the 3 most recent.
    const resident = await this.audioService.ensureResident(bundleId);
    const manager = resident
      ? this.audioService.getManager(bundleId)
      : undefined;
    if (!manager) {
      this.fail(bundleId, {
        kind: 'decode',
        message: `Could not decode audio for this file.`,
      });
      return;
    }

    this.audioDurationS = 0;
    this.finalized = false;

    this.runSub = dispatchPipelineActions(
      this.pipelineRunnerService
        .run({
          audioManager: manager,
          oaudiofile: manager.resource.getOAudioFile(),
          transcribeOptions: options,
          // No translateOptions: /workbench has no translation
          // configuration UI in step 3b-i, so the queue runs
          // transcription + optional diarization only.
        })
        .pipe(
          tap((event: PipelineEvent) => this.onRawEvent(bundleId, event)),
          map(mapPipelineEventToAction),
        ),
    ).subscribe({
      next: (action: Action) => this.onThrottledAction(action),
      error: (err: unknown) =>
        this.fail(bundleId, classifyBundleRunError(err, options.useWebGPU)),
      complete: () => {
        if (!this.finalized) {
          this.fail(bundleId, {
            kind: 'unknown',
            message: 'The pipeline ended without producing a result.',
          });
        }
      },
    });
  }

  /**
   * Raw (unthrottled) event handling — only the terminal outcomes, which
   * must never be delayed or collapsed by the throttle.
   */
  private onRawEvent(bundleId: string, event: PipelineEvent): void {
    const cancelled = bundleRunErrorFromPipelineEvent(event);
    if (cancelled) {
      this.fail(bundleId, cancelled);
      return;
    }
    if (event.stage === 'pipeline' && event.type === 'result') {
      this.succeed(bundleId, event);
    }
  }

  /** Throttled progress ticks — bundle-scoped, never the old slice's actions. */
  private onThrottledAction(action: Action): void {
    const result = mapPipelineActionToQueueProgress(
      action,
      this.audioDurationS,
    );
    this.audioDurationS = result.audioDurationS;
    if (result.update) {
      this.store.dispatch(PipelineQueueActions.progress(result.update));
    }
  }

  private succeed(
    bundleId: string,
    _event: Extract<PipelineEvent, { stage: 'pipeline'; type: 'result' }>,
  ): void {
    if (this.finalized) {
      return;
    }
    this.finalized = true;
    this.store.dispatch(PipelineQueueActions.bundleDone({ bundleId }));
    this.advance();
  }

  private fail(bundleId: string, error: BundleRunError): void {
    if (this.finalized) {
      return;
    }
    this.finalized = true;
    this.store.dispatch(PipelineQueueActions.bundleFailed({ bundleId, error }));
    this.advance();
  }

  private advance(): void {
    this.runSub?.unsubscribe();
    this.runSub = null;
    if (this.queueState().mode === 'pausing') {
      this.store.dispatch(PipelineQueueActions.stopped());
      return;
    }
    this.activateNext();
  }
}

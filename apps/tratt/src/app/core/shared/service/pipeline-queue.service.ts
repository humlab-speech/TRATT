import { Injectable } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { TrattAnnotation } from '@tratt/annotation';
import { map, Subscription, tap } from 'rxjs';
import { LoginMode, RootState } from '../../store/index';
import { selectAllBundleSummaries } from '../../store/login-mode/annotation/annotation.selectors';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
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
  /**
   * Monotonically incremented at the very top of every `runBundle()` call,
   * before any `await` or early-exit — a per-run identity token, NOT a
   * shared "is anything finalized" boolean. `succeed()`/`fail()` only ever
   * act on the token they were handed if it still equals `currentRunToken`
   * (this run hasn't been superseded by the next one) AND it isn't
   * `finalizedToken` yet (this exact run hasn't already been finalized once
   * — result then complete, or a cancel racing an error). A shared boolean
   * here previously caused a real bug: reset too late (after the first
   * early-exit branches), it stayed `true` from the PREVIOUS bundle and
   * silently swallowed every `fail()` call on the second and later bundles,
   * permanently deadlocking the queue. Per-run tokens make that class of bug
   * structurally impossible — a fresh token is minted before any early-exit
   * path can run, so there is no shared mutable flag to be stale.
   */
  private currentRunToken = 0;
  /** The token already finalized (result/fail dispatched) for the CURRENT run, if any. */
  private finalizedToken: number | null = null;
  /**
   * Set by `cancelActive()` to the token of the run it targeted. Consulted
   * by `runBundle()` immediately after the `ensureResident()` await: a
   * cancel click that lands while residency is still resolving arrives too
   * early for `PipelineRunnerService.cancel()` to have anything to cancel
   * (no worker/timer exists yet), so without this check the run would
   * silently proceed once residency resolved, discarding the user's cancel
   * and starting a full model-load + ASR run anyway.
   */
  private cancelRequestedToken: number | null = null;

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
   * Cancel just the in-flight bundle. When `PipelineRunnerService` already
   * has an active run, the resulting `{stage:'pipeline', type:'cancelled'}`
   * event is what actually records the failure and advances the queue —
   * `cancel()` emits it synchronously before completing the run Observable
   * (see PipelineRunnerService.cancel), so there is exactly one code path
   * that finalizes a cancelled run in that case.
   *
   * But `activeId` is set (via the `activateNext` action) BEFORE
   * `runBundle()` even starts awaiting `ensureResident()` — so a cancel
   * click can land in the window where this bundle is "active" from the
   * queue's point of view but `PipelineRunnerService` has nothing to cancel
   * yet. `cancelRequestedToken` records that intent so `runBundle()` can
   * still honor it once the await resolves, instead of silently starting
   * the run anyway.
   */
  cancelActive(): void {
    if (this.queueState().activeId === null) {
      return;
    }
    this.cancelRequestedToken = this.currentRunToken;
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
    // Minted BEFORE any early-exit path (including the synchronous
    // `!options` branch right below) — see currentRunToken's doc comment
    // for why this must never move later, and why it replaces a shared
    // "finalized" boolean.
    const token = ++this.currentRunToken;
    this.audioDurationS = 0;

    const options = this.transcribeOptions;
    if (!options) {
      this.fail(bundleId, token, {
        kind: 'unknown',
        message: NO_OPTIONS_MESSAGE,
      });
      return;
    }

    // Residency before running: an LRU-evicted bundle is exactly as
    // re-decodable as a freshly-selected one, and the queue must not skip or
    // crash on a bundle that simply isn't one of the 3 most recent.
    const resident = await this.audioService.ensureResident(bundleId);

    // A cancel click that arrived while the line above was still pending —
    // see cancelRequestedToken's doc comment. Checked before touching the
    // manager or subscribing, so a cancelled bundle never starts a run.
    if (this.cancelRequestedToken === token) {
      this.fail(bundleId, token, {
        kind: 'cancelled',
        message: 'Run cancelled.',
      });
      return;
    }

    const manager = resident
      ? this.audioService.getManager(bundleId)
      : undefined;
    if (!manager) {
      this.fail(bundleId, token, {
        kind: 'decode',
        message: `Could not decode audio for this file.`,
      });
      return;
    }

    const sub = dispatchPipelineActions(
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
          tap((event: PipelineEvent) =>
            this.onRawEvent(bundleId, token, event),
          ),
          map(mapPipelineEventToAction),
        ),
    ).subscribe({
      next: (action: Action) => this.onThrottledAction(action),
      error: (err: unknown) =>
        this.fail(
          bundleId,
          token,
          classifyBundleRunError(err, options.useWebGPU),
        ),
      complete: () => {
        // No-op via claimFinalize() if 'result' (or an error/cancel) already
        // finalized this token — this unconditional call replaces the old
        // `if (!this.finalized)` guard now that finalization is per-token.
        this.fail(bundleId, token, {
          kind: 'unknown',
          message: 'The pipeline ended without producing a result.',
        });
      },
    });

    // Guard against PipelineRunnerService.run() terminating SYNCHRONOUSLY on
    // subscribe (e.g. a synchronous error from the transcription stage):
    // succeed()/fail() -> advance() would already have unsubscribed and
    // started the next bundle — incrementing currentRunToken — before this
    // line runs, in which case `sub` belongs to an already-superseded run
    // and must not overwrite the next bundle's `runSub`.
    if (token === this.currentRunToken) {
      this.runSub = sub;
    } else {
      sub.unsubscribe();
    }
  }

  /**
   * Raw (unthrottled) event handling — only the terminal outcomes, which
   * must never be delayed or collapsed by the throttle.
   */
  private onRawEvent(
    bundleId: string,
    token: number,
    event: PipelineEvent,
  ): void {
    const cancelled = bundleRunErrorFromPipelineEvent(event);
    if (cancelled) {
      this.fail(bundleId, token, cancelled);
      return;
    }
    if (event.stage === 'pipeline' && event.type === 'result') {
      this.succeed(bundleId, token, event);
    }
  }

  /**
   * Throttled progress ticks — bundle-scoped in practice because they only
   * ever arrive while `bundleId`'s run is the active one, but the dispatched
   * `PipelineQueueActions.progress` action itself carries no `bundleId` and
   * the reducer applies it to `state.activeId` (`pipeline-queue.reducer.ts`).
   * That is safe only because `advance()` below unsubscribes `runSub` —
   * whose teardown clears `dispatchPipelineActions`' pending trailing-edge
   * timer — BEFORE `activateNext()` ever runs. If that order is ever
   * reversed, a still-pending throttled tick from the bundle that just
   * finished could land on the next bundle's row instead of being dropped.
   */
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
    token: number,
    event: Extract<PipelineEvent, { stage: 'pipeline'; type: 'result' }>,
  ): void {
    if (!this.claimFinalize(token)) {
      return;
    }

    const transcript = TrattAnnotation.deserialize(event.annotJson);
    if (!transcript) {
      // F3 (final whole-branch review fix wave): a 'result' event whose
      // annotJson fails to deserialize previously still marked the bundle
      // 'done' unconditionally — permanently stranding it with an empty
      // transcript, since 'done' is excluded from both computeReadyBundleIds
      // and the per-row retry gate (failed/interrupted only). Fail instead,
      // so the existing retry affordance applies. No dedicated
      // bundle-run-errors.ts constant fits — that module classifies what
      // PipelineRunnerService.run() itself errors WITH, and this isn't a
      // runner error, it's an in-process deserialize miss on an otherwise
      // successful 'result' event — so 'unknown' with a clear inline
      // message, matching the "pipeline ended without producing a result"
      // complete()-fallback message's own convention.
      this.store.dispatch(
        PipelineQueueActions.bundleFailed({
          bundleId,
          error: {
            kind: 'unknown',
            message:
              'The pipeline produced a result that could not be read as a transcript.',
          },
        }),
      );
      this.advance();
      return;
    }

    // Explicitly bundle-scoped: AnnotationActions.overwriteTranscript.do
    // would land on whatever bundle the user currently has selected.
    this.store.dispatch(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId,
        transcript,
      }),
    );

    this.store.dispatch(PipelineQueueActions.bundleDone({ bundleId }));
    this.advance();
  }

  private fail(bundleId: string, token: number, error: BundleRunError): void {
    if (!this.claimFinalize(token)) {
      return;
    }
    this.store.dispatch(PipelineQueueActions.bundleFailed({ bundleId, error }));
    this.advance();
  }

  /**
   * The single point that decides whether a terminal outcome (`succeed()`/
   * `fail()`) is allowed to actually dispatch — see `currentRunToken`'s doc
   * comment. Rejects both a token from a superseded run (`token !==
   * currentRunToken`, the bug this whole scheme replaces a shared boolean
   * to fix) and a second terminal outcome for the SAME still-current run
   * (`token === finalizedToken` — e.g. a 'result' event followed later by
   * the Observable's own `complete()` callback).
   */
  private claimFinalize(token: number): boolean {
    if (token !== this.currentRunToken || token === this.finalizedToken) {
      return false;
    }
    this.finalizedToken = token;
    return true;
  }

  private advance(): void {
    // See onThrottledAction's doc comment: this unsubscribe (and the
    // pending-timer teardown it triggers inside dispatchPipelineActions)
    // must happen BEFORE activateNext() below.
    this.runSub?.unsubscribe();
    this.runSub = null;
    if (this.queueState().mode === 'pausing') {
      this.store.dispatch(PipelineQueueActions.stopped());
      return;
    }
    this.activateNext();
  }
}

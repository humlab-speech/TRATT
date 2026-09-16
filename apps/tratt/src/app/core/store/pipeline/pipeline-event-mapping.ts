import { Action } from '@ngrx/store';
import { MonoTypeOperatorFunction, Observable, throttleTime } from 'rxjs';
import type { PipelineEvent } from '../../shared/service/pipeline-runner.service';
import { PipelineActions } from './pipeline.actions';

/**
 * Throttled to roughly 4Hz — see the task brief/plan: fast enough that
 * progress bars still read as "live," slow enough that a real-time stream of
 * ASR/diarization/translation progress events doesn't flood the reducer or
 * trigger excessive change detection under zone-based Angular. `250` is not
 * a magic number chosen ad hoc here — it IS the 4Hz figure (1000ms / 4).
 */
export const PIPELINE_THROTTLE_MS = 250;

/**
 * The exact throttle configuration this slice requires: `leading: true` so
 * the UI updates immediately on the first event of a burst (no perceived
 * lag), `trailing: true` so the LAST event of a burst is never silently
 * dropped.
 *
 * IMPORTANT — this ONLY guarantees the LAST event of a burst survives, not
 * every state-transition event that happens to land inside one. A
 * synchronous burst containing e.g. `transcriptionFinalized` followed
 * immediately (same JS tick, same throttle window) by `translationStart` —
 * which really happens, since `PipelineRunnerService` emits both
 * synchronously back to back whenever transcription finishes with
 * diarization skipped and translation is chained — would silently drop
 * `transcriptionFinalized` under a NAIVE "throttle everything" pipe: only
 * `translationStart` (the last value) is kept, `transcriptionFinalized`
 * (which is what flips `transcription.active` back to `false`) is
 * discarded, never dispatched. See `pipeline-event-mapping.spec.ts`'s "does
 * not drop a terminal event" test for the narrower, still-true claim this
 * operator alone actually backs.
 *
 * This is exactly why `pipelineThrottle()` must NEVER be applied
 * indiscriminately to the whole mapped-action stream. `dispatchPipelineActions()`
 * below needs the ~4Hz cap this operator provides ONLY for the subset of
 * actions classified as safe-to-throttle progress ticks
 * (`isThrottleSafeProgressAction()`) — but it does NOT compose this operator
 * via `filter()`+`merge()` the way an earlier version of this file did.
 * Splitting the stream into two independently-subscribed branches and
 * merging them back together introduces a SECOND bug on top of the
 * dropping one this operator's own docs warn about: a throttled progress
 * tick held in the "safe" branch can be emitted by `merge()` AFTER a
 * bypass action that arrived later on the source but skipped the throttle
 * entirely — reordering the output relative to the input. See
 * `dispatchPipelineActions()`'s own doc comment for the single-subscription,
 * order-preserving design that replaces that approach.
 *
 * NOT used by production code as of Task 4's fix round 2 — `login.component.ts`
 * subscribes to `dispatchPipelineActions()` below instead, which reimplements
 * order-preserving throttling by hand rather than composing this operator via
 * `filter()`+`merge()` (that composition is exactly what reordered output
 * relative to input; see `dispatchPipelineActions()`'s own doc comment).
 * Kept, exported, and still under test here anyway: it's the smallest
 * possible demonstration of `throttleTime`'s own `{leading,trailing}`
 * survival guarantee in isolation — the specific property the rest of this
 * module's design had to work around — and that guarantee is worth pinning
 * on its own regardless of which production code path currently composes it.
 */
export function pipelineThrottle<T>(): MonoTypeOperatorFunction<T> {
  return throttleTime<T>(PIPELINE_THROTTLE_MS, undefined, {
    leading: true,
    trailing: true,
  });
}

/**
 * Classifies a mapped `PipelineActions` action as safe to throttle (a pure,
 * high-frequency progress tick that exists only to drive a progress bar —
 * nothing durable depends on receiving every single one, and dropping an
 * intermediate one is invisible/harmless) vs. NOT safe to throttle (a
 * discrete, one-shot state transition or terminal outcome — durable store
 * state, or which store SLICE an error lands in, depends on every one of
 * these actually reaching the reducer).
 *
 * Only two inner `TranscriptionEvent`/`DiarizationEvent`/`TranslationEvent`
 * types are true progress ticks: `'download-progress'` (fires many times per
 * second while a model streams in) and `'segment-progress'` (fires once per
 * ASR/translation segment). Every other action this module can produce —
 * including every OTHER inner event type wrapped by `transcriptionEvent`/
 * `diarizationEvent`/`translationEvent` (`transcribe-start`,
 * `backend-fallback`, inner `result`, `diarize-start`, `model-init`,
 * `translate-start`, `segments`) and every top-level action
 * (`transcriptionFinalized`, `diarizationStarted`, `diarizationSkipped`,
 * `translationStart`, `stalled`, `result`, `cancelled`) — is a discrete,
 * one-shot event and must bypass the throttle. Some of these (e.g.
 * `diarizationSkipped`, `cancelled`) are no-ops in today's reducer, but are
 * still classified as bypass rather than throttle-safe: they're one-shot by
 * NATURE (there is exactly one per run, never a rapid stream of them), so
 * throttling them buys nothing and only adds a class of bug (a later no-op
 * action silently eating an earlier consequential one in the same window,
 * exactly like this module's own `transcriptionFinalized`/`translationStart`
 * collision) for zero benefit.
 */
export function isThrottleSafeProgressAction(action: Action): boolean {
  if (action.type === PipelineActions.transcriptionEvent.type) {
    const inner = (
      action as ReturnType<typeof PipelineActions.transcriptionEvent>
    ).event.type;
    return inner === 'download-progress' || inner === 'segment-progress';
  }
  if (action.type === PipelineActions.diarizationEvent.type) {
    const inner = (
      action as ReturnType<typeof PipelineActions.diarizationEvent>
    ).event.type;
    return inner === 'download-progress';
  }
  if (action.type === PipelineActions.translationEvent.type) {
    const inner = (
      action as ReturnType<typeof PipelineActions.translationEvent>
    ).event.type;
    return inner === 'download-progress' || inner === 'segment-progress';
  }
  return false;
}

/**
 * The actual dispatch-ready stream. A SINGLE subscription to `action$`
 * (unlike an earlier version of this function, which subscribed twice via
 * `filter()`+`merge()` — see `pipelineThrottle()`'s doc comment for why
 * that reordered output relative to input) drives a small state machine
 * that holds at most one pending throttle-safe ("progress-tick") action at
 * a time, on its own short timer:
 *
 * - A throttle-safe action arriving while nothing is pending is emitted
 *   immediately (the "leading" edge) and arms a `PIPELINE_THROTTLE_MS`
 *   cooldown timer.
 * - A throttle-safe action arriving while the cooldown timer is still
 *   running REPLACES whatever was pending (only the latest survives —
 *   intermediate progress values are still safe to collapse; that's the
 *   whole point of throttling them).
 * - A NOT-throttle-safe ("bypass") action FLUSHES any pending throttle-safe
 *   action first (emitting it, since it arrived earlier on the source and
 *   must not be reordered behind something that arrived later), then emits
 *   itself immediately. This is the fix for the reordering bug: a stale
 *   trailing `download-progress` can never land after a `transcribe-start`
 *   that logically followed it, because bypass actions always drain the
 *   pending slot before emitting.
 * - When the cooldown timer fires with something still pending, that
 *   pending action is flushed (the "trailing" edge), and a new cooldown
 *   timer starts — so a continuous, uninterrupted progress-tick stream still
 *   never exceeds ~4Hz. Note a bypass action also clears the cooldown timer
 *   (it must, to flush synchronously) — so bypass actions interleaved with
 *   progress ticks reset the ~4Hz window each time. Not reachable in
 *   practice: every bypass-class action is one-shot per pipeline run, never
 *   interleaved per-tick with progress events.
 * - On source completion (or error), any pending action is flushed before
 *   forwarding the completion/error, so nothing pending is silently lost
 *   even if the run ends mid-window. (An external `unsubscribe()` — not a
 *   source completion — does discard a still-pending action; that's normal
 *   Observable teardown semantics, not a gap this design claims to close.)
 *
 * This keeps everything to ONE subscription against `action$` (so, unlike
 * the `filter()`+`merge()` version, there's no need for `share()` either —
 * `action$` traces back to `PipelineRunnerService.run()`'s COLD Observable,
 * and a single subscriber here means it only ever runs once). The output is
 * an order-preserving subsequence of the input: every bypass action and
 * every terminal/state-transition action always reaches the subscriber,
 * always in arrival order; only intermediate throttle-safe progress ticks
 * may be collapsed (the whole point of throttling them) — never dropped
 * entirely, never reordered.
 *
 * This is what `login.component.ts` (Task 4) actually subscribes to; it's
 * exported here (rather than assembled inline in the component) for the
 * same one-tested-definition reason `pipelineThrottle()` and
 * `mapPipelineEventToAction()` are.
 */
export function dispatchPipelineActions(
  action$: Observable<Action>,
): Observable<Action> {
  return new Observable<Action>((subscriber) => {
    let pending: Action | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (): void => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    // Emits whatever's pending (if anything) and clears the timer. Used
    // both for an out-of-order flush (a bypass action, or completion) and
    // for the timer's own trailing-edge fire.
    const flushPending = (): void => {
      clearTimer();
      if (pending !== null) {
        const action = pending;
        pending = null;
        subscriber.next(action);
      }
    };

    const armTimer = (): void => {
      clearTimer();
      timerId = setTimeout(() => {
        timerId = null;
        // Trailing edge: emit whatever accumulated during the cooldown (if
        // anything), then re-arm so a continuous progress-tick stream still
        // can't exceed one emission per PIPELINE_THROTTLE_MS.
        if (pending !== null) {
          const action = pending;
          pending = null;
          subscriber.next(action);
          armTimer();
        }
      }, PIPELINE_THROTTLE_MS);
    };

    const subscription = action$.subscribe({
      next: (action) => {
        if (!isThrottleSafeProgressAction(action)) {
          // Bypass action: flush any earlier-arrived, still-pending
          // progress tick FIRST — preserving input order — then emit this
          // one immediately.
          flushPending();
          subscriber.next(action);
          return;
        }
        if (timerId === null) {
          // Leading edge of a fresh cooldown window.
          subscriber.next(action);
          armTimer();
        } else {
          // Still cooling down — hold as the latest pending value.
          pending = action;
        }
      },
      error: (err) => {
        flushPending();
        subscriber.error(err);
      },
      complete: () => {
        flushPending();
        subscriber.complete();
      },
    });

    return () => {
      clearTimer();
      subscription.unsubscribe();
    };
  });
}

/**
 * Pure, mechanical 1:1 mapping from a `PipelineEvent` (Task 2's real,
 * shipped union — see pipeline-runner.service.ts) to the `PipelineActions`
 * action that reflects it into this store slice. Exported so both this
 * module's own throttle-survival test AND Task 4's component can share a
 * single mapping implementation, rather than the component re-deriving its
 * own switch statement over the same union.
 */
export function mapPipelineEventToAction(event: PipelineEvent): Action {
  switch (event.stage) {
    case 'transcription':
      return 'event' in event
        ? PipelineActions.transcriptionEvent({ event: event.event })
        : PipelineActions.transcriptionFinalized({
            diarizationWarning: event.diarizationWarning,
            willTranslate: event.willTranslate,
          });

    case 'diarization':
      if ('event' in event) {
        return PipelineActions.diarizationEvent({ event: event.event });
      }
      return event.type === 'started'
        ? PipelineActions.diarizationStarted()
        : PipelineActions.diarizationSkipped();

    case 'translation':
      return 'event' in event
        ? PipelineActions.translationEvent({ event: event.event })
        : PipelineActions.translationStart();

    case 'pipeline':
      switch (event.type) {
        case 'stalled':
          return PipelineActions.stalled({
            phase: event.phase,
            message: event.message,
          });
        case 'result':
          return PipelineActions.result({
            diarizationWarning: event.diarizationWarning,
          });
        case 'cancelled':
          return PipelineActions.cancelled();
      }
  }
}

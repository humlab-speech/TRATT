import { Action } from '@ngrx/store';
import {
  filter,
  merge,
  MonoTypeOperatorFunction,
  Observable,
  share,
  throttleTime,
} from 'rxjs';
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
 * indiscriminately to the whole mapped-action stream — see
 * `dispatchPipelineActions()` below, which applies it ONLY to the subset of
 * actions classified as safe-to-throttle progress ticks
 * (`isThrottleSafeProgressAction()`), and dispatches every other action —
 * every discrete state transition and terminal outcome — immediately,
 * unthrottled.
 *
 * Design call (see task-3-report.md for the full writeup): this operator is
 * meant to be applied by whichever caller subscribes to
 * `PipelineRunnerService.run()` and dispatches the mapped actions — today
 * that's `login.component.ts` (Task 4), applied inline in its own
 * `.subscribe()`, not inside an NgRx effect. Exported here (rather than
 * defined inline in the component) purely so it has ONE tested definition
 * instead of being re-typed at the call site.
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
    const inner = (action as ReturnType<typeof PipelineActions.transcriptionEvent>)
      .event.type;
    return inner === 'download-progress' || inner === 'segment-progress';
  }
  if (action.type === PipelineActions.diarizationEvent.type) {
    const inner = (action as ReturnType<typeof PipelineActions.diarizationEvent>)
      .event.type;
    return inner === 'download-progress';
  }
  if (action.type === PipelineActions.translationEvent.type) {
    const inner = (action as ReturnType<typeof PipelineActions.translationEvent>)
      .event.type;
    return inner === 'download-progress' || inner === 'segment-progress';
  }
  return false;
}

/**
 * The actual dispatch-ready stream: splits the mapped-action stream in two
 * (via `filter()`, not the deprecated `partition()` helper, though it's the
 * same split-and-remerge shape) by `isThrottleSafeProgressAction()`, runs
 * `pipelineThrottle()` over ONLY the throttle-safe half, and `merge()`s the
 * untouched discrete/terminal half back in — so every discrete
 * state-transition/terminal action reaches `store.dispatch` immediately, in
 * original order, regardless of what's happening in the progress-tick half,
 * while progress ticks are still capped at ~4Hz. This is what
 * `login.component.ts` (Task 4) actually subscribes to; it's exported here
 * (rather than assembled inline in the component) for the same one-tested-
 * definition reason `pipelineThrottle()` and `mapPipelineEventToAction()`
 * are.
 */
export function dispatchPipelineActions(
  action$: Observable<Action>,
): Observable<Action> {
  // `share()` is load-bearing, not cosmetic: `action$` traces back to
  // `PipelineRunnerService.run()`'s COLD Observable (it starts the actual
  // transcribe()/diarize()/translate() work from its subscriber-setup
  // callback). Splitting it into `immediate$`/`progress$` below and
  // `merge()`-ing them back together means TWO independent subscribers —
  // without `share()`, each one would re-subscribe to (and thus re-run) the
  // whole pipeline from scratch, firing every underlying service call and
  // every `tap()` side effect (elapsed-time interval setup, navigation)
  // TWICE. `share()` ensures both partitions observe the SAME single
  // upstream run.
  const shared$ = action$.pipe(share());
  const immediate$ = shared$.pipe(
    filter((action) => !isThrottleSafeProgressAction(action)),
  );
  const progress$ = shared$.pipe(
    filter(isThrottleSafeProgressAction),
    pipelineThrottle(),
  );
  return merge(immediate$, progress$);
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

import { Action } from '@ngrx/store';
import { MonoTypeOperatorFunction, throttleTime } from 'rxjs';
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
 * dropped — this is what guarantees a terminal event (result/error/stalled/
 * cancelled) landing inside a throttle window right after a burst of
 * progress events still gets dispatched. See
 * pipeline-event-mapping.spec.ts's "does not drop a terminal event" test,
 * which verifies this empirically against the real operator rather than
 * just trusting `trailing: true`'s documented semantics.
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

import { createAction, props } from '@ngrx/store';
import type { BundleRunError, BundleRunStage, BundleRunState } from './index';

/**
 * Plain `createAction`s grouped in a class — the convention already used by
 * `PipelineActions` and `LoginModeActions`, not `createActionGroup` (none of
 * these are request/response do/success/fail families).
 *
 * All of these are dispatched by `PipelineQueueService` (Task 4) except
 * `restoreInterrupted`, dispatched by `BundleRestoreEffects` (Task 2).
 *
 * There is deliberately no separate `idle` action: "the queue went idle" is
 * exactly what `activateNext` on an empty queue and `stopped` already
 * produce, and a third way to reach the same state would be untested dead
 * surface.
 */
export class PipelineQueueActions {
  /** Append ids to the FIFO tail and mark each 'queued'. */
  static enqueued = createAction(
    '[PipelineQueue] enqueued',
    props<{ bundleIds: string[] }>(),
  );

  /** Pop the head into `activeId`, or go idle when the queue is empty. */
  static activateNext = createAction('[PipelineQueue] activate next');

  /** Stage/progress tick for whichever bundle is currently active. */
  static progress = createAction(
    '[PipelineQueue] progress',
    props<{
      stage: BundleRunStage;
      progress?: number;
      downloading?: boolean;
    }>(),
  );

  static bundleDone = createAction(
    '[PipelineQueue] bundle done',
    props<{ bundleId: string }>(),
  );

  static bundleFailed = createAction(
    '[PipelineQueue] bundle failed',
    props<{ bundleId: string; error: BundleRunError }>(),
  );

  /**
   * `stop()`: finish the active bundle, then stop. With nothing active this
   * resolves straight to the fully-stopped state instead of parking in
   * 'pausing' forever with no run to finish.
   */
  static pause = createAction('[PipelineQueue] pause');

  /**
   * The queue actually stopped: drop every pending id and reset their run
   * state to 'idle' (NOT 'queued'), so a later "run" recomputes the ready
   * set fresh, per the spec's `stop()` semantics.
   */
  static stopped = createAction('[PipelineQueue] stopped');

  /**
   * Boot-time rehydration from persisted `runState`. 'queued'/'running'
   * become 'interrupted' — never silently resumed.
   */
  static restoreInterrupted = createAction(
    '[PipelineQueue] restore interrupted',
    props<{ entries: { bundleId: string; state: BundleRunState }[] }>(),
  );
}

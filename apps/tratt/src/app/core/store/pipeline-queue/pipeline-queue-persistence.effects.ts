import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import {
  catchError,
  EMPTY,
  forkJoin,
  mergeMap,
  of,
  withLatestFrom,
} from 'rxjs';
import { IDBService } from '../../shared/service/idb.service';
import { buildModeOptions } from '../idb/build-mode-options';
import { LoginMode, RootState } from '../index';
import { runStatusOf } from './index';
import { PipelineQueueActions } from './pipeline-queue.actions';

/**
 * Persists each bundle's `runState` into its own `bundles` options row
 * whenever the queue transitions that bundle's state.
 *
 * A dedicated effect rather than extra entries in `IDBEffects.
 * savemodeOptions$`'s trigger list (the spec's "following the existing
 * savemodeOptions$ trigger-list convention"): that effect resolves its
 * target bundle as `state.localMode.selectedBundleId`, but the queue is
 * almost always transitioning a bundle the user does NOT have selected —
 * routing queue actions through it would write bundle X's run state onto
 * bundle Y's row. This effect reads the target bundle's own AnnotationState
 * out of the entity collection by the action's explicit bundleId instead.
 *
 * It shares `buildModeOptions()` with `savemodeOptions$` so both writers
 * emit the identical field set — mandatory, because the underlying LOCAL
 * write replaces the whole stored options object (see that function's own
 * doc comment).
 *
 * `{ dispatch: false }`: a save failure here must not disturb the queue or
 * the user's editing session. The run itself already happened; a lost
 * runState row degrades to "this bundle looks idle after a reload," which is
 * strictly better than interrupting the queue.
 */
@Injectable()
export class PipelineQueuePersistenceEffects {
  saveRunState$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          PipelineQueueActions.enqueued,
          PipelineQueueActions.activateNext,
          PipelineQueueActions.bundleDone,
          PipelineQueueActions.bundleFailed,
          PipelineQueueActions.stopped,
        ),
        withLatestFrom(this.store),
        mergeMap(([action, appState]) => {
          const bundleIds = this.resolveBundleIds(action, appState);
          if (bundleIds.length === 0) {
            return EMPTY;
          }
          const writes = bundleIds
            .map((bundleId) => this.writeOne(bundleId, appState))
            .filter((write): write is NonNullable<typeof write> => !!write);
          return writes.length > 0 ? forkJoin(writes) : EMPTY;
        }),
      ),
    { dispatch: false },
  );

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private idbService: IDBService,
  ) {}

  /**
   * Which bundles this action changed the persisted state of. `enqueued`
   * and `stopped` change several at once; the rest change exactly one —
   * `activateNext` changes whichever bundle is active AFTER the reducer ran,
   * which `withLatestFrom(this.store)` above already sees.
   */
  private resolveBundleIds(action: Action, appState: RootState): string[] {
    if (action.type === PipelineQueueActions.enqueued.type) {
      return (action as ReturnType<typeof PipelineQueueActions.enqueued>)
        .bundleIds;
    }
    if (action.type === PipelineQueueActions.activateNext.type) {
      const activeId = appState.pipelineQueue.activeId;
      return activeId === null ? [] : [activeId];
    }
    if (action.type === PipelineQueueActions.stopped.type) {
      return Object.keys(appState.pipelineQueue.runs);
    }
    return [
      (
        action as ReturnType<
          | typeof PipelineQueueActions.bundleDone
          | typeof PipelineQueueActions.bundleFailed
        >
      ).bundleId,
    ];
  }

  private writeOne(bundleId: string, appState: RootState) {
    const modeState = appState.localMode.bundles.entities[bundleId];
    if (!modeState) {
      return undefined;
    }
    return this.idbService
      .saveModeOptions(
        LoginMode.LOCAL,
        buildModeOptions(
          modeState,
          appState.authentication.me,
          runStatusOf(appState.pipelineQueue.runs, bundleId).state,
        ),
        bundleId,
      )
      .pipe(
        // Best-effort, per this effect's doc comment: never let a failed
        // persist surface as an unhandled error that kills the effect
        // stream (which would silently stop persisting for the rest of the
        // session).
        mergeMap(() => of(undefined)),
        catchError(() => of(undefined)),
      );
  }
}

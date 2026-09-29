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
import { AudioService } from '../../shared/service/audio.service';
import { IDBService } from '../../shared/service/idb.service';
import { buildModeOptions } from '../idb/build-mode-options';
import { LoginMode, RootState } from '../index';
import { LoginModeActions } from '../login-mode/login-mode.actions';
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
          // F5 (final whole-branch review fix wave): the reducer's `pause`
          // action can resolve directly to stopNow() (when nothing is
          // active), resetting every queued bundle's in-memory run state to
          // 'idle' — the same reset `stopped` gets. Without `pause` in this
          // list that reset was never persisted, so a next-boot restore
          // could rehydrate stale 'queued' Dexie rows as 'interrupted'
          // instead of the 'idle' the queue actually settled on.
          PipelineQueueActions.pause,
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

  /**
   * Persists a transcript the queue produced for a bundle that is usually
   * NOT the selected one.
   *
   * A dedicated effect rather than another entry in `IDBEffects.
   * saveAnnotation`'s trigger list, for the same reason `saveRunState$` is
   * separate: that effect resolves its bundle id from `selectedBundleId` AND
   * reads sample rate/duration off `AudioService.current` — both of which
   * point at the wrong bundle here. This one uses the action's explicit
   * `bundleId` and that bundle's own `AudioManager`.
   */
  saveBundleTranscript$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LoginModeActions.setBundleTranscript),
        withLatestFrom(this.store),
        mergeMap(([action, appState]) => {
          const modeState =
            appState.localMode.bundles.entities[action.bundleId];
          const manager = this.audioService.getManager(action.bundleId);
          if (!modeState || !manager) {
            // No resident audio means no sample rate/duration to serialize
            // against. The transcript is still in the store; it just isn't
            // persisted for this bundle until something re-saves it.
            return EMPTY;
          }
          return this.idbService
            .saveAnnotation(
              LoginMode.LOCAL,
              action.transcript.serialize(
                modeState.audio?.fileName ?? manager.resource.info.fullname,
                manager.resource.info.sampleRate,
                manager.resource.info.duration,
              ),
              action.bundleId,
            )
            .pipe(
              mergeMap(() => of(undefined)),
              catchError(() => of(undefined)),
            );
        }),
      ),
    { dispatch: false },
  );

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private idbService: IDBService,
    private audioService: AudioService,
  ) {}

  /**
   * Which bundles this action changed the persisted state of. `enqueued`,
   * `stopped`, and `pause` (F5 fix: when it resolves to stopNow()) change
   * several at once; the rest change exactly one — `activateNext` changes
   * whichever bundle is active AFTER the reducer ran, which
   * `withLatestFrom(this.store)` above already sees.
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
    if (
      action.type === PipelineQueueActions.stopped.type ||
      action.type === PipelineQueueActions.pause.type
    ) {
      // Same "persist every currently-known bundle id's run state" handling
      // as `stopped` — see the ofType() doc comment above for why `pause`
      // needs it too.
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

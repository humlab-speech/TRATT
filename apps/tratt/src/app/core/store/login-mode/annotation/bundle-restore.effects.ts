import { inject, Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { IAnnotJSON } from '@tratt/annotation';
import { renamePlaceholderLevels } from '@tratt/utilities';
import {
  catchError,
  filter,
  forkJoin,
  map,
  Observable,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { SessionFile } from '../../../obj/SessionFile';
import { IDBService } from '../../../shared/service/idb.service';
import { IIDBModeOptions } from '../../../shared/tratt-database';
import { WorkspaceService } from '../../../shared/workspace/workspace.service';
import { IDBActions } from '../../idb/idb.actions';
import { LoginMode, RootState } from '../../index';
import { BundleRunState } from '../../pipeline-queue';
import { PipelineQueueActions } from '../../pipeline-queue/pipeline-queue.actions';
import { LoginModeActions } from '../login-mode.actions';
import { DEFAULT_BUNDLE_ID } from './local-bundle-collection';

interface RestoredBundleData {
  bundleId: string;
  options: IIDBModeOptions;
  annotation: IAnnotJSON;
}

/**
 * Boot-time effect that restores every LOCAL-mode bundle beyond `bundle-1`
 * from IndexedDB into the store, so bundles the user created before a page
 * reload show up again (audio itself is never persisted, so each restored
 * bundle's `audio.loaded` stays false — the "awaiting media" state).
 *
 * `bundle-1` (DEFAULT_BUNDLE_ID) is deliberately skipped here — it's already
 * restored by IDBEffects.loadOptions$/afterOptionsSuccess$/loadAnnotation$,
 * which remain unchanged. Restoring it again here would double-populate it.
 *
 * Trigger choice: this fires on `IDBActions.loadOptions.success` — i.e.
 * sequenced *after* `IDBEffects.loadOptions$` completes — rather than on the
 * same `initApplication.setSessionStorageOptions` action `loadOptions$`
 * itself listens for. Running on the same trigger would mean this effect
 * either duplicates `IDBService.initialize(databaseName)` (racing
 * `loadOptions$`'s own call, since both would try to set
 * `IDBService`'s private `database` field) or needs its own synchronization
 * with `loadOptions$`'s completion anyway. Sequencing after
 * `loadOptions.success` sidesteps that entirely: by construction, the
 * database is already open and bundle-1's own restore is already in
 * flight/queued, so this effect can safely call `idbService.*` right away
 * with no extra coordination — the simpler option that's still correct.
 */
@Injectable()
export class BundleRestoreEffects {
  private workspaceService = inject(WorkspaceService);

  restoreBundles$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(IDBActions.loadOptions.success),
        // The VISP workspace's list is exactly the server-side assignment.
        filter(() => !this.workspaceService.isVisp()),
        switchMap(() =>
          this.idbService.listLocalBundleIds().pipe(
            switchMap((bundleIds) => {
              const otherBundleIds = bundleIds.filter(
                (bundleId) => bundleId !== DEFAULT_BUNDLE_ID,
              );
              // bundle-1's ENTITY is restored by the pre-existing
              // loadOptions$/loadAnnotation$ boot effects (restoring it here
              // too would double-populate it) — but nothing else restores
              // its persisted runState, so load its options row here purely
              // for that one field. `loadBundle` is reused unchanged: its
              // extra loadAnnotation call for bundle-1 is a read, and the
              // result is discarded below by the DEFAULT_BUNDLE_ID skip in
              // the createBundle loop.
              const idsToLoad = bundleIds.includes(DEFAULT_BUNDLE_ID)
                ? [DEFAULT_BUNDLE_ID, ...otherBundleIds]
                : otherBundleIds;

              if (idsToLoad.length === 0) {
                return of([] as (RestoredBundleData | undefined)[]);
              }

              return forkJoin(
                idsToLoad.map((bundleId) =>
                  this.loadBundle(bundleId).pipe(
                    catchError((error) => {
                      console.error(
                        `[BundleRestoreEffects] failed to load bundle "${bundleId}" — skipping`,
                        error,
                      );
                      return of(undefined);
                    }),
                  ),
                ),
              );
            }),
            tap((results) => {
              const runEntries: {
                bundleId: string;
                state: BundleRunState;
              }[] = [];

              for (const result of results) {
                if (!result) {
                  continue;
                }

                const persistedRunState = result.options?.runState;
                if (persistedRunState) {
                  runEntries.push({
                    bundleId: result.bundleId,
                    state: persistedRunState,
                  });
                }

                if (result.bundleId === DEFAULT_BUNDLE_ID) {
                  // Entity already restored by loadOptions$/loadAnnotation$;
                  // this row was loaded only for its runState above.
                  continue;
                }

                if (!result.options?.sessionfile) {
                  // Defensive skip: an unused/blank bundle should never have
                  // gotten a real bundleId beyond bundle-1 in the first
                  // place — but guard anyway.
                  continue;
                }

                const sessionFile = SessionFile.fromAny(
                  result.options.sessionfile,
                );
                if (!sessionFile) {
                  continue;
                }

                // Transcripts stored before the placeholder was renamed on
                // import still carry the converters' `OCTRA_1` tier name.
                renamePlaceholderLevels(
                  result.annotation,
                  this.transloco.translate('translation.default tier'),
                );
                this.store.dispatch(
                  LoginModeActions.createBundle({
                    mode: LoginMode.LOCAL,
                    bundleId: result.bundleId,
                    sessionFile,
                    restoredOptions: result.options,
                    restoredAnnotation: result.annotation,
                  }),
                );
              }

              if (runEntries.length > 0) {
                // 'queued'/'running' become 'interrupted' in the reducer —
                // a run NEVER silently resumes across a reload.
                this.store.dispatch(
                  PipelineQueueActions.restoreInterrupted({
                    entries: runEntries,
                  }),
                );
              }

              // Unconditionally re-select bundle-1 as the app's default
              // focus at boot — without this, selectedBundleId would end up
              // on whichever restored bundle happened to be processed last
              // (an arbitrary Dexie-scan order).
              this.store.dispatch(
                LoginModeActions.selectBundle({
                  mode: LoginMode.LOCAL,
                  bundleId: DEFAULT_BUNDLE_ID,
                }),
              );
            }),
            catchError((error) => {
              console.error(
                '[BundleRestoreEffects] listLocalBundleIds() failed — no extra bundles restored',
                error,
              );
              this.store.dispatch(
                LoginModeActions.selectBundle({
                  mode: LoginMode.LOCAL,
                  bundleId: DEFAULT_BUNDLE_ID,
                }),
              );
              return of(undefined);
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private idbService: IDBService,
    private transloco: TranslocoService,
  ) {}

  private loadBundle(bundleId: string): Observable<RestoredBundleData> {
    return forkJoin([
      this.idbService.loadModeOptions(LoginMode.LOCAL, bundleId),
      this.idbService.loadAnnotation(LoginMode.LOCAL, bundleId),
    ]).pipe(
      map(([options, annotation]) => ({ bundleId, options, annotation })),
    );
  }
}

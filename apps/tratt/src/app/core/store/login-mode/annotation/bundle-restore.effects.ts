import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { IAnnotJSON } from '@tratt/annotation';
import {
  catchError,
  forkJoin,
  map,
  Observable,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { SessionFile } from '../../../obj/SessionFile';
import { IIDBModeOptions } from '../../../shared/tratt-database';
import { IDBService } from '../../../shared/service/idb.service';
import { LoginMode, RootState } from '../../index';
import { IDBActions } from '../../idb/idb.actions';
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
  restoreBundles$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(IDBActions.loadOptions.success),
        switchMap(() =>
          this.idbService.listLocalBundleIds().pipe(
            switchMap((bundleIds) => {
              const otherBundleIds = bundleIds.filter(
                (bundleId) => bundleId !== DEFAULT_BUNDLE_ID,
              );

              if (otherBundleIds.length === 0) {
                return of([] as (RestoredBundleData | undefined)[]);
              }

              return forkJoin(
                otherBundleIds.map((bundleId) =>
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
              for (const result of results) {
                if (!result?.options?.sessionfile) {
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

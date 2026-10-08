import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import {
  IAnnotJSON,
  OAnnotJSON,
  TrattAnnotation,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { hasProperty } from '@tratt/utilities';
import { SessionStorageService } from 'ngx-webstorage';
import {
  catchError,
  concatMap,
  exhaustMap,
  filter,
  forkJoin,
  from,
  map,
  mergeAll,
  mergeMap,
  Observable,
  of,
  Subject,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';
import { AudioService } from '../../shared/service';
import { ConsoleEntry } from '../../shared/service/bug-report.service';
import { IDBService } from '../../shared/service/idb.service';
import { RoutingService } from '../../shared/service/routing.service';
import {
  IIDBApplicationOptions,
  IIDBModeOptions,
} from '../../shared/tratt-database';
import { ApplicationActions } from '../application/application.actions';
import { AuthenticationActions } from '../authentication';
import { getModeState, LoginMode, RootState } from '../index';
import { AnnotationState } from '../login-mode/annotation';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';
import {
  DEFAULT_BUNDLE_ID,
  resolveLocalBundleState,
} from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { runStatusOf } from '../pipeline-queue';
import { UserActions } from '../user/user.actions';
import { ANNOTATION_SAVE_TRIGGERS } from './annotation-save-triggers';
import { buildModeOptions } from './build-mode-options';
import { IDBActions } from './idb.actions';

@Injectable({
  providedIn: 'root',
})
export class IDBEffects {
  loadOptions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.initApplication.setSessionStorageOptions),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        const databaseName =
          state.application.appConfiguration?.tratt.database.name;

        if (!databaseName) {
          return of(
            IDBActions.loadOptions.fail({
              error: 'App configuration is not loaded',
            }),
          );
        }

        return this.idbService
          .initialize(databaseName)
          .pipe(
            map(() => {
              this.store.dispatch(
                IDBActions.loadImportOptions.do({
                  mode: LoginMode.LOCAL,
                }),
              );
              this.store.dispatch(
                IDBActions.loadImportOptions.do({
                  mode: LoginMode.ONLINE,
                }),
              );
              this.store.dispatch(
                IDBActions.loadImportOptions.do({
                  mode: LoginMode.DEMO,
                }),
              );
              this.store.dispatch(
                IDBActions.loadImportOptions.do({
                  mode: LoginMode.URL,
                }),
              );
              return forkJoin<
                [
                  IIDBApplicationOptions,
                  IIDBModeOptions,
                  IIDBModeOptions,
                  IIDBModeOptions,
                  IIDBModeOptions,
                ]
              >([
                this.idbService.loadOptions([
                  'version',
                  'easyMode',
                  'language',
                  'useMode',
                  'showMagnifier',
                  'secondsPerLine',
                  'audioSettings',
                  'highlightingEnabled',
                  'editorFont',
                  'playOnHover',
                  'followPlayCursor',
                  'showFeedbackNotice',
                  'userProfile',
                ]),
                this.idbService.loadModeOptions(
                  LoginMode.LOCAL,
                  DEFAULT_BUNDLE_ID,
                ),
                this.idbService.loadModeOptions(LoginMode.DEMO),
                this.idbService.loadModeOptions(LoginMode.ONLINE),
                this.idbService.loadModeOptions(LoginMode.URL),
              ]);
            }),
            mergeAll(),
          )
          .pipe(
            map(
              ([
                applicationOptions,
                localOptions,
                demoOptions,
                onlineOptions,
                urlOptions,
              ]) => {
                return IDBActions.loadOptions.success({
                  applicationOptions,
                  localOptions,
                  onlineOptions,
                  demoOptions,
                  urlOptions,
                });
              },
            ),
            catchError((err: string) => {
              console.error(err);

              // loadOptions.fail has no reducer/effect listening for it —
              // also dispatch addError so the user actually sees the
              // pre-built LoadingComponent failure UI instead of hanging
              // silently at /load forever. Matches this effect's existing
              // side-channel dispatch pattern above (loadImportOptions.do).
              this.store.dispatch(
                ApplicationActions.addError({
                  error: err,
                }),
              );

              return of(
                IDBActions.loadOptions.fail({
                  error: err,
                }),
              );
            }),
          );
      }),
    ),
  );

  afterOptionsSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(IDBActions.loadOptions.success),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        return forkJoin([
          this.idbService.loadLogs(LoginMode.ONLINE),
          this.idbService.loadLogs(LoginMode.LOCAL, DEFAULT_BUNDLE_ID),
          this.idbService.loadLogs(LoginMode.DEMO),
          this.idbService.loadLogs(LoginMode.URL),
        ]).pipe(
          map(([onlineModeLogs, localModeLogs, demoModeLogs, urlModeLogs]) => {
            if (this.sessStr.retrieve('last_page_path') !== '/help-tools') {
              if (
                state.application.mode === LoginMode.ONLINE &&
                !this.routingService.staticQueryParams.audio_url
              ) {
                this.store.dispatch(
                  LoginModeActions.loadProjectAndTaskInformation.do({
                    projectID: action.onlineOptions.project?.id,
                    taskID: action.onlineOptions.transcriptID ?? undefined,
                    mode: LoginMode.ONLINE,
                    startup: true,
                  }),
                );
              } else {
                // other modes
                this.store.dispatch(
                  LoginModeActions.loadProjectAndTaskInformation.do({
                    projectID: action.demoOptions?.project?.id ?? '1234',
                    taskID: action.demoOptions?.transcriptID ?? '38295',
                    mode: (this.routingService.staticQueryParams.audio_url
                      ? undefined
                      : state.application.mode!) as any,
                    startup: true,
                  }),
                );
              }
            } else {
              this.store.dispatch(ApplicationActions.initApplication.finish());
            }

            return IDBActions.loadLogs.success({
              online: onlineModeLogs,
              demo: demoModeLogs,
              local: localModeLogs,
              url: urlModeLogs,
            });
          }),
        );
      }),
    ),
  );

  loadAnnotation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(IDBActions.loadAnnotation.do),
      exhaustMap((action) => {
        return forkJoin([
          this.idbService.loadAnnotation(LoginMode.ONLINE),
          this.idbService.loadAnnotation(LoginMode.LOCAL, DEFAULT_BUNDLE_ID),
          this.idbService.loadAnnotation(LoginMode.DEMO),
        ]).pipe(
          withLatestFrom(this.store),
          map(
            ([[onlineAnnotation, localAnnotation, demoAnnotation], state]) => {
              const deserialize = (json: IAnnotJSON) => {
                const annotation = OAnnotJSON.deserialize(json);
                if (annotation) {
                  const result = TrattAnnotation.deserialize(annotation);
                  result.changeCurrentLevelIndex(0);
                  return result;
                }
                return undefined;
              };

              const oAnnotation =
                deserialize(onlineAnnotation) ??
                new TrattAnnotation<TrattAnnotationSegment>();
              const lAnnotation =
                deserialize(localAnnotation) ??
                new TrattAnnotation<TrattAnnotationSegment>();
              const dAnnotation =
                deserialize(demoAnnotation) ??
                new TrattAnnotation<TrattAnnotationSegment>();

              return IDBActions.loadAnnotation.success({
                online: oAnnotation,
                local: lAnnotation,
                demo: dAnnotation,
                url: new TrattAnnotation<TrattAnnotationSegment>(), // IGNORE
              });
            },
          ),
          catchError((error) => {
            return of(
              IDBActions.loadAnnotation.fail({
                error: error?.message ?? error,
              }),
            );
          }),
        );
      }),
    ),
  );

  // concatMap (not exhaustMap): a rapid second undo/redo must queue its save
  // behind the in-flight one instead of being dropped, or the DB keeps a stale state.
  saveAfterUndo$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.undo),
      withLatestFrom(this.store),
      concatMap(([actionData, appState]) => {
        // code for saving to the database
        const modeState = getModeState(appState);

        if (modeState) {
          if (!this.audio.current) {
            return of(
              ApplicationActions.undoFailed({
                error: 'No audio loaded — cannot save undo state.',
              }),
            );
          }

          const links = modeState.transcript.links.map((a) => a.link);

          return this.idbService
            .saveAnnotation(
              appState.application.mode!,
              modeState.transcript.serialize(
                this.audio.current.resource.info.fullname,
                this.audio.current.resource.info.sampleRate,
                this.audio.current.resource.info.duration,
              ),
              this.resolveLocalBundleId(appState.application.mode!, appState),
            )
            .pipe(
              map(() => ApplicationActions.undoSuccess()),
              catchError((error) => {
                return of(
                  ApplicationActions.undoFailed({
                    error,
                  }),
                );
              }),
            );
        } else {
          return of(
            ApplicationActions.undoFailed({
              error: "Can't find modeState",
            }),
          );
        }
      }),
    ),
  );

  saveAfterRedo = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.redo),
      withLatestFrom(this.store),
      concatMap(([actionData, appState]: [Action, RootState]) => {
        // code for saving to the database
        const modeState = getModeState(appState);

        if (modeState) {
          if (!this.audio.current) {
            return of(
              ApplicationActions.redoFailed({
                error: 'No audio loaded — cannot save redo state.',
              }),
            );
          }

          return this.idbService
            .saveAnnotation(
              appState.application.mode!,
              modeState.transcript.serialize(
                this.audio.current.resource.info.fullname,
                this.audio.current.resource.info.sampleRate,
                this.audio.current.resource.info.duration,
              ),
              this.resolveLocalBundleId(appState.application.mode!, appState),
            )
            .pipe(
              map(() => ApplicationActions.redoSuccess()),
              catchError((error) => {
                return of(
                  ApplicationActions.redoFailed({
                    error,
                  }),
                );
              }),
            );
        } else {
          return of(
            ApplicationActions.undoFailed({
              error: "Can't find modeState",
            }),
          );
        }
      }),
    ),
  );

  clearLogs$ = createEffect(() =>
    this.actions$.pipe(
      filter(
        (a) =>
          a.type === AnnotationActions.clearLogs.do.type ||
          a.type === LoginModeActions.clearOnlineSession.do.type,
      ),
      withLatestFrom(this.store),
      exhaustMap(([action, appState]) =>
        this.idbService
          .clearLoggingData(
            (action as any).mode,
            this.resolveLocalBundleId((action as any).mode, appState),
          )
          .pipe(
            map(() => IDBActions.clearLogs.success((action as any).mode)),
            catchError((error) => {
              return of(
                IDBActions.clearLogs.fail({
                  error,
                }),
              );
            }),
          ),
      ),
    ),
  );

  clearAllOptions$ = createEffect(() =>
    this.actions$.pipe(
      filter((a) => a.type === IDBActions.clearAllOptions.do.type),
      exhaustMap((action) => {
        const subject = new Subject<Action>();

        this.idbService
          .clearOptions()
          .then(() => {
            subject.next(IDBActions.clearAllOptions.success());
            subject.complete();
          })
          .catch((error) => {
            subject.next(
              IDBActions.clearAllOptions.fail({
                error,
              }),
            );
            subject.complete();
          });

        return subject;
      }),
    ),
  );

  clearAnnotation$ = createEffect(() =>
    this.actions$.pipe(
      filter(
        (action) =>
          action.type === AnnotationActions.clearAnnotation.do.type ||
          action.type === LoginModeActions.clearOnlineSession.do.type ||
          action.type === AuthenticationActions.logout.success.type ||
          action.type === LoginModeActions.endTranscription.do.type,
      ),
      withLatestFrom(this.store),
      exhaustMap(([action, appState]) => {
        if (
          hasProperty(action, 'clearSession') &&
          (action as any).clearSession &&
          // logout actions may carry no mode; without one there is no table
          // to wipe and forkJoin would never complete.
          (action as any).mode
        ) {
          // Clear the bundle the user is looking at. Without an explicit id,
          // clearDataOfMode falls back to DEFAULT_BUNDLE_ID ('bundle-1'),
          // which is a different file as soon as more than one bundle exists:
          // the selected transcript survived while an untouched bundle's
          // annotation and logs were destroyed instead.
          const bundleId = this.resolveLocalBundleId(
            (action as any).mode,
            appState,
          );
          return forkJoin<{
            annotation: Observable<void>;
            logs: Observable<void>;
          }>({
            annotation: this.idbService.clearAnnotationData(
              (action as any).mode,
              bundleId,
            ),
            logs: this.idbService.clearLoggingData(
              (action as any).mode,
              bundleId,
            ),
          }).pipe(
            map(() => {
              return IDBActions.clearAnnotation.success();
            }),
            catchError((error) => {
              return of(
                IDBActions.clearAnnotation.fail({
                  error,
                }),
              );
            }),
          );
        } else {
          return of(IDBActions.clearAnnotation.success());
        }
      }),
    ),
  );

  logoutSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthenticationActions.logout.success),
      exhaustMap(() => {
        const subject = new Subject<Action>();

        try {
          this.sessStr.store('loggedIn', false);
        } catch (e) {
          // Safari private browsing may throw QuotaExceededError
        }
        timer(0).subscribe(() => {
          subject.next(IDBActions.logoutSession.success());
          subject.complete();
        });

        return subject;
      }),
    ),
  );

  savemodeOptions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        AuthenticationActions.logout.success,
        LoginModeActions.changeComment.do,
        LoginModeActions.setFeedback,
        AnnotationActions.setLogging.do,
        AnnotationActions.setCurrentEditor.do,
        AuthenticationActions.loginDemo.success,
        AuthenticationActions.loginURL.success,
        AuthenticationActions.loginLocal.prepare,
        AuthenticationActions.loginLocal.success,
        LoginModeActions.createBundle,
        LoginModeActions.startAnnotation.success,
        ApplicationActions.changeApplicationOption.do,
        LoginModeActions.endTranscription.do,
        AnnotationActions.setLevelIndex.do,
        LoginModeActions.setImportConverter.do,
        AnnotationActions.addSpeakerId.do,
        AnnotationActions.removeSpeakerId.do,
      ),
      filter(
        (action) =>
          action.type !== LoginModeActions.createBundle.type ||
          !(
            (action as any).restoredOptions ||
            (action as any).restoredAnnotation
          ),
      ),
      withLatestFrom(this.store),
      mergeMap(([action, appState]) => {
        // createBundle must persist the bundle it CREATED, not whichever one
        // is selected: background-created bundles (selectAfterCreate: false
        // — every file after the first) otherwise never got an options row,
        // and BundleRestoreEffects skips bundles without a persisted
        // sessionfile — so after a reload they vanished from the list, even
        // with transcript work saved in their annotation row.
        const createdBundleId =
          action.type === LoginModeActions.createBundle.type &&
          (action as any).mode === LoginMode.LOCAL
            ? ((action as any).bundleId as string)
            : undefined;
        const modeState =
          createdBundleId !== undefined
            ? appState.localMode.bundles.entities[createdBundleId]
            : this.getModeStateFromString(appState, (action as any).mode);

        if (modeState) {
          const bundleId =
            createdBundleId ??
            this.resolveLocalBundleId((action as any).mode, appState);
          // Always re-write the CURRENT runState, never omit it: this write
          // replaces the whole stored options object (see buildModeOptions'
          // doc comment), so omitting it would erase a finished run's state.
          const runState =
            bundleId === undefined
              ? undefined
              : runStatusOf(appState.pipelineQueue.runs, bundleId).state;

          return this.idbService
            .saveModeOptions(
              (action as any).mode,
              buildModeOptions(modeState, appState.authentication.me, runState),
              bundleId,
            )
            .pipe(
              map(() => {
                return IDBActions.saveModeOptions.success({
                  mode: (action as any).mode,
                });
              }),
              catchError((error) => {
                return of(
                  IDBActions.saveModeOptions.fail({
                    error,
                  }),
                );
              }),
            );
        } else {
          return of(
            IDBActions.saveModeOptions.success({
              mode: (action as any).mode,
            }),
          );
        }
      }),
    ),
  );

  changeApplicationOption$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.changeApplicationOption.do),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        return this.idbService.saveOption(action.name, action.value).pipe(
          map((a) => ApplicationActions.changeApplicationOption.success()),
          catchError((error: Error) =>
            of(
              ApplicationActions.changeApplicationOption.fail({
                error: error?.message ?? error.toString(),
              }),
            ),
          ),
        );
      }),
    ),
  );

  saveUserProfile$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UserActions.setUserProfile),
      exhaustMap((action) => {
        return this.idbService
          .saveOption('userProfile', { name: action.name, email: action.email })
          .pipe(
            map(() => IDBActions.saveUserProfile.success()),
            catchError((error: Error) => {
              return of(
                IDBActions.saveUserProfile.fail({
                  error: error.message,
                }),
              );
            }),
          );
      }),
    ),
  );

  saveAppLanguage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.setAppLanguage),
      exhaustMap((action) => {
        return this.idbService.saveOption('language', action.language).pipe(
          map(() => IDBActions.saveAppLanguage.success()),
          catchError((error: Error) => {
            return of(
              IDBActions.saveAppLanguage.fail({
                error: error.message,
              }),
            );
          }),
        );
      }),
    ),
  );

  saveDBVersion = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.setDBVersion),
      exhaustMap((action) => {
        return this.idbService.saveOption('version', action.version).pipe(
          map(() => IDBActions.saveIDBVersion.success()),
          catchError((error: Error) => {
            return of(
              IDBActions.saveIDBVersion.fail({
                error: error.message,
              }),
            );
          }),
        );
      }),
    ),
  );

  saveEasyMode$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.setEasyMode),
      exhaustMap((action) => {
        return this.idbService.saveOption('easyMode', action.easyMode).pipe(
          map(() => IDBActions.saveEasyMode.success()),
          catchError((error: Error) => {
            return of(
              IDBActions.saveEasyMode.fail({
                error: error.message,
              }),
            );
          }),
        );
      }),
    ),
  );

  saveHighlightingEnabled$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.setHighlightingEnabled),
      exhaustMap((action) => {
        return this.idbService
          .saveOption('highlightingEnabled', action.highlightingEnabled)
          .pipe(
            map(() => IDBActions.saveHighlightingEnabled.success()),
            catchError((error: Error) => {
              return of(
                IDBActions.saveHighlightingEnabled.fail({
                  error: error.message,
                }),
              );
            }),
          );
      }),
    ),
  );

  saveLogin$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          AuthenticationActions.loginLocal.success,
          AuthenticationActions.loginDemo.success,
          AuthenticationActions.loginOnline.success,
        ),
        tap(async (action) => {
          try {
            this.sessStr.store('loggedIn', true);
          } catch (e) {
            // Safari private browsing may throw QuotaExceededError
          }
          try {
            await this.idbService.saveOption('useMode', action.mode);
          } catch (e) {
            console.error('Failed to save useMode to IDB:', e);
          }
        }),
      ),
    { dispatch: false },
  );

  saveLogout$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthenticationActions.logout.success),
      exhaustMap((action) => {
        try {
          this.sessStr.store('loggedIn', false);
        } catch (e) {
          // Safari private browsing may throw QuotaExceededError
        }
        return this.idbService.saveOption('useMode', undefined).pipe(
          map(() => IDBActions.saveLogout.success()),
          catchError((error: Error) => {
            return of(
              IDBActions.saveLogout.fail({
                error: error.message,
              }),
            );
          }),
        );
      }),
    ),
  );

  saveReloaded$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.setReloaded),
      exhaustMap((action) => {
        const subject = new Subject<Action>();

        try {
          this.sessStr.store('reloaded', action.reloaded);
          setTimeout(() => {
            subject.next(IDBActions.saveAppReloaded.success());
            subject.complete();
          }, 200);
        } catch (error) {
          setTimeout(() => {
            subject.next(
              IDBActions.saveAppReloaded.fail({
                error: error as any,
              }),
            );
            subject.complete();
          }, 200);
        }

        return subject;
      }),
    ),
  );

  saveAudioSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.setAudioSettings),
      exhaustMap((action) => {
        return this.idbService
          .saveOption('audioSettings', {
            volume: action.volume,
            speed: action.speed,
          })
          .pipe(
            map(() => IDBActions.saveAudioSettings.success()),
            catchError((error: Error) => {
              return of(
                IDBActions.saveAudioSettings.fail({
                  error: error.message,
                }),
              );
            }),
          );
      }),
    ),
  );

  saveCurrentEditor$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.setCurrentEditor.do),
      exhaustMap((action) => {
        return this.idbService
          .saveOption('interface', action.currentEditor)
          .pipe(
            map(() => IDBActions.saveCurrentEditor.success()),
            catchError((error: Error) => {
              return of(
                IDBActions.saveCurrentEditor.fail({
                  error: error.message,
                }),
              );
            }),
          );
      }),
    ),
  );

  saveLogs$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.saveLogs.do, AnnotationActions.addLog.do),
      withLatestFrom(this.store),
      exhaustMap(([action, appState]: [Action, RootState]) => {
        const modeState = this.getModeStateFromString(
          appState,
          (action as any).mode,
        );

        if (modeState) {
          return this.idbService
            .saveLogs(
              (action as any).mode,
              modeState.logging.logs,
              this.resolveLocalBundleId((action as any).mode, appState),
            )
            .pipe(
              map(() => IDBActions.saveLogs.success()),
              catchError((error) => {
                return of(
                  IDBActions.saveLogs.fail({
                    error,
                  }),
                );
              }),
            );
        } else {
          return of(
            IDBActions.saveLogs.fail({
              error: "Can't find modeState",
            }),
          );
        }
      }),
    ),
  );

  saveAnnotation = createEffect(() =>
    this.actions$.pipe(
      ofType(...ANNOTATION_SAVE_TRIGGERS),
      withLatestFrom(this.store),
      mergeMap(([action, appState]) => {
        const modeState = this.getModeStateFromString(appState, action.mode);

        if (!modeState) {
          // Every trigger must be answered, or AnnotationSaveTracker never
          // releases its count and "Leave site?" sticks for the session.
          return of(
            IDBActions.saveAnnotation.fail({
              error: "Can't find modeState",
            }),
          );
        }
        if (!this.audio.current) {
          // Audio not yet loaded (e.g. loginLocal.prepare fires before audio is registered).
          // Skip annotation save — it will be saved once audio loads successfully.
          return of(IDBActions.saveAnnotation.success());
        }
        let serialized;
        try {
          serialized = modeState.transcript.serialize(
            modeState.audio.fileName,
            this.audio.current.resource.info.sampleRate,
            this.audio.current.resource.info.duration,
          );
        } catch (error) {
          // A synchronous throw here would kill the effect and leave the
          // tracker's count unanswered.
          return of(
            IDBActions.saveAnnotation.fail({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        return this.idbService
          .saveAnnotation(
            action.mode,
            serialized,
            this.resolveLocalBundleId(action.mode, appState),
          )
          .pipe(
            map(() => IDBActions.saveAnnotation.success()),
            catchError((error) => {
              return of(
                IDBActions.saveAnnotation.fail({
                  error,
                }),
              );
            }),
          );
      }),
    ),
  );

  loadConsoleEntries$ = createEffect(() =>
    this.actions$.pipe(
      ofType(IDBActions.loadAnnotation.success, IDBActions.loadAnnotation.fail),
      mergeMap((action) => {
        const subject = new Subject<Action>();

        this.idbService
          .loadConsoleEntries()
          .then((dbEntries: ConsoleEntry[]) => {
            if (dbEntries !== undefined) {
              subject.next(
                IDBActions.loadConsoleEntries.success({
                  consoleEntries: dbEntries,
                }),
              );
            } else {
              subject.next(
                IDBActions.loadConsoleEntries.success({
                  consoleEntries: [],
                }),
              );
            }
          })
          .catch(() => {
            subject.next(
              IDBActions.loadConsoleEntries.success({
                consoleEntries: [],
              }),
            );
          });

        return subject;
      }),
    ),
  );

  loadImportOptions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(IDBActions.loadImportOptions.do),
      mergeMap((action) => {
        return from(
          this.idbService.loadImportOptions(
            action.mode,
            action.mode === LoginMode.LOCAL ? DEFAULT_BUNDLE_ID : undefined,
          ),
        ).pipe(
          map((importOptions) =>
            IDBActions.loadImportOptions.success({
              mode: action.mode,
              importOptions,
            }),
          ),
        );
      }),
    ),
  );

  saveConsoleEntries$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApplicationActions.setConsoleEntries),
        tap((action) => {
          if (this.idbService.isReady) {
            this.idbService
              .saveConsoleEntries(action.consoleEntries)
              .then(() => {
                this.store.dispatch(IDBActions.saveConsoleEntries.success());
              })
              .catch((error) => {
                this.store.dispatch(IDBActions.saveConsoleEntries.success());
              });
          }
        }),
      ),
    { dispatch: false },
  );

  saveModeBeforeURLRedirection$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthenticationActions.loginOnline.redirectToURL),
        withLatestFrom(this.store),
        tap(([a, state]) => {
          this.idbService.saveOption('useMode', LoginMode.ONLINE);
        }),
      ),
    { dispatch: false },
  );

  saveImportOptions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LoginModeActions.changeImportOptions.do),
      filter((action) => action.importOptions != null),
      withLatestFrom(this.store),
      exhaustMap(([action, appState]) =>
        this.idbService
          .saveImportOptions(
            action.mode,
            action.importOptions!,
            this.resolveLocalBundleId(action.mode, appState),
          )
          .pipe(
            map(() => IDBActions.saveImportOptions.success()),
            catchError((error: Error) =>
              of(IDBActions.saveImportOptions.fail({ error: error.message })),
            ),
          ),
      ),
    ),
  );

  /**
   * Final whole-branch review fix: `LoginModeActions.removeBundles` only
   * ever touched the NgRx store — nothing deleted the corresponding rows
   * from the Dexie `bundles` table, so a "removed" bundle resurrected on
   * the next reload via `BundleRestoreEffects`'s `listLocalBundleIds()`
   * walk. `{ dispatch: false }`: `removeBundles` has no success/fail
   * action-group siblings to map onto, and a failed IDB delete here must
   * not disturb the store — the bundle is already gone from the UI either
   * way, so this is best-effort cleanup, logged on failure.
   */
  removeBundles$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LoginModeActions.removeBundles),
        // mergeMap, not exhaustMap: exhaustMap silently DROPPED a second
        // removal (e.g. "Clear finished" then "Remove" in quick succession)
        // while the first delete was still in flight, so those bundles
        // resurrected on the next reload.
        mergeMap((action) =>
          this.idbService.deleteLocalBundles(action.bundleIds).pipe(
            catchError((error) => {
              console.error('Failed to delete bundles from IndexedDB', error);
              return of(undefined);
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  clearAllData$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(IDBActions.clearAllData.do),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          try {
            this.sessStr.clear();
          } catch (e) {
            // Safari private browsing may throw QuotaExceededError
          }
          this.idbService
            .clearAllData()
            .then(() => {
              this.store.dispatch(IDBActions.clearAllData.success());
            })
            .catch((e: Error) => {
              console.error('Failed to clear IDB data:', e);
              this.store.dispatch(
                IDBActions.clearAllData.fail({
                  error: e?.message ?? String(e),
                }),
              );
            });
        }),
      ),
    { dispatch: false },
  );

  constructor(
    private actions$: Actions,
    private idbService: IDBService,
    private sessStr: SessionStorageService,
    private routingService: RoutingService,
    private store: Store<RootState>,
    private audio: AudioService,
  ) {
    actions$.subscribe((action) => {
      if (action.type.toLocaleLowerCase().indexOf('failed') > -1) {
        const errorMessage = (action as any).error;
        console.error(`${action.type}: ${errorMessage}`);
      }
    });
  }

  private resolveLocalBundleId(
    mode: LoginMode,
    appState: RootState,
  ): string | undefined {
    return mode === LoginMode.LOCAL
      ? appState.localMode.selectedBundleId
      : undefined;
  }

  getModeStateFromString(appState: RootState, mode: LoginMode) {
    let modeState: AnnotationState | undefined = undefined;
    if (mode === 'online') {
      modeState = appState.onlineMode;
    } else if (mode === 'local') {
      modeState = resolveLocalBundleState(appState.localMode);
    } else if (mode === 'demo') {
      modeState = appState.demoMode;
    } else if (mode === 'url') {
      modeState = appState.urlMode;
    }
    return modeState;
  }
}

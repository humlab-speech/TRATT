import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  TaskDto,
  TaskInputOutputCreatorType,
  TaskInputOutputDto,
  ToolConfigurationAssetDto,
} from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import {
  ImportResult,
  OAnnotJSON,
  OLabel,
  TrattAnnotation,
} from '@tratt/annotation';
import {
  extractFileNameFromURL,
  pickInitialLevelName,
  SubscriptionManager,
} from '@tratt/utilities';
import {
  catchError,
  exhaustMap,
  forkJoin,
  map,
  Observable,
  of,
  tap,
  throwError,
  withLatestFrom,
} from 'rxjs';
import { AppInfo } from '../../../../app.info';
import { TrattModalService } from '../../../modals/tratt-modal.service';
import {
  createSampleProjectDto,
  createSampleTask,
  createSampleUser,
  findCompatibleFileFromIO,
  isValidAnnotation,
  StatisticElem,
} from '../../../shared';
import { migrateLegacyConfigKey } from '../../../shared/legacy-config';
import {
  AlertService,
  AudioService,
  UserInteractionsService,
} from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { RoutingService } from '../../../shared/service/routing.service';
import { ApplicationActions } from '../../application/application.actions';
import { checkAndThrowError } from '../../error.handlers';
import { getModeState, LoginMode, RootState } from '../../index';
import { LoginModeActions } from '../login-mode.actions';
import { AnnotationActions } from './annotation.actions';
import { AnnotationMaintenanceEffects } from './annotation-maintenance.effects';
import { AnnotationState, GuidelinesItem } from './index';

import { FileInfo } from '@tratt/web-media';
import mime from 'mime';
import { FeedBackForm } from '../../../obj/FeedbackForm/FeedBackForm';

@Injectable()
export class AnnotationLoadEffects {
  subscrManager = new SubscriptionManager();

  startNewAnnotation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.startNewAnnotation.do),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        if (a.mode === LoginMode.ONLINE) {
          this.store.dispatch(ApplicationActions.waitForEffects.do());

          // start
          return this.apiService
            .startTask(a.project.id, {
              task_type: 'annotation',
            })
            .pipe(
              map((task) => {
                if (task) {
                  return AnnotationActions.prepareTaskDataForAnnotation.do({
                    currentProject: a.project,
                    task,
                    mode: a.mode,
                  });
                }

                if (!task && a.actionAfterFail) {
                  this.store.dispatch(ApplicationActions.waitForEffects.do());
                  // no remaining task
                  return a.actionAfterFail;
                }
                return AnnotationActions.showNoRemainingTasksModal.do();
              }),
              catchError((error: HttpErrorResponse) =>
                checkAndThrowError(
                  {
                    statusCode: error.status,
                    message: error.error?.message ?? error.message,
                  },
                  a,
                  AnnotationActions.startAnnotation.fail({
                    error: error.error?.message ?? error.message,
                    showOKButton: true,
                  }),
                  this.store,
                  () => {
                    this.alertService.showAlert(
                      'danger',
                      error.error?.message ?? error.message,
                    );
                  },
                ),
              ),
            );
        }

        return of(
          AnnotationActions.startAnnotation.fail({
            error: 'error.error?.message ?? error.message',
            showOKButton: true,
          }),
        );
      }),
    ),
  );

  onPrepareTaskForAnnotation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.prepareTaskDataForAnnotation.do),
      withLatestFrom(this.store),
      map(([{ task, currentProject, mode }, state]) => {
        if (!task.tool_configuration) {
          return AnnotationActions.startAnnotation.fail({
            error: 'Missing tool configuration',
            showOKButton: true,
          });
        }

        if (
          !task.tool_configuration.assets ||
          task.tool_configuration.assets.length === 0
        ) {
          return AnnotationActions.startAnnotation.fail({
            error: 'Missing tool configuration assets',
            showOKButton: true,
          });
        }

        const assets = task.tool_configuration.assets;
        const guidelines: GuidelinesItem[] = this.readGuidelines(assets);

        this.addFunctions(assets);

        let selectedGuidelines: GuidelinesItem | undefined = undefined;

        if (guidelines.length > 0) {
          if (state.application.language) {
            if (guidelines.length === 1) {
              selectedGuidelines = guidelines[0];
            } else {
              const found = guidelines.find(
                (a) =>
                  new RegExp(
                    `_${state.application.language.toLowerCase()}.json`,
                  ).exec(a.filename) !== null,
              );
              selectedGuidelines = found ?? guidelines[0];
            }
          } else {
            selectedGuidelines = guidelines[0];
          }
        }

        return AnnotationActions.prepareTaskDataForAnnotation.success({
          task,
          mode,
          currentProject,
          guidelines,
          selectedGuidelines,
        });
      }),
    ),
  );

  prepareTaskSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.prepareTaskDataForAnnotation.success),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        const audioFile: TaskInputOutputDto | undefined =
          findCompatibleFileFromIO<TaskInputOutputDto>(
            a.task,
            'audio',
            (io: TaskInputOutputDto) => {
              if (
                io.fileType &&
                (io.fileType.includes('audio') || io.fileType.includes('video'))
              ) {
                return io;
              }
              return undefined;
            },
          );

        if (audioFile) {
          return of(
            AnnotationActions.loadAudio.do({
              audioFile,
              task: a.task,
              currentProject: a.currentProject,
              guidelines: a.guidelines,
              selectedGuidelines: a.selectedGuidelines,
              mode: a.mode,
            }),
          );
        } else {
          return of(
            AnnotationActions.loadAudio.fail({
              error: `No audio file found in given IO.`,
            }),
          );
        }
      }),
    ),
  );

  onAnnotationStart$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.startAnnotation.success),
        withLatestFrom(this.store),
        tap(([a, state]) => {
          // INIT UI SERVICE
          const modeState = getModeState(state)!;
          if (a.projectSettings.logging?.forced) {
            this.uiService.init(
              true,
              modeState.logging.startTime,
              modeState.logging.startReference,
            );
            if (
              modeState.logging.logs &&
              Array.isArray(modeState.logging.logs)
            ) {
              this.uiService.elements = modeState.logging.logs.map((a) =>
                StatisticElem.fromAny(a),
              );
            }
            this.uiService.addElementFromEvent(
              'tratt',
              { value: AppInfo.BUILD.version },
              Date.now(),
              undefined,
              undefined,
              undefined,
              undefined,
              'version',
            );
            this.subscrManager.removeByTag('uiService');
            this.subscrManager.add(
              this.uiService.afteradd.subscribe({
                next: (item: StatisticElem) => {
                  this.store.dispatch(
                    AnnotationActions.addLog.do({
                      mode: state.application.mode!,
                      log: item.getDataClone(),
                    }),
                  );
                },
              }),
              'uiService',
            );
          }

          if (a.mode !== LoginMode.LOCAL) {
            this.store.dispatch(
              LoginModeActions.changeImportOptions.do({
                mode: a.mode,
                importOptions: a.projectSettings.tratt?.importOptions,
              }),
            );
          }

          this.store.dispatch(
            AnnotationActions.initTranscriptionService.do({ mode: a.mode }),
          );
        }),
      ),
    { dispatch: false },
  );

  onAudioLoad$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.loadAudio.do),
        withLatestFrom(this.store),
        tap(([a, state]) => {
          if (state.application.mode === undefined || !a.audioFile) {
            this.store.dispatch(
              AnnotationActions.loadAudio.fail({
                error: `An error occured. Please click on "Back" and try it again.`,
              }),
            );
            return;
          }

          let filename = a.audioFile!.filename;
          if (
            state.application.mode === LoginMode.ONLINE ||
            state.application.mode === LoginMode.URL ||
            state.application.mode === LoginMode.DEMO
          ) {
            // online, url or demo
            if (a.audioFile) {
              const src =
                state.application.mode === LoginMode.ONLINE
                  ? this.apiService.prepareFileURL(a.audioFile!.url!)
                  : a.audioFile!.url!;
              // extract filename

              filename = filename.substring(0, filename.lastIndexOf('.'));

              if (filename.indexOf('src=') > -1) {
                filename = filename.substring(filename.indexOf('src=') + 4);
              }

              this.audio.loadAudio(src, a.audioFile).subscribe({
                next: (progress) => {
                  if (progress < 1) {
                    this.store.dispatch(
                      AnnotationActions.loadAudio.progress({
                        value: progress,
                        mode: state.application.mode!,
                      }),
                    );
                  } else {
                    this.store.dispatch(
                      AnnotationActions.loadAudio.success({
                        mode: state.application.mode!,
                        task: a.task,
                        guidelines: a.guidelines,
                        selectedGuidelines: a.selectedGuidelines,
                        currentProject: a.currentProject,
                        audioFile: a.audioFile,
                      }),
                    );
                  }
                },
                error: (err) => {
                  this.store.dispatch(
                    AnnotationActions.loadAudio.fail({
                      error: 'Loading audio file failed',
                    }),
                  );
                  console.error(err);
                },
              });
            } else {
              this.store.dispatch(
                AnnotationActions.loadAudio.fail({
                  error: `No audio source found. Please click on "Back" and try it again.`,
                }),
              );
              console.error('audio src is undefined');
            }
          } else if (state.application.mode === LoginMode.LOCAL) {
            // local mode
            if (state.localMode.sessionFile !== undefined) {
              if (this.audio.audiomanagers.length > 0) {
                this.store.dispatch(
                  AnnotationActions.loadAudio.success({
                    mode: LoginMode.LOCAL,
                    guidelines: a.guidelines,
                    selectedGuidelines: a.selectedGuidelines,
                    task: a.task,
                    currentProject: a.currentProject,
                    audioFile: a.audioFile,
                  }),
                );
              } else if (state.application.audioAlreadyLoaded) {
                // Audio was registered in proceedWithLogin but is no longer in audiomanagers —
                // this is unexpected and indicates a bug (e.g. premature destroy() call).
                console.error(
                  '[onAudioLoad$ LOCAL] BUG: audioAlreadyLoaded=true but audiomanagers is empty — audio manager was lost after registration',
                );
                this.store.dispatch(
                  AnnotationActions.loadAudio.fail({
                    error: 'audio from sessionfile not loaded. Reload needed.',
                  }),
                );
              } else {
                // Normal page-refresh restore path: audio is not in memory, user must re-upload.
                this.store.dispatch(
                  AnnotationActions.loadAudio.fail({
                    error: 'audio from sessionfile not loaded. Reload needed.',
                  }),
                );
              }
            } else {
              console.error(
                '[onAudioLoad$ LOCAL] FAIL: sessionFile is undefined — audiomanagers.length=',
                this.audio.audiomanagers.length,
              );
              this.store.dispatch(
                AnnotationActions.loadAudio.fail({
                  error: 'sessionfile is undefined',
                }),
              );
            }
          }
        }),
      ),
    { dispatch: false },
  );

  onAnnotationLoadFailed$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.loadAudio.fail),
        withLatestFrom(this.store),
        tap(([a, state]) => {
          if (state.application.mode === LoginMode.LOCAL) {
            this.routingService
              .navigate(
                'reload audio local',
                ['/intern/transcr/reload-file'],
                AppInfo.queryParamsHandling,
              )
              .catch((error) => {
                console.error(error);
              });
          } else {
            // it's an error
            this.modalsService.openErrorModal(a.error);
          }
        }),
      ),
    { dispatch: false },
  );

  loadSegments$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.initTranscriptionService.do),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        this.maintenance.initMaintenance(state);
        return this.loadSegments(getModeState(state)!, state);
      }),
    ),
  );

  loadSegmentsSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.initTranscriptionService.success),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          this.routingService.navigate(
            'transcription initialized',
            ['/intern/transcr'],
            AppInfo.queryParamsHandling,
          );
        }),
      ),
    { dispatch: false },
  );

  initTranscriptService$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.initTranscriptionService.fail),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          this.modalsService.openErrorModal(action.error);
        }),
      ),
    { dispatch: false },
  );

  onAudioLoadSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.loadAudio.success),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) =>
        of(
          AnnotationActions.startAnnotation.success({
            task: a.task,
            project: a.currentProject,
            mode: a.mode,
            projectSettings: a.task.tool_configuration?.value,
            guidelines: a.guidelines,
            selectedGuidelines: a.selectedGuidelines,
          }),
        ),
      ),
    ),
  );

  onLoadOnlineInfo$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LoginModeActions.loadProjectAndTaskInformation.do),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        if (a.mode === LoginMode.ONLINE) {
          return this.apiService.getMyAccountInformation().pipe(
            exhaustMap((currentAccount) => {
              if (!a.taskID || !a.projectID) {
                // user logged in without old annotation
                return of(
                  LoginModeActions.loadProjectAndTaskInformation.success({
                    mode: LoginMode.ONLINE,
                    me: currentAccount,
                    startup: a.startup,
                  }),
                );
              }

              return forkJoin({
                currentProject: this.apiService
                  .getProject(a.projectID)
                  .pipe(catchError((b) => of(undefined))),
                task: this.apiService
                  .continueTask(a.projectID, a.taskID)
                  .pipe(catchError((b) => of(undefined))),
              }).pipe(
                map(({ currentProject, task }) => {
                  return LoginModeActions.loadProjectAndTaskInformation.success(
                    {
                      mode: LoginMode.ONLINE,
                      me: currentAccount,
                      currentProject: currentProject ?? undefined,
                      task: task ?? undefined,
                      startup: a.startup,
                    },
                  );
                }),
                catchError((error: HttpErrorResponse) => {
                  return checkAndThrowError(
                    {
                      statusCode: error.status,
                      message: error.error?.message ?? error.message,
                    },
                    a,
                    LoginModeActions.loadProjectAndTaskInformation.fail({
                      error,
                    }),
                    this.store,
                    () => {
                      this.alertService.showAlert(
                        'danger',
                        error.error?.message ?? error.message,
                      );
                    },
                  );
                }),
              );
            }),
            catchError((error) => {
              if (!a.startup) {
                return checkAndThrowError(
                  {
                    statusCode: error.status,
                    message: error.error?.message ?? error.message,
                  },
                  a,
                  LoginModeActions.loadProjectAndTaskInformation.fail({
                    error,
                  }),
                  this.store,
                  () => {
                    this.alertService.showAlert(
                      'danger',
                      error.error?.message ?? error.message,
                    );
                  },
                );
              } else {
                // ignore
                return of(
                  LoginModeActions.loadProjectAndTaskInformation.success({
                    startup: true,
                  }),
                );
              }
            }),
          );
        } else if (
          [LoginMode.DEMO, LoginMode.LOCAL, LoginMode.URL].includes(a.mode)
        ) {
          // mode is not online => load configuration for local environment
          return forkJoin<
            [
              any,
              (
                | {
                    language: string;
                    json: any;
                  }
                | undefined
              )[],
              any,
            ]
          >([
            this.http
              .get('config/localmode/projectconfig.json', {
                responseType: 'json',
              })
              .pipe(
                map(migrateLegacyConfigKey),
                catchError((err) => {
                  console.error(
                    '[onLoadOnlineInfo$] projectconfig.json failed',
                    err,
                  );
                  return of({});
                }),
              ),
            forkJoin(
              state.application.appConfiguration!.tratt.languages.map(
                (b: string) =>
                  this.http
                    .get(`config/localmode/guidelines/guidelines_${b}.json`, {
                      responseType: 'json',
                    })
                    .pipe(
                      map((c) => ({
                        language: b,
                        json: c,
                      })),
                      catchError(() => of(undefined)),
                    ),
              ),
            ),
            this.http
              .get('config/localmode/functions.js', {
                responseType: 'text',
              })
              .pipe(catchError(() => of(''))),
          ]).pipe(
            exhaustMap(([projectConfig, guidelines, functions]) => {
              const currentProject = createSampleProjectDto('1234');

              const observables: Observable<{
                inputs: TaskInputOutputDto[];
              }>[] = [];

              if (a.mode === LoginMode.DEMO) {
                observables.push(
                  of({
                    inputs: state.application
                      .appConfiguration!.tratt.audioExamples.map((a) => {
                        return {
                          id: Date.now().toString(),
                          filename: FileInfo.fromURL(a.url).fullname,
                          fileType: 'audio/wave',
                          chain_position: 0,
                          type: 'input',
                          url: a.url,
                          creator_type: TaskInputOutputCreatorType.user,
                          content: '',
                          content_type: '',
                        };
                      })
                      .slice(0, 1),
                  }),
                );
              } else if (a.mode === LoginMode.LOCAL) {
                observables.push(
                  of({
                    inputs: [
                      {
                        id: Date.now().toString(),
                        filename: state.localMode.sessionFile?.name ?? '',
                        fileType: state.localMode.sessionFile?.type ?? '',
                        chain_position: 0,
                        type: 'input',
                        creator_type: TaskInputOutputCreatorType.user,
                        content: '',
                        content_type: '',
                      },
                    ],
                  }),
                );
              } else if (a.mode === LoginMode.URL) {
                // URL mode
                const urlInfo: {
                  audio: {
                    url?: string;
                    fileInfo?: FileInfo;
                  };
                  transcript: {
                    url?: string;
                    fileInfo?: FileInfo;
                  };
                } = {
                  audio: {
                    url: undefined,
                    fileInfo: undefined,
                  },
                  transcript: {
                    url: undefined,
                    fileInfo: undefined,
                  },
                };
                urlInfo.audio.url = this.routingService.staticQueryParams
                  .audio_url
                  ? decodeURIComponent(
                      this.routingService.staticQueryParams.audio_url,
                    )
                  : undefined;
                urlInfo.transcript.url = this.routingService.staticQueryParams
                  .transcript
                  ? decodeURIComponent(
                      this.routingService.staticQueryParams.transcript,
                    )
                  : undefined;

                const urlInfoIndexed = urlInfo as Record<
                  string,
                  { url?: string; fileInfo?: FileInfo }
                >;
                for (const key of Object.keys(urlInfo)) {
                  if (urlInfoIndexed[key].url) {
                    let mediaType: string | undefined =
                      key === 'audio'
                        ? this.routingService.staticQueryParams.audio_type
                        : undefined;
                    const decodedURL = decodeURIComponent(
                      urlInfoIndexed[key].url!,
                    );

                    if (decodedURL.includes('?')) {
                      const regex = /mediatype=([^&]+)/g;
                      const matches = regex.exec(decodedURL);
                      mediaType = matches ? matches[1] : mediaType;
                    }

                    const nameFromURL = extractFileNameFromURL(decodedURL);

                    let extension = '';
                    if (nameFromURL.extension) {
                      extension = nameFromURL.extension;
                    } else {
                      if (mediaType) {
                        if (mediaType.includes('audio')) {
                          extension = '.wav';
                        } else if (mediaType.includes('text')) {
                          extension = '.txt';
                        } else if (mediaType.includes('json')) {
                          extension = '_annot.json';
                        }
                      }
                    }

                    if (!mediaType) {
                      mediaType = mime.getType(extension) ?? undefined;
                    }

                    urlInfoIndexed[key].url = decodedURL;
                    urlInfoIndexed[key].fileInfo = FileInfo.fromURL(
                      decodedURL,
                      mediaType,
                      key === 'audio' &&
                        this.routingService.staticQueryParams.audio_name
                        ? this.routingService.staticQueryParams.audio_name
                        : `${nameFromURL.name}${extension}`,
                    );
                  }
                }

                observables.push(
                  forkJoin<[{ progress: number; result?: string }]>([
                    urlInfo.transcript.url
                      ? this.http
                          .get(urlInfo.transcript.url, {
                            responseType: 'text',
                          })
                          .pipe(
                            map((result) => ({
                              progress: 1,
                              result,
                            })),
                          )
                      : of({ progress: 1, result: undefined }),
                  ]).pipe(
                    exhaustMap(([event]) => {
                      if (!urlInfo.audio.fileInfo) {
                        return throwError(
                          () => new Error('Audio URL is required for URL mode'),
                        );
                      }
                      const inputs: TaskInputOutputDto[] = [
                        {
                          id: Date.now().toString(),
                          filename: urlInfo.audio.fileInfo.fullname,
                          fileType: urlInfo.audio.fileInfo.type,
                          chain_position: 0,
                          type: 'input',
                          url: urlInfo.audio.url,
                          creator_type: TaskInputOutputCreatorType.user,
                          content: '',
                          content_type: '',
                        },
                      ];

                      if (urlInfo.transcript.url) {
                        inputs.push({
                          id: Date.now().toString(),
                          filename: urlInfo.transcript.fileInfo!.fullname,
                          fileType: urlInfo.transcript.fileInfo!.type,
                          chain_position: 0,
                          type: 'input',
                          url: urlInfo.transcript.url,
                          creator_type: TaskInputOutputCreatorType.user,
                          content: event.result ?? '',
                          content_type: '',
                        });
                      }

                      return of({
                        inputs,
                      });
                    }),
                  ),
                );
              }

              return forkJoin(observables).pipe(
                map(([event]) => {
                  const task = createSampleTask(
                    a.taskID ?? '-1',
                    event.inputs,
                    [],
                    projectConfig,
                    functions,
                    guidelines,
                    {
                      orgtext:
                        LoginMode.DEMO === state.application.mode!
                          ? state.application.appConfiguration!.tratt
                              .audioExamples[0].description
                          : '',
                    },
                  );

                  return LoginModeActions.loadProjectAndTaskInformation.success(
                    {
                      mode: a.mode,
                      me: createSampleUser(),
                      currentProject,
                      task,
                      startup: a.startup,
                    },
                  );
                }),
                catchError((e) => {
                  if (e instanceof HttpErrorResponse) {
                    alert(`Can't load transcript file: ${e.message}`);
                    return of(
                      LoginModeActions.loadProjectAndTaskInformation.fail(e),
                    );
                  }
                  console.error(
                    '[onLoadOnlineInfo$] forkJoin(observables) failed',
                    e,
                  );
                  return of(
                    LoginModeActions.loadProjectAndTaskInformation.fail(e),
                  );
                }),
              );
            }),
          );
        }

        // no mode set
        return of(
          LoginModeActions.loadProjectAndTaskInformation.success({
            startup: true,
          }),
        );
      }),
    ),
  );

  resumeTaskManually$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.resumeTaskManually.do),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        const modeState = getModeState(state);

        if (
          modeState?.currentSession?.currentProject &&
          modeState?.currentSession?.task
        ) {
          return of(
            AnnotationActions.prepareTaskDataForAnnotation.do({
              mode: state.application.mode!,
              currentProject: modeState.currentSession.currentProject,
              task: modeState.currentSession.task,
            }),
          );
        }

        return of();
      }),
    ),
  );

  redirectToTranscription$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.redirectToTranscription.do),
        tap((a) => {
          this.routingService.navigate(
            'redirect to transcription loadOnlineInformationAfterIDBLoaded',
            ['/intern/transcr'],
            AppInfo.queryParamsHandling,
          );
        }),
      ),
    { dispatch: false },
  );

  private addFunctions(assets: ToolConfigurationAssetDto[]) {
    const functionsObj = assets.find((a) => a.name === 'functions');

    const script = document.createElement('script');
    script.type = 'application/javascript';
    script.id = 'octra_functions';
    if (functionsObj) {
      script.innerHTML = functionsObj.content;
    } else {
      script.innerHTML = `
                  function validateAnnotation(annotation, guidelines) { return []; }
                  function tidyUpAnnotation(annotation, guidelines) { return annotation; }
                `;
    }

    document.head.querySelector('#octra_functions')?.remove();
    document.head.appendChild(script);
  }

  private readGuidelines(
    assets: ToolConfigurationAssetDto[],
  ): GuidelinesItem[] {
    return assets
      .filter((a) => a.name === 'guidelines')
      .map((a) => {
        try {
          return {
            filename: a.filename!,
            name: a.name,
            json:
              typeof a.content === 'string' ? JSON.parse(a.content) : a.content,
            type: a.mime_type,
          };
        } catch (e) {
          return {
            filename: a.filename!,
            name: a.name,
            json: undefined,
            type: a.mime_type,
          };
        }
      });
  }

  private loadSegments(modeState: AnnotationState, rootState: RootState) {
    try {
      let feedback: FeedBackForm | undefined = undefined;
      const levelName = pickInitialLevelName({
        asrLanguage: rootState.asr.settings?.selectedASRLanguage,
        uiLanguage: this.transloco.getActiveLang(),
      });
      if (
        modeState.transcript.levels === undefined ||
        modeState.transcript.levels.length === 0
      ) {
        // create new annotation
        let newAnnotation = new TrattAnnotation();

        if (
          rootState.application.mode === LoginMode.ONLINE ||
          rootState.application.mode === LoginMode.URL
        ) {
          let annotResult: ImportResult | undefined;
          const task: TaskDto | undefined = modeState.currentSession?.task;

          // import logs
          this.store.dispatch(
            AnnotationActions.saveLogs.do({
              logs:
                modeState.logging.logs && modeState.logging.logs.length > 0
                  ? modeState.logging.logs
                  : (task?.log ?? []),
              mode: rootState.application.mode,
            }),
          );

          const importResult = task
            ? findCompatibleFileFromIO<
                | {
                    annotjson: OAnnotJSON;
                    converter?: string;
                  }
                | undefined
              >(task, 'transcript', (io: TaskInputOutputDto) => {
                return isValidAnnotation(
                  io,
                  this.audio.audioManager.resource.getOAudioFile(),
                );
              })
            : undefined;

          if (importResult?.annotjson) {
            // import server transcript
            this.store.dispatch(
              LoginModeActions.setImportConverter.do({
                mode: rootState.application.mode!,
                importConverter: importResult?.converter ?? '',
              }),
            );
            newAnnotation = TrattAnnotation.deserialize(
              importResult?.annotjson,
            );
          }

          if (newAnnotation.levels.length === 0) {
            const level = newAnnotation.createSegmentLevel(levelName);
            level.items.push(
              newAnnotation.createSegment(
                this.audio.audioManager.resource.info.duration,
                [
                  new OLabel(levelName, ''), // empty transcript
                ],
              ),
            );
            newAnnotation.addLevel(level);
            newAnnotation.changeLevelIndex(0);
          } else {
            renamePlaceholderLevels(newAnnotation, levelName);
            const currentLevelIndex =
              modeState.previousCurrentLevel === undefined ||
              modeState.previousCurrentLevel === null ||
              modeState.previousCurrentLevel >= newAnnotation.levels.length
                ? Math.max(
                    0,
                    newAnnotation.levels.findIndex((a) => a.type === 'SEGMENT'),
                  )
                : modeState.previousCurrentLevel;

            newAnnotation.changeCurrentLevelIndex(currentLevelIndex);
          }
        } else {
          // not URL oder ONLINE MODE, Annotation is null

          const level = newAnnotation.createSegmentLevel(levelName);
          level.items.push(
            newAnnotation.createSegment(
              this.audio.audioManager.resource.info.duration,
              [
                new OLabel(levelName, ''), // empty transcript
              ],
            ),
          );
          newAnnotation.addLevel(level);
          newAnnotation.changeLevelIndex(0);

          const projectSettings =
            getModeState(rootState)!.currentSession.task!.tool_configuration!
              .value;
          if (projectSettings?.feedback_form) {
            feedback = FeedBackForm.fromAny(
              projectSettings.feedback_form,
              modeState.currentSession.comment ?? '',
            );
          }
          if (feedback) {
            feedback?.importData(feedback);

            if (modeState.currentSession.comment !== undefined) {
              feedback.comment = modeState.currentSession.comment;
            }
          }

          if (this.appStorage.logs === undefined) {
            this.appStorage.clearLoggingDataPermanently();
            this.uiService.elements = [];
          } else if (Array.isArray(this.appStorage.logs)) {
            this.uiService.fromAnyArray(this.appStorage.logs);
          }

          this.uiService.addElementFromEvent(
            'tratt',
            { value: AppInfo.BUILD.version },
            Date.now(),
            undefined,
            undefined,
            undefined,
            undefined,
            'version',
          );
        }

        if (
          rootState.application.options.showFeedbackNotice &&
          this.apiService.appProperties?.send_feedback
        ) {
          this.modalsService.openFeedbackNoticeModal();
        }

        // new annotation set
        return of(
          AnnotationActions.initTranscriptionService.success({
            mode: rootState.application.mode!,
            transcript: newAnnotation,
            feedback,
            saveToDB: true,
          }),
        );
      }

      const transcript = modeState.transcript.changeSampleRate(
        this.audio.audioManager.resource.info.sampleRate,
      );

      const currentLevelIndex =
        modeState.previousCurrentLevel === undefined ||
        modeState.previousCurrentLevel === null ||
        modeState.previousCurrentLevel >= transcript.levels.length
          ? Math.max(
              0,
              transcript.levels.findIndex((a) => a.type === 'SEGMENT'),
            )
          : modeState.previousCurrentLevel;
      transcript.changeCurrentLevelIndex(currentLevelIndex);

      if (
        rootState.application.options.showFeedbackNotice &&
        this.apiService.appProperties?.send_feedback
      ) {
        this.modalsService.openFeedbackNoticeModal();
      }

      return of(
        AnnotationActions.initTranscriptionService.success({
          mode: rootState.application.mode!,
          feedback,
          transcript,
          saveToDB: false,
        }),
      );
    } catch (e: any) {
      return of(
        AnnotationActions.initTranscriptionService.fail({
          error: typeof e === 'string' ? e : e?.message,
        }),
      );
    }
  }

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private apiService: OctraAPIService,
    private http: HttpClient,
    private alertService: AlertService,
    private routingService: RoutingService,
    private modalsService: TrattModalService,
    private audio: AudioService,
    private uiService: UserInteractionsService,
    private appStorage: AppStorageService,
    private transloco: TranslocoService,
    private maintenance: AnnotationMaintenanceEffects,
  ) {}
}

function renamePlaceholderLevels(
  annotation: {
    levels?: { name: string; items?: { labels?: { name: string }[] }[] }[];
  },
  newName: string,
): void {
  const placeholder = 'OCTRA_1';
  for (const level of annotation.levels ?? []) {
    if (level.name === placeholder) {
      level.name = newName;
    }
    for (const item of level.items ?? []) {
      for (const label of item.labels ?? []) {
        if (label.name === placeholder) {
          label.name = newName;
        }
      }
    }
  }
}

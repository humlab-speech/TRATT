import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { AudioCutter, FileInfo, readFileContents } from '@tratt/web-media';
import {
  catchError,
  exhaustMap,
  from,
  mergeMap,
  Observable,
  of,
  take,
  throwError,
  withLatestFrom,
} from 'rxjs';
import X2JS from 'x2js';
import { ASRSettings, ServiceProvider } from '../../obj';
import { AudioService } from '../../shared/service';
import { RootState } from '../index';
import { ASRActions } from './asr.actions';
import { ASRProcessStatus, ASRStateQueueItem } from './index';

@Injectable({
  providedIn: 'root',
})
export class AsrProcessingEffects {
  cutAndUploadItem$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.cutAndUploadQueueItem.do),
      withLatestFrom(this.store),
      mergeMap(([action, state]) => {
        const audioManager = this.audio.audiomanagers[0];

        if (!audioManager.resource.arraybuffer) {
          return throwError(() => new Error(`arraybuffer is undefined`));
        }

        // 1) cut signal
        const cutter = new AudioCutter(audioManager.resource.info);

        const channelDataFactor =
          (audioManager.resource.info.audioBufferInfo?.sampleRate ??
            audioManager.resource.info.sampleRate) /
          audioManager.resource.info.sampleRate;

        return from(
          cutter.cutAudioFileFromChannelData(
            this.audio.audioManager.resource.info,
            `OCTRA_ASRqueueItem_${action.item.id}.wav`,
            audioManager.channel!,
            {
              number: 1,
              sampleStart: Math.ceil(
                action.item.time.sampleStart * channelDataFactor,
              ),
              sampleDur: Math.ceil(
                action.item.time.sampleLength * channelDataFactor,
              ),
            },
          ),
        ).pipe(
          withLatestFrom(this.store),
          exhaustMap(([file, state]) => {
            const queue = state.asr.queue;
            const item = queue!.items.find((a) => a.id === action.item.id);

            if (!item) {
              return of(
                ASRActions.cutAndUploadQueueItem.fail({
                  error: 'item is undefined',
                  newStatus: ASRProcessStatus.FAILED,
                }),
              );
            }

            // 2. upload
            if (item.status !== ASRProcessStatus.STOPPED) {
              const fileBlob = new File([file.uint8Array], file.fileName, {
                type: 'audio/wav',
              });
              const serviceRequirementsError = this.fitsServiceRequirements(
                fileBlob,
                action.item,
              );

              if (serviceRequirementsError === '') {
                const filesForUpload: File[] = [fileBlob];

                if (action.item.transcriptInput) {
                  filesForUpload.push(
                    new File(
                      [action.item.transcriptInput],
                      `OCTRA_ASRqueueItem_${action.item.id}.txt`,
                      { type: 'text/plain' },
                    ),
                  );
                }

                return this.uploadFiles(
                  filesForUpload,
                  action.item.selectedASRService,
                ).pipe(
                  exhaustMap(([audioURL, transcriptURL]) => {
                    return of(
                      ASRActions.cutAndUploadQueueItem.success({
                        item: {
                          ...action.item,
                          progress: 25,
                        },
                        options: action.options,
                        transcriptURL,
                        audioURL,
                        outFormat: 'txt',
                      }),
                    );
                  }),
                );
              } else {
                return of(
                  ASRActions.cutAndUploadQueueItem.fail({
                    error: serviceRequirementsError,
                    item: action.item,
                    newStatus: ASRProcessStatus.FAILED,
                  }),
                );
              }
            }

            // stopped, don't continue
            return of(
              ASRActions.stopItemProcessing.success({
                item,
              }),
            );
          }),
          catchError((error) =>
            of(
              ASRActions.cutAndUploadQueueItem.fail({
                item: action.item,
                error,
                newStatus: ASRProcessStatus.FAILED,
              }),
            ),
          ),
        );
      }),
    ),
  );

  cutItemSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.cutAndUploadQueueItem.success),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        if (action.options?.asr) {
          return of(
            ASRActions.runASROnItem.do({
              item: action.item,
              options: action.options,
              outFormat: action.outFormat,
              audioURL: action.audioURL,
            }),
          );
        } else if (action.options?.wordAlignment) {
          return of(
            ASRActions.runWordAlignmentOnItem.do({
              item: action.item,
              outFormat: action.outFormat,
              audioURL: action.audioURL,
              transcriptURL: action.transcriptURL!,
            }),
          );
        }

        return of(
          ASRActions.cutAndUploadQueueItem.fail({
            item: action.item,
            error: `missing options`,
            newStatus: ASRProcessStatus.FAILED,
          }),
        );
      }),
    ),
  );

  runASROnItem$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.runASROnItem.do),
      withLatestFrom(this.store),
      mergeMap(([{ outFormat, item, options, audioURL }, state]) => {
        return this.transcribeSignalWithASR(
          outFormat,
          item,
          audioURL,
          state.application.appConfiguration!.tratt.plugins!.asr!,
        ).pipe(
          withLatestFrom(this.store),
          exhaustMap(([result, state2]) => {
            const item2 = state2.asr.queue?.items?.find(
              (a) => a.time === item.time,
            );

            if (item2) {
              if (item2.status !== ASRProcessStatus.STOPPED) {
                return of(
                  ASRActions.runASROnItem.success({
                    item,
                    audioURL,
                    options,
                    result: {
                      url: result.url,
                      text: result.text,
                    },
                  }),
                );
              }
            }

            return of(
              ASRActions.stopItemProcessing.success({
                item: item2 ?? item,
              }),
            );
          }),
          catchError((error) => {
            return this.handleShibbolethError(
              item,
              error,
              ASRActions.runASROnItem.fail({
                item,
                error:
                  error instanceof Error
                    ? error.message
                    : error instanceof HttpErrorResponse
                      ? (error.error?.message ?? error.message)
                      : error,
                newStatus: ASRProcessStatus.FAILED,
              }),
            );
          }),
        );
      }),
    ),
  );

  runASROnItemSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.runASROnItem.success),
      withLatestFrom(this.store),
      exhaustMap(([{ item, audioURL, options, result }, state]) => {
        if (!result) {
          return of(
            ASRActions.processQueueItem.fail({
              item,
              error: `asr result is undefined`,
              newStatus: ASRProcessStatus.FAILED,
            }),
          );
        }

        if (!options?.wordAlignment) {
          // finish
          return of(
            ASRActions.processQueueItem.success({
              item,
              result: result.text,
            }),
          );
        } else {
          // continue with word alignment
          return of(
            ASRActions.runWordAlignmentOnItem.do({
              item,
              audioURL: audioURL,
              transcriptURL: result.url,
              outFormat: 'text',
            }),
          );
        }
      }),
    ),
  );

  runWordAlignment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.runWordAlignmentOnItem.do),
      withLatestFrom(this.store),
      mergeMap(([{ item, audioURL, transcriptURL }, state]) => {
        return this.callMAUS(
          item.selectedASRLanguage,
          item.selectedMausLanguage,
          item.selectedASRService.host,
          audioURL,
          transcriptURL,
          state.application.appConfiguration!.tratt!.plugins!.asr!,
        ).pipe(
          exhaustMap((result) => {
            if (item.status !== ASRProcessStatus.STOPPED) {
              return from(
                readFileContents<string>(result.file, 'text', 'utf-8'),
              ).pipe(
                withLatestFrom(this.store),
                exhaustMap(([contents, state2]) => {
                  const item2 = state2.asr.queue?.items?.find(
                    (a) => a.time === item.time,
                  );

                  if (item2) {
                    if (item2.status !== ASRProcessStatus.STOPPED) {
                      return of(
                        ASRActions.runWordAlignmentOnItem.success({
                          item,
                          result: contents,
                          transcriptURL: result.url,
                        }),
                      );
                    }
                  }

                  return of(
                    ASRActions.stopItemProcessing.success({
                      item: item2 ?? item,
                    }),
                  );
                }),
              );
            }
            // do nothing
            return of(
              ASRActions.stopItemProcessing.success({
                item,
              }),
            );
          }),
          catchError((error) =>
            this.handleShibbolethError(
              item,
              error,
              ASRActions.runWordAlignmentOnItem.fail({
                item,
                error:
                  error instanceof Error
                    ? error.message
                    : error instanceof HttpErrorResponse
                      ? (error.error?.message ?? error.message)
                      : error,
                newStatus: ASRProcessStatus.FAILED,
              }),
            ),
          ),
        );
      }),
    ),
  );

  runWordAlignmentSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.runWordAlignmentOnItem.success),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        return of(
          ASRActions.processQueueItem.success({
            item: action.item,
            result: action.result,
          }),
        );
      }),
    ),
  );

  constructor(
    private store: Store<RootState>,
    private actions$: Actions,
    private audio: AudioService,
    private http: HttpClient,
  ) {}

  private fitsServiceRequirements(file: File, item: ASRStateQueueItem): string {
    if (item.selectedASRService) {
      if (item.selectedASRService.maxSignalDuration && item.sampleRate) {
        if (
          item.time.sampleLength / item.sampleRate >
          item.selectedASRService.maxSignalDuration
        ) {
          return '[Error] max duration exceeded';
        }
      }
      if (item.selectedASRService.maxSignalSize !== undefined) {
        if (file.size / 1000 / 1000 > item.selectedASRService.maxSignalSize) {
          return '[Error] max signal size exceeded';
        }
      }
    }

    return '';
  }

  public transcribeSignalWithASR(
    outFormat: string,
    item: ASRStateQueueItem,
    audioURL: string,
    asrSettings: ASRSettings,
  ): Observable<{
    file: File;
    text: string;
    url: string;
  }> {
    return this.callASR(
      item.selectedASRLanguage,
      item.selectedASRService,
      audioURL,
      outFormat,
      asrSettings,
      item.accessCode,
    );
  }

  private callASR(
    language: string,
    service: ServiceProvider,
    audioURL: string,
    outFormat: string,
    asrSettings: ASRSettings,
    accessCode?: string,
  ): Observable<{
    file: File;
    text: string;
    url: string;
  }> {
    let asrUrl = asrSettings.calls[0]
      .replace('{{host}}', service.host)
      .replace('{{audioURL}}', audioURL)
      .replace('{{asrType}}', `call${service.provider}${service.type}`)
      .replace('{{language}}', language)
      .replace('{{outFormat}}', outFormat);

    if (accessCode && accessCode !== '') {
      asrUrl += `&ACCESSCODE=${accessCode}`;
    }

    return this.http
      .post(
        asrUrl,
        {},
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            'ngsw-bypass': 'true',
          },
          responseType: 'text',
        },
      )
      .pipe(
        take(1),
        exhaustMap((result) => {
          return from(this.extractResultData(result));
        }),
      );
  }

  private extractResultData = (
    result: string,
  ): Promise<{ file: File; text: string; url: string }> => {
    return new Promise<{ file: File; text: string; url: string }>(
      (resolve, reject) => {
        const x2js = new X2JS();
        let json: any = x2js.xml2js(result);
        json = json.WebServiceResponseLink;

        if (json.success === 'true') {
          const file = FileInfo.fromURL(json.downloadLink, 'text/plain');
          file
            .updateContentFromURL(this.http)
            .then((text: any) => {
              resolve({
                file: file.file!,
                text,
                url: json.downloadLink,
              });
            })
            .catch((error: any) => {
              reject(error);
            });
        } else {
          reject(new Error(this.extractErrorMessage(json.output)));
        }
      },
    );
  };

  private uploadFiles(
    files: File[],
    selectedLanguage: ServiceProvider,
  ): Observable<string[]> {
    const formData = new FormData();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      formData.append(`file${i}`, file);
    }

    return this.http
      .post(`${selectedLanguage.host}uploadFileMulti`, formData, {
        responseType: 'text',
        headers: {
          'ngsw-bypass': 'true',
        },
      })
      .pipe(
        take(1),
        exhaustMap((result) => {
          const x2js = new X2JS();
          let json: any = x2js.xml2js(result);
          json = json.UploadFileMultiResponse;

          if (json.success === 'true') {
            if (json.fileList?.entry) {
              if (!Array.isArray(json.fileList.entry)) {
                return of([json.fileList.entry.value]);
              } else {
                return of(json.fileList.entry.map((a: any) => a.value));
              }
            }
            return throwError(() => new Error('fileList ist undefined'));
          }

          return throwError(() => new Error('server response with error'));
        }),
      );
  }

  private callMAUS(
    asrLanguage: string,
    mausLanguage: string | undefined,
    host: string,
    audioURL: string,
    transcriptURL: string,
    asrSettings: ASRSettings,
  ): Observable<{
    file: File;
    url: string;
  }> {
    const mausURL = asrSettings.calls[1]
      .replace('{{host}}', host)
      .replace('{{audioURL}}', audioURL)
      .replace('{{transcriptURL}}', transcriptURL)
      .replace('{{language}}', mausLanguage ?? asrLanguage);

    return this.http
      .post(
        mausURL,
        {},
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            'ngsw-bypass': 'true',
          },
          responseType: 'text',
        },
      )
      .pipe(
        exhaustMap((result) => {
          return from(this.extractResultData(result));
        }),
      );
  }

  handleShibbolethError(
    item: ASRStateQueueItem,
    error: HttpErrorResponse,
    errorAction: Action,
  ): Observable<Action> {
    const errorMessage =
      error instanceof Error
        ? error.message
        : error instanceof HttpErrorResponse
          ? (error.error?.message ?? error.message)
          : error;
    console.error(errorMessage);

    if (errorMessage.indexOf('quota') > -1) {
      return of({
        ...errorAction,
        newStatus: ASRProcessStatus.NOQUOTA,
      });
    } else if (errorMessage.indexOf('0 Unknown Error') > -1) {
      return of({
        ...errorAction,
        newStatus: ASRProcessStatus.NOAUTH,
      });
    }
    return of(errorAction);
  }

  extractErrorMessage(error: string) {
    const lines = error.split('<br/>');
    const found = lines.find((a) => /^StdErr: /g.exec(a) !== null);
    let result = found?.replace(/StdErr: /g, '');
    result = result?.replace(/ - exiting/g, '') ?? error;
    return result;
  }
}

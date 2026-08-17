import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { AccountLoginMethod } from '@octra/api-types';
import { exhaustMap, mergeMap, of, tap, withLatestFrom } from 'rxjs';
import { ProjectSettings } from '../../obj';
import { AlertService, UserInteractionsService } from '../../shared/service';
import { AuthenticationActions } from '../authentication';
import { LoginMode, RootState } from '../index';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';
import { ASRActions } from './asr.actions';
import {
  ASRProcessStatus,
  ASRQueueItemType,
  ASRStateQueue,
  ASRStateQueueItem,
} from './index';

@Injectable({
  providedIn: 'root',
})
export class AsrQueueEffects {
  private readonly MAX_PARALLEL_ITEMS = 3;

  addToQueue$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.addToQueue.do),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        if (!state.asr.queue) {
          return of(
            ASRActions.addToQueue.fail({
              error: 'missing queue',
            }),
          );
        }

        const asrSettings =
          state.application.appConfiguration?.tratt.plugins?.asr;

        if (!asrSettings) {
          return of(
            ASRActions.addToQueue.fail({
              error: `missing asr settings`,
            }),
          );
        }

        if (
          !state.asr.settings?.selectedServiceProvider ||
          !state.asr.settings?.selectedASRLanguage
        ) {
          return of(
            ASRActions.addToQueue.fail({
              error: `missing asr info or language`,
            }),
          );
        }

        return of(
          ASRActions.addToQueue.success({
            item: {
              id: state.asr.queue.idCounter + 1,
              selectedASRService: state.asr.settings.selectedServiceProvider!,
              selectedASRLanguage: state.asr.settings.selectedASRLanguage!,
              selectedMausLanguage: state.asr.settings?.selectedMausLanguage,
              accessCode: state.asr.settings?.accessCode,
              status: ASRProcessStatus.IDLE,
              progress: 0,
              time: action.item.timeInterval,
              transcriptInput: action.item.transcript,
              type: action.item.type,
            },
          }),
        );
      }),
    ),
  );

  removeItemFromQueue$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.removeItemFromQueue.do),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        if (!state.asr.queue) {
          return of(
            ASRActions.removeItemFromQueue.fail({
              error: 'missing queue',
            }),
          );
        }

        const index = state.asr.queue.items.findIndex(
          (a) => a.id === action.id,
        );

        if (index > -1) {
          return of(
            ASRActions.removeItemFromQueue.success({
              index,
            }),
          );
        } else {
          return of(
            ASRActions.removeItemFromQueue.fail({
              error: `queueItem with id ${action.id} does not exist and can't be removed.`,
            }),
          );
        }
      }),
    ),
  );

  startProcessing$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        ASRActions.startProcessing.do,
        ASRActions.processQueueItem.do,
        ASRActions.processQueueItem.success,
        ASRActions.processQueueItem.fail,
        ASRActions.stopItemProcessing.success,
      ),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        const queue = state.asr.queue;
        if (!queue) {
          return of(
            ASRActions.startProcessing.fail({
              error: 'missing queue',
            }),
          );
        }

        if (queue.status === ASRProcessStatus.STARTED) {
          if (queue.statistics.running < this.MAX_PARALLEL_ITEMS) {
            const item = this.getFirstFreeItem(queue);

            if (item) {
              return of(
                ASRActions.processQueueItem.do({
                  item,
                }),
              );
            } else if (
              ![
                ASRActions.processQueueItem.do.type,
                ASRActions.startProcessing.do.type,
              ].includes(action.type as any)
            ) {
              if (queue.statistics.running === 0) {
                // no free item after continuation and nothing running
                return of(
                  ASRActions.setQueueStatus.do({
                    status: ASRProcessStatus.IDLE,
                  }),
                );
              }
            }
          }

          // max parallel reached
          return of(
            ASRActions.setQueueStatus.do({
              status: ASRProcessStatus.STARTED,
            }),
          );
        }
        return of();
      }),
    ),
  );

  processQueueItem$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.processQueueItem.do),
      withLatestFrom(this.store),
      exhaustMap(([{ item }, state]) => {
        if (item.status !== ASRProcessStatus.STARTED) {
          // 1. cut audio
          return of(
            ASRActions.cutAndUploadQueueItem.do({
              item,
              options: {
                asr:
                  item.type === ASRQueueItemType.ASR ||
                  item.type === ASRQueueItemType.ASRMAUS,
                wordAlignment:
                  item.type === ASRQueueItemType.ASRMAUS ||
                  item.type === ASRQueueItemType.MAUS,
              },
            }),
          );
        }
        return of(
          ASRActions.processQueueItem.fail({
            item,
            error: `item already started`,
            newStatus: ASRProcessStatus.FAILED,
          }),
        );
      }),
    ),
  );

  stopProcessing$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ASRActions.stopProcessing.do),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        if (state.asr.queue?.items) {
          for (const item of state.asr.queue.items) {
            this.store.dispatch(
              ASRActions.stopItemProcessing.do({
                time: item.time,
              }),
            );
          }
        }

        return of(ASRActions.stopProcessing.success());
      }),
    ),
  );

  stopItemProcessing$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ASRActions.stopItemProcessing.do),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          const item = state.asr.queue?.items?.find(
            (a) =>
              a.time.sampleLength === action.time.sampleLength &&
              a.time.sampleStart === action.time.sampleStart,
          );

          if (item) {
            this.store.dispatch(
              AnnotationActions.updateASRSegmentInformation.do({
                mode: state.application.mode!,
                timeInterval: item.time,
                progress: item.progress,
                itemType: item.type,
                result:
                  item.status === ASRProcessStatus.FINISHED
                    ? item.result
                    : undefined,
                isBlockedBy:
                  item.status !== ASRProcessStatus.STOPPED &&
                  item.status !== ASRProcessStatus.FINISHED &&
                  item.status !== ASRProcessStatus.FAILED
                    ? item.type
                    : undefined,
              }),
            );
          }
        }),
      ),
    { dispatch: false },
  );

  triggerAnnotationChange$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        ASRActions.addToQueue.success,
        ASRActions.processQueueItem.do,
        ASRActions.cutAndUploadQueueItem.success,
        ASRActions.runASROnItem.success,
        ASRActions.runASROnItem.fail,
        ASRActions.runWordAlignmentOnItem.fail,
        ASRActions.processQueueItem.success,
        ASRActions.processQueueItem.fail,
        ASRActions.stopItemProcessing.success,
      ),
      withLatestFrom(this.store),
      mergeMap(([action, state]) => {
        const item =
          state.asr.queue!.items.find((a) => a.id === action.item.id) ??
          action.item;

        if (item) {
          if (
            [ASRProcessStatus.FINISHED, ASRProcessStatus.FAILED].includes(
              item.status,
            )
          ) {
            this.store.dispatch(
              ASRActions.removeItemFromQueue.do({
                id: item.id,
              }),
            );
          }

          return of(
            AnnotationActions.updateASRSegmentInformation.do({
              mode: state.application.mode!,
              timeInterval: item.time,
              progress: item.progress,
              itemType: item.type,
              result:
                item.status === ASRProcessStatus.FINISHED
                  ? item.result
                  : undefined,
              isBlockedBy:
                item.status !== ASRProcessStatus.STOPPED &&
                item.status !== ASRProcessStatus.FINISHED &&
                item.status !== ASRProcessStatus.FAILED
                  ? item.type
                  : undefined,
            }),
          );
        } else {
          console.error(`can't find item in queue with id ${action.item.id}`);
          return of(
            AnnotationActions.updateASRSegmentInformation.fail({
              error: "can't find item in queue",
            }),
          );
        }
      }),
    ),
  );

  onProcessingFail$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          ASRActions.runASROnItem.fail,
          ASRActions.runWordAlignmentOnItem.fail,
        ),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          if (
            action.newStatus === ASRProcessStatus.NOAUTH &&
            state.asr.queue!.status !== ASRProcessStatus.NOQUOTA
          ) {
            if (
              state.application.mode === LoginMode.ONLINE &&
              state.authentication.type === AccountLoginMethod.shibboleth
            ) {
              this.store.dispatch(
                AuthenticationActions.needReAuthentication.do({
                  forceAuthentication: AccountLoginMethod.shibboleth,
                  actionAfterSuccess: ASRActions.startProcessing.do(),
                  forceLogout: false,
                }),
              );
              this.alertService.showAlert(
                'danger',
                this.langService.translate('asr.no auth'),
                true,
              );
            } else {
              this.store.dispatch(
                AuthenticationActions.needReAuthentication.do({
                  forceAuthentication: AccountLoginMethod.shibboleth,
                  actionAfterSuccess: ASRActions.startProcessing.do(),
                  forceLogout: false,
                }),
              );
            }
            this.uiService.addElementFromEvent(
              action.item.type.toLowerCase(),
              {
                value: 'no_auth',
              },
              Date.now(),
              undefined,
              undefined,
              undefined,
              {
                start: action.item.time.sampleStart,
                length: action.item.time.sampleLength,
              },
              'automation',
            );
          } else if (
            action.newStatus === ASRProcessStatus.NOQUOTA &&
            state.asr.queue!.status !== ASRProcessStatus.NOQUOTA
          ) {
            this.alertService.showAlert(
              'danger',
              this.langService.translate('asr.no quota'),
              true,
            );

            this.uiService.addElementFromEvent(
              action.item.type.toLowerCase(),
              {
                value: 'failed',
              },
              Date.now(),
              undefined,
              undefined,
              undefined,
              {
                start: action.item.time.sampleStart,
                length: action.item.time.sampleLength,
              },
              'automation',
            );
          }
        }),
      ),
    {
      dispatch: false,
    },
  );

  reAuthenticationAborted$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthenticationActions.needReAuthentication.abort),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          if (state.asr.queue) {
            for (const item of state.asr.queue.items) {
              if (
                item.status === ASRProcessStatus.FAILED ||
                item.status === ASRProcessStatus.NOAUTH ||
                item.status === ASRProcessStatus.NOQUOTA
              ) {
                this.store.dispatch(
                  ASRActions.processQueueItem.fail({
                    item,
                    error: '',
                    newStatus: ASRProcessStatus.FAILED,
                  }),
                );
              }
            }
          }
        }),
      ),
    { dispatch: false },
  );

  enableASR$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.prepareTaskDataForAnnotation.do),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        const settings = state.application.appConfiguration;
        const isShibbolethUser =
          state.application.mode === LoginMode.ONLINE &&
          state.authentication.type === AccountLoginMethod.shibboleth;
        const localASRSettingsComplete =
          settings?.tratt.plugins?.asr?.shibbolethURL !== undefined &&
          settings.tratt.plugins?.asr?.shibbolethURL !== '';
        const asrSettingsComplete =
          settings?.tratt.plugins?.asr?.enabled === true &&
          settings.tratt.plugins.asr.calls.length === 2 &&
          settings.tratt.plugins.asr.calls[0] !== '' &&
          settings.tratt.plugins.asr.calls[1] !== '';

        return of(
          ASRActions.enableASR.do({
            isEnabled:
              asrSettingsComplete &&
              (((action.task.tool_configuration?.value as ProjectSettings)
                ?.tratt?.asrEnabled === true &&
                isShibbolethUser) ||
                ((action.task.tool_configuration?.value as ProjectSettings)
                  ?.tratt?.asrEnabled === true &&
                  localASRSettingsComplete)),
          }),
        );
      }),
    ),
  );

  constructor(
    private store: Store<RootState>,
    private actions$: Actions,
    private langService: TranslocoService,
    private alertService: AlertService,
    private uiService: UserInteractionsService,
  ) {}

  private getFirstFreeItem(
    queue: ASRStateQueue,
  ): ASRStateQueueItem | undefined {
    return queue.items.find((a) => {
      return a.status === ASRProcessStatus.IDLE;
    });
  }
}

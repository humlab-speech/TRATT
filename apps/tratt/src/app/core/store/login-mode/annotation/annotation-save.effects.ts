import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TaskStatus } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { catchError, exhaustMap, map, of, Subscription, tap, timer, withLatestFrom } from 'rxjs';
import { NgbModalWrapper } from '../../../modals/ng-modal-wrapper';
import { TranscriptionSendingModalComponent } from '../../../modals/transcription-sending-modal/transcription-sending-modal.component';
import { TrattModalService } from '../../../modals/tratt-modal.service';
import { AlertService } from '../../../shared/service';
import { ApplicationActions } from '../../application/application.actions';
import { AuthenticationActions } from '../../authentication';
import { checkAndThrowError } from '../../error.handlers';
import { LoginMode, RootState } from '../../index';
import { LoginModeActions } from '../login-mode.actions';
import { AnnotationActions } from './annotation.actions';
import { AnnotationPersistenceService } from './annotation-persistence.service';

@Injectable()
export class AnnotationSaveEffects {
  transcrSendingModal: {
    ref?: NgbModalWrapper<TranscriptionSendingModalComponent>;
    timeout?: Subscription;
    error?: string;
  } = {};

  onQuit$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.quit.do),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        if (state.application.mode === LoginMode.ONLINE) {
          if (
            a.freeTask &&
            state.onlineMode.currentSession.currentProject &&
            state.onlineMode.currentSession.task
          ) {
            this.store.dispatch(ApplicationActions.waitForEffects.do());
            return this.apiService
              .freeTask(
                state.onlineMode.currentSession.currentProject.id,
                state.onlineMode.currentSession.task.id,
              )
              .pipe(
                map((result) => {
                  if (a.redirectToProjects) {
                    return AnnotationActions.redirectToProjects.do();
                  } else {
                    return AuthenticationActions.logout.do({
                      clearSession: a.clearSession,
                      mode: state.application.mode!,
                    });
                  }
                }),
                catchError((error) =>
                  checkAndThrowError(
                    {
                      statusCode: error.status,
                      message: error.error?.message ?? error.message,
                    },
                    a,
                    AuthenticationActions.logout.do({
                      clearSession: a.clearSession,
                      mode: state.application.mode!,
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
          } else {
            if (a.redirectToProjects) {
              this.store.dispatch(ApplicationActions.waitForEffects.do());
              return of(AnnotationActions.redirectToProjects.do());
            } else {
              this.store.dispatch(ApplicationActions.waitForEffects.do());
              return this.persistence
                .saveTaskToServer(state, TaskStatus.paused)
                .pipe(
                map(() => {
                  return AuthenticationActions.logout.do({
                    clearSession: a.clearSession,
                    mode: state.application.mode,
                  });
                }),
                catchError(() => {
                  return of(
                    AuthenticationActions.logout.do({
                      clearSession: a.clearSession,
                      mode: state.application.mode,
                    }),
                  );
                }),
              );
            }
          }
        } else {
          this.store.dispatch(ApplicationActions.waitForEffects.do());
          return of(
            AuthenticationActions.logout.do({
              clearSession: a.clearSession,
              mode: state.application.mode!,
            }),
          );
        }
      }),
    ),
  );

  onAnnotationSend$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.sendOnlineAnnotation.do),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        if (state.application.mode === LoginMode.ONLINE) {
          this.transcrSendingModal.timeout?.unsubscribe();
          this.transcrSendingModal.timeout = timer(2000).subscribe({
            next: () => {
              this.transcrSendingModal.ref = this.modalsService.openModalRef(
                TranscriptionSendingModalComponent,
                TranscriptionSendingModalComponent.options,
              );
              this.transcrSendingModal.ref.componentInstance.error =
                this.transcrSendingModal.error ?? '';
            },
          });

          if (
            !state.onlineMode.currentSession.currentProject ||
            !state.onlineMode.currentSession.task?.id
          ) {
            return of(
              AnnotationActions.sendOnlineAnnotation.fail({
                mode: state.application.mode!,
                error: 'Current project or current task is undefined',
              }),
            );
          }

          return this.persistence
            .saveTaskToServer(state, TaskStatus.finished)
            .pipe(
            map((a) => {
              return AnnotationActions.sendOnlineAnnotation.success({
                mode: state.application.mode!,
                task: a!,
              });
            }),
            catchError((error: HttpErrorResponse) => {
              if (error.status === 401) {
                this.transcrSendingModal.timeout?.unsubscribe();
              }

              return checkAndThrowError(
                {
                  statusCode: error.status,
                  message: error.error?.message ?? error.message,
                },
                a,
                AnnotationActions.sendOnlineAnnotation.fail({
                  mode: state.application.mode!,
                  error: error.error?.message ?? error.message,
                }),
                this.store,
                () => {
                  if (this.transcrSendingModal.ref) {
                    this.transcrSendingModal.ref.componentInstance.error =
                      error.error?.message ?? error.message;
                  }
                },
              );
            }),
          );
        }

        return of(
          AnnotationActions.sendOnlineAnnotation.fail({
            mode: state.application.mode!,
            error: 'Not implemented',
          }),
        );
      }),
    ),
  );

  sendAnnotationFail$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.sendOnlineAnnotation.fail),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          this.transcrSendingModal.timeout?.unsubscribe();
          this.transcrSendingModal.ref?.close();

          this.modalsService.openErrorModal(action.error);
        }),
      ),
    { dispatch: false },
  );

  afterAnnotationSent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.sendOnlineAnnotation.success),
      withLatestFrom(this.store),
      exhaustMap(([a, state]) => {
        this.transcrSendingModal.timeout?.unsubscribe();
        this.transcrSendingModal.ref?.close();

        this.alertService.showAlert(
          'success',
          this.transloco.translate('g.submission success'),
          true,
          2000,
        );

        this.store.dispatch(ApplicationActions.waitForEffects.do());

        return of(
          LoginModeActions.clearOnlineSession.do({
            mode: a.mode,
            actionAfterSuccess: AnnotationActions.startNewAnnotation.do({
              mode: a.mode,
              project: state.onlineMode.currentSession.currentProject!,
              actionAfterFail: LoginModeActions.endTranscription.do({
                clearSession: true,
                mode: LoginMode.ONLINE,
              }),
            }),
          }),
        );
      }),
    ),
  );

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private apiService: OctraAPIService,
    private alertService: AlertService,
    private modalsService: TrattModalService,
    private transloco: TranslocoService,
    private persistence: AnnotationPersistenceService,
  ) {}
}

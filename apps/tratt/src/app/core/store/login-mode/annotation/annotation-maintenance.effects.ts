import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { hasProperty } from '@tratt/utilities';
import { exhaustMap, interval, of, Subscription, tap, withLatestFrom } from 'rxjs';
import { AppInfo } from '../../../../app.info';
import { MaintenanceAPI } from '../../../component/maintenance/maintenance-api';
import { ErrorModalComponent } from '../../../modals/error-modal/error-modal.component';
import { TrattModalService } from '../../../modals/tratt-modal.service';
import { AlertService, AudioService, UserInteractionsService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { RoutingService } from '../../../shared/service/routing.service';
import { AuthenticationActions } from '../../authentication';
import { getModeState, RootState } from '../../index';
import { LoginModeActions } from '../login-mode.actions';
import { AnnotationActions } from './annotation.actions';

import { DateTime } from 'luxon';

@Injectable()
export class AnnotationMaintenanceEffects {
  private maintenanceChecker?: Subscription;

  setLogging$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.setLogging.do),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          const modeState = getModeState(state)!;
          this.uiService.init(
            action.logging,
            modeState.logging.startTime,
            modeState.logging.startReference,
          );
        }),
      ),
    { dispatch: false },
  );

  onTranscriptionEnd$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LoginModeActions.endTranscription.do),
        tap((a) => {
          this.routingService.navigate(
            'end transcription',
            ['/intern/transcr/end'],
            AppInfo.queryParamsHandling,
          );
          this.audio.destroy(true);
        }),
      ),
    { dispatch: false },
  );

  showNoRemainingTasksModal$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.showNoRemainingTasksModal.do),
        tap((a) => {
          const ref = this.modalsService.openModalRef(
            ErrorModalComponent,
            ErrorModalComponent.options,
          );
          (ref.componentInstance as ErrorModalComponent).text =
            this.transloco.translate('projects-list.no remaining tasks');
        }),
      ),
    { dispatch: false },
  );

  afterLogoutSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthenticationActions.logout.success),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          this.audio.destroy(true);
        }),
      ),
    { dispatch: false },
  );

  afterClearOnlineSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LoginModeActions.clearOnlineSession.do),
      exhaustMap((a) => {
        this.audio.destroy(true);
        return of(a.actionAfterSuccess);
      }),
    ),
  );

  redirectToProjects$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.redirectToProjects.do),
      exhaustMap((a) => {
        console.warn('redirect to projects');
        this.routingService.navigate(
          'redirect to projects after quit',
          ['/intern/projects'],
          AppInfo.queryParamsHandling,
        );
        return of(AnnotationActions.redirectToProjects.success());
      }),
    ),
  );

  levelIndexChange$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.setLevelIndex.do),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          this.uiService.addElementFromEvent(
            'level',
            { value: 'changed' },
            Date.now(),
            this.audio.audioManager.createSampleUnit(0),
            undefined,
            undefined,
            undefined,
            getModeState(state)?.transcript?.levels[action.currentLevelIndex]
              ?.name,
          );
        }),
      ),
    { dispatch: false },
  );

  public initMaintenance(state: RootState) {
    if (
      state.application.appConfiguration !== undefined &&
      hasProperty(
        state.application.appConfiguration.tratt,
        'maintenanceNotification',
      ) &&
      state.application.appConfiguration.tratt.maintenanceNotification
        .active === 'active'
    ) {
      const maintenanceAPI = new MaintenanceAPI(
        state.application.appConfiguration.tratt.maintenanceNotification.apiURL,
        this.http,
      );

      maintenanceAPI
        .readMaintenanceNotifications(24)
        .then((notification) => {
          // only check in interval if there is a pending maintenance in the next 24 hours
          if (notification !== undefined) {
            const readNotification = () => {
              // notify after 15 minutes one hour before the maintenance begins
              maintenanceAPI
                .readMaintenanceNotifications(1)
                .then((notification2) => {
                  if (notification2 !== undefined) {
                    this.alertService.showAlert(
                      'warning',
                      '⚠️ ' +
                        this.transloco.translate('maintenance.in app', {
                          start: DateTime.fromISO(notification.begin)
                            .setLocale(this.appStorage.language)
                            .toLocaleString(DateTime.DATETIME_SHORT),
                          end: DateTime.fromISO(notification.end)
                            .setLocale(this.appStorage.language)
                            .toLocaleString(DateTime.DATETIME_SHORT),
                        }),
                      true,
                      60,
                    );
                  }
                })
                .catch(() => {
                  // ignore
                });
            };

            if (this.maintenanceChecker !== undefined) {
              this.maintenanceChecker.unsubscribe();
            }

            // run each 15 minutes
            this.maintenanceChecker = interval(15 * 60000).subscribe(
              readNotification,
            );
          }
        })
        .catch(() => {
          // ignore
        });
    }
  }

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private http: HttpClient,
    private alertService: AlertService,
    private routingService: RoutingService,
    private modalsService: TrattModalService,
    private audio: AudioService,
    private uiService: UserInteractionsService,
    private appStorage: AppStorageService,
    private transloco: TranslocoService,
  ) {}
}

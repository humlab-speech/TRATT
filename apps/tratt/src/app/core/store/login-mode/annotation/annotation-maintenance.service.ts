import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { hasProperty } from '@tratt/utilities';
import { interval, Subscription } from 'rxjs';
import { MaintenanceAPI } from '../../../component/maintenance/maintenance-api';
import { AlertService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { RootState } from '../../index';

import { DateTime } from 'luxon';

@Injectable({ providedIn: 'root' })
export class AnnotationMaintenanceService {
  private maintenanceChecker?: Subscription;

  constructor(
    private http: HttpClient,
    private alertService: AlertService,
    private transloco: TranslocoService,
    private appStorage: AppStorageService,
  ) {}

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
}

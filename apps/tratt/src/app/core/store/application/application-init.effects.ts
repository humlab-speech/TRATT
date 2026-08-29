import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { uniqueHTTPRequest } from '@tratt/ngx-utilities';
import { DateTime } from 'luxon';
import { catchError, exhaustMap, forkJoin, map, of } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AppInfo } from '../../../app.info';
import { AppConfigSchema } from '../../schemata/appconfig.schema';
import { isIgnoredAction } from '../../shared';
import { migrateLegacyConfigKey } from '../../shared/legacy-config';
import { AppStorageService } from '../../shared/service/appstorage.service';
import {
  BugReportService,
  ConsoleType,
} from '../../shared/service/bug-report.service';
import { ConfigurationService } from '../../shared/service/configuration.service';
import { RoutingService } from '../../shared/service/routing.service';
import { RootState } from '../index';
import { ApplicationActions } from './application.actions';
import { URLParameters } from './index';

@Injectable({
  providedIn: 'root',
})
export class ApplicationInitEffects {
  initApp$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.initApplication.do),
      exhaustMap(() => {
        AppInfo.BUILD = (window as any).BUILD ?? AppInfo.BUILD;
        AppInfo.BUILD.timestamp = DateTime.fromISO(
          AppInfo.BUILD.timestamp,
        ).toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS);
        this.appStorage.saveCurrentPageAsLastPage();

        const queryParams: URLParameters = {
          audio_url: this.getParameterByName<string>('audio_url'),
          audio_name: this.getParameterByName<string>('audio_name'),
          audio_type: this.getParameterByName<string>('audio_type'),
          auto_playback: this.getParameterByName<boolean>('auto_playback'),
          annotationExportType: this.getParameterByName<string>('aType'),
          host: this.getParameterByName<string>('host'),
          transcript: this.getParameterByName<string>('transcript'),
          readonly: this.getParameterByName<boolean>('readonly'),
          embedded: this.getParameterByName<boolean>('embedded'),
          bottomNav: this.getParameterByName<boolean>('bottomNav'),
        };

        if ((queryParams.embedded as any) === 1) {
          queryParams.embedded = true;
        } else if ((queryParams.embedded as any) === 0) {
          queryParams.embedded = false;
        }

        this.routerService.addStaticParams(queryParams as any);

        this.initConsoleLogging();
        return of(ApplicationActions.loadLanguage.do());
      }),
    ),
  );

  loadSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.loadSettings.do),
      exhaustMap((a) => {
        return forkJoin([
          uniqueHTTPRequest(
            this.http,
            false,
            {
              responseType: 'json',
            },
            `config/appconfig.json?v=${Date.now()}`,
            undefined,
          ),
        ]).pipe(
          map(([loadedConfig]) => {
            const appconfig = migrateLegacyConfigKey(loadedConfig);
            const validation = this.configurationService.validateJSON(
              appconfig,
              AppConfigSchema,
            );

            if (validation.length === 0) {
              // Point the in-app manual links at wherever this deployment
              // publishes the manual (defaults to the copy in the repository).
              AppInfo.applyManualSettings(appconfig?.tratt?.manual);
              return ApplicationActions.loadSettings.success({
                settings: appconfig,
              });
            } else {
              return ApplicationActions.loadSettings.fail({
                error: `<br/><ul>${validation
                  .map(
                    (v) =>
                      '<li><b>' +
                      v.instancePath +
                      '</b>:<br/>' +
                      v.message +
                      '</li>',
                  )
                  .join('<br/>')}</ul>`,
              });
            }
          }),
          catchError((err: HttpErrorResponse) => {
            return of(
              ApplicationActions.loadSettings.fail({
                error: err.error?.message ?? err.message,
              }),
            );
          }),
        );
      }),
    ),
  );

  constructor(
    private actions$: Actions,
    private http: HttpClient,
    private configurationService: ConfigurationService,
    private appStorage: AppStorageService,
    private routerService: RoutingService,
    private bugService: BugReportService,
    private store: Store<RootState>,
    private transloco: TranslocoService,
  ) {}

  private initConsoleLogging() {
    if (environment.debugging.logging.console) {
      const oldLog = console.log;
      const serv = this.bugService;
      (() => {
        // tslint:disable-next-line:only-arrow-functions
        console.log = function (...args) {
          if (args[0] && typeof args[0] === 'object' && args[0]?.type) {
            if (isIgnoredAction(args[0].type)) {
              return;
            }
          }
          serv.addEntry(ConsoleType.LOG, args[0]);

          oldLog.apply(console, args);
        };
      })();

      // overwrite console.err
      const oldError = console.error;
      (() => {
        // tslint:disable-next-line:only-arrow-functions
        console.error = function (...args) {
          const error = args[0];
          const context = args[1];

          let debug = '';
          let stack: string | undefined = '';

          if (typeof error === 'string') {
            debug = error;

            if (
              error === 'ERROR' &&
              context !== undefined &&
              context.stack &&
              context.message
            ) {
              debug = context.message;
              stack = context.stack;
            }
          } else {
            if (error instanceof Error) {
              debug = error.message;
              stack = error.stack;
            } else {
              if (typeof error === 'object') {
                // some other type of object
                debug = 'OBJECT';
                stack = JSON.stringify(error);
              } else {
                debug = error;
              }
            }
          }

          if (debug !== '') {
            serv.addEntry(
              ConsoleType.ERROR,
              `${debug}${stack !== '' ? ' ' + stack : ''}`,
            );
          }

          oldError.apply(console, args);
        };
      })();

      // overwrite console.warn
      const oldWarn = console.warn;
      (() => {
        // tslint:disable-next-line:only-arrow-functions
        console.warn = function (...args) {
          if (args[0] && typeof args[0] === 'object' && args[0]?.type) {
            if (isIgnoredAction(args[0].type)) {
              return;
            }
          }

          serv.addEntry(ConsoleType.WARN, args[0]);

          oldWarn.apply(console, args);
        };
      })();

      // overwrite console.collapsedGroup
      const oldGroupCollapsed = console.groupCollapsed;
      (() => {
        // tslint:disable-next-line:only-arrow-functions
        console.groupCollapsed = function (...args) {
          serv.beginGroup(args[0]);

          oldGroupCollapsed.apply(console, args);
        };
      })();

      // overwrite console.groupEnd
      const oldGroupEnd = console.groupEnd;
      (() => {
        // tslint:disable-next-line:only-arrow-functions
        console.groupEnd = function (...args) {
          serv.endGroup();

          oldGroupEnd.apply(console, args);
        };
      })();
    }
  }

  private getParameterByName<T>(name: string, url?: string): T | undefined {
    if (!url) {
      url = document.location.href;
    }
    name = name.replace(/[[]]/g, '\\$&');
    const regExp = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
    const results = regExp.exec(url);
    if (!results || !results[2]) {
      return undefined;
    }

    const result = decodeURIComponent(results[2].replace(/\+/g, ' '));

    if (result === 'undefined' || result === 'null') {
      return undefined;
    } else if (result === 'true' || result === 'false') {
      return (result === 'true') as any;
    } else if (/^[0-9]+$/g.exec(result)) {
      return Number(result) as any;
    }

    return result as any;
  }
}

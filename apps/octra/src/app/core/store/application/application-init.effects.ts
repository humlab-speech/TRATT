import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { uniqueHTTPRequest } from '@octra/ngx-utilities';
import { formatLanguageLabel, isNumber } from '@octra/utilities';
import { findElements, getAttr } from '@octra/web-media';
import { DateTime } from 'luxon';
import {
  catchError,
  EMPTY,
  exhaustMap,
  forkJoin,
  from,
  map,
  Observable,
  of,
  withLatestFrom,
} from 'rxjs';
import X2JS from 'x2js';
import { environment } from '../../../../environments/environment';
import { AppInfo } from '../../../app.info';
import { ASRSettings } from '../../obj';
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
import { ASRActions } from '../asr/asr.actions';
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

  loadASRSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.loadASRSettings.do),
      exhaustMap(({ settings }) => {
        // load information from BASWebservices ASR page

        if (
          settings.tratt.plugins?.asr?.asrInfoURL !== undefined &&
          typeof settings.tratt.plugins.asr.asrInfoURL === 'string' &&
          settings.tratt.plugins.asr.asrInfoURL
        ) {
          return this.http
            .get(settings.tratt.plugins.asr.asrInfoURL, {
              responseType: 'text',
            })
            .pipe(
              map((result) => {
                if (!settings.tratt.plugins?.asr?.services) {
                  throw new Error(
                    'Missing asr.services property in application settings.',
                  );
                }

                const doc = new DOMParser().parseFromString(
                  result,
                  'text/html',
                );
                const basTable = doc.getElementById('bas-asr-service-table');
                const basASRInfoContainers = findElements(
                  basTable!,
                  '.bas-asr-info-container',
                );

                const asrInfos: {
                  name: string;
                  maxSignalDuration: number;
                  maxSignalSize: number;
                  quotaPerMonth: number;
                  termsURL: string;
                  dataStoragePolicy: string;
                  knownIssues: string;
                }[] = [];

                for (const basASRInfoContainer of basASRInfoContainers) {
                  const isStringNumber = (str: string) => !isNaN(Number(str));
                  const sanitizeNumberValue = (el: any, attr: string) => {
                    if (el[attr] !== undefined && isStringNumber(el[attr])) {
                      el[attr] = Number(el[attr]);
                    } else {
                      el[attr] = undefined;
                    }
                  };
                  const sanitizeStringValue = (el: any, attr: string) => {
                    if (
                      el[attr] !== undefined &&
                      typeof el[attr] === 'string'
                    ) {
                      el[attr] = el[attr].replace(/[\n\t\r]+/g, '');
                    } else {
                      el[attr] = undefined;
                    }
                  };

                  const maxSignalDurationSpans = findElements(
                    basASRInfoContainer,
                    '.bas-asr-info-max-signal-duration-seconds',
                  );
                  const maxSignalSizeSpans = findElements(
                    basASRInfoContainer,
                    '.bas-asr-info-max-signal-size-megabytes',
                  );
                  const quotaPerMonthSpans = findElements(
                    basASRInfoContainer,
                    '.bas-asr-info-quota-per-month-seconds',
                  );
                  const termsURLSpans = findElements(
                    basASRInfoContainer,
                    '.bas-asr-info-eula-link',
                  );
                  const dataStoragePolicySpans = findElements(
                    basASRInfoContainer,
                    '.bas-asr-info-data-storage-policy',
                  );
                  const knownIssuesSpans = findElements(
                    basASRInfoContainer,
                    '.bas-asr-info-known-issues',
                  );

                  const newElem: any = {
                    name: getAttr(
                      basASRInfoContainer,
                      'data-bas-asr-info-provider-name',
                    ),
                    maxSignalDuration:
                      maxSignalDurationSpans.length > 0
                        ? getAttr(maxSignalDurationSpans[0], 'data-value')
                        : undefined,
                    maxSignalSize:
                      maxSignalSizeSpans.length > 0
                        ? getAttr(maxSignalSizeSpans[0], 'data-value')
                        : undefined,
                    quotaPerMonth:
                      quotaPerMonthSpans.length > 0
                        ? getAttr(quotaPerMonthSpans[0], 'data-value')
                        : undefined,
                    termsURL:
                      termsURLSpans.length > 0
                        ? getAttr(termsURLSpans[0], 'href')
                        : undefined,
                    dataStoragePolicy:
                      dataStoragePolicySpans.length > 0
                        ? dataStoragePolicySpans[0].innerText
                        : undefined,
                    knownIssues:
                      knownIssuesSpans.length > 0
                        ? knownIssuesSpans[0].innerText
                        : undefined,
                  };

                  sanitizeNumberValue(newElem, 'maxSignalDuration');
                  sanitizeNumberValue(newElem, 'maxSignalSize');
                  sanitizeNumberValue(newElem, 'quotaPerMonth');
                  sanitizeStringValue(newElem, 'dataStoragePolicy');
                  sanitizeStringValue(newElem, 'knownIssues');
                  newElem.knownIssues =
                    newElem.knownIssues.trim() === 'none'
                      ? undefined
                      : newElem.knownIssues;

                  asrInfos.push(newElem);
                }

                // overwrite data of config
                const asrSettings = JSON.parse(
                  JSON.stringify(settings.tratt.plugins.asr),
                );

                for (let i = 0; i < asrSettings.services.length; i++) {
                  const service = asrSettings.services[i];

                  if (service.basName !== undefined) {
                    const basInfo = asrInfos.find(
                      (a) => a.name === service.basName,
                    );

                    if (basInfo !== undefined) {
                      service.dataStoragePolicy =
                        basInfo.dataStoragePolicy !== undefined
                          ? basInfo.dataStoragePolicy
                          : service.dataStoragePolicy;

                      service.maxSignalDuration =
                        basInfo.maxSignalDuration !== undefined
                          ? basInfo.maxSignalDuration
                          : service.maxSignalDuration;

                      service.maxSignalSize =
                        basInfo.maxSignalSize !== undefined
                          ? basInfo.maxSignalSize
                          : service.maxSignalSize;

                      service.knownIssues =
                        basInfo.knownIssues !== undefined
                          ? basInfo.knownIssues
                          : service.knownIssues;

                      service.quotaPerMonth =
                        basInfo.quotaPerMonth !== undefined
                          ? basInfo.quotaPerMonth
                          : service.quotaPerMonth;

                      service.termsURL =
                        basInfo.termsURL !== undefined
                          ? basInfo.termsURL
                          : service.termsURL;
                    }
                  }
                }

                return asrSettings as ASRSettings;
              }),
              exhaustMap((asrSettings) => {
                return forkJoin([
                  from(this.updateASRQuotaInfo(asrSettings)),
                  this.getMAUSLanguages(asrSettings),
                  this.getASRLanguages(asrSettings),
                  this.getActiveASRProviders(asrSettings),
                ]).pipe(
                  exhaustMap(
                    ([
                      setttings,
                      mausLanguages,
                      asrLanguages,
                      activeProviders,
                    ]) => {
                      return of(
                        ApplicationActions.loadASRSettings.success({
                          languageSettings: {
                            ...setttings,
                            services: setttings.services.map((a) => {
                              return {
                                ...a,
                                state: activeProviders.find(
                                  (b) =>
                                    b.ParameterValue.Value ===
                                    `call${a.basName}ASR`,
                                ),
                              };
                            }),
                          },
                          asrLanguages: asrLanguages
                            ?.filter((a) => a.ParameterValue.Description !== '')
                            .map((a) => {
                              const cleanedDescription =
                                a.ParameterValue.Description.replace(
                                  / *\([^)]*\) *$/g,
                                  '',
                                );
                              const result: {
                                value: string;
                                providersOnly?: string[];
                                description: string;
                                label: string;
                              } = {
                                value: a.ParameterValue.Value,
                                description: cleanedDescription,
                                label: formatLanguageLabel(
                                  a.ParameterValue.Value,
                                  cleanedDescription,
                                ),
                              };

                              const matches = / *\(([^)]*)\) *$/g.exec(
                                a.ParameterValue.Description,
                              );

                              if (matches) {
                                const splitted = matches[1].split('/');
                                result.providersOnly = splitted.map((b) => {
                                  switch (b) {
                                    case 'whisp':
                                      return 'WhisperX';
                                    case 'amber':
                                      return 'Amber';
                                    case 'google':
                                      return 'Google';
                                    case 'lst':
                                      return 'LST';
                                    case 'fraunh':
                                      return 'Fraunhofer';
                                    case 'uweb':
                                      return 'Web';
                                    case 'eml':
                                      return 'EML';
                                    case 'watson':
                                      return 'Watson';
                                  }
                                  return b;
                                });

                                const lstIndex =
                                  result.providersOnly.indexOf('LST');

                                if (lstIndex > -1) {
                                  if (/^nl/g.exec(a.ParameterValue.Value)) {
                                    result.providersOnly[lstIndex] = 'LSTDutch';
                                  } else if (
                                    /^en/g.exec(a.ParameterValue.Value)
                                  ) {
                                    result.providersOnly[lstIndex] =
                                      'LSTEnglish';
                                  } else {
                                    result.providersOnly = [
                                      ...result.providersOnly.slice(
                                        0,
                                        lstIndex - 1,
                                      ),
                                      'LSTDutch',
                                      'LSTEnglish',
                                      ...result.providersOnly.slice(lstIndex),
                                    ];
                                  }
                                }
                              } else {
                                result.providersOnly = undefined;
                              }

                              return result;
                            }),
                          mausLanguages: mausLanguages
                            ?.filter((a) => a.ParameterValue.Description !== '')
                            .map((a) => ({
                              value: a.ParameterValue.Value,
                              description: a.ParameterValue.Description,
                              label: formatLanguageLabel(
                                a.ParameterValue.Value,
                                a.ParameterValue.Description,
                              ),
                            })),
                        }),
                      );
                    },
                  ),
                );
              }),
              catchError((error) => {
                console.error(error);
                return of(
                  ApplicationActions.loadASRSettings.fail({
                    error,
                  }),
                );
              }),
            );
        } else {
          return of(
            ApplicationActions.loadASRSettings.fail({
              error: undefined as any,
            }),
          );
        }
      }),
    ),
  );

  setInitialASRLanguage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.loadASRSettings.success),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        const uiLang = this.transloco.getActiveLang();
        const matched = this.bestASRLang(uiLang, action.asrLanguages);
        if (!matched || state.asr.settings?.selectedASRLanguage) {
          return EMPTY;
        }
        return of(
          ASRActions.setASRSettings.do({
            settings: { ...state.asr.settings, selectedASRLanguage: matched },
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

  private bestASRLang(
    uiLang: string,
    asrLanguages: Array<{ value: string }>,
  ): string | undefined {
    return asrLanguages.find((l) =>
      l.value.toLowerCase().startsWith(uiLang.toLowerCase()),
    )?.value;
  }

  public async updateASRQuotaInfo(
    asrSettings: ASRSettings,
  ): Promise<ASRSettings> {
    const results = [];
    if (asrSettings?.services) {
      for (const service of asrSettings.services) {
        if (service.type === 'ASR' && asrSettings.asrQuotaInfoURL) {
          results.push(
            await this.getASRQuotaInfo(
              asrSettings.asrQuotaInfoURL,
              service.provider,
            ),
          );
        }
      }

      for (const result of results) {
        const serviceIndex = asrSettings.services.findIndex(
          (a) => a.provider === result.asrName,
        );

        if (serviceIndex > -1) {
          asrSettings.services[serviceIndex].usedQuota = result.usedQuota;
          asrSettings.services[serviceIndex].quotaPerMonth =
            result.monthlyQuota;
        } else {
          console.error(`could not find ${result.asrName}`);
        }
      }
    }

    return asrSettings;
  }

  getASRQuotaInfo(url: string, asrName: string) {
    return new Promise<{
      asrName: string;
      monthlyQuota?: number;
      usedQuota?: number;
    }>((resolve, reject) => {
      this.http
        .get(`${url}?ASRType=call${asrName}ASR`, { responseType: 'text' })
        .subscribe((result) => {
          const x2js = new X2JS();
          const response: any = x2js.xml2js(result);
          const asrQuotaInfo: {
            asrName: string;
            monthlyQuota?: number;
            usedQuota?: number;
          } = {
            asrName,
          };

          if (response.basQuota) {
            const info = {
              monthlyQuota:
                response.basQuota &&
                response.basQuota.monthlyQuota &&
                isNumber(response.basQuota.monthlyQuota)
                  ? Number(response.basQuota.monthlyQuota)
                  : null,
              secsAvailable:
                response.basQuota &&
                response.basQuota.secsAvailable &&
                isNumber(response.basQuota.secsAvailable)
                  ? Number(response.basQuota.secsAvailable)
                  : null,
            };

            if (info.monthlyQuota && info.monthlyQuota !== 999999) {
              asrQuotaInfo.monthlyQuota = info.monthlyQuota;
            }

            if (
              info.monthlyQuota &&
              info.secsAvailable !== undefined &&
              info.secsAvailable !== null &&
              info.secsAvailable !== 999999
            ) {
              asrQuotaInfo.usedQuota = info.monthlyQuota - info.secsAvailable;
            }
          }

          resolve(asrQuotaInfo);
        });
    });
  }

  public getMAUSLanguages(asrSettings?: ASRSettings): Observable<
    {
      ParameterValue: { Value: string; Description: string };
    }[]
  > {
    if (asrSettings?.basConfigURL) {
      return this.http.get<
        {
          ParameterValue: { Value: string; Description: string };
        }[]
      >(
        `${asrSettings.basConfigURL}?path=CMD/Components/BASWebService/Service/Operations/runPipeline/Input/LANGUAGE/Values/`,
        { responseType: 'json' },
      );
    } else {
      return of([]);
    }
  }

  public getASRLanguages(asrSettings?: ASRSettings): Observable<
    {
      ParameterValue: { Value: string; Description: string };
    }[]
  > {
    if (asrSettings?.basConfigURL) {
      return this.http.get<
        {
          ParameterValue: { Value: string; Description: string };
        }[]
      >(
        `${asrSettings.basConfigURL}?path=CMD/Components/BASWebService/Service/Operations/runASR/Input/LANGUAGE/Values`,
        { responseType: 'json' },
      );
    } else {
      return of([]);
    }
  }

  public getActiveASRProviders(asrSettings?: ASRSettings): Observable<
    {
      ParameterValue: { Value: string; Description: string };
    }[]
  > {
    if (asrSettings?.basConfigURL) {
      return this.http.get<
        {
          ParameterValue: { Value: string; Description: string };
        }[]
      >(
        `${asrSettings.basConfigURL}?path=CMD/Components/BASWebService/Service/Operations/runASR/Input/ASRType/Values/`,
        { responseType: 'json' },
      );
    } else {
      return of([]);
    }
  }

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

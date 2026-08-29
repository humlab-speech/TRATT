import { Injectable } from '@angular/core';
import { getBrowserLang, TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { LocalStorageService, SessionStorageService } from 'ngx-webstorage';
import { exhaustMap, of, Subject, tap, withLatestFrom } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { AppSettings } from '../../obj';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { BugReportService } from '../../shared/service/bug-report.service';
import { RoutingService } from '../../shared/service/routing.service';
import { APIActions } from '../api';
import { ApplicationActions } from '../application/application.actions';
import { AuthenticationActions } from '../authentication';
import { IDBActions } from '../idb/idb.actions';
import { getModeState, LoginMode, RootState } from '../index';
import { LoginModeActions } from '../login-mode';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';

@Injectable({
  providedIn: 'root',
})
export class ApplicationSessionEffects {
  loadLanguage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.loadLanguage.do),
      exhaustMap((a) => {
        this.transloco.setAvailableLangs(['en']);
        this.transloco.setActiveLang('en');
        return of(ApplicationActions.loadLanguage.success());
      }),
    ),
  );

  loadLanguageSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.loadLanguage.success),
      exhaustMap((a) => {
        return of(ApplicationActions.loadSettings.do());
      }),
    ),
  );

  settingsLoaded$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApplicationActions.loadSettings.success),
      exhaustMap((a) => {
        // set language
        const language = this.localStorage.retrieve('language');
        const availableLangs = a.settings.tratt.languages as string[];
        this.transloco.setAvailableLangs(availableLangs);
        const browserLang = getBrowserLang()?.replace(/-.*/g, '');
        const resolvedLang =
          language?.replace(/-.*/g, '') ??
          (browserLang && availableLangs.includes(browserLang)
            ? browserLang
            : 'en');
        this.transloco.setActiveLang(resolvedLang);

        const webToken = this.sessStr.retrieve('webToken');
        const authType = this.sessStr.retrieve('authType');
        const authenticated = this.sessStr.retrieve('loggedIn');

        this.transloco.setAvailableLangs(a.settings.tratt.languages);

        if (
          a.settings.api?.url &&
          a.settings.api?.appToken &&
          a.settings.trattBackend?.enabled !== false
        ) {
          return of(
            APIActions.init.do({
              url: a.settings.api.url,
              appToken: a.settings.api.appToken,
              authType,
              authenticated,
              webToken,
            }),
          );
        } else {
          return of(
            APIActions.init.initWithoutAPI({
              authenticated: false,
            }),
          );
        }
      }),
    ),
  );

  afterAPIInit$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(APIActions.init.success, APIActions.init.initWithoutAPI),
        withLatestFrom(this.store),
        tap(([a, state]) => {
          if (
            state.application.appConfiguration?.tratt?.tracking?.active &&
            state.application.appConfiguration.tratt.tracking.active !== ''
          ) {
            this.appendTrackingCode(
              state.application.appConfiguration.tratt.tracking.active,
              state.application.appConfiguration,
            );
          }

          this.store.dispatch(
            ApplicationActions.initApplication.setSessionStorageOptions({
              loggedIn:
                this.sessStr.retrieve('loggedIn') ?? a.authenticated ?? false,
              reloaded: this.sessStr.retrieve('reloaded') ?? false,
            }),
          );
        }),
      ),
    { dispatch: false },
  );

  afterInitApplication$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          ApplicationActions.initApplication.finish,
          LoginModeActions.loadProjectAndTaskInformation.success,
        ),
        withLatestFrom(this.store),
        tap(([a, state]) => {
          if (state.application.initialized && !(a as any).startup) {
            if (!state.application.mode) {
              // no mode active
              if (
                state.authentication.authenticated &&
                !this.routerService.staticQueryParams.audio_url
              ) {
                this.store.dispatch(
                  AuthenticationActions.logout.do({
                    message: 'logout due undefined mode',
                    messageType: 'error',
                    mode: undefined,
                    clearSession: false,
                  }),
                );
              } else if (!this.routerService.staticQueryParams.audio_url) {
                this.store.dispatch(
                  ApplicationActions.redirectToLastPage.do({
                    mode: state.application.mode!,
                  }),
                );
              }
              return;
            }
            const modeState = getModeState(state)!;

            if (!this.routerService.staticQueryParams.audio_url) {
              if (!state.application.loggedIn) {
                this.store.dispatch(
                  ApplicationActions.redirectToLastPage.do({
                    mode: state.application.mode!,
                  }),
                );
              } else {
                // logged in
                if (
                  modeState.currentSession.currentProject &&
                  modeState.currentSession.task
                ) {
                  this.store.dispatch(
                    AnnotationActions.prepareTaskDataForAnnotation.do({
                      currentProject: modeState.currentSession.currentProject,
                      mode: state.application.mode,
                      task: modeState.currentSession.task,
                    }),
                  );
                } else if (
                  this.sessStr.retrieve('last_page_path') !== '/help-tools'
                ) {
                  this.store.dispatch(
                    AuthenticationActions.redirectToProjects.do(),
                  );
                } else {
                  this.store.dispatch(
                    ApplicationActions.redirectToLastPage.do({
                      mode: state.application.mode!,
                    }),
                  );
                }
              }
            } else {
              if (
                modeState.currentSession.currentProject &&
                modeState.currentSession.task
              ) {
                this.store.dispatch(
                  AnnotationActions.prepareTaskDataForAnnotation.do({
                    currentProject: modeState.currentSession.currentProject,
                    mode: state.application.mode,
                    task: modeState.currentSession.task,
                  }),
                );
              } else {
                this.store.dispatch(ApplicationActions.waitForEffects.do());
              }
            }
          }
        }),
      ),
    { dispatch: false },
  );

  onProjectAndTaskInfoLoaded$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LoginModeActions.loadProjectAndTaskInformation.success),
        withLatestFrom(this.store),
        tap(([action, state]) => {
          if (!state.application.initialized) {
            // load on startup
            this.store.dispatch(IDBActions.loadAnnotation.do());
          }
        }),
      ),
    { dispatch: false },
  );

  redirectToLastPage$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApplicationActions.redirectToLastPage.do),
        tap((a) => {
          if (a.mode !== LoginMode.URL) {
            const lastPagePath = this.sessStr.retrieve('last_page_path');
            let queryParams: any = undefined;
            console.warn(lastPagePath);
            if (lastPagePath) {
              if (lastPagePath.indexOf('?') > -1) {
                queryParams = {};
                const splitted = lastPagePath
                  .substring(lastPagePath.indexOf('?') + 1)
                  .split('&')
                  .map((str: string) => {
                    const matched = /([^&]+)=([^&]+)/g.exec(str);
                    if (!matched) return null;
                    return { key: matched[1], value: matched[2] };
                  })
                  .filter(
                    (
                      item: { key: string; value: string } | null,
                    ): item is { key: string; value: string } => item !== null,
                  );

                for (const splittedElement of splitted) {
                  queryParams[splittedElement.key] = splittedElement.value;
                }
              }

              if (
                lastPagePath &&
                !['', '/', '/load'].includes(lastPagePath) &&
                !/^\/http/g.exec(lastPagePath)
              ) {
                this.routerService.navigate('last page', [lastPagePath], {
                  queryParams,
                });
              } else {
                this.routerService.navigate('no last page', ['/local']);
              }
            } else {
              this.routerService.navigate('no last page', ['/local']);
            }
          }
        }),
      ),
    { dispatch: false },
  );

  redirectTo$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApplicationActions.redirectTo.success),
        tap((a) => {
          if (a.needsRedirectionTo) {
            this.routerService.navigate('last page', [a.needsRedirectionTo]);
          }
        }),
      ),
    { dispatch: false },
  );

  afterIDBLoaded$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(IDBActions.loadConsoleEntries.success),
        withLatestFrom(this.store),
        tap(([a, state]: [Action, RootState]) => {
          this.bugService.addEntriesFromDB(this.appStorage.consoleEntries);

          // define languages
          const languages = state.application.appConfiguration!.tratt.languages;
          const browserLang = getBrowserLang() ?? '';

          // check if browser language is available in translations
          if (
            this.appStorage.language === undefined ||
            this.appStorage.language === ''
          ) {
            if (
              state.application.appConfiguration!.tratt.languages.find(
                (value) => {
                  return value === browserLang;
                },
              ) !== undefined
            ) {
              this.transloco.setActiveLang(browserLang);
            } else {
              // use first language defined as default language
              this.transloco.setActiveLang(languages[0]);
            }
          } else {
            if (
              state.application.appConfiguration!.tratt.languages.find(
                (value) => {
                  return value === this.appStorage.language;
                },
              ) !== undefined
            ) {
              this.transloco.setActiveLang(this.appStorage.language);
            } else {
              this.transloco.setActiveLang(languages[0]);
            }
          }

          if (this.routerService.staticQueryParams?.audio_url) {
            this.store.dispatch(
              AuthenticationActions.loginURL.do({
                mode: LoginMode.URL,
              }),
            );
          }

          this.store.dispatch(ApplicationActions.initApplication.finish());
        }),
      ),
    { dispatch: false },
  );

  logoutSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthenticationActions.logout.success),
      exhaustMap((action) => {
        try {
          this.sessStr.clear();
        } catch (e) {
          // Safari private browsing may throw QuotaExceededError
        }
        // clear undo history
        this.store.dispatch(ApplicationActions.clear());

        const subject = new Subject<Action>();

        subject.next(LoginModeActions.clearSessionStorage.success());
        subject.complete();

        this.routerService.clear();
        this.routerService
          .navigate(
            'after logout success',
            ['/local'],
            {
              queryParams: {},
            },
            'replace',
          )
          .catch((error) => {
            console.error(error);
          });

        return subject;
      }),
    ),
  );

  wait$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApplicationActions.waitForEffects.do),
        tap((a) => {
          this.routerService.navigate(
            'wait for effects',
            ['/load'],
            AppInfo.queryParamsHandling,
          );
        }),
      ),
    { dispatch: false },
  );

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private sessStr: SessionStorageService,
    private localStorage: LocalStorageService,
    private transloco: TranslocoService,
    private appStorage: AppStorageService,
    private bugService: BugReportService,
    private routerService: RoutingService,
  ) {}

  private appendTrackingCode(type: string, settings: AppSettings) {
    // check if matomo is activated
    if (type === 'matomo') {
      if (
        settings.tratt.tracking?.matomo !== undefined &&
        settings.tratt.tracking?.matomo.host !== undefined &&
        settings.tratt.tracking?.matomo.siteID !== undefined
      ) {
        const matomoSettings = settings.tratt.tracking!.matomo;
        // config values come from appconfig.json; encode as JS literals so they
        // can't break out of the string context or close the <script> tag early.
        const toInlineScriptLiteral = (value: string | number) =>
          JSON.stringify(value).replace(/</g, '\\u003C');

        const trackingCode = document.createElement('script');
        trackingCode.setAttribute('type', 'text/javascript');
        trackingCode.innerHTML = `
<!-- Matomo -->
  var _paq = window._paq || [];
  /* tracker methods like "setCustomDimension" should be called before "trackPageView" */
  _paq.push(['trackPageView']);
  _paq.push(['enableLinkTracking']);
  (function() {
    var u=${toInlineScriptLiteral(matomoSettings.host)};
    _paq.push(['setTrackerUrl', u+'piwik.php']);
    _paq.push(['setSiteId', ${toInlineScriptLiteral(matomoSettings.siteID)}]);
    var d=document, g=d.createElement('script'), s=d.getElementsByTagName('script')[0];
    g.type='text/javascript'; g.async=true; g.defer=true; g.src=u+'piwik.js'; s.parentNode.insertBefore(g,s);
  })();
<!-- End Matomo Code -->`;

        document.body.appendChild(trackingCode);
      } else {
        console.error(
          `attributes for piwik tracking in appconfig.json are invalid.`,
        );
      }
    } else {
      console.error(`tracking type ${type} is not supported.`);
    }
  }
}

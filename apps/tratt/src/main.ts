/// <reference types="@angular/localize" />

import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import '@angular/localize/init';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import {
  provideRouter,
  withEnabledBlockingInitialNavigation,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import {
  NgbCollapseModule,
  NgbDropdownModule,
  NgbModalModule,
  NgbNavModule,
  NgbOffcanvasModule,
  NgbPopoverModule,
  NgbTooltipModule,
} from '@ng-bootstrap/ng-bootstrap';
import { EffectsModule } from '@ngrx/effects';
import { StoreModule } from '@ngrx/store';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { NgxOctraApiModule } from '@octra/ngx-octra-api';
import { TrattComponentsModule } from '@tratt/ngx-components';
import { TrattUtilitiesModule } from '@tratt/ngx-utilities';
import 'jodit/esm/plugins/justify/justify.js';
import {
  provideNgxWebstorage,
  withLocalStorage,
  withNgxWebstorageConfig,
  withSessionStorage,
} from 'ngx-webstorage';
import { AppComponent } from './app/app.component';
import { APP_ROUTES } from './app/app.routes';
import { SHARED_PROVIDERS } from './app/app.shared.providers';
import { TranslocoRootModule } from './app/app.transloco';
import { NavbarService } from './app/core/component/navbar/navbar.service';
import { MODALS_PROVIDERS } from './app/core/modals/modals.providers';
import { TrattModalService } from './app/core/modals/tratt-modal.service';
import { ReloadFileGuard } from './app/core/pages/intern/reload-file/reload-file.activateguard';
import { PagesModule } from './app/core/pages/pages.module';
import { ALoginGuard, DeALoginGuard } from './app/core/shared/guard';
import { TranscActivateGuard } from './app/core/shared/guard/transcr.activateguard';
import { MultiThreadingService } from '@tratt/ngx-components';
import { AudioService, SettingsService } from './app/core/shared/service';
import { AppStorageService } from './app/core/shared/service/appstorage.service';
import { BugReportService } from './app/core/shared/service/bug-report.service';
import { CompatibilityService } from './app/core/shared/service/compatibility.service';
import { IDBService } from './app/core/shared/service/idb.service';
import { APIEffects } from './app/core/store/api';
import { ApplicationInitEffects } from './app/core/store/application/application-init.effects';
import { ApplicationSessionEffects } from './app/core/store/application/application-session.effects';
import { ApplicationUiEffects } from './app/core/store/application/application-ui.effects';
import * as fromApplication from './app/core/store/application/application.reducer';
import { AsrProcessingEffects } from './app/core/store/asr/asr-processing.effects';
import { AsrQueueEffects } from './app/core/store/asr/asr-queue.effects';
import * as fromASR from './app/core/store/asr/asr.reducer';
import {
  AuthenticationEffects,
  authenticationReducer,
} from './app/core/store/authentication';
import { IDBEffects } from './app/core/store/idb/idb-effects.service';
import * as fromUser from './app/core/store/user/user.reducer';
import { environment } from './environments/environment';

// Strip unknown query params before Angular router initializes.
// Matomo and other trackers inject params (pk_vid, link_addon, etc.) that
// confuse Angular's router and cause NG04002 errors.
(function stripUnknownQueryParams() {
  const KNOWN_PARAMS = new Set([
    'audio_url',
    'audio_name',
    'audio_type',
    'auto_playback',
    'aType',
    'host',
    'transcript',
    'readonly',
    'embedded',
    'bottomNav',
  ]);
  const url = new URL(window.location.href);
  let dirty = false;
  for (const key of [...url.searchParams.keys()]) {
    if (!KNOWN_PARAMS.has(key)) {
      url.searchParams.delete(key);
      dirty = true;
    }
  }
  if (dirty) {
    history.replaceState(null, '', url.toString());
  }
})();

bootstrapApplication(AppComponent, {
  providers: [
    // Routing
    provideRouter(APP_ROUTES, withEnabledBlockingInitialNavigation()),

    // Forms
    FormsModule,
    ReactiveFormsModule,

    // NgRx (requires importProvidersFrom because they return ModuleWithProviders)
    importProvidersFrom(
      StoreModule.forRoot(
        {
          application: fromApplication.reducer,
          asr: fromASR.reducer,
          authentication: authenticationReducer,
          user: fromUser.reducer,
        },
        {
          metaReducers: !environment.production ? [] : [],
          runtimeChecks: {
            strictActionImmutability: true,
            strictStateImmutability: true,
          },
        },
      ),
    ),
    ...(!environment.production
      ? [
          importProvidersFrom(
            StoreDevtoolsModule.instrument({
              trace: !environment.production,
              maxAge: 200,
              logOnly: !environment.production,
              connectInZone: true,
            }),
          ),
        ]
      : []),
    importProvidersFrom(
      EffectsModule.forRoot([
        IDBEffects,
        ApplicationInitEffects,
        ApplicationSessionEffects,
        ApplicationUiEffects,
        AsrQueueEffects,
        AsrProcessingEffects,
        APIEffects,
        AuthenticationEffects,
      ]),
      EffectsModule.forFeature([]),
    ),

    // Shared & Modals
    ...SHARED_PROVIDERS,
    ...MODALS_PROVIDERS,

    // i18n & UI Modules (standalone or root)
    importProvidersFrom(TranslocoRootModule),
    NgbDropdownModule,
    NgbNavModule,
    NgbModalModule,
    NgbPopoverModule,
    NgbTooltipModule,
    NgbCollapseModule,
    NgbOffcanvasModule,

    // Feature Modules (NgModules must be wrapped in importProvidersFrom)
    importProvidersFrom(PagesModule),
    importProvidersFrom(NgxOctraApiModule),
    TrattComponentsModule,
    TrattUtilitiesModule,

    // Guards & Services
    ALoginGuard,
    DeALoginGuard,
    AudioService,
    TrattModalService,
    NavbarService,
    ReloadFileGuard,
    AppStorageService,
    IDBService,
    TranscActivateGuard,
    SettingsService,
    BugReportService,
    CompatibilityService,
    MultiThreadingService,

    // HTTP & Animation
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimations(),

    // Storage & Service Worker
    provideNgxWebstorage(
      withNgxWebstorageConfig({
        separator: '.',
        prefix: 'custom',
      }),
      withLocalStorage(),
      withSessionStorage(),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: false,
    }),
  ],
}).catch((err) => {
  console.error(err);
  document.body.innerHTML = `
    <div style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto;text-align:center;">
      <h1 style="color:#c00;">TRATT failed to start</h1>
      <p>An error occurred during initialization. This may be caused by browser incompatibility or private browsing mode.</p>
      <pre style="text-align:left;background:#f5f5f5;padding:1rem;border-radius:4px;overflow:auto;max-height:200px;">${
        err?.message || err
      }</pre>
      <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1.5rem;cursor:pointer;">Retry</button>
    </div>`;
});

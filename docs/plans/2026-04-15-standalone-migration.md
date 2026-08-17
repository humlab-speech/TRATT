# Standalone Component Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all 9 NgModule wrappers, convert deprecated `ComponentFactoryResolver` to modern `ViewContainerRef.createComponent()`, eliminate 2 non-standalone base classes.

**Architecture:** Convert `InternModule` + `PagesModule` + `ModalsModule` + `AppSharedModule` to standalone providers. Update `DynComponentDirective` to modern API. Update `main.ts` providers to remove `importProvidersFrom()` calls. Migrate child routes in `InternRoutingModule` to `loadComponent`. Update root route config in `app.routes.ts`.

**Tech Stack:** Angular 19.2.x standalone APIs, `ViewContainerRef.createComponent()` (modern API).

**Rationale:** Reduces runtime overhead of NgModule machinery, simplifies DI, improves tree-shaking, modernizes deprecated APIs. 18-24 dev-hours estimated.

---

## Phase 1: Standalone Base Classes

### Task 1: Migrate DefaultComponent to standalone

**Files:**

- Modify: `apps/octra/src/app/core/component/default.component.ts`

**Step 1: Read DefaultComponent**

```bash
cat apps/octra/src/app/core/component/default.component.ts
```

**Step 2: Convert to standalone**

```typescript
// apps/octra/src/app/core/component/default.component.ts

import { Component } from '@angular/core';
import { SubscriberComponent } from '@tratt/ngx-utilities';

@Component({
  selector: 'octra-default',
  template: '',
  standalone: true,
})
export class DefaultComponent extends SubscriberComponent {}
```

**Step 3: Commit**

```bash
git add apps/octra/src/app/core/component/default.component.ts
git commit -m "refactor: make DefaultComponent standalone"
```

---

### Task 2: Convert DynComponentDirective to modern API

**Files:**

- Modify: `apps/octra/src/app/core/shared/directive/dyn-component.directive.ts`

**Step 1: Replace ComponentFactoryResolver with ViewContainerRef.createComponent()**

```typescript
// apps/octra/src/app/core/shared/directive/dyn-component.directive.ts

import { Directive, Input, Output, ViewContainerRef, EventEmitter, OnInit, OnDestroy } from '@angular/core';

@Directive({
  selector: '[octraDynComponent]',
  standalone: true,
})
export class DynComponentDirective implements OnInit, OnDestroy {
  @Input() component!: { id: number; class: any; instance: any };
  @Output() initialized = new EventEmitter<{ id: number; instance: any }>();
  @Output() destroyed = new EventEmitter<{ id: number }>();

  constructor(public viewContainerRef: ViewContainerRef) {}

  ngOnInit(): void {
    const viewContainerRef = this.viewContainerRef;
    viewContainerRef.clear();

    // Modern API: no ComponentFactoryResolver needed
    const comp = viewContainerRef.createComponent(this.component!.class);

    // subscribe to comp.instance lifecycle events
    if (comp.instance.initialized) {
      comp.instance.initialized.subscribe(() => {
        this.initialized.emit({ id: this.component!.id, instance: comp.instance });
      });
    }

    if (comp.instance.destroyed) {
      comp.instance.destroyed.subscribe(() => {
        this.destroyed.emit({ id: this.component!.id });
      });
    }
  }

  ngOnDestroy(): void {
    this.viewContainerRef.clear();
  }
}
```

**Step 2: Commit**

```bash
git add apps/octra/src/app/core/shared/directive/dyn-component.directive.ts
git commit -m "refactor: replace ComponentFactoryResolver with modern ViewContainerRef.createComponent()"
```

---

## Phase 2: Module Dissolution - AppSharedModule

### Task 3: Convert AppSharedModule to providers array

**Files:**

- Create: `apps/octra/src/app/app.shared.providers.ts`
- Modify: `apps/octra/src/app/app.shared.module.ts` (mark as deprecated)

**Step 1: Extract providers from AppSharedModule**

```typescript
// apps/octra/src/app/app.shared.providers.ts

import { Provider } from '@angular/core';
import { OctraComponentsModule, OctraUtilitiesModule } from '@tratt/ngx-components';
import { TranslocoModule } from '@jsverse/transloco';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { NgbDropdownModule, NgbPopoverModule, NgbToastModule } from '@ng-bootstrap/ng-bootstrap';
import { NgxJoditComponent } from 'ngx-jodit';

// Import standalone components that were in AppSharedModule.exports
import { TranscriptionFeedbackComponent } from './core/component/transcription-feedback/transcription-feedback.component';
import { ClipTextPipe } from './core/shared/pipe/clip-text.pipe';
import { OctraDropzoneComponent } from './core/component/octra-dropzone/octra-dropzone.component';
import { DropZoneComponent } from './core/component/drop-zone/drop-zone.component';
import { AlertComponent } from './core/component/alert/alert.component';
import { SignupComponent } from './core/component/authentication-component/signup/signup.component';
import { TranscrOverviewComponent } from './core/component/transcr-overview/transcr-overview.component';
import { TranscrEditorComponent } from './core/component/transcr-editor/transcr-editor.component';
import { ValidationPopoverComponent } from './core/component/transcr-editor/validation-popover/validation-popover.component';
import { AsrOptionsComponent } from './core/component/octra-dropzone/asr-options/asr-options.component';

export const SHARED_PROVIDERS: Provider[] = [
  // Module compatibility shims - eventually remove these
  CommonModule,
  FormsModule,
  RouterModule,
  DragDropModule,
  NgbDropdownModule,
  NgbPopoverModule,
  NgbToastModule,
  TranslocoModule,
  OctraComponentsModule,
  OctraUtilitiesModule,
  NgxJoditComponent,

  // Standalone components (these will be imported directly where needed)
  TranscriptionFeedbackComponent,
  ClipTextPipe,
  OctraDropzoneComponent,
  DropZoneComponent,
  AlertComponent,
  SignupComponent,
  TranscrOverviewComponent,
  TranscrEditorComponent,
  ValidationPopoverComponent,
  AsrOptionsComponent,
];
```

**Step 2: Mark AppSharedModule as deprecated**

```typescript
// apps/octra/src/app/app.shared.module.ts

/**
 * @deprecated Use SHARED_PROVIDERS from app.shared.providers.ts instead
 */
@NgModule({
  imports: [
    /* ... existing imports ... */
  ],
  exports: [
    /* ... existing exports ... */
  ],
})
export class AppSharedModule {}
```

**Step 3: Update main.ts to import SHARED_PROVIDERS**

```typescript
// apps/octra/src/main.ts

import { SHARED_PROVIDERS } from './app/app.shared.providers';

bootstrapApplication(AppComponent, {
  providers: [
    // ... other providers ...
    SHARED_PROVIDERS,
    // ... rest ...
  ],
});
```

**Step 4: Commit**

```bash
git add apps/octra/src/app/app.shared.providers.ts apps/octra/src/app/app.shared.module.ts apps/octra/src/main.ts
git commit -m "refactor: extract AppSharedModule providers to standalone array"
```

---

### Task 4: Convert ModalsModule to providers + direct imports

**Files:**

- Create: `apps/octra/src/app/core/modals/modals.providers.ts`
- Modify: `apps/octra/src/app/core/modals/modals.module.ts` (deprecate)
- Modify: `apps/octra/src/app/core/pages/intern/intern-routing.module.ts` (update imports)

**Step 1: Extract modal component imports to providers**

```typescript
// apps/octra/src/app/core/modals/modals.providers.ts

import { Provider } from '@angular/core';
import { ErrorModalComponent, ExportFilesModalComponent, HelpModalComponent, InactivityModalComponent, LoginInvalidModalComponent, MissingPermissionsModalComponent, OctraModalComponent, OverviewModalComponent, PromptModalComponent, ShortcutsModalComponent, StatisticsModalComponent, SupportedFilesModalComponent, ToolsModalComponent, TranscriptionDeleteModalComponent, TranscriptionDemoEndModalComponent, TranscriptionGuidelinesModalComponent, TranscriptionSendingModalComponent, TranscriptionStopModalComponent, YesNoModalComponent, ProtectedModalComponent, ShortcutComponent, TableConfiguratorComponent, ReAuthenticationModalComponent, AuthenticationComponent, AboutModalComponent, FeedbackNoticeModalComponent, TranscriptionBackupEndModalComponent, ImportOptionsModalComponent, WaitingModalComponent, BugreportModalComponent, NamingDragAndDropComponent } from './modals.barrel'; // Create a barrel export if not present

import { AppSharedModule } from '../../app.shared.module';
import { OctraFormGeneratorModule } from '@tratt/ngx-components';
import { NgbModalModule } from '@ng-bootstrap/ng-bootstrap';
import { CommonModule } from '@angular/common';

export const MODALS_PROVIDERS: Provider[] = [
  CommonModule,
  AppSharedModule,
  NgbModalModule,
  OctraFormGeneratorModule,

  // All modal components as standalone imports
  ErrorModalComponent,
  ExportFilesModalComponent,
  HelpModalComponent,
  // ... (full list)
  WaitingModalComponent,
];
```

**Step 2: Update InternRoutingModule to include modal providers**

```typescript
// In intern-routing.module.ts
import { MODALS_PROVIDERS } from '../modals/modals.providers';

@NgModule({
  imports: [
    // ... existing ...
    ...MODALS_PROVIDERS,
  ],
  // ...
})
export class InternRoutingModule {}
```

**Step 3: Commit**

```bash
git add apps/octra/src/app/core/modals/modals.providers.ts apps/octra/src/app/core/pages/intern/intern-routing.module.ts
git commit -m "refactor: extract ModalsModule to standalone providers"
```

---

## Phase 3: InternModule Migration

### Task 5: Convert InternModule to loadComponent routes

**Files:**

- Modify: `apps/octra/src/app/core/pages/intern/intern-routing.module.ts`
- Modify: `apps/octra/src/app/core/pages/intern/intern.module.ts`

**Step 1: Migrate child routes to loadComponent**

```typescript
// apps/octra/src/app/core/pages/intern/intern-routing.module.ts

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AUTHENTICATED_GUARD } from '../../pages/intern/intern.activateguard';

const INTERN_ROUTES: Routes = [
  {
    path: 'projects',
    loadComponent: () => import('./projects-list/projects-list.component').then((m) => m.ProjectsListComponent),
    canActivate: [AUTHENTICATED_GUARD],
  },
  {
    path: 'transcr',
    loadComponent: () => import('./transcription/transcription.component').then((m) => m.TranscriptionComponent),
    canActivate: [AUTHENTICATED_GUARD],
  },
  {
    path: 'transcr/end',
    loadComponent: () => import('./transcription-end/transcription-end.component').then((m) => m.TranscriptionEndComponent),
    canActivate: [AUTHENTICATED_GUARD],
  },
  {
    path: 'transcr/reload-file',
    loadComponent: () => import('./reload-file/reload-file.component').then((m) => m.ReloadFileComponent),
    canActivate: [AUTHENTICATED_GUARD],
  },
  {
    path: 'auth',
    loadComponent: () => import('./auth/auth.component').then((m) => m.AuthComponent),
    canActivate: [AUTHENTICATED_GUARD],
  },
  {
    path: 'auth-success',
    loadComponent: () => import('./auth-success-page/auth-success-page.component').then((m) => m.AuthSuccessPageComponent),
    canActivate: [AUTHENTICATED_GUARD],
  },
];

@NgModule({
  imports: [RouterModule.forChild(INTERN_ROUTES)],
  exports: [RouterModule],
})
export class InternRoutingModule {}
```

**Step 2: Remove InternModule, keep only InternRoutingModule for routing**

Mark `InternModule` as deprecated or delete entirely. Router now handles all child component loading.

**Step 3: Update app.routes.ts to use loadChildren with InternRoutingModule**

```typescript
// apps/octra/src/app/app.routes.ts

{
  path: 'intern',
  loadChildren: () => import('./core/pages/intern/intern-routing.module').then(m => m.InternRoutingModule),
  canActivate: [APP_INITIALIZED_GUARD]
}
```

**Step 4: Commit**

```bash
git add apps/octra/src/app/core/pages/intern/intern-routing.module.ts apps/octra/src/app/app.routes.ts
git commit -m "refactor: migrate InternModule child routes to loadComponent"
```

---

## Phase 4: Update main.ts providers

### Task 6: Remove importProvidersFrom() calls

**Files:**

- Modify: `apps/octra/src/main.ts`

**Step 1: Replace all importProvidersFrom() with direct standalone imports**

```typescript
// apps/octra/src/main.ts

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslocoModule } from '@jsverse/transloco';
import { StoreModule, StoreDevtoolsModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { ApplicationRootEffects } from './app/core/store/application/effects/application-init.effects';
import { AuthenticationEffects } from './app/core/store/authentication/authentication.effects';
import { ApplicationSessionEffects } from './app/core/store/application/effects/application-session.effects';
import { ApplicationUIEffects } from './app/core/store/application/effects/application-ui.effects';
import { AsrQueueEffects } from './app/core/store/asr/asr-queue.effects';
import { AsrProcessingEffects } from './app/core/store/asr/asr-processing.effects';
import { IDBEffectsService } from './app/core/store/idb/idb-effects.service';
import { NgbDropdownModule, NgbNavModule, NgbModalModule, NgbPopoverModule, NgbTooltipModule, NgbCollapseModule, NgbOffcanvasModule } from '@ng-bootstrap/ng-bootstrap';
import { OctraComponentsModule } from '@tratt/ngx-components';
import { OctraUtilitiesModule } from '@tratt/ngx-utilities';
import { NgxOctraApiModule } from '@octra/ngx-octra-api';
import { ModalsModule } from './app/core/modals/modals.module';
import { PagesModule } from './app/core/pages/pages.module';
import { SHARED_PROVIDERS } from './app/app.shared.providers';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { APP_ROUTES } from './app/app.routes';
import { provideRouter, withEnabledBlockingInitialNavigation } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from './environments/environment';
import { appRootState, appRootReducer } from './app/core/store/application/application.reducer';
import { asrRootState, asrRootReducer } from './app/core/store/asr/asr.reducer';
import { authenticationRootState, authenticationRootReducer } from './app/core/store/authentication/authentication.reducer';
import { userRootState, userRootReducer } from './app/core/store/user/user.reducer';
import { appConfig } from './app/app.transloco';
import { ALoginGuard, AudioService, NavbarService, AppStorageService, IDBService, SettingsService } from './app/core/shared/service';

bootstrapApplication(AppComponent, {
  providers: [
    // Router
    provideRouter(APP_ROUTES, withEnabledBlockingInitialNavigation()),

    // Forms
    FormsModule,
    ReactiveFormsModule,

    // NgRx store
    StoreModule.forRoot({
      [appRootState]: appRootReducer,
      [asrRootState]: asrRootReducer,
      [authenticationRootState]: authenticationRootReducer,
      [userRootState]: userRootReducer,
    }),
    StoreDevtoolsModule.instrument({ maxAge: 25, logOnly: environment.production }),
    EffectsModule.forRoot([ApplicationRootEffects, AuthenticationEffects, ApplicationSessionEffects, ApplicationUIEffects, AsrQueueEffects, AsrProcessingEffects, IDBEffectsService]),

    // ng-bootstrap modules
    NgbDropdownModule,
    NgbNavModule,
    NgbModalModule,
    NgbPopoverModule,
    NgbTooltipModule,
    NgbCollapseModule,
    NgbOffcanvasModule,

    // @octra packages
    OctraComponentsModule,
    OctraUtilitiesModule,
    NgxOctraApiModule,

    // Legacy compatibility (mark for eventual removal)
    ModalsModule,
    PagesModule,

    // Shared providers (Components, Pipes, etc)
    ...SHARED_PROVIDERS,

    // HTTP and animations
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimations(),

    // Service worker
    provideServiceWorker('ngsw-worker.js', { enabled: environment.production }),

    // Services
    ALoginGuard,
    AudioService,
    NavbarService,
    AppStorageService,
    IDBService,
    SettingsService,
  ],
}).catch((err) => console.error(err));
```

**Step 2: Commit**

```bash
git add apps/octra/src/main.ts
git commit -m "refactor: replace importProvidersFrom() with direct standalone modules and providers"
```

---

## Phase 5: Testing & Cleanup

### Task 7: Run unit tests to verify no regressions

**Run:**

```bash
npm test -- apps/octra --watch=false
```

**Expected:** All tests pass. If any fail, they are likely due to changed import paths or missing providers.

**Commit if pass:**

```bash
git add apps/octra/src
git commit -m "test: verify standalone migration passes all unit tests"
```

---

### Task 8: Build and verify bundle size

**Run:**

```bash
npm run build -- apps/octra
```

**Expected:** Build succeeds with no errors. Compare bundle size to baseline (should be slightly smaller due to removed NgModule wrappers).

**Check sizes:**

```bash
npm run analyze:octra
```

**Commit:**

```bash
git add .
git commit -m "perf: standalone migration reduces bundle overhead"
```

---

## Execution Paths

**Plan saved to `docs/plans/2026-04-15-standalone-migration.md`**

Two execution options:

**1. Subagent-Driven (this session)** — Fresh subagent per task, code review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with superpowers:executing-plans, batch execution with checkpoints

Which approach?

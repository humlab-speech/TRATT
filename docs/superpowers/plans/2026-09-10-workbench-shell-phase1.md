# Workbench Phase 1 (the shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/workbench` route, behind a flag, that shows the existing dropzone/pipeline-options UI and the existing dynamic editor host on one page (two-pane), for one bundle, with behaviour indistinguishable from the current two-step `/local` → `/intern/transcr` flow. `/local` stays untouched as the rollback path.

**Architecture:** A new standalone `WorkbenchComponent` composes existing pieces it does not own the logic of: `TrattDropzoneComponent` (left, already hosts `AutoTranscribeOptionsComponent`/`AutoTranslateOptionsComponent`) and the existing `LoadeditorDirective` dynamic editor host + `editorComponents` registry (right), plus the fastbar/comment/bottom-nav markup lifted verbatim from `TranscriptionComponent`. Session start reuses the exact `AudioService.registerAudioManager` → `AuthenticationStoreService.loginLocal` sequence `LoginComponent.proceedWithLogin` uses today. The NgRx effect chain that currently ends in `router.navigate(['/intern/transcr'])` is patched with one conditional so it does not navigate away when the session started from `/workbench` — the right pane reveals in place instead, driven by the same `application.loading.status === FINISHED` condition `TranscActivateGuard` already checks.

**Tech Stack:** Angular 19 standalone components, NgRx (existing store/effects, no state-shape change this phase), Transloco.

**Spec:** `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md` (and the fuller prose in `docs/superpowers/specs/reference/TRATT Conversion Plan.dc.html` §4).

## Global Constraints

- No state-shape change this phase (`LoginModeState`/`currentSession` untouched — that's phase 2).
- One bundle only this phase — no bundle list, no queue.
- `/local` must keep working unmodified; `/workbench` is additive and flag-gated.
- Every new user-facing string gets Transloco keys in both `en.json` and `sv.json`; `npm run validate:i18n` must stay green.
- New components follow the in-framework performance guidance already adopted: `OnPush` change detection on every new component (plan §9).
- Server-mode variant (left rail suppressed for online sessions) and About-modal content rehoming are explicitly **out of scope** for this phase — see "Deferred" section at the end.

---

### Task 1: Feature flag, guard, and empty `/workbench` route

**Files:**
- Modify: `apps/tratt/src/environments/environment.ts`
- Modify: `apps/tratt/src/environments/environment.dev.ts`
- Create: `apps/tratt/src/app/core/shared/guard/workbench-enabled.guard.ts`
- Create: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Create: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`
- Create: `apps/tratt/src/app/core/pages/workbench/workbench.component.scss`
- Test: `apps/tratt/src/app/core/shared/guard/workbench-enabled.guard.spec.ts`
- Modify: `apps/tratt/src/app/app.routes.ts:17-22` (add the new route after the existing `local` route)

**Interfaces:**
- Produces: `environment.workbenchEnabled: boolean` (default `true` in `environment.dev.ts`, `false` in the base `environment.ts` so prod stays off until phase 5 flips it).
- Produces: `WORKBENCH_ENABLED_GUARD: CanActivateFn` — redirects to `/local` when `environment.workbenchEnabled` is `false`.
- Produces: `WorkbenchComponent` — standalone, selector `tratt-workbench`, `OnPush`, empty two-pane grid (`.workbench__left` / `.workbench__right`) with no content yet — later tasks fill it in.

- [ ] **Step 1: Add the flag to both environment files**

In `apps/tratt/src/environments/environment.ts`, add `workbenchEnabled: false,` alongside the existing `production`/`dev_version`/`useCookies` keys. In `apps/tratt/src/environments/environment.dev.ts`, add `workbenchEnabled: true,` the same way (mirror whatever the existing override pattern in that file looks like for `dev_version`).

- [ ] **Step 2: Write the guard test first**

```ts
// apps/tratt/src/app/core/shared/guard/workbench-enabled.guard.spec.ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { WORKBENCH_ENABLED_GUARD } from './workbench-enabled.guard';
import { environment } from '../../../../environments/environment';

describe('WORKBENCH_ENABLED_GUARD', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { parseUrl: jest.fn((url: string) => url) } }],
    });
    router = TestBed.inject(Router);
  });

  it('allows activation when environment.workbenchEnabled is true', () => {
    (environment as any).workbenchEnabled = true;
    const result = TestBed.runInInjectionContext(() =>
      WORKBENCH_ENABLED_GUARD({} as any, {} as any),
    );
    expect(result).toBe(true);
  });

  it('redirects to /local when environment.workbenchEnabled is false', () => {
    (environment as any).workbenchEnabled = false;
    const result = TestBed.runInInjectionContext(() =>
      WORKBENCH_ENABLED_GUARD({} as any, {} as any),
    );
    expect(router.parseUrl).toHaveBeenCalledWith('/local');
    expect(result).toBe('/local');
  });
});
```

- [ ] **Step 3: Run it, confirm it fails (guard file doesn't exist yet)**

Run: `npx nx test tratt --testPathPattern=workbench-enabled.guard.spec.ts`
Expected: FAIL — cannot find module `./workbench-enabled.guard`.

- [ ] **Step 4: Write the guard**

```ts
// apps/tratt/src/app/core/shared/guard/workbench-enabled.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../../../environments/environment';

export const WORKBENCH_ENABLED_GUARD: CanActivateFn = () => {
  if (environment.workbenchEnabled) {
    return true;
  }
  return inject(Router).parseUrl('/local');
};
```

- [ ] **Step 5: Run the guard test again, confirm it passes**

Run: `npx nx test tratt --testPathPattern=workbench-enabled.guard.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Create the empty `WorkbenchComponent` shell**

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.ts
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'tratt-workbench',
  templateUrl: './workbench.component.html',
  styleUrls: ['./workbench.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkbenchComponent {}
```

```html
<!-- apps/tratt/src/app/core/pages/workbench/workbench.component.html -->
<div class="workbench">
  <div class="workbench__left"></div>
  <div class="workbench__right"></div>
</div>
```

```scss
// apps/tratt/src/app/core/pages/workbench/workbench.component.scss
.workbench {
  display: grid;
  grid-template-columns: 340px 1fr;
  height: 100%;
  min-height: 0;
}
.workbench__left {
  overflow-y: auto;
  border-right: 1px solid #d4d9e0;
}
.workbench__right {
  overflow-y: auto;
}
```

- [ ] **Step 7: Register the route**

In `apps/tratt/src/app/app.routes.ts`, right after the existing `local` route object (lines 17-22), add:

```ts
  {
    path: 'workbench',
    loadComponent: () =>
      import('./core/pages/workbench/workbench.component').then(
        (m) => m.WorkbenchComponent,
      ),
    canActivate: [APP_INITIALIZED_GUARD, ALoginGuard, WORKBENCH_ENABLED_GUARD],
    data: { localOnly: true },
  },
```

Add the import `import { WORKBENCH_ENABLED_GUARD } from './core/shared/guard/workbench-enabled.guard';` near the other guard imports at the top of the file.

- [ ] **Step 8: Manual smoke check**

Run: `npm start`, set `workbenchEnabled: true` locally if not already (dev environment has it on), navigate to `http://localhost:5321/workbench`.
Expected: page loads, shows the empty two-pane grid, no console errors.

- [ ] **Step 9: Commit**

```bash
git add apps/tratt/src/environments/environment.ts apps/tratt/src/environments/environment.dev.ts \
  apps/tratt/src/app/core/shared/guard/workbench-enabled.guard.ts \
  apps/tratt/src/app/core/shared/guard/workbench-enabled.guard.spec.ts \
  apps/tratt/src/app/core/pages/workbench/ apps/tratt/src/app/app.routes.ts
git commit -m "feat(workbench): add flagged /workbench route with empty two-pane shell"
```

---

### Task 2: Left pane — dropzone and session start

**Files:**
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`
- Test: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts`

**Interfaces:**
- Consumes: `TrattDropzoneComponent` (selector `tratt-dropzone`, `@Input() height`, `@Input() showAutoTranscribe`, `@Output() filesAdded`, and the `dropzone` template-ref API: `hasAudio`, `hasAnnotation`, `oannotation`, `oaudiofile`, `audioManager`, `releaseAudioManager()` — from `apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.component.ts`).
- Consumes: `AudioService.registerAudioManager(manager)` (`apps/tratt/src/app/core/shared/service/audio.service.ts`), `AuthenticationStoreService.loginLocal(files, annotation, removeData)` (`apps/tratt/src/app/core/store/authentication/authentication-store.service.ts:83-92`).
- Produces: `WorkbenchComponent.startSession(removeData: boolean): void` — the method later tasks (and the effect patch in Task 4) rely on having run before the right pane reveals.
- Produces: `WorkbenchComponent.sessionStarting: boolean` signal-backed field, exposed so the template can disable the start control while the effect chain runs.

- [ ] **Step 1: Write the component test for session start, before touching the template**

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkbenchComponent } from './workbench.component';
import { AudioService } from '../../shared/service/audio.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';

describe('WorkbenchComponent', () => {
  let fixture: ComponentFixture<WorkbenchComponent>;
  let component: WorkbenchComponent;
  let audioService: { registerAudioManager: jest.Mock };
  let authStoreService: { loginLocal: jest.Mock };

  beforeEach(async () => {
    audioService = { registerAudioManager: jest.fn() };
    authStoreService = { loginLocal: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [WorkbenchComponent],
      providers: [
        { provide: AudioService, useValue: audioService },
        { provide: AuthenticationStoreService, useValue: authStoreService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkbenchComponent);
    component = fixture.componentInstance;
  });

  it('registers the dropzone audio manager and calls loginLocal on startSession', () => {
    const manager = { id: 'fake-manager' } as any;
    component.dropzone = {
      audioManager: manager,
      files: [{ name: 'a.wav' }],
      hasAudio: true,
      hasAnnotation: false,
      oannotation: undefined,
      releaseAudioManager: jest.fn(),
    } as any;

    component.startSession(false);

    expect(audioService.registerAudioManager).toHaveBeenCalledWith(manager);
    expect(component.dropzone!.releaseAudioManager).toHaveBeenCalled();
    expect(authStoreService.loginLocal).toHaveBeenCalledWith(
      [{ name: 'a.wav' }],
      undefined,
      false,
    );
  });

  it('does nothing when the dropzone has no audio manager yet', () => {
    component.dropzone = { audioManager: undefined } as any;
    component.startSession(false);
    expect(audioService.registerAudioManager).not.toHaveBeenCalled();
    expect(authStoreService.loginLocal).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: FAIL — `component.dropzone` / `component.startSession` don't exist.

- [ ] **Step 3: Implement `startSession` and wire the dropzone into the template**

This is `LoginComponent.proceedWithLogin` (`apps/tratt/src/app/core/pages/login/login.component.ts:551-581`) copied and renamed — same call sequence, same guard-on-missing-manager behaviour, adapted to read from a `@ViewChild` instead of a component property:

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.ts
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { TrattDropzoneComponent } from '../../component/tratt-dropzone/tratt-dropzone.component';
import { AudioService } from '../../shared/service/audio.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';

@Component({
  selector: 'tratt-workbench',
  templateUrl: './workbench.component.html',
  styleUrls: ['./workbench.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TrattDropzoneComponent],
})
export class WorkbenchComponent {
  @ViewChild(TrattDropzoneComponent) dropzone?: TrattDropzoneComponent;
  sessionStarting = false;

  constructor(
    private audioService: AudioService,
    private authStoreService: AuthenticationStoreService,
  ) {}

  startSession(removeData: boolean): void {
    const manager = this.dropzone?.audioManager;
    if (!manager) {
      return;
    }
    this.sessionStarting = true;
    const files = this.dropzone!.files;
    const annotation = this.dropzone!.hasAnnotation
      ? this.dropzone!.oannotation
      : undefined;
    this.audioService.registerAudioManager(manager);
    this.dropzone!.releaseAudioManager();
    this.authStoreService.loginLocal(files, annotation, removeData);
  }
}
```

```html
<!-- apps/tratt/src/app/core/pages/workbench/workbench.component.html -->
<div class="workbench">
  <div class="workbench__left">
    <tratt-dropzone height="180px" [showAutoTranscribe]="true"></tratt-dropzone>
    <button
      type="button"
      class="btn btn-primary workbench__start"
      [disabled]="sessionStarting"
      (click)="startSession(false)"
    >
      {{ 'workbench.start session' | transloco }}
    </button>
  </div>
  <div class="workbench__right"></div>
</div>
```

Add `TranslocoPipe` to the component's `imports` array alongside `TrattDropzoneComponent`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the Transloco key**

Add `"start session": "Start session"` under a new `"workbench"` object in `apps/tratt/src/assets/i18n/en.json`, and `"start session": "Starta session"` under the same new `"workbench"` object in `apps/tratt/src/assets/i18n/sv.json`.

Run: `npm run validate:i18n`
Expected: passes, no missing/extra keys reported.

- [ ] **Step 6: Manual smoke check**

`npm start`, go to `/workbench`, drag a `.wav` file onto the dropzone, click "Start session". Expected: no console errors; `AuthenticationStoreService.loginLocal` fires (visible in Redux devtools as `[Authentication] Login local do`, if installed) — full reveal is Task 4, so the page will currently navigate away to `/intern/transcr` at this point, which is expected until Task 4 lands.

- [ ] **Step 7: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/ apps/tratt/src/assets/i18n/en.json apps/tratt/src/assets/i18n/sv.json
git commit -m "feat(workbench): wire dropzone into left pane and start the session"
```

---

### Task 3: Right pane — fastbar, editor host, comment field, bottom nav

**Files:**
- Modify: `apps/tratt/src/app/editors/components.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`
- Test: `apps/tratt/src/app/editors/components.spec.ts`
- Test: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` (extend)

**Interfaces:**
- Consumes: `LoadeditorDirective` (`apps/tratt/src/app/core/shared/directive/loadeditor.directive.ts`, selector `[trattLoadeditor]`, exposes `viewContainerRef: ViewContainerRef`).
- Consumes: `TRATTEditor` / `TrattEditorRequirements` types from `apps/tratt/src/app/editors/tratt-editor.ts`.
- Consumes: `FastbarComponent` (selector `tratt-fastbar`, `apps/tratt/src/app/core/component/taskbar/taskbar.component.ts`).
- Produces: `editorComponents: { name: string; editor: Type<TRATTEditor>; translate: string; icon: string }[]` — the `any` is gone; any other consumer of this array (`TranscriptionComponent.changeEditor`, `transcription.component.ts:586-684`) keeps compiling unchanged since the runtime values are unchanged, only the declared type narrows.
- Produces: `WorkbenchComponent.changeEditor(name: string): void`, `WorkbenchComponent.sessionReady: boolean` (Task 4 will drive this from the store instead of leaving it always false).

- [ ] **Step 1: Write the failing test for the editor registry type**

```ts
// apps/tratt/src/app/editors/components.spec.ts
import { Type } from '@angular/core';
import { editorComponents } from './components';
import { TRATTEditor } from './tratt-editor';

describe('editorComponents', () => {
  it('declares every entry as a component Type<TRATTEditor>', () => {
    editorComponents.forEach((entry) => {
      const editorType: Type<TRATTEditor> = entry.editor;
      expect(typeof editorType).toBe('function');
    });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=editors/components.spec.ts`
Expected: FAIL only if `TRATTEditor` isn't exported from `tratt-editor.ts` yet — check first; if it's already exported (the earlier exploration found `TRATTEditor`/`TrattEditorRequirements` types already in use at `transcription.component.ts:15-18`), this test should compile and pass immediately, since TypeScript's `any` doesn't fail assignment either way. Run it to confirm current green state before the type-narrowing change, since the real regression this test guards against is a **future** loosening back to `any`.

- [ ] **Step 3: Narrow the type in `editorComponents`**

```ts
// apps/tratt/src/app/editors/components.ts
import { Type } from '@angular/core';
import { TwoDEditorComponent } from './2D-editor';
import { DictaphoneEditorComponent } from './dictaphone-editor';
import { LinearEditorComponent } from './linear-editor';
import { TrnEditorComponent } from './trn-editor';
import { TRATTEditor } from './tratt-editor';

export const editorComponents: {
  name: string;
  editor: Type<TRATTEditor>;
  translate: string;
  icon: string;
}[] = [
  // ...unchanged entries
];
```

Run: `npx nx build tratt` (or `npx tsc -p apps/tratt --noEmit` if that target exists) to confirm the narrower type doesn't break `TranscriptionComponent.changeEditor` or any other consumer.
Expected: compiles clean. If any editor component doesn't structurally satisfy `TRATTEditor`, fix that editor's class signature rather than widening this type back — check `apps/tratt/src/app/editors/tratt-editor.ts` for the exact required shape (it defines `editorname: string` as a static plus whatever instance members `TrattEditorRequirements` lists) before making any editor-file changes.

- [ ] **Step 4: Extend the workbench test for the editor host and reveal**

```ts
// append to apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts
it('creates the selected editor component inside the loadeditor viewContainerRef', () => {
  const createComponentSpy = jest.fn();
  component.showEditor = {
    viewContainerRef: { clear: jest.fn(), createComponent: createComponentSpy },
  } as any;

  component.changeEditor('DictaphoneEditor');

  expect(component.showEditor!.viewContainerRef.clear).toHaveBeenCalled();
  expect(createComponentSpy).toHaveBeenCalled();
});
```

(Use whichever `editorname` string `DictaphoneEditorComponent.editorname` actually resolves to — read it from `apps/tratt/src/app/editors/dictaphone-editor/dictaphone-editor.component.ts` before writing this literal, since the plan doesn't have that exact string on hand.)

- [ ] **Step 5: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: FAIL — `component.showEditor` / `changeEditor` don't exist.

- [ ] **Step 6: Implement the right pane**

Copy `TranscriptionComponent.changeEditor` (`transcription.component.ts:586-684`) into `WorkbenchComponent` verbatim, renaming only `this.appLoadeditor`/whatever internal field name it uses for the `LoadeditorDirective` reference to `this.showEditor`, matching the `#showEditor` template reference below. Keep its lookup against `editorComponents` and its `viewContainerRef.createComponent<TRATTEditor>(comp)` call unchanged.

```ts
// additions to apps/tratt/src/app/core/pages/workbench/workbench.component.ts
import { ViewChild } from '@angular/core';
import { LoadeditorDirective } from '../../shared/directive/loadeditor.directive';
import { FastbarComponent } from '../../component/taskbar/taskbar.component';
import { editorComponents } from '../../../editors/components';
import { TRATTEditor } from '../../../editors/tratt-editor';
import { TranslocoPipe } from '@jsverse/transloco'; // match whatever import path transcription.component.ts already uses

// inside the class, alongside the existing ViewChild(TrattDropzoneComponent):
@ViewChild(LoadeditorDirective) showEditor?: LoadeditorDirective;
sessionReady = false; // Task 4 drives this for real

changeEditor(name: string): void {
  // body copied from TranscriptionComponent.changeEditor, transcription.component.ts:586-684
}
```

Update the `@Component` `imports` array to include `LoadeditorDirective`, `FastbarComponent`.

```html
<!-- apps/tratt/src/app/core/pages/workbench/workbench.component.html -->
<div class="workbench">
  <div class="workbench__left">
    <tratt-dropzone height="180px" [showAutoTranscribe]="true"></tratt-dropzone>
    <button
      type="button"
      class="btn btn-primary workbench__start"
      [disabled]="sessionStarting"
      (click)="startSession(false)"
    >
      {{ 'workbench.start session' | transloco }}
    </button>
  </div>
  <div class="workbench__right" *ngIf="sessionReady">
    <tratt-fastbar></tratt-fastbar>
    <ng-container trattLoadeditor #showEditor></ng-container>
    <!-- comment field and bottom-navigation blocks: copy verbatim from
         transcription.component.html:81-96 and :97-220, unchanged, since
         they bind to services (AnnotationStoreService, NavbarService,
         RecordedFileService) this component injects the same way -->
  </div>
</div>
```

Copy the comment-field (`transcription.component.html:81-96`) and bottom-navigation (`:97-220`) markup blocks in verbatim, and copy the handful of `TranscriptionComponent` methods/injected services those blocks call (`abortTranscription()`, `onSendButtonClick()`, `onSaveTranscriptionButtonClicked()`, `navbarServ`, `recordedFileService`, `annotationStoreService`, `showCommentSection`) into `WorkbenchComponent`'s constructor and class body — same names, same signatures, so the copied markup needs no edits.

- [ ] **Step 7: Run the tests, confirm they pass**

Run: `npx nx test tratt --testPathPattern="editors/components.spec.ts|workbench.component.spec.ts"`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/tratt/src/app/editors/components.ts apps/tratt/src/app/editors/components.spec.ts \
  apps/tratt/src/app/core/pages/workbench/
git commit -m "feat(workbench): compose right pane from existing editor host, fastbar, comment field, bottom nav"
```

---

### Task 4: Reveal in place instead of navigating away

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation-load/annotation-load.effects.ts` (or wherever `loadSegmentsSuccess$`, `onAnnotationLoadFailed$`, `redirectToTranscription$` actually live — confirm exact path/filename first; the exploration referenced it as `annotation-load.effects.ts:467-472` etc.)
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Test: extend the existing spec file for whichever effects file is modified (find it via `find apps/tratt/src/app/core/store -iname "annotation-load.effects.spec.ts"`)
- Test: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` (extend)

**Interfaces:**
- Consumes: `Store.select` on `application.loading.status` (the same field `TranscActivateGuard`, `apps/tratt/src/app/core/shared/guard/transcr.activateguard.ts:23-45`, checks against `LoadingStatus.FINISHED`).
- Produces: `WorkbenchComponent.sessionReady` now driven by that selector via an `AsyncPipe`/subscription instead of the static `false` from Task 3.

- [ ] **Step 1: Locate the exact effects file and existing spec**

Run: `find apps/tratt/src/app/core/store -iname "annotation-load.effects*"`
Confirm the real path (the plan text above uses the name from exploration; verify before editing).

- [ ] **Step 2: Write the failing effect test**

Find the existing test(s) for `loadSegmentsSuccess$` in that spec file (search for `loadSegmentsSuccess$` or `initTranscriptionService.success` inside it) and add a case alongside them:

```ts
it('does not navigate to /intern/transcr when the current URL is /workbench', (done) => {
  routingService.navigate = jest.fn();
  // reuse whatever TestScheduler / actions$ marble setup the existing
  // loadSegmentsSuccess$ tests in this file already use, but stub
  // router.url (or whatever this effect reads to get the current URL)
  // to '/workbench' before dispatching initTranscriptionService.success
  router.url = '/workbench';

  actions$ = of(AnnotationActions.initTranscriptionService.success({ ...existingSuccessPayloadFixture }));

  effects.loadSegmentsSuccess$.subscribe(() => {
    expect(routingService.navigate).not.toHaveBeenCalled();
    done();
  });
});
```

Match this test's setup exactly to whatever pattern the file's existing `loadSegmentsSuccess$` tests already use for `actions$`/mocked services — read the file first and mirror it; don't introduce a second testing pattern into the same spec file.

- [ ] **Step 3: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=annotation-load.effects.spec.ts`
Expected: FAIL — effect still navigates unconditionally.

- [ ] **Step 4: Add the conditional in the effect**

At each of the three call sites (`loadSegmentsSuccess$` line ~467-472, `onAnnotationLoadFailed$` line ~425-448, `redirectToTranscription$` line ~920-933), guard the `routingService.navigate(['/intern/transcr'], ...)` call:

```ts
if (!this.router.url.startsWith('/workbench')) {
  this.routingService.navigate('transcription initialized', ['/intern/transcr'], ...);
}
```

Inject `Router` into the effects class if it isn't already (check the constructor first — `RoutingService` may already expose the current URL without needing a raw `Router` injection; prefer `this.routingService.url` or equivalent if it exists, to avoid a redundant injection).

- [ ] **Step 5: Run the test, confirm it passes, and confirm the pre-existing tests still pass**

Run: `npx nx test tratt --testPathPattern=annotation-load.effects.spec.ts`
Expected: all PASS, including the pre-existing `loadSegmentsSuccess$` cases that assert navigation *does* happen for `/local`.

- [ ] **Step 6: Drive `sessionReady` from the store in `WorkbenchComponent`**

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.ts
import { Store } from '@ngrx/store';
import { LoadingStatus } from '...'; // exact import path from transcr.activateguard.ts
import { map } from 'rxjs/operators';

// inside the class
sessionReady = false;
private loadingStatus$ = this.store.select((state: any) => state.application.loading.status);

constructor(
  // ...existing injections
  private store: Store,
) {
  this.loadingStatus$
    .pipe(map((status) => status === LoadingStatus.FINISHED))
    .subscribe((ready) => {
      this.sessionReady = ready;
    });
}
```

Use whatever the codebase's actual idiom is for subscribing in a component constructor without leaking (`DefaultComponent`'s existing teardown pattern, used by both `LoginComponent` and `TranscriptionComponent` — extend `DefaultComponent` and use its `subscrManager`/`takeUntil` convention instead of a bare `.subscribe()`, matching `transcription.component.ts`'s own pattern).

- [ ] **Step 7: Extend the component test**

```ts
// append to workbench.component.spec.ts
it('reveals the right pane once application.loading.status is FINISHED', () => {
  storeMock.select.mockReturnValue(of({ status: LoadingStatus.FINISHED }));
  fixture.detectChanges();
  expect(component.sessionReady).toBe(true);
});
```

Adjust the mock shape to match whichever selector form Step 6 actually used.

- [ ] **Step 8: Run all workbench-related tests**

Run: `npx nx test tratt --testPathPattern="workbench|annotation-load.effects"`
Expected: all PASS.

- [ ] **Step 9: Manual end-to-end smoke check (this is the phase's acceptance test)**

`npm start`, navigate to `/workbench`, drop one `.wav` file, click "Start session". Expected: page does **not** navigate to `/intern/transcr`; the right pane reveals in place with the fastbar and an editor tab visible; editing, saving, and exporting behave the same as on `/local` → `/intern/transcr` today. Then repeat the same flow at `/local` to confirm it still navigates and behaves exactly as before (regression check).

- [ ] **Step 10: Commit**

```bash
git add apps/tratt/src/app/core/store/ apps/tratt/src/app/core/pages/workbench/
git commit -m "feat(workbench): reveal editor pane in place instead of navigating to /intern/transcr"
```

---

---

### Task 5: Auto-mount an editor when the session becomes ready

**Why this task exists:** Task 4's review found that after `sessionReady` flips `true`, the right pane's editor host renders empty — nothing calls `changeEditor(...)`. `TranscriptionComponent.ngOnInit` avoids this by calling `checkCurrentEditor()` (defaults `appStorage.interface` to `projectsettings.interfaces[0]` if the stored value isn't a valid interface for this project) then `this.changeEditor(this.interface)`. Without the equivalent here, the plan's own "Done when" ("edit... entirely at `/workbench`") is not met — this closes that gap. Ruled load-bearing in the SDD ledger (`Task 4: Ruling`).

**Files:**
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts`

**Interfaces:**
- Consumes: `WorkbenchComponent.changeEditor(name: string): void` (Task 3), `WorkbenchComponent.sessionReady` now store-driven (Task 4), `this.settingsService.projectsettings` getter (already present, Task 3), `this.appStorage` (already injected, Task 3) — `AppStorageService.interface: string | undefined` is the same field `TranscriptionComponent` reads/writes at `transcription.component.ts:476,582,598`.
- Produces: no new public members — this task adds a private helper and one call site inside the existing `loading$` subscription callback.

- [ ] **Step 1: Read the exact current behaviour to mirror**

Read `apps/tratt/src/app/core/pages/intern/transcription/transcription.component.ts:465-485` (the `checkCurrentEditor()` call + `this.interface = this.appStorage.interface` + conditional `changeEditor` call) and `:575-583` (`checkCurrentEditor()`'s body: finds `appStorage.interface` in `projectsettings.interfaces`, defaults to `projectsettings.interfaces[0]` if not found). Confirm these still match this description — if the real code differs, follow what you read, not this paraphrase.

- [ ] **Step 2: Write the failing test**

Add to `workbench.component.spec.ts` (extend the existing `describe('WorkbenchComponent', ...)` block, following the same `@jest/globals` import convention and mock-extension pattern Task 4 already established for `settingsService`/`appStoreService`):

```ts
it('auto-mounts an editor once the session becomes ready', () => {
  const createComponentSpy = jest.fn();
  component.showEditor = {
    viewContainerRef: { clear: jest.fn(), createComponent: createComponentSpy },
  } as any;
  (component as any).appStorage = { interface: undefined };
  (component as any).settingsService = {
    projectsettings: { interfaces: ['Dictaphone Editor', 'Linear Editor'] },
    isTheme: jest.fn().mockReturnValue(false),
  };

  loadingSubject.next({ status: LoadingStatus.FINISHED } as any);
  fixture.detectChanges();

  expect(component.sessionReady).toBe(true);
  expect(createComponentSpy).toHaveBeenCalled();
});
```

Adapt the exact mock shape (`loadingSubject`, `LoadingStatus` import, how `settingsService`/`appStorage` are currently provided in this spec file's `beforeEach`) to match what Task 4 actually left in place — read the current file first rather than assuming this snippet's variable names are exact.

- [ ] **Step 3: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: FAIL — `createComponentSpy` never called, since nothing invokes `changeEditor` yet.

- [ ] **Step 4: Implement the auto-mount**

In the `loading$` subscription callback added in Task 4 (inside `ngOnInit`), after setting `sessionReady = true` and calling `markForCheck()`, add a call to a small private helper mirroring `TranscriptionComponent.checkCurrentEditor()` + the `changeEditor` call:

```ts
private mountDefaultEditor(): void {
  const interfaces = this.settingsService.projectsettings?.interfaces ?? [];
  const current = this.appStorage.interface;
  const valid = interfaces.find((x) => x === current);
  if (valid === undefined && interfaces.length > 0) {
    this.appStorage.interface = interfaces[0];
  }
  if (this.appStorage.interface) {
    this.changeEditor(this.appStorage.interface);
  }
}
```

Call `this.mountDefaultEditor()` once, only on the transition into `sessionReady === true` (not on every emission if `loading$` re-emits FINISHED repeatedly — guard with the existing `sessionReady` field: only call it when `sessionReady` was `false` and the new status is `FINISHED`, mirroring how the callback already has both the previous field value and the new incoming status available).

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: all PASS (previous 6 + this new one).

- [ ] **Step 6: Manual smoke check**

`npm start`, `/workbench`, drop a file, click "Start session". Expected: right pane reveals AND an editor tab (e.g. Dictaphone) is visibly mounted with content, matching `/local`'s post-navigation editor view.

- [ ] **Step 7: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/
git commit -m "feat(workbench): auto-mount default editor when session becomes ready"
```

## Done when (phase 1 acceptance, from the spec)

A user can drop one file, run the pipeline (existing `AutoTranscribeOptionsComponent`/`AutoTranslateOptionsComponent`, unchanged), edit, and export, entirely at `/workbench`, with behaviour indistinguishable from `/local` — verified manually in Task 4 Step 9, since this is a full-stack UI flow with no existing E2E harness in this repo to automate it against.

## Deferred (explicitly out of scope for this plan)

- **Server-mode variant** (left rail suppressed for online/server-backed sessions) — `/workbench` in this plan only ever serves local mode (same `data: { localOnly: true }` as `/local`); online sessions keep using `/login`. Revisit when `/workbench` is ready to absorb `/login` too.
- **About modal / landing-page content rehoming** — no landing page is being removed in this plan (`/local` and `/login` both stay), so there's nothing to rehome yet. Do this when `/local`/`/login` are actually retired, per the spec's own risk-register note (§10, "scope creep from the landing page").
- **Phase 0 leftovers** (single-session reducer test, Dexie 0.5 fixture) — deferred to phase 2 where they're actually exercised (2.1 entity state, 2.6 Dexie 0.6), not built speculatively against nothing now.
- **Known divergences from `TranscriptionComponent.ngOnInit` not carried into `WorkbenchComponent`** (found in the final whole-branch review): `overwriteTidyUpAnnotation()` (SRT speaker-label normalisation on imported annotations), `afterFirstInitialization()`/`auto_playback`, `registerGeneralShortcutGroup(transcriptionShortcuts)` (transcription-level shortcuts — editors still register their own), `appStorage.saveCurrentPageAsLastPage()`, the `beforeunload` unsaved-recording guard, and the saving-state indicator. None block phase 1's core flow; each is a candidate for a small follow-up task once `/workbench` is exercised more.
- **Reload-at-`/workbench` behaviour change**: the effect patch (Task 4) makes the `reload audio local` failure path silently skip navigating to `/intern/transcr/reload-file` when already at `/workbench` — the user sees the dropzone again rather than an explicit "re-select your audio file" prompt. Untested, undocumented until now; probably the right fallback for a workbench layout, but deliberate and worth a test if this path gets exercised.
- **Trimming `WorkbenchComponent`'s copied online/demo-only methods** (~200 of its ~400 lines — `onSendButtonClick`, `onSendNowClick`, `reloadDemo`, `clearDataPermanently`, `sendTranscriptionForShortAudioFiles`, the `ONLINE`/`URL` branches of `abortTranscription`) — unreachable on this `localOnly` route (only `loginLocal` is ever called), copied verbatim only because the bottom-nav markup needed them to satisfy `strictTemplates`. Not fixed in the final review's fix wave (risk of introducing new bugs in `strictTemplates`-required code with no second review cycle to catch mistakes) — flagged for phase 2, before this file grows further.

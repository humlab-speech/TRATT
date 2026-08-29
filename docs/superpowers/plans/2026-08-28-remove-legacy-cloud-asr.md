# Remove Legacy Cloud ASR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove TRATT's inherited OCTRA feature that sends a transcript segment to an external/cloud ASR service (BAS ASR at LMU Munich) for automatic transcription and MAUS word-alignment, from the app code and from `docs/manual/`.

**Architecture:** This is a deletion/simplification pass, not new feature work, executed bottom-up through the dependency graph: annotation data model → NgRx store slice → app-level store wiring → config schema → UI components (audio-viewer engine, editors, navbar/toolbar) → bootstrap wiring → i18n → docs. Each task ends in a state where `nx build tratt`, `nx lint`, and the affected `nx test` targets are clean, so a reviewer can stop after any task and the app still builds and runs.

**Tech Stack:** Angular 19, NgRx (actions/reducers/effects/selectors), Nx monorepo, Transloco i18n, Dexie (IndexedDB), Jest.

**Spec:** This plan's spec is this document plus the user's description of the legacy feature: "a segment can be sent to an external/cloud ASR service", as documented upstream at https://clarin.phonetik.uni-muenchen.de/apps/octra/manuals/octra/2.1/the-editors-1.html#using-asr. TRATT's newer **local, in-browser Whisper transcription** feature (`local-transcription.service.ts`, `whisper-transcription.worker.ts`, `auto-transcribe-options.component.ts`, `docs/manual/automatic-transcription.md`) is a **different, unrelated feature and must not be touched**.

## Global Constraints

- Do not touch anything under `apps/tratt/src/app/core/shared/service/local-transcription*`, `apps/tratt/src/app/core/workers/whisper-transcription.worker.ts`, `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts`, or `docs/manual/automatic-transcription.md` (+ `sv/` counterpart) — these are the local Whisper feature, out of scope.
- Do not touch `@octra/api-types` / `@octra/ngx-octra-api` usage for authentication, login, or project/task sync (`authentication.effects.ts` non-ASR code, `annotation-load.effects.ts`, `annotation-save.effects.ts`, `annotation-persistence.service.ts`) — only the ASR-specific branches called out below.
- `libs/utilities/src/lib/language-label.ts`'s `pickInitialLevelName()` function and its `asrLanguage?: string` parameter are **shared** by both the legacy feature and the local Whisper feature (`local-transcription-finalization.ts` also calls it) — keep the function and the parameter name; only remove the legacy call site's argument (Task 3).
- After every task: run `npx nx build tratt` and `npx nx lint tratt` (add `ngx-components`, `annotation`, `utilities` as needed per task) before committing. TypeScript compiler errors are your map for the generic-removal task (Task 1) — they will point at every remaining reference.
- Final acceptance bar: `grep -rniE "\basr\b|\bmaus\b" apps/tratt/src libs docs/manual --include=*.ts --include=*.html --include=*.json --include=*.md` (excluding the local-Whisper files/docs listed above) returns nothing.

---

### Task 1: Strip the ASR context out of the annotation data model

**Files:**
- Modify: `libs/annotation/src/lib/trattAnnotationSegment.ts`
- Modify: `libs/annotation/src/lib/annotation.ts`
- Delete: `libs/annotation/src/lib/asr.ts`
- Modify: `libs/annotation/src/index.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/index.ts`

**Interfaces:**
- Produces: `TrattAnnotationSegment` (non-generic, no `context` field), `SegmentWithContext` (non-generic, no `context` field), `TrattAnnotation<T extends TrattAnnotationSegment>` (single type parameter, `S`/`ASRContext` removed), `TrattAnnotation.createSegment(time: SampleUnit, labels?: OLabel[])` (no `context` param).
- Consumes: nothing new.

**Why this is safe to do first:** `ASRContext` (`{ asr?: { isBlockedBy?: ASRQueueItemType; progressInfo?: {...} } }`) is the *only* shape ever supplied for `TrattAnnotationSegment<T extends ASRContext = ASRContext>`'s type parameter anywhere in the repo (confirmed by grep — every instantiation site uses `ASRContext`, a passthrough generic bound to `ASRContext`, or relies on the default). The `context` field exists solely to carry legacy-ASR blocking/progress state. Removing it collapses two generic parameters (`TrattAnnotationSegment<T>`, `TrattAnnotation<S, T>`) down to one (`TrattAnnotation<T extends TrattAnnotationSegment>`), and the TypeScript compiler will enumerate every call site that needs updating.

- [ ] **Step 1: Delete the ASR enum file**

```bash
rm libs/annotation/src/lib/asr.ts
```

- [ ] **Step 2: Remove `ASRContext`/`SegmentWithContext.context`/generic `T` from `trattAnnotationSegment.ts`**

In `libs/annotation/src/lib/trattAnnotationSegment.ts`, replace the top of the file:

```typescript
import { SampleUnit } from '@tratt/media';
import { Serializable } from '@tratt/utilities';
import { ISegment, OItem, OLabel, OSegment } from './annotjson';

export interface SegmentWithContext {
  id: number;
  labels: OLabel[];
  time: SampleUnit;
}
```

(drop the `import { ASRQueueItemType } from './asr';` line and the whole `ASRContext` interface.)

Then, in the same file:
- Change `export class TrattAnnotationSegment<T extends ASRContext = ASRContext>` to `export class TrattAnnotationSegment`.
- Change `implements SegmentWithContext<T>, Serializable<SegmentWithContext<T>, TrattAnnotationSegment<T>>` to `implements SegmentWithContext, Serializable<SegmentWithContext, TrattAnnotationSegment>`.
- Delete the `public context?: T;` field.
- Change `constructor(id: number, time: SampleUnit, labels?: OLabel[], context?: T)` to `constructor(id: number, time: SampleUnit, labels?: OLabel[])` and remove the `this.context = context;`-style assignment in the body (if present — check).
- Change `deserialize(jsonObject: SegmentWithContext<T>): TrattAnnotationSegment<T>` to `deserialize(jsonObject: SegmentWithContext): TrattAnnotationSegment`.
- Change `static deserialize<T extends ASRContext>(...)` to `static deserialize(...)`, and its body's `new TrattAnnotationSegment<T>(...)` to `new TrattAnnotationSegment(...)`.
- Change `static deserializeFromOSegment<T extends ASRContext>(...)` to `static deserializeFromOSegment(...)`, same treatment.
- Change `clone(id?: number): TrattAnnotationSegment<T>` to `clone(id?: number): TrattAnnotationSegment`.
- Change `isEqualWith(other: TrattAnnotationSegment<T>)` to `isEqualWith(other: TrattAnnotationSegment)`.
- In `TrattAnnotationEvent`, change `static deserialize<T extends ASRContext>(...)` to a plain `static deserialize(...)` (this class never used `T` for anything but the constraint — confirm at edit time by reading the method body; it should not reference `T` at all once the constraint is gone).

- [ ] **Step 3: Update `annotation.ts`'s `TrattAnnotation` class**

In `libs/annotation/src/lib/annotation.ts`:
- Remove `ASRContext` from the import block from `'./trattAnnotationSegment'` (or wherever it's imported).
- Change:
  ```typescript
  export class TrattAnnotation<
    S extends ASRContext,
    T extends TrattAnnotationSegment<S>,
  > {
  ```
  to:
  ```typescript
  export class TrattAnnotation<T extends TrattAnnotationSegment> {
  ```
- Every other use of `T` in the file (e.g. `TrattAnnotationAnyLevel<T>`, `TrattAnnotationSegmentLevel<T>`) stays as-is — `T` itself is unchanged, only its constraint source (`TrattAnnotationSegment<S>` → `TrattAnnotationSegment`) changes.
- `createSegment(time: SampleUnit, labels?: OLabel[], context?: S)`: remove the `context?: S` parameter. Its body:
  ```typescript
  createSegment(time: SampleUnit, labels?: OLabel[], context?: S) {
    return new TrattAnnotationSegment<ASRContext>(
      this._idCounters.item++,
      time,
      labels,
      context,
    );
  }
  ```
  becomes:
  ```typescript
  createSegment(time: SampleUnit, labels?: OLabel[]) {
    return new TrattAnnotationSegment(this._idCounters.item++, time, labels);
  }
  ```
- Find the method around line 515 with signature `(level: TrattAnnotationSegmentLevel<T>, time: SampleUnit, ..., context?: S)` (a segment-insertion helper). Remove the `context?: S` parameter, and change both `new TrattAnnotationSegment<S>(..., context ?? ({} as S))` construction sites inside it to `new TrattAnnotationSegment(...)` with the trailing `context ?? ({} as S)` argument removed entirely.
- Find the block around line 640-665 that does `(level.items as TrattAnnotationSegment<ASRContext>[]).map((a) => new TrattAnnotationSegment<ASRContext>(...))` (a deserialize/clone path) and `a.context` — change the casts to plain `TrattAnnotationSegment[]` / `new TrattAnnotationSegment(...)`, and remove the `a.context` (or equivalent) argument being passed through, since the field no longer exists.

- [ ] **Step 4: Update the barrel export**

In `libs/annotation/src/index.ts`, delete the line:
```typescript
export * from './lib/asr';
```

- [ ] **Step 5: Update the app-level segment subclass**

In `apps/tratt/src/app/core/store/login-mode/annotation/index.ts`:
- Remove `ASRContext` and `SegmentWithContext` from the `@tratt/annotation` import if they become unused (check first — `SegmentWithContext` may still be needed for the `deserialize` override signature, just without a type argument).
- Change:
  ```typescript
  export class SomeSegmentSubclass<
    T extends ASRContext,
  > extends TrattAnnotationSegment<T> {
    static override deserialize<T extends ASRContext>(
      jsonObject: SegmentWithContext<T>,
      ...
  ```
  (read the actual class/method names first — this was reported at lines 25-30) to drop the `<T extends ASRContext>` generic entirely: `extends TrattAnnotationSegment`, `static override deserialize(jsonObject: SegmentWithContext, ...)`.
- Change `transcript: TrattAnnotation<ASRContext, TrattAnnotationSegment<ASRContext>>;` to `transcript: TrattAnnotation<TrattAnnotationSegment>;`.

- [ ] **Step 6: Compile and chase every remaining reference**

```bash
npx nx build annotation
```

Fix every error. Known remaining consumer sites to expect (from repo-wide grep — update each: drop the `<ASRContext>` / `<T>` / `<any>` type argument, remove `.context`/`.context?.asr` reads, remove `ASRContext`/`ASRQueueItemType` imports):

- `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-interaction.service.ts` (and `.spec.ts`) — handled in Task 6.
- `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-renderer.service.ts` — handled in Task 6.
- `libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.spec.ts` (`new TrattAnnotationSegment<any>(...)` → drop `<any>`).
- `apps/tratt/src/app/core/store/login-mode/annotation/annotation.actions.ts` / `annotation.reducer.ts` — handled in Task 3.
- `apps/tratt/src/app/core/modals/tools-modal/tools-modal.component.ts` — handled in Task 9.
- `apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts`, `transcr-window.component.ts`, `linear-editor.component.ts` — handled in Tasks 7-8.

Do not fix those consumer sites yet if they belong to a later task below — just confirm the compiler errors match the expected list, then move to Task 2. (If your workflow requires a green build after every task, it is fine to also strip the dead `ASRContext`/`ASRQueueItemType` type references from those files now while you're there — just don't remove their *behavioral* ASR logic yet, that happens in the tasks below.)

- [ ] **Step 7: Commit**

```bash
git add libs/annotation
git commit -m "refactor(annotation): drop legacy ASR context generic from TrattAnnotationSegment"
```

---

### Task 2: Delete the legacy ASR NgRx store slice

**Files:**
- Delete: `apps/tratt/src/app/core/store/asr/asr-processing.effects.ts`
- Delete: `apps/tratt/src/app/core/store/asr/asr-queue.effects.ts`
- Delete: `apps/tratt/src/app/core/store/asr/asr-store-service.service.ts`
- Delete: `apps/tratt/src/app/core/store/asr/asr.actions.ts`
- Delete: `apps/tratt/src/app/core/store/asr/asr.reducer.ts`
- Delete: `apps/tratt/src/app/core/store/asr/asr.selectors.ts`
- Delete: `apps/tratt/src/app/core/store/asr/index.ts`

**Interfaces:**
- Consumes: nothing (this whole directory is self-contained legacy ASR machinery — queueing, uploading segments to the BAS ASR/MAUS web service, parsing XML responses via `X2JS`, tracking per-item processing status).
- Produces: nothing — every symbol this directory exported (`ASRActions`, `AsrStoreService`, `ASRQueueItemType`, `ASRProcessStatus`, `ASRState`, `ASRStateQueue`, `ASRTimeInterval`, `selectASR*`) is removed. Tasks 3, 6, 7, 8, 9, 10 remove the corresponding imports from every consumer.

- [ ] **Step 1: Delete the whole directory**

```bash
rm -rf apps/tratt/src/app/core/store/asr
```

- [ ] **Step 2: Leave the build broken on purpose**

Do not attempt `nx build` yet — dozens of files still import from this directory; they're fixed in Tasks 3 and 6-10. This step exists purely to remove the source of truth so the compiler can enumerate every consumer.

- [ ] **Step 3: Commit**

```bash
git add -A apps/tratt/src/app/core/store/asr
git commit -m "refactor(store): delete legacy ASR NgRx feature slice"
```

---

### Task 3: Remove ASR wiring from the application/annotation/idb store layers

**Files:**
- Modify: `apps/tratt/src/app/core/store/index.ts`
- Modify: `apps/tratt/src/app/core/store/application/application-init.effects.ts`
- Modify: `apps/tratt/src/app/core/store/application/application-session.effects.ts`
- Modify: `apps/tratt/src/app/core/store/application/application.actions.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-tools.effects.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.actions.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.ts`
- Modify: `apps/tratt/src/app/core/store/idb/idb-effects.service.ts`
- Modify: `apps/tratt/src/app/core/store/idb/idb.actions.ts`

**Interfaces:**
- Consumes: nothing from Task 2 (Task 2's directory is gone; this task removes the imports that pointed at it).
- Produces: `RootState` without an `asr` slice; `ApplicationActions` without `loadASRSettings`; `AnnotationActions` without `updateASRSegmentInformation`/`addMultipleASRSegments`; `IDBActions` without `saveASRSettings`.

- [ ] **Step 1: `store/index.ts` — drop the `asr` slice from `RootState`**

```typescript
import { ApplicationState } from './application';
import { AuthenticationState } from './authentication';
import { AnnotationState } from './login-mode/annotation';
import { UserState } from './user';
```

(remove `import { ASRState } from './asr';`) and remove the `asr: ASRState;` line from the `RootState` interface body.

- [ ] **Step 2: `application-init.effects.ts` — remove the BAS ASR provider/quota scraping**

Remove:
- The `ASRSettings` import (from `../../obj`) and the `ASRActions` import.
- The `loadASRSettings$` effect (scrapes the BAS ASR info page HTML, builds `ServiceProvider[]`, dispatches `ApplicationActions.loadASRSettings.success/fail`).
- The `setInitialASRLanguage$` effect (dispatches `ASRActions.setASRSettings.do` on `loadASRSettings.success`).
- The private helpers `bestASRLang()`, `updateASRQuotaInfo()`, `getMAUSLanguages()`, `getASRLanguages()`, `getActiveASRProviders()`.
- Any now-unused imports these leave behind (`X2JS`, `findElements`, `getAttr` from `@tratt/web-media`, `EMPTY`, `withLatestFrom` — check each is not used by the remaining, non-ASR effects in this file before deleting the import).

Do not touch `initApp$`, `loadSettings$`, `initConsoleLogging()`, or the shared constructor dependencies (`http`, `store`, `transloco`) — they're used by non-ASR effects in the same class.

- [ ] **Step 3: `application-session.effects.ts` — remove the ASR-settings kickoff**

Inside `settingsLoaded$`, delete only:

```typescript
if (a.settings.tratt.plugins?.asr?.enabled) {
  this.store.dispatch(
    ApplicationActions.loadASRSettings.do({ settings: a.settings }),
  );
}
```

Leave the rest of `settingsLoaded$` (language setup, session restoration) and every other effect in the file untouched.

- [ ] **Step 4: `application.actions.ts` — remove the `loadASRSettings` action group**

Remove `ASRSettings` from the shared import line (keep `AppSettings` if that import also brings it in). Delete the whole:

```typescript
static loadASRSettings = createActionGroup({
  source: 'app/load asr settings',
  ...
});
```

block (reported at lines 40-64). Leave `initApplication`, `redirectToLastPage`, `loadSettings`, and later actions untouched.

- [ ] **Step 5: `annotation-load.effects.ts` — drop the legacy ASR language passthrough**

In `loadSegments()`:

```typescript
const levelName = pickInitialLevelName({
  asrLanguage: rootState.asr.settings?.selectedASRLanguage,
  uiLanguage: this.transloco.getActiveLang(),
});
```

becomes:

```typescript
const levelName = pickInitialLevelName({
  uiLanguage: this.transloco.getActiveLang(),
});
```

`pickInitialLevelName` itself (in `libs/utilities/src/lib/language-label.ts`) is unchanged — it's shared with the local Whisper feature's `local-transcription-finalization.ts`, which passes its own `asrLanguage`. Do not touch that function or that other caller.

- [ ] **Step 6: `annotation-tools.effects.ts` — delete the MAUS word-alignment effect**

Delete the whole `asrRunWordAlignmentSuccess$` effect (lines ~180-333: listens for `AnnotationActions.updateASRSegmentInformation.do`, converts a Praat TextGrid result into new segments via `PraatTextgridConverter`, dispatches `AnnotationActions.addMultipleASRSegments.success/fail`).

Once it's gone, also remove (all now-unused by the remaining `combinePhrases$`/`combinePhrasesSuccess$`/`combinePhrasesFailed$` effects in this file):
- `import { ASRQueueItemType } from '../../asr';`
- `ISegment`, `OLabel`, `PraatTextgridConverter` from the `@tratt/annotation` import (keep `TrattAnnotationSegment`, `TrattAnnotationSegmentLevel` — used by `combinePhrases$`).
- `import { SampleUnit } from '@tratt/media';` (only used inside the deleted effect).
- `AudioService` from `import { AlertService, AudioService } from '../../../shared/service';` → keep only `AlertService`.
- The `private audio: AudioService,` constructor parameter.

- [ ] **Step 7: `annotation.actions.ts` — remove the two ASR action groups**

Remove `import { ASRQueueItemType, ASRTimeInterval } from '../../asr';`. Delete the `static updateASRSegmentInformation = createActionGroup({...})` block (lines ~393-408) and the `static addMultipleASRSegments = createActionGroup({...})` block (lines ~410-421).

Keep the `ASRContext` import from `@tratt/annotation` only if Task 1 left any generic type parameters in this file that still reference it — after Task 1, `ASRContext` no longer exists, so also remove `ASRContext` from this file's imports and fix any `TrattAnnotationSegment<ASRContext>` type annotations elsewhere in the file to plain `TrattAnnotationSegment` (the compiler will flag these).

- [ ] **Step 8: `annotation.reducer.ts` — remove the two ASR reducer handlers**

Delete the `on(AnnotationActions.addMultipleASRSegments.success, (state, { mode, newSegments, segmentID }) => {...})` block (lines ~87-131: unblocks the current segment's `context.asr`, splices in new word-aligned segments).

Delete the `on(AnnotationActions.updateASRSegmentInformation.do, (state, {...}) => {...})` block (lines ~658-714: writes the ASR result into a segment's label and sets `segment.context.asr = {...}`).

Fix any remaining `ASRContext`-typed generics elsewhere in the file per Task 1's compiler-driven cleanup (they're structural, not behavioral — just drop the type argument).

- [ ] **Step 9: `idb-effects.service.ts` / `idb.actions.ts` — remove the ASR-settings IDB save**

In `idb-effects.service.ts`, delete the `saveASRSettings$` effect (`ofType(ASRActions.setASRSettings.do)`, saves `state.asr.settings` via `this.idbService.saveOption('asr', ...)`, dispatches `IDBActions.saveASRSettings.success/fail`) and its `import { ASRActions } from '../asr/asr.actions';`.

In `idb.actions.ts`, delete the `static saveASRSettings = createActionGroup({ source: 'IDB/save ASRSettings', success: emptyProps(), fail: { error: string } })` block (lines ~305-312ish — confirm exact range by reading the file, it sits among several `save*Settings` action groups of the same shape).

- [ ] **Step 10: Build**

```bash
npx nx build tratt
```

Fix any remaining compiler errors surfaced by Task 1's generic removal within these files (drop stray `ASRContext`/`ASRQueueItemType` type references).

- [ ] **Step 11: Commit**

```bash
git add apps/tratt/src/app/core/store
git commit -m "refactor(store): remove legacy ASR wiring from application/annotation/idb slices"
```

---

### Task 4: Remove ASR config from `AppSettings` and the JSON schemas

**Files:**
- Modify: `apps/tratt/src/app/core/obj/Settings/app-settings.ts`
- Modify: `apps/tratt/src/app/core/schemata/appconfig.schema.ts`
- Modify: `libs/assets/src/lib/schemata/projectconfig.schema.json`
- Modify: `libs/assets/src/lib/schemata/projectconfig.schema.ts`
- Modify: `apps/tratt/src/config/localmode/projectconfig.json`

**Interfaces:**
- Produces: `AppSettings.tratt` without a `plugins` field at all (its only member was `asr`); no `ServiceProvider`/`ASRSettings` interfaces.

- [ ] **Step 1: `app-settings.ts`**

Remove:
```typescript
plugins?: {
  asr?: ASRSettings;
};
```
from the `AppSettings.tratt` interface (the `plugins` object had no other members — delete the whole `plugins?` field, not just `asr`).

Delete the `ServiceProvider` interface (lines 57-71) and the `ASRSettings` interface (lines 73-81) — they were only referenced from the field just removed.

- [ ] **Step 2: `appconfig.schema.ts`**

Inside `tratt.plugins.properties`, delete the entire `asr: { type: 'object', required: [...], properties: {...} }` block (reported at lines ~105-149: `enabled`, `calls`, `services` with provider/basName/type/termsURL/dataStoragePolicy/homepageURL/logoURL/host). Since `asr` was the only property under `plugins`, remove the `plugins: { type: 'object', properties: { ... } }` wrapper entirely too, and check whether `plugins` is in the schema's top-level `required` array — if so, remove it from there as well.

- [ ] **Step 3: `projectconfig.schema.json` and `projectconfig.schema.ts`**

Delete the `asrEnabled` property (JSON schema, ~lines 51-54: `"type": "boolean", "description": "Allow users to use ASR. Only working if ASR is enabled in \`appconfig.json\`. (ASR and word alignment only supported on the main installation by LMU Munich)."`) from `properties.tratt.properties` in the `.json` file, and its generated mirror in the `.ts` file (~lines 60-64).

- [ ] **Step 4: `apps/tratt/src/config/localmode/projectconfig.json`**

Remove the `"asrEnabled": true` line (inside the `"tratt"` object, ~line 18) — this is real deployed config data enabling the feature for local-mode installs, now dead.

- [ ] **Step 5: Build**

```bash
npx nx build tratt
```

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/obj/Settings/app-settings.ts apps/tratt/src/app/core/schemata/appconfig.schema.ts libs/assets/src/lib/schemata apps/tratt/src/config
git commit -m "refactor(config): remove ASR plugin config from AppSettings and project/app config schemas"
```

---

### Task 5: Remove the ASR-only local-reauthentication branch from `authentication.effects.ts`

**Files:**
- Modify: `apps/tratt/src/app/core/store/authentication/authentication.effects.ts`
- Modify: `apps/tratt/src/app/core/store/authentication/authentication.effects.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `reauthenticate$` effect without its `[LoginMode.DEMO, LoginMode.LOCAL]` branch.

**Context:** The `reauthenticate$` effect (or similarly-named effect around line 120) has a branch:

```typescript
if (
  a.type === AuthenticationActions.reauthenticate.do.type &&
  [LoginMode.DEMO, LoginMode.LOCAL].includes(state.application.mode!)
) {
  // local re-authentication
  if (
    state.application.appConfiguration?.tratt.plugins?.asr
      ?.shibbolethURL
  ) {
    return of(
      waitForWindowResponse(
        a.actionAfterSuccess,
        state.application.appConfiguration?.tratt.plugins.asr
          .shibbolethURL,
        { nc: true, cid: Date.now(), ... },
      ),
    );
  } else {
    return of(
      AuthenticationActions.reauthenticate.fail({
        error: 'Missing Shibboleth URL in application settings.',
      }),
    );
  }
}
```

`shibbolethURL` only ever existed on `ASRSettings` (removed in Task 4). This entire `if` branch exists solely to authenticate the ASR/MAUS plugin for DEMO/LOCAL mode — with `plugins.asr` gone, it is dead code that would now always fall into a `Missing Shibboleth URL` failure.

- [ ] **Step 1: Read the full `reauthenticate$` (or equivalent) effect**

```bash
sed -n '1,170p' apps/tratt/src/app/core/store/authentication/authentication.effects.ts
```

Confirm: (a) the exact function/effect name containing this branch, (b) whether there is other logic before/after this `if` block that must be preserved (e.g. an `[LoginMode.ONLINE]` branch using `waitForWindowResponse` against `trattBackend`/Shibboleth URLs unrelated to ASR — keep that), and (c) whether `waitForWindowResponse` (the local helper defined earlier in the same file) is used anywhere else — if this was its only caller in the DEMO/LOCAL path but it's still used by the ONLINE path, keep the helper.

- [ ] **Step 2: Delete the branch**

Remove the whole `if (a.type === AuthenticationActions.reauthenticate.do.type && [LoginMode.DEMO, LoginMode.LOCAL].includes(...)) { ... }` block. If it was the last branch in an `exhaustMap`/`switchMap` callback and removing it leaves the function without a final `return`, add a fallback that matches the surrounding pattern (e.g. `return of(AuthenticationActions.reauthenticate.fail({ error: 'Re-authentication is not supported in this mode.' }));` if a DEMO/LOCAL re-authentication branch is structurally required to exist) — read the surrounding code first to see what makes sense; do not invent new user-facing behavior beyond "this path no longer exists."

- [ ] **Step 3: Update the spec**

In `authentication.effects.spec.ts`, remove any test(s) exercising the deleted branch, and remove the `asr: {...}` fixture field from the mock `AppSettings`/`appConfiguration` object if `ASRSettings` no longer exists on the type (it won't, after Task 4).

- [ ] **Step 4: Build and test**

```bash
npx nx build tratt
npx nx test tratt --testPathPattern=authentication.effects
```

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/authentication
git commit -m "refactor(auth): remove ASR-only local re-authentication branch"
```

---

### Task 6: Delete `AsrOptionsComponent` and its app-wide wiring

**Files:**
- Delete: `libs/ngx-components/src/lib/components/asr-options/` (whole directory: `asr-options.component.ts`, `.html`, `.scss`, `index.ts`, `types.ts`)
- Modify: `libs/ngx-components/src/lib/components.module.ts`
- Modify: `libs/ngx-components/src/index.ts`
- Modify: `apps/tratt/src/app/app.shared.module.ts`
- Modify: `apps/tratt/src/app/app.shared.providers.ts`

**Interfaces:**
- Produces: nothing — `AsrOptionsComponent`, `ServiceProvider`, `ASRSettings`, `ASROptionsTranslations` (the `libs/ngx-components` copies, distinct from the deleted `app-settings.ts` ones) no longer exist or are exported.

- [ ] **Step 1: Delete the component directory**

```bash
rm -rf libs/ngx-components/src/lib/components/asr-options
```

- [ ] **Step 2: `components.module.ts`**

Remove `import { AsrOptionsComponent } from './components/asr-options';` and the two `AsrOptionsComponent` entries in the `exports: [...]` and declarations/imports arrays (leave `AudioplayerComponent`, `AudioViewerComponent` and everything else alone).

- [ ] **Step 3: `libs/ngx-components/src/index.ts`**

Remove:
```typescript
export * from './lib/components/asr-options/asr-options.component';
export * from './lib/components/asr-options/types';
```

- [ ] **Step 4: `app.shared.module.ts`**

Remove `AsrOptionsComponent` from the `@tratt/ngx-components` import, and from both the `declarations`/`imports` array and the `exports` array.

- [ ] **Step 5: `app.shared.providers.ts`**

Remove `AsrOptionsComponent` from the `@tratt/ngx-components` import and from the standalone-component providers/imports array.

- [ ] **Step 6: Build**

```bash
npx nx build ngx-components
npx nx build tratt
```

(Expect further errors from `navbar.component.html` still referencing `<tratt-asr-options>` — that's fixed in Task 9. If your workflow needs green builds per task, you may fold Task 9's navbar edit into this step instead — do not leave a dangling unknown-element error uncommitted for more than one task.)

- [ ] **Step 7: Commit**

```bash
git add libs/ngx-components apps/tratt/src/app/app.shared.module.ts apps/tratt/src/app/app.shared.providers.ts
git commit -m "refactor(ngx-components): delete legacy AsrOptionsComponent and its app-wide wiring"
```

---

### Task 7: Remove ASR from the shared audio-viewer engine

**Files:**
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-interaction.service.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-interaction.service.spec.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-renderer.service.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.config.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.spec.ts`
- Modify: `libs/ngx-components/src/lib/obj/tratt-colors.ts`

**Interfaces:**
- Consumes: nothing from Tasks 2-6.
- Produces: `AudioviewerConfig` without an `asr` settings field or `do_asr`/`do_asr_maus`/`do_maus` shortcuts; `TRATT_COLORS` without the ASR/MAUS blocked-state color tokens.

- [ ] **Step 1: `audio-viewer.config.ts`**

Remove `public asr = { enabled: false };` (~lines 93-95).

Remove the three shortcut entries from the `shortcuts.items` array:
```typescript
{ name: 'do_asr', keys: { mac: 'R', pc: 'R' }, focusonly: true, title: 'do asr' },
{ name: 'do_asr_maus', keys: { mac: 'M', pc: 'M' }, focusonly: true, title: 'do asr maus' },
{ name: 'do_maus', keys: { mac: 'W', pc: 'W' }, focusonly: true, title: 'do maus only' },
```
(~lines 195-219).

- [ ] **Step 2: `audio-viewer-interaction.service.ts`**

Remove:
- `ASRContext`, `ASRQueueItemType` from the `@tratt/annotation` import.
- The `asr: { enabled: boolean };` field from the settings-shape interface (~lines 68-70).
- Every `TrattAnnotationSegment<ASRContext>`/`TrattAnnotation<ASRContext, ...>` type argument — drop to plain `TrattAnnotationSegment`/`TrattAnnotation<...>` (Task 1 already changed the underlying types; this just removes the now-invalid type arguments here).
- The boundary-drag guard blocking a drag when `isBlockedBy === ASRQueueItemType.ASR` (~lines 432-436) — simplify the surrounding condition to drop this clause (read the full `if` first; don't remove more than the ASR clause).
- The three `case 'do_asr':`/`case 'do_asr_maus':`/`case 'do_maus':` branches in the shortcut-dispatch `switch` (~lines 1037-1050), which call `this.handleAsrShortcut(...)`.
- The `segment.context?.asr?.isBlockedBy === undefined` guard inside the undo/redo-adjacent handler (~lines 1117-1155) — simplify to remove the ASR-specific condition.
- The `private handleAsrShortcut(shortcutInfo, startValue, cancelValue, requiresFocus)` method (~lines 1520-1558) in its entirety.

- [ ] **Step 3: `audio-viewer-interaction.service.spec.ts`**

Remove:
- `ASRQueueItemType` import.
- `asr: { enabled: true },` from the test-fixture settings object (~line 61).
- The test `'refuses to drag a boundary blocked by an ASR job'` (~lines 530-534).
- The test `'do_asr emits do_asr for a free segment and cancel_asr for a blocked one'` (~lines 918-935).
- The test `'do_asr requires focus but do_maus does not'` (~line 938 onward).
- Any `TrattAnnotationSegment<any>[]`/`ASRContext`-typed casts left behind — drop to plain `TrattAnnotationSegment[]`.

- [ ] **Step 4: `audio-viewer-renderer.service.ts`**

Remove `ASRContext`, `ASRQueueItemType` from the `@tratt/annotation` import, and drop the now-invalid `<ASRContext>` type arguments elsewhere in the file.

Find the segment-rendering block (~lines 2493-2570):
```typescript
if (sceneSegment.context?.asr?.isBlockedBy === undefined) {
  // normal render (clearRect, etc.)
} else {
  if (isBlockedBy === ASRQueueItemType.ASR) {
    fillStyle = TRATT_COLORS.asrBlockedFill; // + progress bar draw using asrBlockedProgress
  } else if (isBlockedBy === ASRQueueItemType.ASRMAUS) {
    fillStyle = TRATT_COLORS.asrMausBlockedFill; // + asrMausBlockedProgress
  } else if (isBlockedBy === ASRQueueItemType.MAUS) {
    // maus-only colors
  }
  // draws progress bar using sceneSegment.context.asr.progressInfo.progress / .statusLabel
}
```
Replace the whole `if/else` with just the "normal render" branch's body (unconditional — no more ASR-blocked coloring/progress-bar path).

Remove the two doc comments that reference ASR (`* non-rendering methods (mouse/keyboard handling, playback, ASR) keep`, `* math for the ASR progress bar is separate from the actual`) — reword them to drop the ASR mention (e.g. `* non-rendering methods (mouse/keyboard handling, playback) keep`) rather than leaving a comment about deleted functionality.

- [ ] **Step 5: `speaker-colors.spec.ts`**

Change `new TrattAnnotationSegment<any>(...)` to `new TrattAnnotationSegment(...)`.

- [ ] **Step 6: `tratt-colors.ts`**

Remove the four (or six, if `mausBlockedFill`/`mausBlockedProgress` exist as separate non-`asr`-prefixed keys documented as ASR/MAUS-queue colors) named color constants and their doc comments from `TRATT_COLORS`: `asrBlockedFill`, `asrBlockedProgress`, `asrMausBlockedFill`, `asrMausBlockedProgress`, and (read the file first to confirm) any `mausBlockedFill`/`mausBlockedProgress` pair used only by the block removed in Step 4.

- [ ] **Step 7: Build and test**

```bash
npx nx build ngx-components
npx nx test ngx-components
```

- [ ] **Step 8: Commit**

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer libs/ngx-components/src/lib/obj/tratt-colors.ts
git commit -m "refactor(audio-viewer): remove legacy ASR shortcuts, blocking guards, and progress rendering"
```

---

### Task 8: Remove ASR from the 2D editor, transcr-window, and linear editor

**Files:**
- Modify: `apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts`
- Modify: `apps/tratt/src/app/editors/2D-editor/transcr-window/transcr-window.component.ts`
- Modify: `apps/tratt/src/app/editors/2D-editor/transcr-window/transcr-window.component.html`
- Modify: `apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts`

**Interfaces:**
- Consumes: nothing (Task 2 already deleted `AsrStoreService`/`ASRProcessStatus`/`ASRTimeInterval`; this task removes the imports/usages that pointed at them).

- [ ] **Step 1: `2D-editor.component.ts`**

Remove:
- `ASRContext`, `ASRQueueItemType` from the `@tratt/annotation` import (~lines 18-24).
- `import { ASRProcessStatus, ASRTimeInterval } from '../../core/store/asr';` and `import { AsrStoreService } from '../../core/store/asr/asr-store-service.service';` (~lines 54-55).
- The `private asrStoreService: AsrStoreService,` constructor parameter (~line 358).
- `this.miniMagnifierSettings.asr.enabled = false;` (~line 410).
- The `this.subscribe(this.asrStoreService.asrEnabled$, {...})` block that toggles `this.viewer.settings.asr.enabled` and registers/unregisters `do_asr`/`do_asr_maus`/`do_maus` shortcuts (~lines 416-434).
- The `this.subscribe(this.asrStoreService.queue$, {...})` and `this.subscribe(this.asrStoreService.itemChange$, {...})` blocks (~lines 484-560, undo/redo bookkeeping tied to ASR queue statistics and `ASRProcessStatus.FINISHED/STARTED` mapping) — read the full range first since it's interleaved with non-ASR undo/redo code; remove only the ASR-specific subscriptions/branches.
- The `segment.context?.asr?.isBlockedBy !== ASRQueueItemType.ASRMAUS && ... !== ASRQueueItemType.MAUS` guard in the boundary-drag/segment-selection logic (~lines 605-607) — simplify the surrounding condition.
- The `'do_asr'`/`'do_asr_maus'`/`'do_maus'` context-menu/shortcut handler branches calling `asrStoreService.addToQueue(...)` (~lines 810-908).
- The `contains($event.value, 'playonhover') || contains($event.value, 'asr')` ASR filter (~lines 931-932) — simplify to just the `playonhover` check if that's the only remaining condition needed (read the surrounding code to confirm).
- The already-dead, fully-commented-out `resetQueueItemsWithNoAuth = () => {...}` method (~lines 1083-1093) — delete outright rather than leaving commented ASR code behind.

- [ ] **Step 2: `transcr-window.component.ts`**

Remove:
- `ASRContext`, `ASRQueueItemType` from the `@tratt/annotation` import (keep other names from that same multi-import).
- `import { ASRProcessStatus } from '../../../core/store/asr';` and `import { AsrStoreService } from '../../../core/store/asr/asr-store-service.service';`.
- The `public asrStoreService: AsrStoreService,` constructor parameter (it's `public` because the removed template bound to it directly — confirm no other template binds to it before deleting).
- The `this.subscribe(this.asrStoreService.queue$, {...})` block reacting to `item.status === ASRProcessStatus.FINISHED` (~lines 456-475).
- `startASRForThisSegment()`, `startASRForAllSegmentsNext()`, `stopASRForAll()`, `stopASRForThisSegment()` methods in their entirety (~lines 1466-1610).
- The `if (!segment?.context?.asr?.isBlockedBy) { ... }` and `if (!segment!.context?.asr?.isBlockedBy) { ... }` playback-gating guards (~lines 518, 693-694) — since the condition is now always true (no ASR context exists), unwrap the `if` to just run its body unconditionally (delete the `if` wrapper, keep the body statement(s), remove the `isNextSegmentLastAndBreak` gate the same way if that helper's only remaining logic was the ASR check (~lines 1440-1441)).
- The navigation guard `tempSegment!.context?.asr?.isBlockedBy !== ASRQueueItemType.ASRMAUS && ... !== ASRQueueItemType.MAUS` (~lines 897-900) — same treatment: if this was the only condition in its `if`, the branch becomes unconditional; simplify accordingly (read the surrounding logic first).
- `TrattAnnotationSegment<ASRContext>` casts (e.g. ~line 789) — drop to plain `TrattAnnotationSegment`.

- [ ] **Step 3: `transcr-window.component.html`**

Delete the entire `@if (asrStoreService.asrEnabled$ | async) { ... }` block (~lines 34-98: the "ASR:" dropdown menu with "start this segment"/"start for all next"/"stop this segment"/"stop for all next"/"stop all" actions and the loading spinner tied to `(asrStoreService.queue$ | async)?.status`).

- [ ] **Step 4: `linear-editor.component.ts`**

Remove `ASRContext` from the `@tratt/annotation` import, the `this._miniMagnifierSettings.asr.enabled = false;` line (~line 517), and drop the `ASRContext` type argument from `TrattAnnotation<ASRContext, TrattAnnotationSegment>` (~line 1106) → `TrattAnnotation<TrattAnnotationSegment>`.

- [ ] **Step 5: Build**

```bash
npx nx build tratt
```

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/editors
git commit -m "refactor(editors): remove legacy ASR queueing, shortcuts, and blocking guards"
```

---

### Task 9: Remove ASR from navbar/transcr-editor/tools-modal; delete the authentication-needed alert; rehome error-occurred's i18n key

**Files:**
- Modify: `apps/tratt/src/app/core/component/navbar/navbar.component.ts`
- Modify: `apps/tratt/src/app/core/component/navbar/navbar.component.html`
- Modify: `apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.ts`
- Modify: `apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.html`
- Modify: `apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.scss`
- Modify: `apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.spec.ts`
- Modify: `apps/tratt/src/app/core/modals/tools-modal/tools-modal.component.ts`
- Delete: `apps/tratt/src/app/core/alerts/authentication-needed/` (whole directory)
- Modify: `apps/tratt/src/app/core/pages/intern/intern.module.ts`
- Modify: `apps/tratt/src/app/core/alerts/error-occurred/error-occurred.component.html`

**Interfaces:**
- Consumes: nothing from earlier tasks besides "`AsrStoreService` no longer exists."

- [ ] **Step 1: `navbar.component.ts`**

Remove `import { AsrStoreService } from '../../store/asr/asr-store-service.service';`, the `protected asrStoreService: AsrStoreService,` constructor parameter, and the private `applyASRLanguageForLang(lang)` method (~lines 240-263) plus its call site.

- [ ] **Step 2: `navbar.component.html`**

Delete the whole ASR-options block (~lines 800-828): the "ASR options" header label, the `<tratt-asr-options ...>` element with all its bound inputs/outputs, and its bracketing `<hr>` separators. Leave the rest of the settings dialog template alone.

- [ ] **Step 3: `transcr-editor.component.ts`**

Remove:
- `import { ASRProcessStatus, ASRStateQueue } from '../../store/asr';` and `import { AsrStoreService } from '../../store/asr/asr-store-service.service';`.
- The `private asrStoreService: AsrStoreService,` constructor parameter.
- `public asr = { status: 'inactive', result: '', error: '' };` component state field.
- The reset-to-`'inactive'` assignments in editor init (~lines 508-510) and on transcript (re)load (~lines 1492-1496).
- The `onASRQueueChange = (queue?: ASRStateQueue) => {...}` handler (~lines 563-586).
- The `this.subscribe(this.asrStoreService.queue$, { next: this.onASRQueueChange, error: ... })` subscription in `ngAfterViewInit` (~lines 670-675).
- The `public onASROverlayClick()` method (~lines 1251-1260).

- [ ] **Step 4: `transcr-editor.component.html`**

Read the full file first. Remove the `@if (asr.status === 'active') { <div id="asrOverlay" class="asr-running" (click)="onASROverlayClick()" ...> {{ 'asr.asr running' | transloco }} ... }` block (~lines 13-25), and remove the adjacent `asr.status === 'failed'`/error-card block that uses `asr.error`/`asr.result` if present (check the lines immediately following — the investigation only confirmed the `'active'` branch by grep, but the component TS clearly tracks a `'failed'` status too).

- [ ] **Step 5: `transcr-editor.component.scss`**

Remove the four rule blocks: `tratt-transcr-editor #asrOverlay { ... }` (~line 57), `tratt-transcr-editor .asr-running { ... }` (~line 65), `tratt-transcr-editor .asr-error { ... }` (~line 69), `#asrOverlay { ... }` (~line 108).

- [ ] **Step 6: `transcr-editor.component.spec.ts`**

Remove `import { AsrStoreService } from '../../store/asr/asr-store-service.service';` and the `{} as AsrStoreService,` (or `{ provide: AsrStoreService, useValue: {} }`) TestBed provider entry.

- [ ] **Step 7: `tools-modal.component.ts`**

Delete the `isSomethingBlocked(): boolean { ... }` method (checks `a.context?.asr?.isBlockedBy !== undefined` across the current level's items) and simplify its only caller:

```typescript
onCombinePhrasesClick() {
  if (!this.isSomethingBlocked()) {
    this.combinePhrases();
  }
}
```

becomes:

```typescript
onCombinePhrasesClick() {
  this.combinePhrases();
}
```

- [ ] **Step 8: Delete the `AuthenticationNeededComponent` alert**

This alert's only text ("Please authenticate in order to use features like ASR or word-alignment...") and only dispatcher (`alertService.showAlert(...)` calls inside `asr-queue.effects.ts`, deleted in Task 2) are both ASR-specific — confirmed by repo-wide grep, it has no other caller.

```bash
rm -rf apps/tratt/src/app/core/alerts/authentication-needed
```

In `apps/tratt/src/app/core/pages/intern/intern.module.ts`, remove `import { AuthenticationNeededComponent } from '../../alerts/authentication-needed/authentication-needed.component';` and change:
```typescript
export const ALERTS: any[] = [AuthenticationNeededComponent];
```
to:
```typescript
export const ALERTS: any[] = [];
```

- [ ] **Step 9: Rehome `error-occurred.component.html`'s i18n key**

`ErrorOccurredComponent` is a **generic** error/fallback page (registered separately from the `ALERTS` dynamic-lookup array, used directly in routing) whose only text happens to live under the `asr.error` translation key ("An error occurred. Please send us a short feedback for the error to be fixed.") — a naming accident inherited from OCTRA, not ASR-specific content. Do not delete this component or its message; move the key out of the `asr` namespace before Task 12 deletes that namespace.

In `apps/tratt/src/app/core/alerts/error-occurred/error-occurred.component.html`, change:
```html
<p>{{ 'asr.error' | transloco }}</p>
```
to:
```html
<p>{{ 'alerts.error occurred' | transloco }}</p>
```

(The actual i18n key rename — adding `alerts.error occurred` with each language's existing `asr.error` string value, and removing `asr.error` — happens in Task 12, so both edits land together and nothing references a missing key in between. If you're executing tasks strictly in order, do this HTML edit as part of Task 12 instead, right before deleting the `asr` namespace, so the app is never in a broken-key state between commits.)

- [ ] **Step 10: Build**

```bash
npx nx build tratt
```

- [ ] **Step 11: Commit**

```bash
git add apps/tratt/src/app/core/component/navbar apps/tratt/src/app/core/component/transcr-editor apps/tratt/src/app/core/modals/tools-modal apps/tratt/src/app/core/alerts apps/tratt/src/app/core/pages/intern/intern.module.ts
git commit -m "refactor(ui): remove ASR options panel, overlay, and authentication-needed alert"
```

---

### Task 10: Remove ASR reducer/effects registration from bootstrap, and ASR entries from the action-log ignore-list

**Files:**
- Modify: `apps/tratt/src/main.ts`
- Modify: `apps/tratt/src/app/core/shared/functions.ts`

**Interfaces:**
- Consumes: nothing (Task 2's directory is already gone; this removes the dangling imports).

- [ ] **Step 1: `main.ts`**

Remove:
```typescript
import { AsrProcessingEffects } from './app/core/store/asr/asr-processing.effects';
import { AsrQueueEffects } from './app/core/store/asr/asr-queue.effects';
import * as fromASR from './app/core/store/asr/asr.reducer';
```

Remove `asr: fromASR.reducer,` from the `StoreModule.forRoot({...})` reducer map.

Remove `AsrQueueEffects, AsrProcessingEffects,` from the `EffectsModule.forRoot([...])` array.

Leave the other reducers (`application`, `authentication`, `user`) and effects (`IDBEffects`, `ApplicationInitEffects`, `ApplicationSessionEffects`, `ApplicationUiEffects`, `APIEffects`, `AuthenticationEffects`) untouched.

- [ ] **Step 2: `functions.ts`**

Remove `import { ASRActions } from '../store/asr/asr.actions';`. Inside `isIgnoredAction()`'s ignore-list array, remove these three entries:
```typescript
ASRActions.processQueueItem.do.type,
ApplicationActions.loadASRSettings.do.type,
ApplicationActions.loadASRSettings.success.type,
```
Leave the `ApplicationActions` import (still used elsewhere in the file) and every other ignore-list entry untouched.

- [ ] **Step 3: Build**

```bash
npx nx build tratt
```

This should now be a **fully green build** — every ASR-related compile error from Tasks 1-9 should be resolved. If not, chase remaining errors before proceeding; do not move on to i18n/docs cleanup with a broken build.

- [ ] **Step 4: Commit**

```bash
git add apps/tratt/src/main.ts apps/tratt/src/app/core/shared/functions.ts
git commit -m "refactor(bootstrap): remove ASR reducer/effects registration"
```

---

### Task 11: Clean legacy ASR entries out of the IndexedDB schema/migration

**Files:**
- Modify: `apps/tratt/src/app/core/shared/tratt-database.ts`

**Interfaces:**
- Produces: `IIDBApplicationOptions` without an `asr` field; `IDBApplicationOptionName` without `'asr'`; the v4/v5 migration drops (rather than reconstructs) legacy `'asr'`/`'accessCode'`/`'maus'` option rows from existing users' browsers.

**Why not just delete the migration code outright:** existing installs may have an `app_options` IndexedDB table row named `'asr'` from before this change shipped. If the migration code that reads/deletes it disappears too, that row lingers forever as harmless-but-orphaned data — acceptable, but cleaner to have the migration actively drop it once. Since `ASRStateSettings` (the type these rows were validated against) no longer exists, don't reconstruct a typed value — just delete the legacy rows during migration.

- [ ] **Step 1: Read the migration function in full**

```bash
sed -n '260,330p' apps/tratt/src/app/core/shared/tratt-database.ts
```

- [ ] **Step 2: Replace the reconstruction logic with a drop**

Where the migration currently does something like:
```typescript
const asrOption: { name: 'asr'; value?: ... } | undefined =
  options.find((a) => a.name === 'asr');
const accessCodeOption = options.find((a) => a.name === 'accessCode');
const mausOption: { name: 'maus'; value?: ... } | undefined =
  options.find((a) => a.name === 'maus');
// ... builds newASRSettings from the three, writes back:
tr.table('app_options').put({ name: 'asr', value: newASRSettings });
```
replace it with code that just removes any of those three legacy rows if present, e.g.:
```typescript
for (const legacyKey of ['asr', 'accessCode', 'maus'] as const) {
  if (options.some((a) => a.name === legacyKey)) {
    await tr.table('app_options').delete(legacyKey);
  }
}
```
(adapt to match this file's actual Dexie transaction API — read a neighboring migration step in the same file for the idiom this codebase uses for deleting vs. `put`-ing a row, and match it.)

- [ ] **Step 3: Remove the default-option array entries**

Remove both occurrences of `{ name: 'asr', value: undefined }` from the default `IIDBEntry[]` arrays (~lines 190-200 and ~636-648).

- [ ] **Step 4: Remove the type declarations**

Remove `import { ASRStateSettings } from '../store/asr';` (the import will already be dangling from Task 2 — this is where you finally delete it). Remove `asr?: ASRStateSettings | null;` from `IIDBApplicationOptions` (~lines 696-697). Remove `'asr'` from the `IDBApplicationOptionName` union type (~lines 721-723).

- [ ] **Step 5: Build and test**

```bash
npx nx build tratt
npx nx test tratt --testPathPattern=tratt-database
```

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/shared/tratt-database.ts
git commit -m "refactor(idb): drop legacy ASR option rows instead of migrating them forward"
```

---

### Task 12: Strip ASR keys from all 7 i18n files, and land the error-occurred key rename

**Files:**
- Modify: `apps/tratt/src/assets/i18n/en.json`
- Modify: `apps/tratt/src/assets/i18n/de.json`
- Modify: `apps/tratt/src/assets/i18n/it.json`
- Modify: `apps/tratt/src/assets/i18n/ko.json`
- Modify: `apps/tratt/src/assets/i18n/nl.json`
- Modify: `apps/tratt/src/assets/i18n/sv.json`
- Modify: `apps/tratt/src/assets/i18n/zh.json`
- Modify: `apps/tratt/src/app/core/alerts/error-occurred/error-occurred.component.html` (if not already done in Task 9 Step 9)

**Interfaces:**
- Produces: no `asr.*` namespace, no `alerts.authentication needed` key, no `modal.shortcuts.do asr`/`do asr maus`/`do maus only` keys, in any of the 7 files. A new `alerts.error occurred` key exists in every file, holding what used to be that file's `asr.error` string.

Do this per file, in this order, so nothing ever points at a missing key:

- [ ] **Step 1: Add `alerts.error occurred` before removing `asr.error`**

For each of the 7 files, find the current value of the `asr` → `error` key (e.g. in `en.json`: `"error": "An error occurred. Please send us a short feedback for the error to be fixed."`). Add a new key `"error occurred"` under the existing `"alerts": { ... }` object in that same file, using that exact string (copy verbatim — do not translate or reword; every language file already has its own translated value for this key, just under the wrong namespace).

- [ ] **Step 2: Delete the entire `asr` object**

In each file, delete the whole top-level `"asr": { ... }` object (in `en.json` this is lines 12-31: `asr language`, `asr provider`, `asr running`, `click on logo`, `error`, `file too big`, `maus empty text`, `maus language`, `max duration exceeded`, `max signal size exceeded`, `no asr selected`, `no auth`, `no quota`, `start for all next`, `start this segment`, `stop all`, `stop for all next`, `stop this segment`, `without asr`. Some languages don't have every key — `it`/`ko`/`nl`/`zh` are missing `asr language`/`asr provider`/`maus language`/`max duration exceeded`/`max signal size exceeded` — delete whatever subset exists in each file, don't add missing keys.)

- [ ] **Step 3: Delete `alerts.authentication needed`**

In each file's `"alerts": { ... }` object, delete the `"authentication needed": "..."` key (its only consumer, `AuthenticationNeededComponent`, was deleted in Task 9).

- [ ] **Step 4: Delete `g.asr options`**

In `en.json` (line ~206), `de.json` (line ~197), and `sv.json` (line ~204), delete the `"asr options": "..."` key from the `"g": { ... }` object. This key does not exist in `it`/`ko`/`nl`/`zh.json` — skip those.

- [ ] **Step 5: Delete the ASR shortcut description keys**

In each file's `"modal": { "shortcuts": { ... } }` object, delete `"do asr": "..."`, `"do asr maus": "..."`, and `"do maus only": "..."`.

- [ ] **Step 6: Edit the update-notice text**

In `en.json` (`toasts.new update.body`, ~line 785) and `sv.json` (~line 733), the value lists "ASR, Word Alignment, Trimming" (English) / "taligenkänning, ordjustering, beskärning" (Swedish) as processes that must not be running during an update. Edit the sentence to drop the ASR/word-alignment items, keeping "Trimming"/"beskärning" and the rest of the sentence structure intact — read the full current sentence in each file first and make the minimal edit (don't rewrite the whole sentence). Check `de`/`it`/`ko`/`nl`/`zh.json` for the same `toasts.new update.body` (or equivalent) key with an ASR/MAUS mention — if present, apply the same trim; if the key doesn't mention ASR in that language, leave it alone.

- [ ] **Step 7: Point `error-occurred.component.html` at the new key**

If not already done in Task 9: change `{{ 'asr.error' | transloco }}` to `{{ 'alerts.error occurred' | transloco }}`.

- [ ] **Step 8: Validate every file is still valid JSON**

```bash
for f in apps/tratt/src/assets/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" && echo "$f OK"; done
```

- [ ] **Step 9: Build, run, and spot-check**

```bash
npx nx build tratt
```
Grep to confirm no leftover ASR i18n keys or `'asr.` transloco references anywhere in the app:
```bash
grep -rn "'asr\.\|\"asr\." apps/tratt/src --include=*.ts --include=*.html
```

- [ ] **Step 10: Commit**

```bash
git add apps/tratt/src/assets/i18n apps/tratt/src/app/core/alerts/error-occurred
git commit -m "refactor(i18n): remove legacy ASR/MAUS translation keys"
```

---

### Task 13: Update `docs/manual/` (English and Swedish) to remove every mention

**Files:**
- Modify: `docs/manual/privacy.md`
- Modify: `docs/manual/sv/privacy.md`
- Modify: `docs/manual/shortcuts.md`
- Modify: `docs/manual/sv/shortcuts.md`
- Modify: `docs/manual/coming-from-octra.md`
- Modify: `docs/manual/sv/coming-from-octra.md`
- Modify: `docs/manual/glossary.md`
- Modify: `docs/manual/sv/glossary.md`
- Modify: `docs/manual/CONTRIBUTING.md`

**Interfaces:** none — pure prose edits.

**Do not touch:** `docs/manual/index.md` / `sv/index.md` (their CLARIN/OCTRA-manual links are general attribution, not ASR-specific), `docs/manual/the-editors.md`, `using-tools.md`, `transcribing.md`, `troubleshooting.md` (+ `sv/` counterparts) — confirmed by full-text investigation to contain no legacy-ASR content, and `docs/manual/automatic-transcription.md` (+ `sv/`) — the unrelated local Whisper feature.

- [ ] **Step 1: `privacy.md` / `sv/privacy.md`**

Delete the section "## The one exception to be aware of" (en, ~lines 46-60) / "## Det enda undantaget" (sv, ~lines 46-61) in full — it exists solely to describe the cloud ASR/word-alignment privacy exception. After deleting, read the surrounding headings to confirm the document still flows (e.g. check whether a preceding sentence like "...with one exception, described below" needs to be adjusted since the exception section is gone).

- [ ] **Step 2: `shortcuts.md` / `sv/shortcuts.md`**

Delete the section "### Cloud speech recognition (usually inactive)" (en, ~lines 52-67) / "### Molnbaserad taligenkänning: normalt inaktiv" (sv, ~lines 52-67) in full, including the R/M/W shortcut table rows and the explanatory paragraph.

- [ ] **Step 3: `coming-from-octra.md` / `sv/coming-from-octra.md`**

Delete the paragraph "**Cloud ASR and MAUS word alignment.**" (en, ~lines 35-39) / "**Moln-ASR och MAUS-ordanpassning.**" (sv, ~lines 36-40) in full.

- [ ] **Step 4: `glossary.md` / `sv/glossary.md`**

Delete the `**ASR**` glossary entry (en ~line 21, sv ~line 22) and the `**MAUS**` glossary entry (en ~line 28, sv ~line 29). Leave the Diarization/Whisper/KB-Whisper/WebGPU/WASM entries untouched (local-Whisper feature).

- [ ] **Step 5: `CONTRIBUTING.md`**

Remove the bullet mentioning "cloud ASR keys that do nothing" (~line 36, part of a list of example documented failure-states — remove just that example, keep the rest of the bullet list and its surrounding sentence).

Remove the table row "Whether cloud ASR is configured | `tratt.plugins.asr` in `apps/tratt/src/config/appconfig.json`" (~line 140, under "Facts that will go out of date") — this row is now doubly stale since `tratt.plugins.asr` no longer exists in the schema (Task 4).

- [ ] **Step 6: Repo-wide doc sweep**

```bash
grep -rniE "\basr\b|\bmaus\b|cloud asr|word.alignment|bas asr" docs/manual
```
Confirm zero remaining hits. If anything surfaces outside the files above, read it in context and remove it following the same pattern (delete the ASR-specific sentence/section; don't touch surrounding unrelated content).

- [ ] **Step 7: Commit**

```bash
git add docs/manual
git commit -m "docs(manual): remove all mentions of the legacy cloud ASR/MAUS feature"
```

---

### Task 14: Final verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full build**

```bash
npx nx run-many --target=build --projects=tratt,ngx-components,annotation,utilities,assets
```

- [ ] **Step 2: Full lint**

```bash
npx nx run-many --target=lint --all
```

- [ ] **Step 3: Full test suite**

```bash
npx nx run-many --target=test --all
```

- [ ] **Step 4: Repo-wide grep for stragglers**

```bash
grep -rniE "\basr\b|\bmaus\b|asrqueue|asroptions|asrstoreservice|asrcontext" \
  apps/tratt/src libs docs/manual \
  --include=*.ts --include=*.html --include=*.scss --include=*.json --include=*.md \
  | grep -viE "local-transcription|whisper-transcription|auto-transcribe-options|automatic-transcription\.md"
```
Expected output: empty. Anything that shows up here is a leftover to clean up before this plan is considered done.

- [ ] **Step 5: Manual smoke test**

Run the app (`npm start`), open a project, load a segment level, and confirm: no "ASR options" entry in the settings/preferences dialog, no ASR dropdown in the segment editor's context menu, `R`/`M`/`W` keys do nothing (or are simply unbound — check they're no longer listed in the in-app Shortcuts window), the local Whisper "Auto-transcribe" flow on the drop-zone page still works exactly as before.

- [ ] **Step 6: Final commit (if any straggler fixes were needed)**

```bash
git add -A
git commit -m "chore: final cleanup pass after legacy ASR removal"
```

# Workbench Step 6 — Continuous Ingestion, Empty-Only Auto-Run, Compact Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/workbench`'s one-shot "drop files → click Start" gesture with continuous ingestion (every dropped file becomes a bundle immediately, auto-enqueuing into the pipeline if a bundle's transcript is empty and pipeline config is set), move the bundle list above the upload/record tabs, shrink the dropzone, and consolidate pipeline configuration into one always-visible compact panel.

**Architecture:** `WorkbenchComponent` subscribes to `TrattDropzoneService.filesChange` (via the existing `dropzone.filesAdded` output) once its `@ViewChild` resolves. The first newly-valid audio file(s) seen this visit run through the existing, unmodified `AuthenticationStoreService.loginLocal()` → `onLoginLocal$` login/bootstrap chain exactly once ("first wave"); every later file dispatches `LoginModeActions.createBundle` directly, bypassing that chain entirely ("later wave"). Both waves remove their own consumed row from the dropzone's pending list via a new narrow `consumeEntry(id)` (never touching rows still mid-decode), and both register the newly-created bundle id for a one-shot auto-enqueue attempt that fires, via a reactive `effect()`, once that bundle's `sessionFile`/`transcript` have actually landed in the store (closing a race the design doc's own architecture section left unresolved — see Task 6's note).

**Tech Stack:** Angular 19 (standalone components, signals), NgRx (`@ngrx/store`, `@ngrx/entity`), Jest.

**Spec:** `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md`, section "Step 6 design (2026-10-01) — continuous ingestion, empty-only auto-run, compact layout" (the file's most recently appended section).

## Global Constraints

- Zero behaviour change to `/local` (`login.component.html`'s own `<tratt-dropzone>` mount, and `AutoTranscribeOptionsComponent`/`AutoTranslateOptionsComponent`'s default `compact=false` rendering) — every new input defaults to today's behaviour.
- Never overwrite or inject over existing annotation data: a bundle only ever auto-enqueues when its transcript is empty (zero items across every level) — this is a binary per-bundle check, not per-stage; no new `PipelineRunnerService` entry point is built in this plan.
- The LOCAL login/session-bootstrap chain (`AuthenticationStoreService.loginLocal()` → `onLoginLocal$`) must fire **exactly once** per workbench visit — never re-triggered per background file.
- `TrattDropzoneService.reset()`'s "all files" shape must not be used for continuous ingestion — any row still mid-decode when another row validates must survive untouched (see Review Focus #1).
- No cryptographic/content hashing, no new Dexie schema, no full-state batch export/import, no per-stage (diarization/translation-only) reprocessing — all explicitly out of scope per the spec.

## Review Focus

- **Two files dropped together, decoded sequentially:** file 1 validates and triggers the first-wave bootstrap while file 2 is still mid-decode. If the bootstrap clears the dropzone's entire pending list (as `reset()` does), file 2's `FileProgress` is orphaned — its decode completes but is never emitted again and its `AudioManager` is never registered anywhere. Task 6 uses per-id `consumeEntry()` (never `reset()`) in both waves specifically to prevent this; its own test must actually exercise the two-files-one-still-decoding sequence, not just two already-valid entries.
- **A restored/imported bundle whose transcript already has content must never be silently auto-enqueued or offered for "run all"**, even once its audio becomes resident mid-session. Covered by Task 3's `computeReadyBundleIds` exclusion test.
- **A later-wave bundle must never steal the user's current bundle selection** — `createBundle`'s reducer defaults `selectAfterCreate` to `true` for every existing call site (so `/local`'s multi-file batch effect is unaffected), and only the new per-file background path passes `false`. Covered by Task 2's reducer test and Task 6's "does not change `selectedBundleId`" test.
- **Auto-enqueue must not fire before a first-wave bundle's transcript has actually landed in the store** — the async `loginLocal.do` → `loginLocal.prepare` effect chain writes `sessionFile` and `transcript` together in one reducer case, but the dispatch that starts that chain returns before it resolves. Covered by Task 6's "does not enqueue before the bundle's sessionFile has landed, then does once it has" test.
- **Dropping "Auto-transcribe" to unchecked (clearing `queueOptions()`) between two drops must not auto-enqueue the second file.** Covered by Task 6's "does not auto-enqueue when no pipeline options are configured" test.

---

## File Structure

- `apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.service.ts` — add `consumeEntry(id)`.
- `apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.component.ts` — passthrough.
- `apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts` — `createBundle` gains `selectAfterCreate?`.
- `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts` — honour it.
- `apps/tratt/src/app/core/store/login-mode/annotation/annotation.selectors.ts` — `selectAllBundleSummaries` gains `hasAnnotationContent`.
- `apps/tratt/src/app/core/store/pipeline-queue/index.ts` — `BundleSummaryForQueue`/`computeReadyBundleIds` exclude it.
- `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts` — `compact` input.
- `apps/tratt/src/app/core/component/tratt-dropzone/auto-translate-options.component.ts` — `compact` input.
- `apps/tratt/src/app/core/pages/workbench/workbench.component.ts` — continuous ingestion + auto-enqueue.
- `apps/tratt/src/app/core/pages/workbench/workbench.component.html` — layout reorder, single persistent settings panel, Start button removed.
- Matching `.spec.ts` files for every item above that has one.

---

### Task 1: `TrattDropzoneService.consumeEntry(id)`

**Files:**
- Modify: `apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.service.ts`
- Modify: `apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.component.ts`
- Test: `apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.service.spec.ts`

**Interfaces:**
- Produces: `TrattDropzoneService.consumeEntry(id: number): void` — splices the one matching `FileProgress` out of `_files`, calls `updateStatistics()`. Deliberately does **not** call `stopFileProcessing()` (which would destroy the entry's `AudioManager`) and does **not** touch `_oaudiofile`/`_oannotation`. `TrattDropzoneComponent.consumeEntry(id: number): void` passes through to it.

- [ ] **Step 1: Write the failing test**

Add to `tratt-dropzone.service.spec.ts` (mirror the existing `add()`/`reset()` test setup already in that file for constructing the service and a fake decoded `File`):

```ts
describe('consumeEntry', () => {
  it('removes only the matching entry, leaving others (including still-decoding ones) untouched', () => {
    service.add(new File(['a'], 'a.wav', { type: 'audio/wav' }));
    service.add(new File(['b'], 'b.wav', { type: 'audio/wav' }));
    const [first, second] = service.files;

    service.consumeEntry(first.id);

    expect(service.files).toEqual([second]);
    expect(service.files.find((f) => f.id === first.id)).toBeUndefined();
  });

  it('does not destroy the consumed entry AudioManager', () => {
    service.add(new File(['a'], 'a.wav', { type: 'audio/wav' }));
    const [entry] = service.files;
    // decode is async in this spec's environment — see the file's existing
    // AudioManager.create mocking convention above for how `entry.audioManager`
    // becomes defined before this point.
    const destroySpy = entry.audioManager
      ? jest.spyOn(entry.audioManager, 'destroy')
      : undefined;

    service.consumeEntry(entry.id);

    expect(destroySpy).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown id', () => {
    service.add(new File(['a'], 'a.wav', { type: 'audio/wav' }));
    const before = service.files.length;

    service.consumeEntry(999999);

    expect(service.files.length).toBe(before);
  });
});
```

(If the existing spec file's `AudioManager.create` mock resolves synchronously, the `audioManager` property will already be set by the time `service.files` is read; follow whatever await/flush pattern the file's existing `readAudioFile`-exercising tests already use — do not invent a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tratt-dropzone.service.spec.ts -t consumeEntry`
Expected: FAIL with "service.consumeEntry is not a function"

- [ ] **Step 3: Implement `consumeEntry`**

In `tratt-dropzone.service.ts`, add right after `reset()`:

```ts
  /**
   * Removes exactly one entry from the pending list — the narrow, per-id
   * counterpart to reset()'s "clear everything" shape, used by continuous
   * ingestion (step 6) so a row still mid-decode is never collaterally
   * dropped when a DIFFERENT row finishes and gets consumed. Like reset(),
   * does NOT destroy the entry's AudioManager (already handed off to
   * AudioService by the caller) and does not touch _oaudiofile/_oannotation
   * — those are session-singular fields unrelated to any one entry.
   */
  consumeEntry(id: number): void {
    const index = this._files.findIndex((f) => f.id === id);
    if (index === -1) {
      return;
    }
    this._subscrManager.removeByTag(`fileProgress${id}`);
    this._files.splice(index, 1);
    this.updateStatistics();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tratt-dropzone.service.spec.ts -t consumeEntry`
Expected: PASS

- [ ] **Step 5: Add the component passthrough**

In `tratt-dropzone.component.ts`, add right after `public reset(): void { ... }`:

```ts
  /** Narrow per-id counterpart to reset() — see TrattDropzoneService.consumeEntry(). */
  public consumeEntry(id: number): void {
    this.trattDropzoneService.consumeEntry(id);
  }
```

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.service.ts apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.component.ts apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.service.spec.ts
git commit -m "feat(workbench): add TrattDropzoneService.consumeEntry for per-id removal"
```

---

### Task 2: `createBundle` gains `selectAfterCreate`

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts`
- Test: `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts` (create if it does not already cover `wrapAsLocalBundleCollectionReducer`'s `createBundle` case — check first with `grep -n "createBundle" apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts`; if a `describe('createBundle'...)` block already exists, extend it instead of creating a new file)

**Interfaces:**
- Produces: `LoginModeActions.createBundle` props gain `selectAfterCreate?: boolean`. Reducer behaviour: `selectedBundleId` is set to the new bundle's id when `selectAfterCreate` is `true` or omitted; left unchanged when `selectAfterCreate === false`.

- [ ] **Step 1: Write the failing test**

```ts
it('createBundle leaves selectedBundleId unchanged when selectAfterCreate is false', () => {
  const reducer = new LoginModeReducers(LoginMode.LOCAL).create() as ActionReducer<
    LocalBundleCollectionState,
    Action
  >;
  const seeded = reducer(undefined, { type: '@ngrx/store/init' } as Action);

  const result = reducer(
    seeded,
    LoginModeActions.createBundle({
      mode: LoginMode.LOCAL,
      bundleId: 'bundle-2',
      sessionFile: new SessionFile('b.wav', 1, new Date(), 'audio/wav'),
      selectAfterCreate: false,
    }),
  );

  expect(result.selectedBundleId).toBe(seeded.selectedBundleId);
  expect(result.bundles.entities['bundle-2']).toBeDefined();
});

it('createBundle still selects the new bundle when selectAfterCreate is omitted (existing behaviour)', () => {
  const reducer = new LoginModeReducers(LoginMode.LOCAL).create() as ActionReducer<
    LocalBundleCollectionState,
    Action
  >;
  const seeded = reducer(undefined, { type: '@ngrx/store/init' } as Action);

  const result = reducer(
    seeded,
    LoginModeActions.createBundle({
      mode: LoginMode.LOCAL,
      bundleId: 'bundle-2',
      sessionFile: new SessionFile('b.wav', 1, new Date(), 'audio/wav'),
    }),
  );

  expect(result.selectedBundleId).toBe('bundle-2');
});
```

Adjust the import list at the top of whichever spec file hosts this (`LoginModeReducers`, `LoginModeActions`, `LoginMode`, `LocalBundleCollectionState`, `SessionFile`, `Action`, `ActionReducer`) to match that file's existing conventions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest login-mode.reducer.spec.ts -t "selectAfterCreate"`
Expected: FAIL — `result.selectedBundleId` is `'bundle-2'` in the first test (today's unconditional-select behaviour).

- [ ] **Step 3: Add the prop**

In `login-mode.actions.ts`, change:

```ts
  static createBundle = createAction(
    'annotation Create bundle',
    props<{
      mode: LoginMode;
      bundleId: string;
      sessionFile: SessionFile;
      restoredOptions?: IIDBModeOptions;
      restoredAnnotation?: IAnnotJSON;
    }>(),
  );
```

to:

```ts
  static createBundle = createAction(
    'annotation Create bundle',
    props<{
      mode: LoginMode;
      bundleId: string;
      sessionFile: SessionFile;
      restoredOptions?: IIDBModeOptions;
      restoredAnnotation?: IAnnotJSON;
      /**
       * Whether creating this bundle also selects it. Defaults to `true` —
       * every existing call site (the multi-file loginLocal batch effect,
       * BundleRestoreEffects) keeps today's behaviour unchanged. Only
       * WorkbenchComponent's step-6 continuous-ingestion background path
       * passes `false`, so a file decoding quietly in the background never
       * steals focus from whatever bundle the user is actively editing.
       */
      selectAfterCreate?: boolean;
    }>(),
  );
```

- [ ] **Step 4: Honour it in the reducer**

In `login-mode.reducer.ts`, inside `wrapAsLocalBundleCollectionReducer`, change:

```ts
    if (action.type === LoginModeActions.createBundle.type) {
      const { bundleId, sessionFile, restoredOptions, restoredAnnotation } =
        action as ReturnType<typeof LoginModeActions.createBundle>;
      let entity: IdentifiedAnnotationState = {
        ...initialInner,
        bundleId,
        sessionFile,
      };
      if (restoredOptions) {
        for (const [name, value] of getProperties(restoredOptions)) {
          entity = {
            ...writeOptionToStore(entity, name, value),
            bundleId,
            sessionFile,
          };
        }
      }
      if (restoredAnnotation) {
        const deserializedAnnotation =
          OAnnotJSON.deserialize(restoredAnnotation);
        if (deserializedAnnotation) {
          entity = {
            ...entity,
            transcript: TrattAnnotation.deserialize(deserializedAnnotation),
          };
        }
      }
      return {
        ...state,
        bundles: localBundleAdapter.addOne(entity, state.bundles),
        selectedBundleId: bundleId,
      };
    }
```

to:

```ts
    if (action.type === LoginModeActions.createBundle.type) {
      const {
        bundleId,
        sessionFile,
        restoredOptions,
        restoredAnnotation,
        selectAfterCreate = true,
      } = action as ReturnType<typeof LoginModeActions.createBundle>;
      let entity: IdentifiedAnnotationState = {
        ...initialInner,
        bundleId,
        sessionFile,
      };
      if (restoredOptions) {
        for (const [name, value] of getProperties(restoredOptions)) {
          entity = {
            ...writeOptionToStore(entity, name, value),
            bundleId,
            sessionFile,
          };
        }
      }
      if (restoredAnnotation) {
        const deserializedAnnotation =
          OAnnotJSON.deserialize(restoredAnnotation);
        if (deserializedAnnotation) {
          entity = {
            ...entity,
            transcript: TrattAnnotation.deserialize(deserializedAnnotation),
          };
        }
      }
      return {
        ...state,
        bundles: localBundleAdapter.addOne(entity, state.bundles),
        selectedBundleId: selectAfterCreate ? bundleId : state.selectedBundleId,
      };
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest login-mode.reducer.spec.ts -t "selectAfterCreate"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts
git commit -m "feat(workbench): createBundle gains selectAfterCreate, default true"
```

---

### Task 3: `hasAnnotationContent` — exclude already-transcribed bundles from the pipeline

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.selectors.ts`
- Modify: `apps/tratt/src/app/core/store/pipeline-queue/index.ts`
- Test: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.selectors.spec.ts`
- Test: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.selectors.spec.ts`

**Interfaces:**
- Produces: `selectAllBundleSummaries` rows gain `hasAnnotationContent: boolean`. `BundleSummaryForQueue` gains the same field. `computeReadyBundleIds` excludes any summary where it is `true`, in addition to its existing `awaitingMedia`/run-state checks.
- Consumes: nothing new — `PipelineQueueService.readyBundleIds()`/`WorkbenchComponent.readyBundleIds` already pass `selectAllBundleSummaries()`'s rows straight through to `computeReadyBundleIds`, so they pick up the new field automatically once the selector produces it.

- [ ] **Step 1: Write the failing selector test**

In `annotation.selectors.spec.ts`, update the existing `describe('selectAllBundleSummaries', ...)` block's fixtures and expectations:

```ts
describe('selectAllBundleSummaries', () => {
  it('returns a summary per bundle with correct selected, awaitingMedia and hasAnnotationContent flags', () => {
    // bundleA: never had audio decoded this session (e.g. restored from IDB
    // at boot per step 2.8, Task 3) -> awaitingMedia true; no transcript at
    // all -> hasAnnotationContent false.
    const bundleA = {
      bundleId: 'bundle-a',
      sessionFile: new SessionFile('a.wav', 1, new Date(), 'audio/wav'),
      audio: { loaded: false },
    } as any;
    // bundleB: audio decoded this session -> awaitingMedia false; has a
    // non-empty transcript level -> hasAnnotationContent true.
    const bundleB = {
      bundleId: 'bundle-b',
      sessionFile: new SessionFile('b.wav', 2, new Date(), 'audio/wav'),
      audio: { loaded: true },
      transcript: { levels: [{ items: [{}] }] },
    } as any;
    const local = {
      bundles: localBundleAdapter.setAll(
        [bundleA, bundleB],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'bundle-b',
    };

    expect(selectAllBundleSummaries.projector(local)).toEqual([
      {
        bundleId: 'bundle-a',
        name: 'a.wav',
        selected: false,
        awaitingMedia: true,
        hasAnnotationContent: false,
      },
      {
        bundleId: 'bundle-b',
        name: 'b.wav',
        selected: true,
        awaitingMedia: false,
        hasAnnotationContent: true,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest annotation.selectors.spec.ts -t selectAllBundleSummaries`
Expected: FAIL — actual objects lack `hasAnnotationContent`.

- [ ] **Step 3: Implement the selector change**

In `annotation.selectors.ts`, change:

```ts
export const selectAllBundleSummaries = createSelector(
  selectLocalMode,
  (local) =>
    selectAllBundleEntities(local.bundles).map((b) => ({
      bundleId: b.bundleId,
      name: b.sessionFile?.name,
      selected: b.bundleId === local.selectedBundleId,
      awaitingMedia: !b.audio.loaded,
    })),
);
```

to:

```ts
export const selectAllBundleSummaries = createSelector(
  selectLocalMode,
  (local) =>
    selectAllBundleEntities(local.bundles).map((b) => ({
      bundleId: b.bundleId,
      name: b.sessionFile?.name,
      selected: b.bundleId === local.selectedBundleId,
      awaitingMedia: !b.audio.loaded,
      // Step 6: a bundle with any non-empty level is excluded from
      // auto-enqueue and "run all" — a fresh level's items default to an
      // empty array (TrattAnnotationSegmentLevel -> OLevel never seeds a
      // placeholder segment), so "zero items across every level" is an
      // exact, already-precedented definition of "empty".
      hasAnnotationContent: b.transcript?.levels?.some(
        (l) => l.items.length > 0,
      ) ?? false,
    })),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest annotation.selectors.spec.ts -t selectAllBundleSummaries`
Expected: PASS

- [ ] **Step 5: Write the failing `computeReadyBundleIds` test**

In `pipeline-queue.selectors.spec.ts`, add `hasAnnotationContent: false` to every existing fixture object in the `summaries` const and the two inline array literals (required once the field exists on the type), then add:

```ts
it('excludes a bundle whose transcript already has content, even when otherwise ready', () => {
  const ready = computeReadyBundleIds(
    [
      { bundleId: 'empty', awaitingMedia: false, hasAnnotationContent: false },
      {
        bundleId: 'already-transcribed',
        awaitingMedia: false,
        hasAnnotationContent: true,
      },
    ],
    {},
    () => true,
  );
  expect(ready).toEqual(['empty']);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest pipeline-queue.selectors.spec.ts -t "already has content"`
Expected: FAIL (or a TS compile error from the now-required field on the other fixtures — fix those first per Step 5's instruction, then this one fails on the actual assertion: `['empty', 'already-transcribed']`).

- [ ] **Step 7: Implement in `store/pipeline-queue/index.ts`**

Change:

```ts
export interface BundleSummaryForQueue {
  bundleId: string;
  awaitingMedia: boolean;
}
```

to:

```ts
export interface BundleSummaryForQueue {
  bundleId: string;
  awaitingMedia: boolean;
  /** Step 6: a bundle with any transcript content is never auto-run or offered for "run all". */
  hasAnnotationContent: boolean;
}
```

and change `computeReadyBundleIds`'s filter body from:

```ts
    .filter((summary) => {
      if (summary.awaitingMedia && !isResident(summary.bundleId)) {
        return false;
      }
      const state = runStatusOf(runs, summary.bundleId).state;
      return state !== 'queued' && state !== 'running' && state !== 'done';
    })
```

to:

```ts
    .filter((summary) => {
      if (summary.hasAnnotationContent) {
        return false;
      }
      if (summary.awaitingMedia && !isResident(summary.bundleId)) {
        return false;
      }
      const state = runStatusOf(runs, summary.bundleId).state;
      return state !== 'queued' && state !== 'running' && state !== 'done';
    })
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest pipeline-queue.selectors.spec.ts annotation.selectors.spec.ts`
Expected: PASS, including every pre-existing test in both files (confirms the fixture updates in Step 5 didn't break anything else).

- [ ] **Step 9: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation.selectors.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation.selectors.spec.ts apps/tratt/src/app/core/store/pipeline-queue/index.ts apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.selectors.spec.ts
git commit -m "feat(workbench): exclude already-transcribed bundles from the pipeline queue"
```

---

### Task 4: `AutoTranscribeOptionsComponent` compact mode

**Files:**
- Modify: `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts`
- Test: `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.spec.ts`

**Interfaces:**
- Produces: `compact = input<boolean>(false)`. When `true`: every decorative `<small>` hint is suppressed (requires-internet, the three per-language fine-tuned-model hints, the no-webgpu warning, speaker-separation help, speaker-count help); the per-model radio label becomes `"<Titlecase key> (~<sizeMb> MB)"` instead of the full i18n comparative sentence. The Safari warning and the "model cached after download" hint are **not** suppressed in compact mode (the former is a hard constraint, the latter is deliberately kept per the spec's own line-range list). Default `false` keeps `/local`'s `login.component.html` mount byte-identical.

- [ ] **Step 1: Write the failing test**

Check first whether `auto-transcribe-options.component.spec.ts` exists and what TestBed/harness pattern it already uses (`grep -n "TestBed\|describe(" apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.spec.ts`); add to it in that same style:

```ts
it('suppresses decorative hints and uses the short model label in compact mode', () => {
  fixture.componentRef.setInput('compact', true);
  fixture.componentRef.setInput('audioLoaded', true);
  component.enabled.set(true);
  fixture.detectChanges();

  const text = fixture.nativeElement.textContent as string;
  expect(text).not.toContain('login.auto-transcription.requires internet');
  expect(text).not.toContain('login.auto-transcription.no webgpu');
  expect(text).not.toContain(
    'login.auto-transcription.speaker separation help',
  );
  expect(text).not.toContain('login.auto-transcription.speaker count help');
  // kept even in compact mode:
  expect(text).toContain(
    'login.auto-transcription.model cached after download',
  );
  expect(text).toMatch(/Medium \(~\d+ MB\)/);
});

it('renders the full i18n label (not the short one) when compact is false', () => {
  fixture.componentRef.setInput('compact', false);
  fixture.componentRef.setInput('audioLoaded', true);
  component.enabled.set(true);
  fixture.detectChanges();

  expect(fixture.nativeElement.textContent as string).not.toMatch(
    /Medium \(~\d+ MB\)/,
  );
});
```

(Use whatever stub `TranslocoService` the existing spec file already provides — this component's own `translate()` calls must resolve to the raw key strings the same way other tests in this file already assert, per the `toContain('login.auto-transcription...')` pattern above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest auto-transcribe-options.component.spec.ts -t "compact mode"`
Expected: FAIL — `compact` input does not exist yet (compile error) or the hints still render.

- [ ] **Step 3: Add the input and helper**

In `auto-transcribe-options.component.ts`, add alongside `idPrefix`:

```ts
  /**
   * Step 6: suppresses decorative `<small>` hints and swaps the per-model
   * label for a short "<Name> (~<size> MB)" form, for /workbench's narrow
   * persistent settings panel. Default `false` keeps /local's full
   * descriptive copy unchanged.
   */
  readonly compact = input<boolean>(false);
```

and add a new method near `emitChange()`:

```ts
  modelLabel(model: KbWhisperModel): string {
    if (!this.compact()) {
      return this.transloco.translate(
        this.hasWebGpu() && model.hasWebgpuVariant
          ? `login.auto-transcription.models.${model.i18nKey ?? model.key}.webgpu`
          : `login.auto-transcription.models.${model.i18nKey ?? model.key}.wasm`,
      );
    }
    const titlecased = model.key.charAt(0).toUpperCase() + model.key.slice(1);
    return `${titlecased} (~${model.sizeMb} MB)`;
  }
```

- [ ] **Step 4: Gate the hint blocks and swap the label in the template**

Change the requires-internet block:

```html
        @if (!isSafari()) {
          <small class="text-muted d-block mb-2">
            <i class="bi bi-cloud-download"></i>
            {{ 'login.auto-transcription.requires internet' | transloco }}
          </small>
        }
```

to:

```html
        @if (!isSafari() && !compact()) {
          <small class="text-muted d-block mb-2">
            <i class="bi bi-cloud-download"></i>
            {{ 'login.auto-transcription.requires internet' | transloco }}
          </small>
        }
```

Change the model-label line inside the `@for (model of models; ...)` block from:

```html
                  {{
                    (hasWebGpu() && model.hasWebgpuVariant
                      ? 'login.auto-transcription.models.' +
                        (model.i18nKey ?? model.key) +
                        '.webgpu'
                      : 'login.auto-transcription.models.' +
                        (model.i18nKey ?? model.key) +
                        '.wasm'
                    ) | transloco
                  }}
```

to:

```html
                  {{ modelLabel(model) }}
```

Wrap the per-language hints and the no-webgpu warning (the contiguous block from the Swedish hint through the no-webgpu `<small>`) in one `@if (!compact())`:

```html
            @if (!compact()) {
              @if (selectedLanguage === 'sv') {
                <small class="text-muted d-block mt-1">
                  <i class="bi bi-info-circle"></i>
                  {{
                    'login.auto-transcription.swedish kb-whisper hint' | transloco
                  }}
                </small>
              }
              @if (selectedLanguage === 'fi') {
                <small class="text-muted d-block mt-1">
                  <i class="bi bi-info-circle"></i>
                  {{
                    'login.auto-transcription.finnish fine-tuned hint' | transloco
                  }}
                </small>
              }
              @if (selectedLanguage === 'no' || selectedLanguage === 'nn') {
                <small class="text-muted d-block mt-1">
                  <i class="bi bi-info-circle"></i>
                  {{
                    'login.auto-transcription.norwegian fine-tuned hint'
                      | transloco
                  }}
                </small>
              }

              @if (!hasWebGpu()) {
                <small class="text-muted">
                  <i class="bi bi-exclamation-triangle"></i>
                  {{ 'login.auto-transcription.no webgpu' | transloco }}
                </small>
              }
            }
```

Wrap the speaker-separation help `<small>` in `@if (!compact())`:

```html
            @if (!compact()) {
              <small class="text-muted d-block mt-1">
                {{
                  'login.auto-transcription.speaker separation help' | transloco
                }}
              </small>
            }
```

Wrap the speaker-count help `<small>` (inside the `@if (speakerSegmentationEnabled)` block) in `@if (!compact())`:

```html
                @if (!compact()) {
                  <small class="text-muted d-block mt-1">
                    {{
                      'login.auto-transcription.speaker count help' | transloco
                    }}
                  </small>
                }
```

Leave the Safari warning block and the "model cached after download" `<small>` untouched.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest auto-transcribe-options.component.spec.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.spec.ts
git commit -m "feat(workbench): compact mode for AutoTranscribeOptionsComponent"
```

---

### Task 5: `AutoTranslateOptionsComponent` compact mode

**Files:**
- Modify: `apps/tratt/src/app/core/component/tratt-dropzone/auto-translate-options.component.ts`
- Test: `apps/tratt/src/app/core/component/tratt-dropzone/auto-translate-options.component.spec.ts`

**Interfaces:**
- Produces: `compact = input<boolean>(false)`, suppressing only the "model cached after download" hint (mirroring the one purely-decorative, non-status hint `AutoTranscribeOptionsComponent` also keeps vs. suppresses is a judgement call documented inline — see the code comment below). The availability-path messages (direct/pivot/unavailable/probing) are **not** suppressed — they are load-bearing status, not decoration, the same reasoning that keeps the Safari warning visible in the sibling component.

**Ruling (recorded here since the spec names this component for `compact` without giving line numbers, unlike its sibling):** only the caching hint is decorative in this component; everything else is either a form control or a status message the user needs to judge whether translation will run at all.

- [ ] **Step 1: Write the failing test**

```ts
it('suppresses the caching hint but keeps availability status in compact mode', () => {
  fixture.componentRef.setInput('compact', true);
  fixture.componentRef.setInput('transcribeWillRun', true);
  component.enabled.set(true);
  component['availabilityKind'].set('direct');
  fixture.detectChanges();

  const text = fixture.nativeElement.textContent as string;
  expect(text).not.toContain('login.translation.model cached after download');
  expect(text).toContain('login.translation.path direct');
});
```

(Match whatever existing pattern this spec file already uses to drive `availabilityKind`/`enabled` — if they are not reachable as shown, use the same setup the file's existing "shows the direct path message" test already uses, and extend it with the `compact` input instead.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest auto-translate-options.component.spec.ts -t "compact mode"`
Expected: FAIL — `compact` input does not exist.

- [ ] **Step 3: Add the input and gate the template**

In `auto-translate-options.component.ts`, add alongside `annotationAlreadyLoaded`:

```ts
  /**
   * Step 6: suppresses the "model cached after download" hint for
   * /workbench's narrow persistent settings panel. The availability-path
   * messages (direct/pivot/unavailable/probing) are NOT gated by this —
   * they are load-bearing status the user needs to judge whether
   * translation will work, the same reasoning AutoTranscribeOptionsComponent
   * applies to its own Safari warning. Default `false` keeps /local's mount
   * unchanged.
   */
  readonly compact = input<boolean>(false);
```

Change:

```html
          <small class="text-muted mt-1 d-block">
            <i class="bi bi-info-circle"></i>
            {{ 'login.translation.model cached after download' | transloco }}
          </small>
```

to:

```html
          @if (!compact()) {
            <small class="text-muted mt-1 d-block">
              <i class="bi bi-info-circle"></i>
              {{ 'login.translation.model cached after download' | transloco }}
            </small>
          }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest auto-translate-options.component.spec.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/component/tratt-dropzone/auto-translate-options.component.ts apps/tratt/src/app/core/component/tratt-dropzone/auto-translate-options.component.spec.ts
git commit -m "feat(workbench): compact mode for AutoTranslateOptionsComponent"
```

---

### Task 6: `WorkbenchComponent` — continuous ingestion and one-shot auto-enqueue

**Files:**
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts`

**Interfaces:**
- Consumes: `TrattDropzoneComponent.filesAdded: EventEmitter<{statistics: DropzoneStatistics; addedFiles: FileProgress[]}>`, `.consumeEntry(id: number): void` (Task 1), `LoginModeActions.createBundle({..., selectAfterCreate: false})` (Task 2), `selectAllBundleSummaries()`'s `hasAnnotationContent` (Task 3, consumed transitively via `computeReadyBundleIds`/`PipelineQueueService.enqueue`).
- Produces: `WorkbenchComponent` implements `AfterViewInit`. Public `startSession(removeData: boolean)` is **removed** (replaced by private `runFirstWave`/`runLaterWave`, invoked only from the new `filesAdded` subscription). `sessionStarting` field is **removed** (its sole consumer, the Start button, is removed in Task 7). New `onQueueTranslateOptionsChange(options: TranslationOptions | null): void` and `queueTranslateOptions = signal<TranslationOptions | null>(null)` (Task 7's template wires this).

> **Design-doc gap this task resolves:** the spec's "Decisions locked in" says "a newly-created bundle auto-enqueues into the pipeline immediately if config is set," but its own "Architecture" section never describes the trigger. A naive `pipelineQueueService.enqueue([bundleId])` call placed right after `authStoreService.loginLocal(...)` (first wave) would race the async `loginLocal.do → loginLocal.prepare` effect chain that actually writes that bundle's `sessionFile`/`transcript` — enqueuing before an imported annotation (if any) has landed would defeat Task 3's `hasAnnotationContent` exclusion for exactly the case it exists to protect. This task closes that gap with a one-shot, per-bundle-id pending set resolved reactively off `selectAllBundleSummaries()` (whose `name` field only becomes defined once that bundle's `sessionFile` — and, in the same reducer case, its `transcript` — have actually been written), used uniformly for both the first-wave (async) and later-wave (synchronous) paths.

- [ ] **Step 1: Update the test file's `TrattDropzoneComponent` mock and `Store` stub**

In `workbench.component.spec.ts`, change the `jest.mock('../../component/tratt-dropzone/tratt-dropzone.component', ...)` factory from:

```ts
jest.mock('../../component/tratt-dropzone/tratt-dropzone.component', () => {
  const { Component, Input } = require('@angular/core');
  @Component({ selector: 'tratt-dropzone', template: '' })
  class TrattDropzoneComponent {
    @Input() showAutoTranscribe = false;
    @Input() allowMultipleAudio = false;
  }
  return { TrattDropzoneComponent };
});
```

to:

```ts
jest.mock('../../component/tratt-dropzone/tratt-dropzone.component', () => {
  const { Component, EventEmitter, Input, Output } = require('@angular/core');
  @Component({ selector: 'tratt-dropzone', template: '' })
  class TrattDropzoneComponent {
    @Input() allowMultipleAudio = false;
    @Output() filesAdded = new EventEmitter();
    hasAnnotation = false;
    oannotation = undefined;
    reset() {}
    consumeEntry(_id: number) {}
    addFile(_file: File) {}
  }
  return { TrattDropzoneComponent };
});
```

(`showAutoTranscribe` is dropped from the mock because Task 7 removes the binding from the real template — see that task.)

Add a `dispatch: jest.fn()` to the top-level `describe('WorkbenchComponent', ...)` block's `Store` provider `useValue` (needed by the new `runLaterWave`'s `store.dispatch(...)` call):

```ts
        {
          provide: Store,
          useValue: {
            dispatch: jest.fn(),
            selectSignal: (selector: unknown) => {
              if (selector === selectAllBundleSummaries) {
                return () => bundleSummaries;
              }
              if (selector === selectQueueMode) {
                return () => queueMode;
              }
              if (selector === selectAllRunStatuses) {
                return () => runStatuses;
              }
              return () => undefined;
            },
          },
        },
```

Keep a reference to this mock's `dispatch` in the outer scope (same pattern as `audioService`/`authStoreService`) by capturing it in a new `let storeDispatch: jest.Mock;` assigned inside `beforeEach` alongside the `Store` provider's `dispatch: (storeDispatch = jest.fn())`.

- [ ] **Step 2: Delete the now-obsolete `sessionStarting` tests and rewrite the direct `startSession()` tests as `filesAdded`-driven ones**

Delete the entire `describe('sessionStarting reset', ...)` block (and its preceding "Finding 3" comment) — the field it tests no longer exists.

Replace the three existing tests that call `component.startSession(false)` directly (`'registers the dropzone audio manager and calls loginLocal on startSession'`, `'does nothing when the dropzone has no valid audio entries'`, `'registers a distinct bundle id per dropped audio file and passes them all to loginLocal'`) with the following, which exercise the real `ngAfterViewInit` + `filesAdded` subscription instead:

```ts
function fileProgress(
  id: number,
  file: File,
  overrides: Partial<{ status: 'valid' | 'progress'; audioManager: any; oaudiofile: any }> = {},
) {
  return {
    id,
    status: overrides.status ?? 'progress',
    checked_converters: 0,
    progress: 1,
    file: { file, fullname: file.name, type: file.type, size: file.size },
    audioManager: overrides.audioManager,
    oaudiofile: overrides.oaudiofile,
  } as any;
}

describe('continuous ingestion (step 6)', () => {
  function makeDropzone() {
    return {
      filesAdded: new EventEmitter<any>(),
      hasAnnotation: false,
      oannotation: undefined,
      reset: jest.fn(),
      consumeEntry: jest.fn(),
      addFile: jest.fn(),
    };
  }

  it('bootstraps via loginLocal on the first valid file and consumes just that entry', () => {
    component.dropzone = makeDropzone() as any;
    component.ngAfterViewInit();

    const manager = { id: 'm1' } as any;
    const nativeFile = new File(['a'], 'a.wav');
    const fp = fileProgress(1, nativeFile, {
      status: 'valid',
      audioManager: manager,
      oaudiofile: {},
    });

    component.dropzone!.filesAdded.emit({ statistics: {} as any, addedFiles: [fp] });

    expect(audioService.registerAudioManager).toHaveBeenCalledWith(
      DEFAULT_BUNDLE_ID,
      manager,
      nativeFile,
    );
    expect(authStoreService.loginLocal).toHaveBeenCalledWith(
      [nativeFile],
      undefined,
      false,
      [DEFAULT_BUNDLE_ID],
    );
    expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
    expect(component.dropzone!.reset).not.toHaveBeenCalled();
  });

  it('does nothing when no file has validated yet', () => {
    component.dropzone = makeDropzone() as any;
    component.ngAfterViewInit();

    component.dropzone!.filesAdded.emit({
      statistics: {} as any,
      addedFiles: [fileProgress(1, new File(['a'], 'a.wav'), { status: 'progress' })],
    });

    expect(audioService.registerAudioManager).not.toHaveBeenCalled();
    expect(authStoreService.loginLocal).not.toHaveBeenCalled();
  });

  it('routes every file after the first through createBundle directly, not loginLocal', () => {
    component.dropzone = makeDropzone() as any;
    component.ngAfterViewInit();

    const file1 = new File(['a'], 'a.wav');
    const file2 = new File(['b'], 'b.wav');
    component.dropzone!.filesAdded.emit({
      statistics: {} as any,
      addedFiles: [
        fileProgress(1, file1, { status: 'valid', audioManager: {} as any, oaudiofile: {} }),
      ],
    });
    authStoreService.loginLocal.mockClear();

    const manager2 = { id: 'm2' } as any;
    component.dropzone!.filesAdded.emit({
      statistics: {} as any,
      addedFiles: [
        fileProgress(1, file1, { status: 'valid', audioManager: {} as any, oaudiofile: {} }),
        fileProgress(2, file2, { status: 'valid', audioManager: manager2, oaudiofile: {} }),
      ],
    });

    expect(authStoreService.loginLocal).not.toHaveBeenCalled();
    expect(audioService.registerAudioManager).toHaveBeenCalledWith(
      expect.any(String),
      manager2,
      file2,
    );
    expect(storeDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LoginModeActions.createBundle.type,
        selectAfterCreate: false,
      }),
    );
    expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(2);
  });

  // Review Focus #1: a file still mid-decode when a DIFFERENT file's
  // first-wave bootstrap fires must not be orphaned.
  it('does not consume or lose an entry that is still decoding when the first wave fires for an earlier entry', () => {
    component.dropzone = makeDropzone() as any;
    component.ngAfterViewInit();

    const file1 = new File(['a'], 'a.wav');
    const stillDecoding = fileProgress(2, new File(['b'], 'b.wav'), {
      status: 'progress',
    });
    component.dropzone!.filesAdded.emit({
      statistics: {} as any,
      addedFiles: [
        fileProgress(1, file1, { status: 'valid', audioManager: {} as any, oaudiofile: {} }),
        stillDecoding,
      ],
    });

    // Only the valid entry (id 1) was consumed — id 2 was left alone.
    expect(component.dropzone!.consumeEntry).toHaveBeenCalledTimes(1);
    expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
    expect(component.dropzone!.reset).not.toHaveBeenCalled();

    // id 2 finishing later still reaches the later-wave path correctly.
    const manager2 = { id: 'm2' } as any;
    stillDecoding.status = 'valid';
    stillDecoding.audioManager = manager2;
    stillDecoding.oaudiofile = {};
    component.dropzone!.filesAdded.emit({
      statistics: {} as any,
      addedFiles: [stillDecoding],
    });

    expect(audioService.registerAudioManager).toHaveBeenCalledWith(
      expect.any(String),
      manager2,
      stillDecoding.file.file,
    );
    expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(2);
  });

  it('ignores a repeat emission for an already-ingested id', () => {
    component.dropzone = makeDropzone() as any;
    component.ngAfterViewInit();
    const fp = fileProgress(1, new File(['a'], 'a.wav'), {
      status: 'valid',
      audioManager: {} as any,
      oaudiofile: {},
    });
    component.dropzone!.filesAdded.emit({ statistics: {} as any, addedFiles: [fp] });
    authStoreService.loginLocal.mockClear();
    audioService.registerAudioManager.mockClear();

    component.dropzone!.filesAdded.emit({ statistics: {} as any, addedFiles: [fp] });

    expect(authStoreService.loginLocal).not.toHaveBeenCalled();
    expect(audioService.registerAudioManager).not.toHaveBeenCalled();
  });
});

describe('auto-enqueue on bundle creation (step 6)', () => {
  function makeDropzone() {
    return {
      filesAdded: new EventEmitter<any>(),
      hasAnnotation: false,
      oannotation: undefined,
      reset: jest.fn(),
      consumeEntry: jest.fn(),
      addFile: jest.fn(),
    };
  }

  it('does not enqueue before the first-wave bundle has landed in the store, then does once it has', () => {
    component.dropzone = makeDropzone() as any;
    component.ngAfterViewInit();
    component.onQueueOptionsChange({ modelId: 'm', useWebGPU: false } as any);

    component.dropzone!.filesAdded.emit({
      statistics: {} as any,
      addedFiles: [
        fileProgress(1, new File(['a'], 'a.wav'), {
          status: 'valid',
          audioManager: {} as any,
          oaudiofile: {},
        }),
      ],
    });
    // Store hasn't actually written the bundle's sessionFile yet (loginLocal
    // is async) — bundleSummaries still only shows the empty default.
    expect(pipelineQueueService.enqueue).not.toHaveBeenCalled();

    // The async chain lands: selectAllBundleSummaries now shows this bundle
    // with a defined name.
    bundleSummaries = [
      {
        bundleId: DEFAULT_BUNDLE_ID,
        name: 'a.wav',
        selected: true,
        awaitingMedia: false,
        hasAnnotationContent: false,
      },
    ];
    fixture.detectChanges();

    expect(pipelineQueueService.enqueue).toHaveBeenCalledWith([DEFAULT_BUNDLE_ID]);
  });

  it('does not auto-enqueue when no pipeline options are configured', () => {
    component.dropzone = makeDropzone() as any;
    component.ngAfterViewInit();
    // queueOptions() left at its default null — no onQueueOptionsChange call.

    component.dropzone!.filesAdded.emit({
      statistics: {} as any,
      addedFiles: [
        fileProgress(1, new File(['a'], 'a.wav'), {
          status: 'valid',
          audioManager: {} as any,
          oaudiofile: {},
        }),
      ],
    });
    bundleSummaries = [
      {
        bundleId: DEFAULT_BUNDLE_ID,
        name: 'a.wav',
        selected: true,
        awaitingMedia: false,
        hasAnnotationContent: false,
      },
    ];
    fixture.detectChanges();

    expect(pipelineQueueService.enqueue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify the new/changed ones fail**

Run: `npx jest workbench.component.spec.ts -t "continuous ingestion"`
Run: `npx jest workbench.component.spec.ts -t "auto-enqueue"`
Expected: FAIL — `ngAfterViewInit` does not exist yet; `LoginModeActions` not imported in the spec file yet (add the import alongside the other store imports at the top of the spec file: `import { LoginModeActions } from '../../store/login-mode/login-mode.actions';`).

- [ ] **Step 4: Implement in `workbench.component.ts`**

Add to the imports at the top:

```ts
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ComponentRef,
  computed,
  effect,
  OnDestroy,
  OnInit,
  signal,
  Type,
  ViewChild,
} from '@angular/core';
```

```ts
import { FileProgress } from '../../obj/objects';
import { SessionFile } from '../../obj/SessionFile';
import { normalizeMimeType } from '@tratt/web-media';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { TranslationOptions } from '../../shared/service/local-translation.service';
import { DropzoneStatistics } from '../../component/tratt-dropzone/tratt-dropzone.service';
```

Change the class signature:

```ts
export class WorkbenchComponent
  extends DefaultComponent
  implements OnInit, AfterViewInit, OnDestroy
{
```

Remove the `sessionStarting = false;` field (keep `sessionReady = false;`).

In `ngOnInit()`'s `loading$` subscription callback, remove this block entirely:

```ts
        if (
          loading?.status === LoadingStatus.FINISHED ||
          loading?.status === LoadingStatus.FAILED
        ) {
          this.sessionStarting = false;
        }
```

Add new fields (near `queueOptions`):

```ts
  /**
   * Step 6: one-shot queueing for a brand-new translation config panel —
   * captured for UI consistency with the dropzone's pre-step-6 pairing, but
   * NOT forwarded to PipelineQueueService: PipelineRunnerService.run() has
   * no entry point that accepts translateOptions yet (see the step 4 design
   * note in the spec — "/workbench has no translation configuration UI").
   * Wiring translation into the queue itself is separate, future work.
   */
  queueTranslateOptions = signal<TranslationOptions | null>(null);

  onQueueTranslateOptionsChange(options: TranslationOptions | null): void {
    this.queueTranslateOptions.set(options);
  }

  // Step 6 continuous ingestion bookkeeping.
  private ingestedIds = new Set<number>();
  private visitBootstrapped = false;
  // Bundle ids created this visit whose creation dispatch may still be
  // in flight (first wave only — later wave's createBundle dispatch is
  // synchronous) — see this task's own doc comment on the race it closes.
  private pendingAutoEnqueueIds = new Set<string>();
```

Add the auto-enqueue effect inside the constructor body, right after `super();`:

```ts
    // Step 6: fires once per pending bundle id, exactly when that bundle's
    // sessionFile (and, in the same reducer case, its transcript) have
    // actually landed in the store — see this task's doc comment above.
    effect(() => {
      if (this.pendingAutoEnqueueIds.size === 0) {
        return;
      }
      const summaries = this.bundleSummaries();
      const options = this.queueOptions();
      for (const summary of summaries) {
        if (
          this.pendingAutoEnqueueIds.has(summary.bundleId) &&
          summary.name !== undefined
        ) {
          this.pendingAutoEnqueueIds.delete(summary.bundleId);
          if (options !== null) {
            this.pipelineQueueService.enqueue([summary.bundleId]);
          }
        }
      }
    });
```

Add `ngAfterViewInit()` right after `ngOnInit()`:

```ts
  ngAfterViewInit(): void {
    if (!this.dropzone) {
      return;
    }
    this.subscribe(
      this.dropzone.filesAdded,
      (event: { statistics: DropzoneStatistics; addedFiles: FileProgress[] }) => {
        this.onFilesChanged(event.addedFiles);
      },
    );
  }

  private onFilesChanged(addedFiles: FileProgress[]): void {
    const newlyValid = addedFiles.filter(
      (f) =>
        f.status === 'valid' &&
        f.audioManager !== undefined &&
        f.oaudiofile !== undefined &&
        !this.ingestedIds.has(f.id),
    );
    if (newlyValid.length === 0) {
      return;
    }
    for (const f of newlyValid) {
      this.ingestedIds.add(f.id);
    }
    if (!this.visitBootstrapped) {
      this.visitBootstrapped = true;
      this.runFirstWave(newlyValid);
    } else {
      this.runLaterWave(newlyValid);
    }
  }
```

Replace the whole `startSession(removeData: boolean): void { ... }` method with:

```ts
  /**
   * The login/session-bootstrap chain (AuthenticationStoreService.loginLocal()
   * -> onLoginLocal$) must fire exactly once per workbench visit — see the
   * spec's own grounding fact 1. This is that one call, now driven by the
   * FIRST filesAdded emission containing at least one newly-valid audio
   * file, instead of a manual "Start session" click. Same batch shape as
   * before: entry 0 -> DEFAULT_BUNDLE_ID, the rest -> generateBundleId(),
   * all handed to one loginLocal() call so onLoginLocal$'s own multi-file
   * handling (entry 0 through the prepare/save-gate path, the rest via its
   * own createBundle loop) runs unchanged.
   *
   * Consumes each entry individually via consumeEntry() rather than
   * dropzone.reset() — reset() clears the ENTIRE pending list, which would
   * orphan any other file still mid-decode in the same drop gesture (see
   * this plan's Review Focus #1).
   */
  private runFirstWave(entries: FileProgress[]): void {
    const annotation = this.dropzone!.hasAnnotation
      ? this.dropzone!.oannotation
      : undefined;

    const audioBundleIds: string[] = [];
    const files: File[] = [];
    entries.forEach((entry, i) => {
      const bundleId = i === 0 ? DEFAULT_BUNDLE_ID : generateBundleId();
      const nativeFile = entry.file.file!;
      this.audioService.registerAudioManager(
        bundleId,
        entry.audioManager!,
        nativeFile,
      );
      audioBundleIds.push(bundleId);
      files.push(nativeFile);
    });

    this.authStoreService.loginLocal(files, annotation, false, audioBundleIds);
    for (const id of audioBundleIds) {
      this.pendingAutoEnqueueIds.add(id);
    }
    for (const entry of entries) {
      this.dropzone!.consumeEntry(entry.id);
    }
  }

  /**
   * Every file after the first-wave bootstrap: registers its AudioManager
   * and dispatches createBundle directly, with selectAfterCreate: false so
   * a file decoding in the background never steals focus from whatever
   * bundle the user is actively editing (Task 2). Deliberately does NOT
   * call authStoreService.loginLocal() — re-firing the login chain per file
   * would re-fetch config over HTTP, reset logging's start time, and force-
   * select the wrong bundle (spec grounding fact 1).
   *
   * Carried-forward gap, not fixed here: a transcript file dropped after the
   * first wave has already bootstrapped has no attachment point — the
   * dropzone's singular _oannotation pairing only ever reaches the
   * bootstrap call (see the spec's step 2.7 finding of the same name).
   */
  private runLaterWave(entries: FileProgress[]): void {
    for (const entry of entries) {
      const bundleId = generateBundleId();
      const nativeFile = entry.file.file!;
      this.audioService.registerAudioManager(
        bundleId,
        entry.audioManager!,
        nativeFile,
      );
      this.store.dispatch(
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId,
          sessionFile: new SessionFile(
            nativeFile.name,
            nativeFile.size,
            new Date(nativeFile.lastModified),
            normalizeMimeType(nativeFile.type),
          ),
          selectAfterCreate: false,
        }),
      );
      this.pendingAutoEnqueueIds.add(bundleId);
      this.dropzone!.consumeEntry(entry.id);
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest workbench.component.spec.ts`
Expected: PASS for every test in the file, including the ones untouched by this task (confirms the `Store.dispatch` addition and mock changes in Step 1 didn't regress anything).

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/workbench.component.ts apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts
git commit -m "feat(workbench): continuous ingestion — bootstrap once, create bundles per file, auto-enqueue when empty"
```

---

### Task 7: Layout — bundle list first, compact dropzone, one persistent settings panel, Start button removed

**Files:**
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` (comment fixes only — see Step 3)

**Interfaces:**
- Consumes: `AutoTranscribeOptionsComponent`'s `compact` input (Task 4), `AutoTranslateOptionsComponent` (new import + its `compact` input, Task 5), `WorkbenchComponent.onQueueTranslateOptionsChange`/`queueOptions` (Task 6).

- [ ] **Step 1: Add `AutoTranslateOptionsComponent` to the component's imports array**

In `workbench.component.ts`, add the import:

```ts
import { AutoTranslateOptionsComponent } from '../../component/tratt-dropzone/auto-translate-options.component';
```

and add `AutoTranslateOptionsComponent` to the `@Component({ imports: [...] })` array (alongside the existing `AutoTranscribeOptionsComponent`).

- [ ] **Step 2: Rewrite the left-rail template**

In `workbench.component.html`, replace the file's contents from the opening `<div class="workbench">` through the closing of the `.workbench__left` div (i.e. everything up to and including the `</div>` that currently closes `.workbench__left`, lines 1–115 of the pre-Task-7 file) with:

```html
<div class="workbench">
  <div class="workbench__left">
    @if (hasAnyBundles()) {
      <!-- Moved above the upload/record tabs (step 6): the bundle list is
           the primary "what's loaded" surface once anything exists; the
           dropzone below is now just the ingest affordance, not the list. -->
      <tratt-bundle-list></tratt-bundle-list>
    }
    <ul
      ngbNav
      #workbenchNav="ngbNav"
      [(activeId)]="activeTab"
      [destroyOnHide]="false"
      class="nav-tabs"
    >
      <li [ngbNavItem]="'upload'">
        <button ngbNavLink type="button">
          <i class="bi bi-folder2-open me-1"></i>
          {{ 'workbench.tabs.upload' | transloco }}
        </button>
        <ng-template ngbNavContent>
          <div class="pt-2">
            <!-- height shrunk from 180px (step 6): consumeEntry() removes a
                 row from this table the instant it's bundled, so this table
                 only ever shows rows still mid-decode or failed — the
                 bundle list above now owns "the list of files." -->
            <tratt-dropzone height="96px" [allowMultipleAudio]="true"></tratt-dropzone>
          </div>
        </ng-template>
      </li>
      <li [ngbNavItem]="'record'">
        <button ngbNavLink type="button">
          <i class="bi bi-mic-fill me-1"></i>
          {{ 'workbench.tabs.record' | transloco }}
        </button>
        <ng-template ngbNavContent>
          <div class="pt-2">
            <tratt-recording-panel
              (useRecording)="onUseRecording($event)"
            ></tratt-recording-panel>
          </div>
        </ng-template>
      </li>
    </ul>
    <div [ngbNavOutlet]="workbenchNav"></div>

    <!-- One persistent pipeline-settings panel (step 6), visible even
         pre-first-file — replaces both the dropzone's own pre-session
         [showAutoTranscribe] mount (removed above) and the old
         sessionReady-gated post-session mount. Changing it only affects
         bundles added/run after the change. -->
    <div class="workbench__queue">
      <h6 class="workbench__queue-title">
        {{ 'workbench.queue.options_title' | transloco }}
      </h6>
      <tratt-auto-transcribe-options
        idPrefix="queue-"
        [audioLoaded]="true"
        [annotationAlreadyLoaded]="false"
        [compact]="true"
        (optionsChange)="onQueueOptionsChange($event)"
      ></tratt-auto-transcribe-options>
      <tratt-auto-translate-options
        [annotationAlreadyLoaded]="false"
        [transcribeWillRun]="queueOptions() !== null"
        [sourceLanguageHint]="queueOptions()?.language"
        [compact]="true"
        (optionsChange)="onQueueTranslateOptionsChange($event)"
      ></tratt-auto-translate-options>
      <button
        type="button"
        class="btn btn-outline-primary workbench__queue-run"
        [disabled]="
          !queueRunning() &&
          (readyBundleIds().length === 0 || queueOptions() === null)
        "
        [attr.title]="
          !queueRunning() && queueOptions() === null
            ? ('workbench.queue.no_options_hint' | transloco)
            : null
        "
        (click)="onRunPauseClick()"
      >
        @if (queueRunning()) {
          <i class="bi bi-pause-fill me-1"></i>
          {{ 'workbench.queue.pause' | transloco }}
        } @else {
          <i class="bi bi-play-fill me-1"></i>
          {{
            'workbench.queue.run'
              | transloco: { count: readyBundleIds().length }
          }}
        }
      </button>
    </div>

    <!-- Deliberately OUTSIDE any session-state gate: cached ML models are
         the dominant browser-storage consumer and can exist long before
         this workbench has a single bundle, so the storage readout has to
         render on an empty workbench too. -->
    <div class="workbench__capacity">
      <tratt-capacity-indicator></tratt-capacity-indicator>
    </div>
  </div>
```

(The right pane — everything from `@if (sessionReady) { ... }` onward — is unchanged; leave it exactly as it is in the current file.)

- [ ] **Step 3: Fix two now-stale comments in `workbench.component.spec.ts`**

In the `describe('run/pause button rendering (Task 7 review Q1)', ...)` block, the first two tests' comments ("Named (so hasAnyBundles() is true and the queue panel actually renders)" / "Named so the queue panel renders from the start") are no longer accurate once the panel renders unconditionally. Update both to: `// Named so hasAnyBundles() is true (unrelated to the queue panel, which now always renders).` The test bodies and assertions themselves need no change.

- [ ] **Step 4: Run the full spec file**

Run: `npx jest workbench.component.spec.ts`
Expected: PASS for every test, including `'renders the capacity indicator even with no named bundles'` and the whole `'run/pause button rendering (Task 7 review Q1)'` describe block (the queue panel/run button now render regardless of `hasAnyBundles()`, which these tests' assertions do not depend on).

- [ ] **Step 5: Manual verification**

Run: `npm start`, open `/workbench` in a browser, drop two audio files one after another:
- Confirm the bundle list appears above the upload/record tabs the instant the first file validates, with no "Start session" button anywhere.
- Confirm the second file appears as its own row shortly after, without losing the first file's selection/editor state.
- Confirm the pipeline-settings panel (Auto-transcribe + Auto-translate, compact styling, no multi-paragraph hints) is visible before any file is dropped.
- With "Auto-transcribe" ticked and a model chosen, drop a third file and confirm its row shows `queued`/`running` without clicking Run.

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/workbench.component.ts apps/tratt/src/app/core/pages/workbench/workbench.component.html apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts
git commit -m "feat(workbench): reorder left rail, compact dropzone, one persistent pipeline-settings panel, remove Start button"
```

---

## Final verification

- [ ] Run the full suite: `npx jest apps/tratt/src/app/core/pages/workbench apps/tratt/src/app/core/component/tratt-dropzone apps/tratt/src/app/core/component/bundle-list apps/tratt/src/app/core/store/login-mode apps/tratt/src/app/core/store/pipeline-queue` — all green.
- [ ] Run `npx tsc -p apps/tratt --noEmit` (or `npm run build:dev`) — no new type errors.
- [ ] Run `npm run lint` — no new violations (3 pre-existing, unrelated errors are already tracked separately per this doc's own step-2.4 note — do not attempt to fix them here).
- [ ] Confirm `/local` (`login.component.html`) still renders `AutoTranscribeOptionsComponent`/`AutoTranslateOptionsComponent` with full, uncompacted copy (compact defaults to `false`).

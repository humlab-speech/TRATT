# Phase 3 Step 3a — Extract the Pipeline Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ASR → diarization → translation orchestration currently living as plain component state and methods inside `login.component.ts` moves into a testable, reusable `PipelineRunnerService`, with zero change to today's user-visible behavior on `/local`. Progress lands in a new NgRx "pipeline" store slice, throttled to avoid reducer/render flooding, and `login.component.ts` becomes a thin consumer of that slice instead of owning the orchestration itself.

**Architecture:** The master conversion plan calls this "the critical task" of Phase 3 and explicitly says it can "ship alone" — nothing about `/workbench` changes in this step; the pipeline stays reachable only from `/local`, exactly as today. This is the highest-stakes work in the whole conversion effort so far: it touches real, working ML orchestration (ASR, diarization, translation) with a hard zero-behavior-change requirement, and — unlike every piece of Phase 2's bundle work — there is **no existing test coverage for any of it** (`login.component.spec.ts` does not exist). Task 1 exists specifically to close that gap *before* anything is touched, so every later task has a real regression net to extract against, not just a "looks the same" impression.

**Tech Stack:** Angular 19, NgRx (a genuinely new "pipeline" feature slice — nothing in this app's pipeline UI has ever gone through the store before), RxJS (`throttleTime`/`auditTime` for the 4Hz throttle), the three existing worker-wrapper services (`LocalTranscriptionService`, `LocalDiarizationRuntimeService`, `LocalTranslationService` — all unchanged by this plan).

**Spec:** `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md` — Phase 3 is only named at a high level there; this plan is the first real design document for it. Add the corrections/design decisions below to that file once this plan's self-review is done, following this project's established practice for every prior step.

## Global Constraints

- **Do not touch `local-offline-transcription.helpers.ts`.** It's a genuinely clean, already-isolated pure-function seam (verified during planning, not just assumed) — `applyOptionalSpeakerSegmentation({annotJson, diarizationEnabled, runDiarization})`, no DOM, no Angular DI, already unit-tested (3 cases). `PipelineRunnerService` calls it, doesn't reimplement it.
- **Do not touch `LocalTranscriptionService`, `LocalDiarizationRuntimeService`, `LocalTranslationService`, or any of the three worker files** (`whisper-transcription.worker.ts`, `pyannote-diarization.worker.ts`, `translation.worker.ts`). Their event shapes (`TranscriptionEvent`, `DiarizationEvent`, `TranslationEvent` — all already well-typed discriminated unions), cancel semantics, WebGPU→WASM fallback (transcription only), and stall/retry mechanics (translation's internal `prefetchOnnxFile` retry loop, entirely separate from this plan's stall timers) are all correct today and out of scope. This plan only changes *who orchestrates calls to them*.
- **The two stall timers (30s download / 60s init) are translation-only today — do not invent equivalents for transcription or diarization.** The original plan's prose implies these are pipeline-wide; verified false during planning. Preserve them exactly as they exist (same budgets, same re-arm-on-every-non-result-event behavior, same "sets an error message but does not auto-cancel" firing behavior) for the translation stage only.
- **Elapsed-time display is a presentation concern, not pipeline state — it does not go through the throttled store channel.** A `setInterval`-driven ticking clock dispatching into NgRx every second forever is the exact reducer-flooding problem this plan's own store-throttling exists to avoid. `PipelineRunnerService`'s emitted events carry stage-start timestamps (already present in `TranscriptionStart`/translation's `translate-start` event shapes); the *ticking* — recomputing `Date.now() - startTime` once a second for display — stays a small, local, UI-layer timer in whatever component renders it (today: `login.component.ts`; this plan doesn't need to build a reusable version of it, just relocate the existing two `setInterval` blocks unchanged).
- **Cancel becomes one symmetric method, not two asymmetric ones.** Today `cancelTranscription()` cancels two services (transcription + diarization) and `cancelTranslation()` cancels one (translation) — no single "cancel whatever's running" entry point exists. `PipelineRunnerService.cancel()` must correctly stop whichever stage(s) are actually active, replacing the asymmetry with one real mechanism, while still allowing the consumer to distinguish "user clicked cancel during transcription" from "during translation" for UI purposes if it needs to (the consumer already knows the current stage from the event stream).
- **TDD throughout**, per this codebase's Jest conventions. Task 1 is entirely tests, against unmodified current code — no implementation change happens until it's green.

---

### Task 1: characterization tests for today's pipeline behavior (write first, before touching anything)

**Files:**
- Create: `apps/tratt/src/app/core/pages/login/login.component.spec.ts` (does not exist today)

**Interfaces:**
- Consumes: nothing new — tests the CURRENT, unmodified `login.component.ts` exactly as it stands right now.
- Produces: a regression safety net every later task in this plan must keep passing (adapted to the new architecture where the underlying mechanism moves, but the *observable behavior* it encodes must not change) — this is the plan's own definition of "zero behavior change."

**Steps:**

1. Read `login.component.ts` in full (623 lines) before writing anything — the exact orchestration methods this task characterizes are `onOfflineSubmit`, `_startTranscription`, `onTranscriptionEvent`, `handleCompletedTranscription`, `_startTranslation`, `onTranslationEvent`, `_armTranslationStallTimer`/`_clearTranslationStallTimer`, `cancelTranscription`, `cancelTranslation`, `dismissTranscriptionError`, `dismissTranslationError` (all present today, exact line ranges given below current as of this plan's writing — re-verify against the live file, don't assume they haven't shifted).
2. Mock `LocalTranscriptionService`, `LocalDiarizationRuntimeService`, `LocalTranslationService` at the boundary (each returning a controllable `Subject<TranscriptionEvent | DiarizationEvent | TranslationEvent>` you push events into manually in each test) — not the workers themselves; those services' own internals are out of scope and already have some separate test coverage. Use Jest's fake timers (`jest.useFakeTimers()`) for every test touching the stall timers or elapsed-time intervals.
3. Write tests covering, at minimum:
   - **Sequencing**: transcription-only (no diarization, no translation) — `_startTranscription` → push `download-progress`/`transcribe-start`/`segment-progress`/`result` events → assert `proceedWithLogin`-equivalent behavior fires (spy on `authStoreService.loginLocal` or whatever the actual finalization call is) with no diarization/translation involved.
   - **Diarization success path**: transcription completes with diarization enabled → `LocalDiarizationRuntimeService.diarize(...)`'s mocked stream emits a `result` event → assert `diarizationWarning` stays `null` and the finalization path receives the diarized annotation.
   - **Diarization graceful-degradation path**: diarization's mocked stream errors → assert `diarizationWarning` is set (via the real `transloco.translate` call or a spy on it), `console.error` is called, and — critically — the pipeline **still finalizes** with the original (non-diarized) annotation rather than aborting (this is `local-offline-transcription.helpers.ts`'s own already-tested behavior, but characterize it here too at the integration point, since Task 2/4 will change *how* this call happens even though the helper itself is untouched).
   - **Transcription → translation chaining**: transcription completes with `translateOptions` set → assert `_startTranslation` (or equivalent) fires automatically with the (possibly diarized) annotation, not requiring a second user action.
   - **Translation stall timers**: using fake timers, start translation, advance time past `TRANSLATION_DOWNLOAD_STALL_MS` (30_000ms) without any progress event → assert `translation.error` gets set to the exact download-stall message and `translation.active` stays `true` (the real current behavior — it does NOT auto-cancel). Separately, advance past `TRANSLATION_INIT_STALL_MS` (60_000ms) during the `initializing`/`translating` phase → assert the corresponding message. Assert the timer correctly *re-arms* on every non-`result` event (push a progress event just before the stall budget, advance time again, confirm it does NOT fire early).
   - **Elapsed-time intervals**: using fake timers, assert `transcription.elapsedMs`/`translation.elapsedMs` tick upward in 1000ms increments once the respective `-start` event fires, and stop ticking (interval cleared) once a terminal event (result/error/cancel) occurs — assert no further increments happen after clearing, by advancing time again and checking the value is unchanged.
   - **Cancel asymmetry**: `cancelTranscription()` calls both `localTranscriptionService.cancel()` and `localDiarizationRuntimeService.cancel()`; `cancelTranslation()` calls only `localTranslationService.cancel()`. Write both as explicit spy-call-count assertions — this exact asymmetry is what Task 2 replaces with one symmetric method, so this test's job is to prove today's actual (asymmetric) behavior, for later tasks to consciously supersede rather than silently lose.
   - **Dismiss-error branching**: `dismissTranscriptionError()`/`dismissTranslationError()` — when `active` is true, dismissing routes through cancel; when `active` is false, it just clears the error field without touching services.
4. Run the full new spec file against the current, unmodified `login.component.ts` and confirm every test passes — this task adds tests only, no implementation changes. If any test can't be made to pass without a change to `login.component.ts` itself, that's a sign the test doesn't accurately characterize current behavior — fix the test, not the component (this task must not alter runtime behavior at all).

---

### Task 2: extract `PipelineRunnerService`

**Files:**
- Create: `apps/tratt/src/app/core/shared/service/pipeline-runner.service.ts`
- Create: `apps/tratt/src/app/core/shared/service/pipeline-runner.service.spec.ts`
- Modify: `apps/tratt/src/app/core/pages/login/login.component.ts` (remove the extracted orchestration methods/fields; Task 4 does the full "thin consumer" rewire — this task's job is only to make `login.component.ts` call the new service instead of the three worker services directly, keeping its own component-field UI state and subscription-handling exactly as-is for now, so this task's diff is reviewable on its own before Task 4's larger template/store rewrite)

**Interfaces:**
- Consumes: `LocalTranscriptionService.transcribe()`, `LocalDiarizationRuntimeService.diarize()`/`.cancel()`, `LocalTranslationService.translate()`/`.cancel()`, `applyOptionalSpeakerSegmentation()` (all existing, unchanged).
- Produces:
  ```ts
  export type PipelineEvent =
    | { stage: 'transcription'; event: TranscriptionEvent }
    | { stage: 'diarization'; event: DiarizationEvent }
    | { stage: 'translation'; event: TranslationEvent }
    | { stage: 'diarization'; type: 'skipped' }
    | { stage: 'pipeline'; type: 'stalled'; phase: string; message: string }
    | { stage: 'pipeline'; type: 'result'; annotJson: OAnnotJSON; diarizationWarning: string | null }
    | { stage: 'pipeline'; type: 'cancelled' };

  export interface PipelineInput {
    audioManager: AudioManager;
    oaudiofile: OAudiofile;
    transcribeOptions?: TranscriptionOptions;
    translateOptions?: TranslationOptions; // check the real exported type name in local-translation.service.ts
  }
  ```
  (Adjust field/type names to match whatever the real existing type names are once you've read the three worker-wrapper services in full — don't invent parallel types where an existing exported one already fits; the point of this shape is illustrative of the STRUCTURE, not a literal transcription to copy verbatim.) `run(input: PipelineInput): Observable<PipelineEvent>` and `cancel(): void` are the service's public surface. Consumed by Task 3 (the store-throttling effect) and Task 4 (`login.component.ts`'s rewire).

**Steps:**

1. Read Task 1's new `login.component.spec.ts` in full first — it is the executable spec for what this extraction must preserve. Also re-read `login.component.ts`'s current orchestration methods (same list as Task 1 step 1) since this task moves them.
2. `PipelineRunnerService`, `providedIn: 'root'` (all three services it wraps except diarization are already root-provided; diarization is the one exception — see step 3).
3. **Resolve the diarization DI coupling.** `LocalDiarizationRuntimeService` is currently `@Injectable()` with no `providedIn`, and its `LOCAL_DIARIZATION_WORKER_FACTORY` token is provided inside `login.component.ts`'s own `@Component` `providers` array (constructing `new Worker(new URL('../../workers/pyannote-diarization.worker', import.meta.url), {type:'module'})`). Investigate *why* it was scoped to the component rather than root before changing it — check git blame / any related comment, and check whether component-scoping was ever load-bearing (e.g., ensuring a fresh worker per login attempt, which a root singleton wouldn't naturally give you if the service reuses one worker instance across multiple `diarize()` calls — read `LocalDiarizationRuntimeService`'s own worker-creation logic to see whether it already creates a fresh worker per `diarize()` call regardless of the service's own DI scope, in which case root-providing is safe). If it's safe, make `LocalDiarizationRuntimeService` `providedIn: 'root'` and provide `LOCAL_DIARIZATION_WORKER_FACTORY` at the root/app level (`app.config.ts` or wherever other root-level tokens are provided — check the existing pattern) instead of inside `login.component.ts`'s decorator. If your investigation finds a real reason for the component scoping, do NOT change it — instead provide both `LocalDiarizationRuntimeService` and the worker-factory token in `PipelineRunnerService`'s constructor injection path some other way (e.g. providing them in whatever DI scope `PipelineRunnerService` itself needs to live at), and explain your reasoning clearly in your report either way — this is a real judgment call, not a formality.
4. Implement `run(input)`: mirrors `_startTranscription`/`onTranscriptionEvent`/`handleCompletedTranscription`/`_startTranslation`/`onTranslationEvent`'s exact sequencing logic (call `localTranscriptionService.transcribe(...)`, on its `result` event call `applyOptionalSpeakerSegmentation` wrapping `localDiarizationRuntimeService.diarize(...)` exactly as today, then either `localTranslationService.translate(...)` if translate options are present or emit the pipeline-level `result` event) — as one Observable pipeline (likely built with `concatMap`/`switchMap` chaining the three stage Observables, or a hand-rolled `Observable` constructor if that's cleaner given the existing services return Subjects/Observables of their own event unions — your call on the exact RxJS composition, but the STAGE ORDER and the diarization-failure-doesn't-abort behavior must be byte-for-byte preserved, verified against Task 1's characterization tests). Preserve the translation-only stall timers exactly (same budgets, same re-arm-on-every-event, same "sets a stalled-pipeline event but doesn't auto-cancel" behavior — emit `{stage:'pipeline', type:'stalled', ...}` instead of directly mutating a component field, since the service has no component field to mutate; the consumer decides what to do with it, matching today's behavior of just setting an error string for display).
5. Implement `cancel()`: determine which stage is currently active from the service's own internal state (not from asking the consumer) and cancel exactly that stage's service(s) — for transcription active, cancel both `localTranscriptionService` and `localDiarizationRuntimeService` (matching today's `cancelTranscription()`); for translation active, cancel `localTranslationService` (matching today's `cancelTranslation()`). This is the "one symmetric method" the Global Constraints section asks for — it should still produce the exact same underlying service-cancel calls as today for whichever stage is running, just decided by the service's own tracked state rather than requiring the caller to know which method to call.
6. Update `login.component.ts`: replace direct calls to the three worker services with calls to `pipelineRunnerService.run(...)`/`.cancel()`. **Do not yet change the component's own `transcription`/`translation` field shapes, its template, or introduce NgRx here** — map incoming `PipelineEvent`s onto the exact same field writes the component does today (e.g. `{stage:'transcription', event: {type:'download-progress', ...}}` → `this.transcription.phase = 'downloading'; this.transcription.downloadLoaded = ...` exactly as today). This keeps this task's diff reviewable as "same behavior, new event source" without also being "and also rearchitected to use NgRx," which Task 4 does separately. Elapsed-time `setInterval` blocks and the two stall-timer-driven UI updates stay in `login.component.ts` for now (per the Global Constraint that elapsed-time ticking is presentation-layer, not pipeline state) — trigger them off the new `PipelineEvent` stream's stage-start/stalled events instead of the old raw `TranscriptionEvent`/`TranslationEvent` streams.
7. Run Task 1's full characterization suite against this new code — every test must still pass, since the service's job is a pure relocation, not a behavior change. If a test needs to change because the OBSERVABLE behavior genuinely shifted (not just internal plumbing), stop and treat that as a real finding to report, not something to quietly patch the test around.

**Tests** (for the new service, in addition to re-running Task 1's suite against the updated component): unit-test `PipelineRunnerService.run()` directly with mocked worker-wrapper services — assert the stage sequencing, diarization-failure-doesn't-abort behavior, stall-timer emission, and `cancel()`'s stage-aware routing, independent of any component. This is the service's own regression net going forward, since it's now a real, independently-testable unit — Task 1's suite characterizes `login.component.ts`'s integration with it, not the service's own internals.

---

### Task 3: NgRx "pipeline" store slice with throttled progress

**Files:**
- Create: `apps/tratt/src/app/core/store/pipeline/pipeline.actions.ts`
- Create: `apps/tratt/src/app/core/store/pipeline/pipeline.reducer.ts`
- Create: `apps/tratt/src/app/core/store/pipeline/pipeline.selectors.ts`
- Create: `apps/tratt/src/app/core/store/pipeline/pipeline.reducer.spec.ts`
- Modify: wherever this app's NgRx feature slices/reducers get registered (find the existing pattern — check `apps/tratt/src/app/core/store/index.ts` or `app.config.ts` for how `localMode`/`onlineMode`/etc. are registered, and match it exactly)

**Interfaces:**
- Consumes: `PipelineRunnerService`'s `PipelineEvent` union (Task 2).
- Produces: a `pipeline` feature-state slice and selectors — consumed by Task 4's component rewire. Design the state shape to mirror what `login.component.ts`'s current `transcription`/`translation` fields already track (so Task 4's template rewrite is close to mechanical), not a new, differently-organized shape that would force Task 4 to redesign the UI's data model too.

**Steps:**

1. Read Task 2's `PipelineRunnerService` and its `PipelineEvent` union in full first.
2. Design the throttling precisely: the master plan's own words are "throttled to roughly 4 Hz" specifically to avoid flooding the reducer / triggering full-shell re-renders under zone-based change detection — use RxJS `throttleTime(250, undefined, { leading: true, trailing: true })` (250ms ≈ 4Hz), with `trailing: true` **required**, not optional — a terminal event (`result`, `error`, `stalled`, `cancelled`) landing inside a throttle window must never be silently dropped just because it wasn't the leading edge. Write a test proving this specifically: push a rapid burst of progress events followed immediately by a `result` event within one throttle window, assert the dispatched action sequence still includes the `result` (don't just trust `trailing: true`'s documented semantics — verify empirically against the real operator).
3. Where does the throttling+dispatching actually live — in a new NgRx effect (subscribing to something that triggers it), or inline in whatever component calls `pipelineRunnerService.run()`? Given `login.component.ts` doesn't dispatch actions to TRIGGER a pipeline run today (it calls the service directly, imperatively, in response to a button click) and nothing else in this app currently starts a pipeline run, an **effect** listening for a "start pipeline" action is unnecessary machinery for a single, component-initiated, one-shot operation — simpler and more consistent with how `login.component.ts` already calls services directly elsewhere in this file: have `login.component.ts` (Task 4) call `pipelineRunnerService.run(input)` directly, subscribe to the returned Observable itself, apply the `throttleTime` operator itself, and `store.dispatch(...)` the resulting throttled events itself. This task therefore does NOT need a new effects class — just the actions/reducer/selectors. State this reasoning explicitly in your report; if you find a concrete reason an effect would genuinely be better (e.g. a future consumer needing to trigger runs without being the same component that dispatches), note it but don't build it speculatively — YAGNI.
4. Reducer: mirror today's `transcription`/`translation` field shapes as the state's own field shapes (per the Interfaces section above), with actions like `PipelineActions.transcriptionProgress`, `PipelineActions.translationProgress`, `PipelineActions.stalled`, `PipelineActions.result`, `PipelineActions.cancelled` — whatever granularity keeps the mapping from `PipelineEvent` to store update close to mechanical. Don't over-normalize into something more "correct" than what the UI actually needs to render — this state exists to drive the exact same progress bars/phase text/elapsed-time/error messages `login.component.ts` already renders, not a general-purpose pipeline-run history log.
5. Selectors: one selector per field/group the template needs (matching whatever granularity `login.component.html` already reads at, e.g. `selectTranscriptionPhase`, `selectTranscriptionDownloadProgress`, etc., or a single `selectPipelineState` if the template is fine reading the whole slice at once — check the template's actual usage pattern in Task 4 before over-designing this in isolation; it's fine for this task to build a reasonably-guessed selector set and have Task 4 adjust if needed, since these two tasks are tightly coupled).

**Tests**: reducer tests for each action type producing the correct state transition (mirroring the shape of `login-mode.reducer.spec.ts`'s existing testing conventions in this codebase). The throttling test described in step 2 (the most important test in this task — it's protecting against silently losing a terminal pipeline event, which would leave the UI stuck showing "in progress" forever after the pipeline actually finished).

---

### Task 4: `login.component.ts` becomes a thin consumer of the pipeline store slice

**Files:**
- Modify: `apps/tratt/src/app/core/pages/login/login.component.ts`
- Modify: `apps/tratt/src/app/core/pages/login/login.component.html`
- Modify: `apps/tratt/src/app/core/pages/login/login.component.spec.ts` (Task 1's characterization suite — update the mechanism under test, not the asserted behavior)

**Interfaces:**
- Consumes: `pipelineRunnerService.run()`/`.cancel()` (Task 2, already wired in by Task 2's own step 6 — this task replaces that intermediate "still using local component fields" wiring with the real store-based one), `PipelineActions`/selectors (Task 3).
- Produces: nothing consumed by a later task.

**Steps:**

1. Read Task 1's characterization suite (as it stands after Task 2's updates) and Task 3's reducer/selectors in full before starting.
2. Remove `login.component.ts`'s own `transcription`/`translation` component fields, the two elapsed-time `setInterval` mechanisms, and the direct field-mutation event handlers — replace with: calling `pipelineRunnerService.run(input)`, subscribing once, applying `throttleTime(250, undefined, {leading:true, trailing:true})`, and `store.dispatch`-ing the appropriate `PipelineActions` for each event (mirroring Task 3's design). Elapsed-time ticking: since it's explicitly NOT part of the throttled store channel (Global Constraints), keep a small local `setInterval` in the component that recomputes a locally-held `elapsedMs` field from a stage-start timestamp obtained from the (unthrottled, since you're already subscribed to the raw service Observable to build the dispatches) event stream — i.e., the component still gets to see every raw event for its own local elapsed-time bookkeeping, it just doesn't dispatch every one of them into the store.
3. Update `login.component.html` to read progress-bar/phase-text/error state from the new store selectors (via `async` pipe or `store.selectSignal`, matching whichever convention is more consistent with this file's existing template patterns — check what's already used elsewhere in `login.component.html`) instead of `transcription.*`/`translation.*` component fields, while elapsed-time display keeps reading the local component field from step 2.
4. `cancelTranscription()`/`cancelTranslation()`/`dismissTranscriptionError()`/`dismissTranslationError()`: route through `pipelineRunnerService.cancel()` (the new symmetric method) plus dispatching whatever `PipelineActions.cancelled`/clear-error action Task 3 defined, preserving the exact same dismiss-vs-cancel branching behavior Task 1 characterized (dismiss while active routes through cancel; dismiss while inactive just clears the error).
5. Run Task 1's full characterization suite (adjusted for the new mechanism, unchanged in asserted behavior) and confirm it's still green. This is the actual proof this whole plan achieved "zero behavior change" — if any assertion needs to change in a way that reflects a genuine behavior difference (not just "we now read from a selector instead of a field"), stop and report it as a finding, don't silently adjust the test to match new behavior.

---

### Task 5: docs — record the shipped shape

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md`

**Steps:**

- [ ] Add a "Step 3a shipped shape" section once Tasks 1-4 have landed: the corrected premises found during planning (stall timers are translation-only, not pipeline-wide; no existing test coverage existed for any of this before Task 1; the diarization DI-scoping investigation's outcome from Task 2 step 3; the design ruling that elapsed-time display stays outside the throttled store channel and why; the design ruling that no new NgRx effect was needed for triggering runs and why). Explicitly confirm `/workbench` still doesn't consume any of this yet — this step shipped as a pure internal `/local` refactor, matching the master plan's own "ship alone" framing, with wiring pipeline UI into `/workbench` left for later work.

---

## Final whole-branch review

This is the highest-stakes step in the conversion effort so far — real, working ML orchestration, a hard zero-behavior-change bar, and (before Task 1) zero pre-existing test coverage as a baseline safety net. Run the final review on the most capable available model, with explicit instructions to:
1. Independently re-derive, from the final code (not from trusting Task 1's characterization suite was written correctly), that the ASR → diarization → translation sequencing, the diarization-failure-doesn't-abort behavior, both translation stall timers, and the cancel-asymmetry-now-made-symmetric all produce byte-for-byte the same *observable* outcomes as the pre-plan code — trace at least one full happy-path scenario and one diarization-failure scenario by hand through the final architecture.
2. Confirm the 4Hz throttle's `trailing: true` behavior is real and tested, not just configured — verify a terminal event genuinely cannot be silently dropped inside a throttle window.
3. Confirm `/workbench` genuinely has zero new dependency on any of this (grep for `PipelineRunnerService`/the new `pipeline` store slice/selectors in `workbench.component.ts` and fail the review if any unexpected coupling snuck in) — this step's entire safety margin rests on it being a self-contained, `/local`-only change that can't regress anything on `/workbench`.

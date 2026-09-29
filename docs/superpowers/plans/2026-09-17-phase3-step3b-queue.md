# Phase 3 Step 3b-i — Pipeline Queue Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FIFO, one-in-flight pipeline queue over the bundles in `/workbench` — per-bundle run status in a new `pipeline-queue` NgRx slice, failure isolation with per-row retry, interruption-on-reload, and the first pipeline UI ever wired into `/workbench` (run/pause button, per-row status, pipeline options).

**Architecture:** A new `pipeline-queue` store slice (`queue`/`activeId`/`mode`/`runs`) holds the queue's whole state machine as pure reducer logic. A root-provided `PipelineQueueService` drives it: it pops one bundle at a time, ensures that bundle's audio is resident via `AudioService`, calls the **unchanged** `PipelineRunnerService.run()` from step 3a, translates the resulting `PipelineEvent` stream into bundle-scoped progress actions (reusing step 3a's pure `mapPipelineEventToAction` / `dispatchPipelineActions` throttling helpers), writes the produced transcript back to the *correct* bundle, and advances. Per-bundle `runState` is persisted into the existing per-bundle `bundles` IndexedDB options row and rehydrated as `'interrupted'` at boot. The existing singleton `pipeline` slice and `/local` are untouched.

**Tech Stack:** Angular 19 (standalone components, signals, `OnPush`), NgRx 19 store + effects + `@ngrx/entity` (`Dictionary` only — `runs` is a plain dictionary, not an entity collection), RxJS, Dexie (existing `bundles` table, no schema change), Jest + `@ngrx/store`'s real `provideStore` for store-driven service tests, Transloco for i18n.

**Spec:** `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md` — authoritative section: **"## Step 3b design (2026-09-17) — the queue"** (final section). Context sections: "## Architecture", "## Step 3a shipped shape (2026-09-16)".

## Global Constraints

- **Scope is 3b-i only.** Never touch worker termination/lifecycle code inside `LocalTranscriptionService` / `LocalDiarizationRuntimeService` / `LocalTranslationService` — `PipelineRunnerService` and those three services are used exactly as 3a left them. Warm-worker refcounting is 3b-ii, a separate plan.
- **The existing `pipeline` NgRx slice (`apps/tratt/src/app/core/store/pipeline/`) is untouched** — it keeps serving `login.component.ts` / `/local` exactly as-is. This step's new `pipeline-queue` slice is separate. The only things reused from that folder are the **pure functions** in `pipeline-event-mapping.ts` (`mapPipelineEventToAction`, `isThrottleSafeProgressAction`, `dispatchPipelineActions`) — imported, never modified.
- **`/local` must keep working unchanged throughout.** No change to `login.component.ts`, `login.component.html`, or any file only `/local` reaches, except the one strictly-backward-compatible `idPrefix` input added to the shared `AutoTranscribeOptionsComponent` in Task 7 (default `''` keeps `/local`'s rendered ids byte-identical).
- **Every new piece of state, service, and UI must have tests before being considered done** — characterization/unit tests for store logic and service logic, with mocked worker/service dependencies. **No real `Worker` instantiation in tests**; follow `pipeline-runner.service.spec.ts`'s `jest.mock('./local-transcription.service', ...)` preamble pattern wherever a spec's import graph reaches those services.
- **New user-facing strings need Transloco keys.** Add every new key to **all seven** locale files in `apps/tratt/src/assets/i18n/` (`en`, `sv`, `de`, `it`, `ko`, `nl`, `zh`) — real translations for `en` and `sv`, English text copied verbatim into the other five. See the i18n reconciliation note below for why "keep `npm run validate:i18n` green" is not achievable and what the real gate is.
- **Follow this codebase's plain-`createAction`-in-a-class convention for NgRx actions** (see `PipelineActions`, `LoginModeActions`) — not `createActionGroup`.
- **`OnPush` change detection on any new component.** (Both components this step touches — `BundleListComponent`, `WorkbenchComponent` — are already `OnPush`; keep them that way.)

## File-grounded corrections to the spec (read before starting)

Nine things the spec's "Step 3b design" section assumes that the actual code contradicts. Each is resolved by a named task below; none invalidates the design, but several change *how* it must be built.

1. **`AudioService.ensureResident()` is `private` and returns `Promise<void>`, swallowing every failure** (`audio.service.ts:238`). The spec's "residency before running … a residency failure here is the `'decode'` error class" needs a public, outcome-reporting call. Task 4 makes it `public async ensureResident(bundleId: string): Promise<boolean>`.
2. **There is no way to get a *specific* bundle's `AudioManager`.** `AudioService.current` resolves through `selectedBundleId`; the queue runs bundles that are usually *not* selected. Task 4 adds `public getManager(bundleId: string): AudioManager | undefined`.
3. **A pure `selectReadyBundleIds` selector cannot compute the ready set correctly.** `selectAllBundleSummaries`'s `awaitingMedia` is `!b.audio.loaded`, and the reducer only ever sets `audio.loaded` for the *selected* bundle — so every non-selected, genuinely-resident bundle would read as "awaiting media" and be excluded. `BundleListComponent` already works around this by merging in a live `AudioService.hasResident()` check. Task 1 therefore ships the skip rule as a **pure helper** `computeReadyBundleIds(summaries, runs, isResident)` (fully unit-testable) that both the service and the workbench component call with `audioService.hasResident` — not as a store selector.
4. **`selectBundleRunStatus(bundleId)` as a per-row selector factory is the wrong shape here.** Every consumer (bundle list rows, ready-count) needs *all* rows at once; a factory selector called inside an `@for` allocates a fresh memoized selector per row per render. Task 1 ships `selectAllRunStatuses` plus a pure `runStatusOf(runs, bundleId)` helper instead; the spec's named behavior ("absent entry ⇒ `{state:'idle'}`") is preserved exactly.
5. **The LOCAL options write path replaces the whole stored `value` object, it does not merge.** `TrattDatabase.saveModeData()` calls `this.bundles.update([bundleId, name], { value: prepared })` (`tratt-database.ts:571`) — so a new effect that writes `{runState}` alone would erase `sessionfile`/`currentEditor`/etc. and break bundle restore, and conversely the existing `savemodeOptions$` (which knows nothing about `runState`) would erase a previously-written `runState` on the next unrelated options save. Task 2 resolves this by extracting the options literal into one shared pure builder that **both** writers use, with `runState` always read from the `pipelineQueue` slice.
6. **Every action other than `createBundle`/`selectBundle` is routed to the *selected* bundle** by `wrapAsLocalBundleCollectionReducer` (`login-mode.reducer.ts:162`). Dispatching the existing `AnnotationActions.overwriteTranscript.do` for a queue-produced result would write bundle X's transcript into whatever bundle the user currently has selected — silent data corruption. Task 5 adds an explicitly bundle-scoped `LoginModeActions.setBundleTranscript`, routed the same way `createBundle` already is. **This task is an addition to the caller's five-task breakdown**, justified because without it the queue either discards every result it produces or corrupts the selected bundle.
7. **`AutoTranscribeOptionsComponent` is already mounted on `/workbench`** — inside `<tratt-dropzone [showAutoTranscribe]="true">` (`workbench.component.html:19`, `tratt-dropzone.component.html:128`). Its own template gate is `audioLoaded() && !annotationAlreadyLoaded()`, bound to the dropzone's `hasAudio`, so it disappears the moment `startSession()` calls `dropzone.reset()` — and `dropzone.transcribeOptions` goes `null` with it (the component's `effect()` re-emits `null` when `audioLoaded` goes false). The queue therefore genuinely needs its own mount, as the spec says, but the two can coexist on screen (a returning user with restored bundles who drops new files), which would duplicate the element ids `autoTranscribeCheck` / `languageSelect` / `model-*` / `speakerSegmentationCheck` / `numSpeakersInput`. Task 7 adds an `idPrefix` input (default `''`) to that component so both mounts stay valid, with `/local`'s markup unchanged.
8. **`npm run validate:i18n` is already red on `main`** — 62 missing keys in `de`, 225 each in `it`/`ko`/`nl`/`zh`, 34 in `sv`, plus 5 extra keys in four locales. The entire existing `workbench.*` block is absent from `de`/`it`/`ko`/`nl`/`zh`. "Keep it green" is not achievable in this step and is not this step's job. **The real gate:** run `npm run validate:i18n` before and after, and assert the per-locale missing counts do not increase. Adding a key to `en.json` alone would increase all six other counts, which is why every new key goes into all seven files.
9. **`LocalTranscriptionService` errors with the *friendly* message, not the raw worker message** (`local-transcription.service.ts:181-185` wraps `transcriptionFriendlyError(...)` in the `Error`). `classifyTranscriptionWorkerError()` still classifies the friendly WebGPU strings as `'webgpu-runtime'` (they contain "gpu"), but never as `'webgpu-backend-load-failed'` (that needs raw substrings the friendly text drops). Task 3's classifier therefore layers additional message heuristics on top of `classifyTranscriptionWorkerError()` rather than relying on it alone, and documents this.

Also deliberately **out of scope**, consistent with the spec's own scope cuts: FIFO queue *position* is never persisted (only per-bundle state, per the spec); warm-worker reuse (3b-ii); per-bundle translation (the queue runs transcription + optional diarization only — `PipelineInput.translateOptions` is left unset, because `/workbench` has no translation-configuration UI and building one is not in this step's spec text).

---

### Task 1: the `pipeline-queue` store slice (pure state layer)

**Files:**
- Create: `apps/tratt/src/app/core/store/pipeline-queue/index.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.actions.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.reducer.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.selectors.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.reducer.spec.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.selectors.spec.ts`
- Modify: `apps/tratt/src/app/core/store/index.ts` (add `pipelineQueue` to `RootState`)
- Modify: `apps/tratt/src/main.ts` (register the reducer in `StoreModule.forRoot`)

**Interfaces:**
- Consumes: `Dictionary` from `@ngrx/entity`; `selectAllBundleSummaries` from `../login-mode/annotation/annotation.selectors` (returns `{bundleId: string; name: string | undefined; selected: boolean; awaitingMedia: boolean}[]`).
- Produces: `PipelineQueueState`, `BundleRunState`, `BundleRunStage`, `BundleRunErrorKind`, `BundleRunError`, `BundleRunStatus`, `IDLE_RUN_STATUS`, `PipelineQueueActions`, `initialState`, `reducer`, `selectPipelineQueueFeature`, `selectQueueMode`, `selectActiveBundleId`, `selectAllRunStatuses`, `runStatusOf()`, `computeReadyBundleIds()`.

**Steps:**

- [ ] **Step 1: Create the state types**

Create `apps/tratt/src/app/core/store/pipeline-queue/index.ts`:

```ts
import { Dictionary } from '@ngrx/entity';

/**
 * Per-bundle pipeline run state for the /workbench queue (step 3b-i).
 *
 * Deliberately separate from the singleton `pipeline` slice (step 3a), which
 * is a SINGLE run's progress with no bundleId anywhere and stays wired
 * exclusively to login.component.ts / `/local`. Nothing here touches it.
 */
export type BundleRunState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'interrupted';

export type BundleRunStage = 'decode' | 'asr' | 'diarization' | 'translation';

export type BundleRunErrorKind =
  | 'decode'
  | 'model-load'
  | 'oom'
  | 'cancelled'
  | 'unknown';

export interface BundleRunError {
  kind: BundleRunErrorKind;
  message: string;
}

export interface BundleRunStatus {
  state: BundleRunState;
  stage?: BundleRunStage;
  /** 0-1 within the current stage. */
  progress?: number;
  error?: BundleRunError;
}

export interface PipelineQueueState {
  /** FIFO of pending bundle ids, oldest first. */
  queue: string[];
  /** Bundle id currently running, or null when idle. */
  activeId: string | null;
  /** 'pausing' = finish activeId, then stop; don't drain the rest. */
  mode: 'idle' | 'running' | 'pausing';
  /**
   * Keyed by bundleId. An ABSENT entry means "idle" — entries are created
   * lazily on first enqueue, never eagerly for every bundle. Read it through
   * `runStatusOf()` so that default is applied in exactly one place.
   */
  runs: Dictionary<BundleRunStatus>;
}

/**
 * Frozen so it can be shared as the default for every bundle with no `runs`
 * entry without any risk of a consumer mutating the shared object (NgRx's
 * strictStateImmutability runtime check does not cover values that never
 * entered the store).
 */
export const IDLE_RUN_STATUS: BundleRunStatus = Object.freeze({
  state: 'idle',
}) as BundleRunStatus;

/** Absent entry ⇒ idle. The single place that default is applied. */
export function runStatusOf(
  runs: Dictionary<BundleRunStatus>,
  bundleId: string,
): BundleRunStatus {
  return runs[bundleId] ?? IDLE_RUN_STATUS;
}

export interface BundleSummaryForQueue {
  bundleId: string;
  awaitingMedia: boolean;
}

/**
 * The spec's skip rule: a bundle is eligible for `enqueue()` when its media
 * is available AND its current run state is not one of queued/running/done.
 *
 * NOT a store selector: `selectAllBundleSummaries`'s `awaitingMedia` is
 * `!b.audio.loaded`, and the reducer only ever sets `audio.loaded` for the
 * SELECTED bundle (see AnnotationActions.loadAudio.success) — so a bundle
 * with a real, resident AudioManager that simply hasn't been selected yet
 * would be wrongly excluded. `isResident` is AudioService.hasResident, the
 * same live check BundleListComponent already merges in for exactly this
 * reason.
 */
export function computeReadyBundleIds(
  summaries: BundleSummaryForQueue[],
  runs: Dictionary<BundleRunStatus>,
  isResident: (bundleId: string) => boolean,
): string[] {
  return summaries
    .filter((summary) => {
      if (summary.awaitingMedia && !isResident(summary.bundleId)) {
        return false;
      }
      const state = runStatusOf(runs, summary.bundleId).state;
      return state !== 'queued' && state !== 'running' && state !== 'done';
    })
    .map((summary) => summary.bundleId);
}
```

- [ ] **Step 2: Create the actions**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.actions.ts`:

```ts
import { createAction, props } from '@ngrx/store';
import type { BundleRunError, BundleRunStage, BundleRunState } from './index';

/**
 * Plain `createAction`s grouped in a class — the convention already used by
 * `PipelineActions` and `LoginModeActions`, not `createActionGroup` (none of
 * these are request/response do/success/fail families).
 *
 * All of these are dispatched by `PipelineQueueService` (Task 4) except
 * `restoreInterrupted`, dispatched by `BundleRestoreEffects` (Task 2).
 *
 * There is deliberately no separate `idle` action: "the queue went idle" is
 * exactly what `activateNext` on an empty queue and `stopped` already
 * produce, and a third way to reach the same state would be untested dead
 * surface.
 */
export class PipelineQueueActions {
  /** Append ids to the FIFO tail and mark each 'queued'. */
  static enqueued = createAction(
    '[PipelineQueue] enqueued',
    props<{ bundleIds: string[] }>(),
  );

  /** Pop the head into `activeId`, or go idle when the queue is empty. */
  static activateNext = createAction('[PipelineQueue] activate next');

  /** Stage/progress tick for whichever bundle is currently active. */
  static progress = createAction(
    '[PipelineQueue] progress',
    props<{ stage: BundleRunStage; progress?: number }>(),
  );

  static bundleDone = createAction(
    '[PipelineQueue] bundle done',
    props<{ bundleId: string }>(),
  );

  static bundleFailed = createAction(
    '[PipelineQueue] bundle failed',
    props<{ bundleId: string; error: BundleRunError }>(),
  );

  /**
   * `stop()`: finish the active bundle, then stop. With nothing active this
   * resolves straight to the fully-stopped state instead of parking in
   * 'pausing' forever with no run to finish.
   */
  static pause = createAction('[PipelineQueue] pause');

  /**
   * The queue actually stopped: drop every pending id and reset their run
   * state to 'idle' (NOT 'queued'), so a later "run" recomputes the ready
   * set fresh, per the spec's `stop()` semantics.
   */
  static stopped = createAction('[PipelineQueue] stopped');

  /**
   * Boot-time rehydration from persisted `runState`. 'queued'/'running'
   * become 'interrupted' — never silently resumed.
   */
  static restoreInterrupted = createAction(
    '[PipelineQueue] restore interrupted',
    props<{ entries: { bundleId: string; state: BundleRunState }[] }>(),
  );
}
```

- [ ] **Step 3: Write the failing reducer tests**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.reducer.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import { PipelineQueueState } from './index';
import { PipelineQueueActions } from './pipeline-queue.actions';
import { initialState, reducer } from './pipeline-queue.reducer';

function seed(overrides: Partial<PipelineQueueState> = {}): PipelineQueueState {
  return { ...initialState, ...overrides };
}

describe('pipeline-queue.reducer', () => {
  it('returns the initial state for an unknown action', () => {
    expect(reducer(undefined, { type: '@@INIT' } as any)).toEqual(initialState);
  });

  describe('enqueued', () => {
    it('appends ids to the FIFO tail and marks each queued', () => {
      const state = reducer(
        initialState,
        PipelineQueueActions.enqueued({ bundleIds: ['a', 'b'] }),
      );
      expect(state.queue).toEqual(['a', 'b']);
      expect(state.runs['a']).toEqual({ state: 'queued' });
      expect(state.runs['b']).toEqual({ state: 'queued' });
      expect(state.activeId).toBeNull();
      expect(state.mode).toBe('idle');
    });

    it('appends to an existing queue rather than replacing it', () => {
      const first = reducer(
        initialState,
        PipelineQueueActions.enqueued({ bundleIds: ['a'] }),
      );
      const second = reducer(
        first,
        PipelineQueueActions.enqueued({ bundleIds: ['b'] }),
      );
      expect(second.queue).toEqual(['a', 'b']);
    });

    it('skips ids already queued or already active', () => {
      const state = reducer(
        seed({ queue: ['a'], activeId: 'z', mode: 'running' }),
        PipelineQueueActions.enqueued({ bundleIds: ['a', 'z', 'b'] }),
      );
      expect(state.queue).toEqual(['a', 'b']);
    });

    it('clears a previous error when a failed bundle is re-enqueued', () => {
      const failed = seed({
        runs: {
          a: { state: 'failed', error: { kind: 'oom', message: 'boom' } },
        },
      });
      const state = reducer(
        failed,
        PipelineQueueActions.enqueued({ bundleIds: ['a'] }),
      );
      expect(state.runs['a']).toEqual({ state: 'queued' });
    });
  });

  describe('activateNext', () => {
    it('pops the head into activeId and marks it running at the decode stage', () => {
      const state = reducer(
        seed({ queue: ['a', 'b'], runs: { a: { state: 'queued' } } }),
        PipelineQueueActions.activateNext(),
      );
      expect(state.activeId).toBe('a');
      expect(state.queue).toEqual(['b']);
      expect(state.mode).toBe('running');
      expect(state.runs['a']).toEqual({ state: 'running', stage: 'decode' });
    });

    it('goes idle when the queue is empty', () => {
      const state = reducer(
        seed({ queue: [], activeId: 'a', mode: 'running' }),
        PipelineQueueActions.activateNext(),
      );
      expect(state.activeId).toBeNull();
      expect(state.mode).toBe('idle');
    });
  });

  describe('progress', () => {
    it('updates stage and progress on the active bundle only', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          runs: { a: { state: 'running', stage: 'decode' }, b: { state: 'queued' } },
        }),
        PipelineQueueActions.progress({ stage: 'asr', progress: 0.25 }),
      );
      expect(state.runs['a']).toEqual({
        state: 'running',
        stage: 'asr',
        progress: 0.25,
      });
      expect(state.runs['b']).toEqual({ state: 'queued' });
    });

    it('keeps the previous progress value when the tick carries none', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          runs: { a: { state: 'running', stage: 'asr', progress: 0.4 } },
        }),
        PipelineQueueActions.progress({ stage: 'diarization' }),
      );
      expect(state.runs['a']).toEqual({
        state: 'running',
        stage: 'diarization',
        progress: 0.4,
      });
    });

    it('is a no-op when nothing is active', () => {
      const before = seed({ runs: { a: { state: 'queued' } } });
      const state = reducer(
        before,
        PipelineQueueActions.progress({ stage: 'asr', progress: 0.5 }),
      );
      expect(state).toBe(before);
    });
  });

  describe('bundleDone', () => {
    it('marks the bundle done and clears activeId', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          queue: ['b'],
          runs: { a: { state: 'running', stage: 'asr', progress: 0.9 } },
        }),
        PipelineQueueActions.bundleDone({ bundleId: 'a' }),
      );
      expect(state.runs['a']).toEqual({ state: 'done' });
      expect(state.activeId).toBeNull();
      expect(state.queue).toEqual(['b']);
      expect(state.mode).toBe('running');
    });
  });

  describe('bundleFailed', () => {
    it('records the error, clears activeId and leaves the rest of the queue intact', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          queue: ['b'],
          runs: { a: { state: 'running', stage: 'asr' }, b: { state: 'queued' } },
        }),
        PipelineQueueActions.bundleFailed({
          bundleId: 'a',
          error: { kind: 'oom', message: 'GPU out of memory' },
        }),
      );
      expect(state.runs['a']).toEqual({
        state: 'failed',
        error: { kind: 'oom', message: 'GPU out of memory' },
      });
      expect(state.activeId).toBeNull();
      expect(state.queue).toEqual(['b']);
      expect(state.runs['b']).toEqual({ state: 'queued' });
    });
  });

  describe('pause', () => {
    it('parks in pausing while a bundle is still running', () => {
      const state = reducer(
        seed({ activeId: 'a', mode: 'running', queue: ['b'] }),
        PipelineQueueActions.pause(),
      );
      expect(state.mode).toBe('pausing');
      expect(state.activeId).toBe('a');
      expect(state.queue).toEqual(['b']);
    });

    it('stops immediately when nothing is active', () => {
      const state = reducer(
        seed({
          activeId: null,
          mode: 'running',
          queue: ['b'],
          runs: { b: { state: 'queued' } },
        }),
        PipelineQueueActions.pause(),
      );
      expect(state.mode).toBe('idle');
      expect(state.queue).toEqual([]);
      expect(state.runs['b']).toEqual({ state: 'idle' });
    });
  });

  describe('stopped', () => {
    it('drops pending ids and resets them to idle, not queued', () => {
      const state = reducer(
        seed({
          activeId: null,
          mode: 'pausing',
          queue: ['b', 'c'],
          runs: {
            a: { state: 'done' },
            b: { state: 'queued' },
            c: { state: 'queued' },
          },
        }),
        PipelineQueueActions.stopped(),
      );
      expect(state.queue).toEqual([]);
      expect(state.mode).toBe('idle');
      expect(state.activeId).toBeNull();
      expect(state.runs['a']).toEqual({ state: 'done' });
      expect(state.runs['b']).toEqual({ state: 'idle' });
      expect(state.runs['c']).toEqual({ state: 'idle' });
    });
  });

  describe('restoreInterrupted', () => {
    it('rehydrates queued and running as interrupted, never as running', () => {
      const state = reducer(
        initialState,
        PipelineQueueActions.restoreInterrupted({
          entries: [
            { bundleId: 'a', state: 'queued' },
            { bundleId: 'b', state: 'running' },
            { bundleId: 'c', state: 'done' },
            { bundleId: 'd', state: 'failed' },
            { bundleId: 'e', state: 'idle' },
          ],
        }),
      );
      expect(state.runs['a']).toEqual({ state: 'interrupted' });
      expect(state.runs['b']).toEqual({ state: 'interrupted' });
      expect(state.runs['c']).toEqual({ state: 'done' });
      expect(state.runs['d']).toEqual({ state: 'failed' });
      expect(state.runs['e']).toBeUndefined();
      expect(state.queue).toEqual([]);
      expect(state.activeId).toBeNull();
      expect(state.mode).toBe('idle');
    });
  });
});
```

- [ ] **Step 4: Run the reducer tests to verify they fail**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.reducer`
Expected: FAIL — `Cannot find module './pipeline-queue.reducer'`.

- [ ] **Step 5: Write the reducer**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.reducer.ts`:

```ts
import { Dictionary } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { BundleRunStatus, PipelineQueueState } from './index';
import { PipelineQueueActions } from './pipeline-queue.actions';

export const initialState: PipelineQueueState = {
  queue: [],
  activeId: null,
  mode: 'idle',
  runs: {},
};

/** Shared by `pause` (with nothing active) and `stopped`. */
function stopNow(state: PipelineQueueState): PipelineQueueState {
  const runs: Dictionary<BundleRunStatus> = { ...state.runs };
  for (const bundleId of state.queue) {
    runs[bundleId] = { state: 'idle' };
  }
  return { ...state, queue: [], activeId: null, mode: 'idle', runs };
}

export const reducer = createReducer(
  initialState,

  on(
    PipelineQueueActions.enqueued,
    (state, { bundleIds }): PipelineQueueState => {
      const runs: Dictionary<BundleRunStatus> = { ...state.runs };
      const queue = [...state.queue];
      for (const bundleId of bundleIds) {
        if (queue.includes(bundleId) || state.activeId === bundleId) {
          continue;
        }
        queue.push(bundleId);
        // A fresh object, not a merge: re-enqueueing a failed bundle must
        // drop its old `error`/`stage`/`progress`, not carry them forward.
        runs[bundleId] = { state: 'queued' };
      }
      return { ...state, queue, runs };
    },
  ),

  on(PipelineQueueActions.activateNext, (state): PipelineQueueState => {
    const [next, ...rest] = state.queue;
    if (next === undefined) {
      return { ...state, activeId: null, mode: 'idle' };
    }
    return {
      ...state,
      queue: rest,
      activeId: next,
      mode: 'running',
      runs: { ...state.runs, [next]: { state: 'running', stage: 'decode' } },
    };
  }),

  on(
    PipelineQueueActions.progress,
    (state, { stage, progress }): PipelineQueueState => {
      const activeId = state.activeId;
      if (activeId === null) {
        return state;
      }
      const previous = state.runs[activeId] ?? { state: 'running' };
      return {
        ...state,
        runs: {
          ...state.runs,
          [activeId]: {
            ...previous,
            state: 'running',
            stage,
            ...(progress !== undefined ? { progress } : {}),
          },
        },
      };
    },
  ),

  on(
    PipelineQueueActions.bundleDone,
    (state, { bundleId }): PipelineQueueState => ({
      ...state,
      activeId: state.activeId === bundleId ? null : state.activeId,
      runs: { ...state.runs, [bundleId]: { state: 'done' } },
    }),
  ),

  on(
    PipelineQueueActions.bundleFailed,
    (state, { bundleId, error }): PipelineQueueState => ({
      ...state,
      activeId: state.activeId === bundleId ? null : state.activeId,
      runs: { ...state.runs, [bundleId]: { state: 'failed', error } },
    }),
  ),

  on(PipelineQueueActions.pause, (state): PipelineQueueState => {
    if (state.activeId === null) {
      return stopNow(state);
    }
    return { ...state, mode: 'pausing' };
  }),

  on(PipelineQueueActions.stopped, (state): PipelineQueueState => stopNow(state)),

  on(
    PipelineQueueActions.restoreInterrupted,
    (state, { entries }): PipelineQueueState => {
      const runs: Dictionary<BundleRunStatus> = { ...state.runs };
      for (const entry of entries) {
        if (entry.state === 'idle') {
          continue;
        }
        runs[entry.bundleId] =
          entry.state === 'queued' || entry.state === 'running'
            ? { state: 'interrupted' }
            : { state: entry.state };
      }
      return { ...state, runs };
    },
  ),
);
```

- [ ] **Step 6: Run the reducer tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.reducer`
Expected: PASS (all cases).

- [ ] **Step 7: Write the failing selector/helper tests**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.selectors.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import {
  BundleRunStatus,
  computeReadyBundleIds,
  IDLE_RUN_STATUS,
  runStatusOf,
} from './index';
import {
  selectActiveBundleId,
  selectAllRunStatuses,
  selectQueueMode,
} from './pipeline-queue.selectors';

const runs: Record<string, BundleRunStatus> = {
  done: { state: 'done' },
  failed: { state: 'failed', error: { kind: 'oom', message: 'x' } },
  queued: { state: 'queued' },
  running: { state: 'running', stage: 'asr' },
  interrupted: { state: 'interrupted' },
};

describe('runStatusOf', () => {
  it('returns the shared idle status for an absent entry', () => {
    expect(runStatusOf({}, 'missing')).toBe(IDLE_RUN_STATUS);
    expect(runStatusOf({}, 'missing').state).toBe('idle');
  });

  it('returns the stored entry when present', () => {
    expect(runStatusOf(runs, 'done')).toEqual({ state: 'done' });
  });
});

describe('computeReadyBundleIds', () => {
  const summaries = [
    { bundleId: 'idle', awaitingMedia: false },
    { bundleId: 'done', awaitingMedia: false },
    { bundleId: 'failed', awaitingMedia: false },
    { bundleId: 'queued', awaitingMedia: false },
    { bundleId: 'running', awaitingMedia: false },
    { bundleId: 'interrupted', awaitingMedia: false },
  ];

  it('excludes queued, running and done bundles', () => {
    expect(computeReadyBundleIds(summaries, runs, () => true)).toEqual([
      'idle',
      'failed',
      'interrupted',
    ]);
  });

  it('excludes a bundle awaiting media with no resident manager', () => {
    const ready = computeReadyBundleIds(
      [{ bundleId: 'idle', awaitingMedia: true }],
      {},
      () => false,
    );
    expect(ready).toEqual([]);
  });

  it('includes a bundle whose store flag says awaiting media but whose audio is actually resident', () => {
    const ready = computeReadyBundleIds(
      [{ bundleId: 'idle', awaitingMedia: true }],
      {},
      (id) => id === 'idle',
    );
    expect(ready).toEqual(['idle']);
  });
});

describe('pipeline-queue.selectors', () => {
  const state = {
    pipelineQueue: {
      queue: ['b'],
      activeId: 'a',
      mode: 'running' as const,
      runs,
    },
  };

  it('projects mode, activeId and runs', () => {
    expect(selectQueueMode(state as any)).toBe('running');
    expect(selectActiveBundleId(state as any)).toBe('a');
    expect(selectAllRunStatuses(state as any)).toBe(runs);
  });
});
```

- [ ] **Step 8: Run the selector tests to verify they fail**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.selectors`
Expected: FAIL — `Cannot find module './pipeline-queue.selectors'`.

- [ ] **Step 9: Write the selectors**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue.selectors.ts`:

```ts
import { Dictionary } from '@ngrx/entity';
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { BundleRunStatus, PipelineQueueState } from './index';

export const selectPipelineQueueFeature =
  createFeatureSelector<PipelineQueueState>('pipelineQueue');

export const selectQueueMode = createSelector(
  selectPipelineQueueFeature,
  (s) => s.mode,
);

export const selectActiveBundleId = createSelector(
  selectPipelineQueueFeature,
  (s) => s.activeId,
);

export const selectQueuedBundleIds = createSelector(
  selectPipelineQueueFeature,
  (s) => s.queue,
);

/**
 * The whole `runs` dictionary in one read. Consumers index it via
 * `runStatusOf(runs, bundleId)` (which applies the "absent ⇒ idle" default).
 *
 * Deliberately NOT a `selectBundleRunStatus(bundleId)` selector factory as
 * the spec sketched: every consumer needs all rows at once (the bundle list
 * renders a status per row; the ready-count filters across all bundles), and
 * a factory selector called inside an `@for` allocates a fresh memoized
 * selector per row per render.
 */
export const selectAllRunStatuses = createSelector(
  selectPipelineQueueFeature,
  (s): Dictionary<BundleRunStatus> => s.runs,
);
```

- [ ] **Step 10: Run the selector tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.selectors`
Expected: PASS.

- [ ] **Step 11: Register the slice in `RootState`**

In `apps/tratt/src/app/core/store/index.ts`, add the import next to the existing `PipelineState` import (line 8):

```ts
import { PipelineQueueState } from './pipeline-queue';
```

and add the field to `RootState` (after `pipeline: PipelineState;`):

```ts
  pipelineQueue: PipelineQueueState;
```

- [ ] **Step 12: Register the reducer in `main.ts`**

In `apps/tratt/src/main.ts`, add an import alongside the existing `fromPipeline` import:

```ts
import * as fromPipelineQueue from './app/core/store/pipeline-queue/pipeline-queue.reducer';
```

and add one line inside `StoreModule.forRoot({...})` right after `pipeline: fromPipeline.reducer,`:

```ts
          pipelineQueue: fromPipelineQueue.reducer,
```

- [ ] **Step 13: Verify the app still compiles and nothing else regressed**

Run: `npx nx test tratt`
Expected: PASS — the whole existing suite, plus the two new spec files. If the `RootState` change breaks a spec that builds a literal `RootState`, fix it by casting through `as unknown as RootState` (the convention already used in `bundle-list.component.spec.ts`), not by weakening the interface.

- [ ] **Step 14: Commit**

```bash
git add apps/tratt/src/app/core/store/pipeline-queue apps/tratt/src/app/core/store/index.ts apps/tratt/src/main.ts
git commit -m "feat(store): add pipeline-queue slice with FIFO queue state machine"
```

---

### Task 2: persist and restore per-bundle run state

**Files:**
- Modify: `apps/tratt/src/app/core/shared/tratt-database.ts` (add `runState` to `IIDBModeOptions`, ~line 782)
- Create: `apps/tratt/src/app/core/store/idb/build-mode-options.ts`
- Create: `apps/tratt/src/app/core/store/idb/build-mode-options.spec.ts`
- Modify: `apps/tratt/src/app/core/store/idb/idb-effects.service.ts` (`savemodeOptions$`, lines 485-576)
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.spec.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/bundle-restore.effects.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/bundle-restore.effects.spec.ts`
- Modify: `apps/tratt/src/main.ts` (register `PipelineQueuePersistenceEffects`)

**Interfaces:**
- Consumes: `PipelineQueueActions` (Task 1), `BundleRunState`, `runStatusOf`, `selectAllRunStatuses`; `IDBService.saveModeOptions(mode, options, bundleId?)`, `IDBService.loadModeOptions(mode, bundleId?)`, `IDBService.listLocalBundleIds()`.
- Produces: `buildModeOptions(modeState, me, runState)` → `IIDBModeOptions`; `PipelineQueuePersistenceEffects`; `IIDBModeOptions.runState?: BundleRunState`.

**Steps:**

- [ ] **Step 1: Add `runState` to the persisted options shape**

In `apps/tratt/src/app/core/shared/tratt-database.ts`, add a type-only import at the top of the file (alongside the other imports):

```ts
import type { BundleRunState } from '../store/pipeline-queue';
```

and add one field to `IIDBModeOptions` (at the end of the interface, after `user?: {...} | null;`):

```ts
  /**
   * Per-bundle pipeline run state (step 3b-i). 'queued'/'running' are
   * rehydrated as 'interrupted' at boot by BundleRestoreEffects — a run
   * never survives a reload.
   */
  runState?: BundleRunState;
```

- [ ] **Step 2: Write the failing test for the shared options builder**

Create `apps/tratt/src/app/core/store/idb/build-mode-options.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import { SessionFile } from '../../obj/SessionFile';
import { buildModeOptions } from './build-mode-options';

function makeState(overrides: Record<string, unknown> = {}): any {
  return {
    sessionFile: new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav'),
    importConverter: 'AnnotJSON',
    currentEditor: '2D-Editor',
    transcript: { selectedLevelIndex: 2 },
    logging: { enabled: true },
    currentSession: {
      loadFromServer: false,
      assessment: null,
      comment: 'hello',
    },
    additionalSpeakerIds: [],
    ...overrides,
  };
}

describe('buildModeOptions', () => {
  it('produces the same field set the options save path has always written', () => {
    const options = buildModeOptions(makeState(), undefined, undefined);

    expect(options.sessionfile).toEqual(
      new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav').toAny(),
    );
    expect(options.importConverter).toBe('AnnotJSON');
    expect(options.currentEditor).toBe('2D-Editor');
    expect(options.currentLevel).toBe(2);
    expect(options.logging).toBe(true);
    expect(options.project).toBeUndefined();
    expect(options.transcriptID).toBeUndefined();
    expect(options.comment).toBe('hello');
    expect(options.additionalSpeakerIds).toBeNull();
    expect(options.user).toBeUndefined();
  });

  it('carries the run state through when one is supplied', () => {
    expect(buildModeOptions(makeState(), undefined, 'done').runState).toBe(
      'done',
    );
  });

  it('omits runState entirely when none is supplied, rather than writing undefined', () => {
    expect('runState' in buildModeOptions(makeState(), undefined, undefined)).toBe(
      false,
    );
  });

  it('includes the authenticated user when one is present', () => {
    const options = buildModeOptions(
      makeState(),
      { id: '7', username: 'ada', email: 'ada@example.org' } as any,
      undefined,
    );
    expect(options.user).toEqual({
      id: '7',
      name: 'ada',
      email: 'ada@example.org',
    });
  });

  it('nulls the session file when the state has none', () => {
    expect(buildModeOptions(makeState({ sessionFile: undefined }), undefined, undefined)
      .sessionfile).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx nx test tratt --testPathPattern=build-mode-options`
Expected: FAIL — `Cannot find module './build-mode-options'`.

- [ ] **Step 4: Extract the options builder**

Create `apps/tratt/src/app/core/store/idb/build-mode-options.ts`:

```ts
import { AuthDtoMe } from '@octra/api-types';
import { IIDBModeOptions } from '../../shared/tratt-database';
import { AnnotationState } from '../login-mode/annotation';
import { BundleRunState } from '../pipeline-queue';

/**
 * The single definition of "what a persisted mode-options row contains",
 * hoisted out of `IDBEffects.savemodeOptions$` so the pipeline-queue's own
 * persistence effect writes the IDENTICAL field set for a bundle that isn't
 * the selected one.
 *
 * This shared definition is load-bearing, not tidiness: `TrattDatabase.
 * saveModeData()`'s LOCAL branch does `bundles.update([bundleId, name],
 * { value: prepared })` — it REPLACES the stored value object rather than
 * merging into it. Two writers with two different field sets would silently
 * erase each other's fields (a `{runState}`-only write would wipe
 * `sessionfile` and break bundle restore; an options write with no
 * `runState` would wipe a finished run's `'done'`). Both writers therefore
 * build the whole object here, and both pass the CURRENT `runState` from the
 * pipelineQueue slice.
 */
export function buildModeOptions(
  modeState: AnnotationState,
  me: AuthDtoMe | undefined,
  runState: BundleRunState | undefined,
): IIDBModeOptions {
  return {
    sessionfile:
      modeState?.sessionFile && Object.keys(modeState.sessionFile).length > 0
        ? modeState.sessionFile.toAny()
        : null,
    importConverter: modeState.importConverter,
    currentEditor: modeState.currentEditor ?? null,
    currentLevel: modeState.transcript?.selectedLevelIndex ?? null,
    logging: modeState.logging.enabled ?? null,
    project: modeState.currentSession?.loadFromServer
      ? (modeState.currentSession?.currentProject ?? null)
      : undefined,
    transcriptID: modeState.currentSession?.loadFromServer
      ? (modeState.currentSession?.task?.id ?? null)
      : undefined,
    feedback: modeState.currentSession?.assessment ?? null,
    comment: modeState.currentSession?.comment ?? null,
    additionalSpeakerIds: modeState.additionalSpeakerIds?.length
      ? modeState.additionalSpeakerIds
      : null,
    user: me
      ? {
          id: me.id,
          name: me.username,
          email: me.email,
        }
      : undefined,
    ...(runState !== undefined ? { runState } : {}),
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx nx test tratt --testPathPattern=build-mode-options`
Expected: PASS.

- [ ] **Step 6: Rewire `savemodeOptions$` onto the shared builder**

In `apps/tratt/src/app/core/store/idb/idb-effects.service.ts`, add imports:

```ts
import { runStatusOf } from '../pipeline-queue';
import { buildModeOptions } from './build-mode-options';
```

Then replace the whole inline options object literal inside `savemodeOptions$` (the `{ sessionfile: ..., user: ... }` block spanning lines 522-550) with a call to the builder. The `mergeMap` body becomes:

```ts
      mergeMap(([action, appState]) => {
        const modeState = this.getModeStateFromString(
          appState,
          (action as any).mode,
        );

        if (modeState) {
          const bundleId = this.resolveLocalBundleId(
            (action as any).mode,
            appState,
          );
          // Always re-write the CURRENT runState, never omit it: this write
          // replaces the whole stored options object (see buildModeOptions'
          // doc comment), so omitting it would erase a finished run's state.
          const runState =
            bundleId === undefined
              ? undefined
              : runStatusOf(appState.pipelineQueue.runs, bundleId).state;

          return this.idbService
            .saveModeOptions(
              (action as any).mode,
              buildModeOptions(
                modeState,
                appState.authentication.me,
                runState,
              ),
              bundleId,
            )
            .pipe(
              map(() => {
                return IDBActions.saveModeOptions.success({
                  mode: (action as any).mode,
                });
              }),
              catchError((error) => {
                return of(
                  IDBActions.saveModeOptions.fail({
                    error,
                  }),
                );
              }),
            );
        } else {
          return of(
            IDBActions.saveModeOptions.success({
              mode: (action as any).mode,
            }),
          );
        }
      }),
```

- [ ] **Step 7: Verify the existing IDB effect tests still pass**

Run: `npx nx test tratt --testPathPattern=idb-effects`
Expected: PASS. If a test's mocked state has no `pipelineQueue` key, add `pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} }` to that fixture — do not make `runStatusOf` defensive against a missing slice (the reducer always registers it).

- [ ] **Step 8: Write the failing test for the queue persistence effect**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Observable, of, Subject } from 'rxjs';
import { SessionFile } from '../../obj/SessionFile';
import { IDBService } from '../../shared/service/idb.service';
import { LoginMode, RootState } from '../index';
import { localBundleAdapter } from '../login-mode/annotation/local-bundle-collection';
import { PipelineQueueActions } from './pipeline-queue.actions';
import { PipelineQueuePersistenceEffects } from './pipeline-queue-persistence.effects';

describe('PipelineQueuePersistenceEffects', () => {
  let actions$: Subject<any>;
  let store: MockStore<RootState>;
  let idbService: { saveModeOptions: jest.Mock<any> };
  let effects: PipelineQueuePersistenceEffects;

  const bundleA = {
    bundleId: 'a',
    sessionFile: new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav'),
    importConverter: 'AnnotJSON',
    currentEditor: '2D-Editor',
    transcript: { selectedLevelIndex: 0 },
    logging: { enabled: true },
    currentSession: { loadFromServer: false },
    additionalSpeakerIds: [],
  } as any;

  const initialState = {
    authentication: { me: undefined },
    localMode: {
      bundles: localBundleAdapter.setAll(
        [bundleA],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'a',
    },
    pipelineQueue: {
      queue: [],
      activeId: 'a',
      mode: 'running',
      runs: { a: { state: 'running', stage: 'asr' } },
    },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new Subject<any>();
    idbService = { saveModeOptions: jest.fn(() => of(undefined)) };

    TestBed.configureTestingModule({
      providers: [
        PipelineQueuePersistenceEffects,
        provideMockActions(() => actions$ as Observable<any>),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: idbService },
      ],
    });

    store = TestBed.inject(MockStore);
    effects = TestBed.inject(PipelineQueuePersistenceEffects);
    effects.saveRunState$.subscribe();
  });

  it('writes the active bundle\'s full options row including runState on activateNext', () => {
    actions$.next(PipelineQueueActions.activateNext());

    expect(idbService.saveModeOptions).toHaveBeenCalledTimes(1);
    const [mode, options, bundleId] = idbService.saveModeOptions.mock
      .calls[0] as any[];
    expect(mode).toBe(LoginMode.LOCAL);
    expect(bundleId).toBe('a');
    expect(options.runState).toBe('running');
    // The rest of the row must still be there — this write replaces the
    // whole stored value, so a partial write would break bundle restore.
    expect(options.sessionfile).not.toBeNull();
    expect(options.currentEditor).toBe('2D-Editor');
  });

  it('writes the finished bundle\'s row on bundleDone, keyed by the action\'s bundleId', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'running',
        runs: { a: { state: 'done' } },
      },
    } as unknown as RootState);

    actions$.next(PipelineQueueActions.bundleDone({ bundleId: 'a' }));

    const [, options, bundleId] = idbService.saveModeOptions.mock
      .calls[0] as any[];
    expect(bundleId).toBe('a');
    expect(options.runState).toBe('done');
  });

  it('writes nothing for a bundle that has no entity in the store', () => {
    actions$.next(PipelineQueueActions.bundleDone({ bundleId: 'ghost' }));
    expect(idbService.saveModeOptions).not.toHaveBeenCalled();
  });

  it('writes every bundle whose state was reset by stopped', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'idle',
        runs: { a: { state: 'idle' } },
      },
    } as unknown as RootState);

    actions$.next(PipelineQueueActions.stopped());

    expect(idbService.saveModeOptions).toHaveBeenCalledTimes(1);
    const [, options, bundleId] = idbService.saveModeOptions.mock
      .calls[0] as any[];
    expect(bundleId).toBe('a');
    expect(options.runState).toBe('idle');
  });
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npx nx test tratt --testPathPattern=pipeline-queue-persistence`
Expected: FAIL — `Cannot find module './pipeline-queue-persistence.effects'`.

- [ ] **Step 10: Write the queue persistence effect**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.ts`:

```ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import {
  catchError,
  EMPTY,
  forkJoin,
  mergeMap,
  of,
  withLatestFrom,
} from 'rxjs';
import { IDBService } from '../../shared/service/idb.service';
import { buildModeOptions } from '../idb/build-mode-options';
import { LoginMode, RootState } from '../index';
import { runStatusOf } from './index';
import { PipelineQueueActions } from './pipeline-queue.actions';

/**
 * Persists each bundle's `runState` into its own `bundles` options row
 * whenever the queue transitions that bundle's state.
 *
 * A dedicated effect rather than extra entries in `IDBEffects.
 * savemodeOptions$`'s trigger list (the spec's "following the existing
 * savemodeOptions$ trigger-list convention"): that effect resolves its
 * target bundle as `state.localMode.selectedBundleId`, but the queue is
 * almost always transitioning a bundle the user does NOT have selected —
 * routing queue actions through it would write bundle X's run state onto
 * bundle Y's row. This effect reads the target bundle's own AnnotationState
 * out of the entity collection by the action's explicit bundleId instead.
 *
 * It shares `buildModeOptions()` with `savemodeOptions$` so both writers
 * emit the identical field set — mandatory, because the underlying LOCAL
 * write replaces the whole stored options object (see that function's own
 * doc comment).
 *
 * `{ dispatch: false }`: a save failure here must not disturb the queue or
 * the user's editing session. The run itself already happened; a lost
 * runState row degrades to "this bundle looks idle after a reload," which is
 * strictly better than interrupting the queue.
 */
@Injectable()
export class PipelineQueuePersistenceEffects {
  saveRunState$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          PipelineQueueActions.enqueued,
          PipelineQueueActions.activateNext,
          PipelineQueueActions.bundleDone,
          PipelineQueueActions.bundleFailed,
          PipelineQueueActions.stopped,
        ),
        withLatestFrom(this.store),
        mergeMap(([action, appState]) => {
          const bundleIds = this.resolveBundleIds(action, appState);
          if (bundleIds.length === 0) {
            return EMPTY;
          }
          const writes = bundleIds
            .map((bundleId) => this.writeOne(bundleId, appState))
            .filter((write): write is NonNullable<typeof write> => !!write);
          return writes.length > 0 ? forkJoin(writes) : EMPTY;
        }),
      ),
    { dispatch: false },
  );

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private idbService: IDBService,
  ) {}

  /**
   * Which bundles this action changed the persisted state of. `enqueued`
   * and `stopped` change several at once; the rest change exactly one —
   * `activateNext` changes whichever bundle is active AFTER the reducer ran,
   * which `withLatestFrom(this.store)` above already sees.
   */
  private resolveBundleIds(action: Action, appState: RootState): string[] {
    if (action.type === PipelineQueueActions.enqueued.type) {
      return (action as ReturnType<typeof PipelineQueueActions.enqueued>)
        .bundleIds;
    }
    if (action.type === PipelineQueueActions.activateNext.type) {
      const activeId = appState.pipelineQueue.activeId;
      return activeId === null ? [] : [activeId];
    }
    if (action.type === PipelineQueueActions.stopped.type) {
      return Object.keys(appState.pipelineQueue.runs);
    }
    return [
      (
        action as ReturnType<
          | typeof PipelineQueueActions.bundleDone
          | typeof PipelineQueueActions.bundleFailed
        >
      ).bundleId,
    ];
  }

  private writeOne(bundleId: string, appState: RootState) {
    const modeState = appState.localMode.bundles.entities[bundleId];
    if (!modeState) {
      return undefined;
    }
    return this.idbService
      .saveModeOptions(
        LoginMode.LOCAL,
        buildModeOptions(
          modeState,
          appState.authentication.me,
          runStatusOf(appState.pipelineQueue.runs, bundleId).state,
        ),
        bundleId,
      )
      .pipe(
        // Best-effort, per this effect's doc comment: never let a failed
        // persist surface as an unhandled error that kills the effect
        // stream (which would silently stop persisting for the rest of the
        // session).
        mergeMap(() => of(undefined)),
        catchError(() => of(undefined)),
      );
  }
}
```


- [ ] **Step 11: Run it to verify it passes**

Run: `npx nx test tratt --testPathPattern=pipeline-queue-persistence`
Expected: PASS.

- [ ] **Step 12: Register the effect in `main.ts`**

In `apps/tratt/src/main.ts`, add:

```ts
import { PipelineQueuePersistenceEffects } from './app/core/store/pipeline-queue/pipeline-queue-persistence.effects';
```

and add `PipelineQueuePersistenceEffects,` to the `EffectsModule.forRoot([...])` array, right after `BundleRestoreEffects,`.

- [ ] **Step 13: Write the failing restore-as-interrupted test**

Append to `apps/tratt/src/app/core/store/login-mode/annotation/bundle-restore.effects.spec.ts` (inside its existing top-level `describe`, matching its existing fixture/mocking style — read the file first and reuse its `idbService` mock and `store.dispatch` spy rather than building new ones):

```ts
  it('rehydrates a persisted queued/running runState as interrupted, for bundle-1 too', async () => {
    // listLocalBundleIds returns bundle-1 plus one restored bundle; the
    // effect must read runState for BOTH (bundle-1's entity restore is
    // handled by the pre-existing loadOptions$ effects, but nothing else
    // restores its run state).
    idbService.listLocalBundleIds.mockReturnValue(of(['bundle-1', 'bundle-2']));
    idbService.loadModeOptions.mockImplementation((_mode: any, id: string) =>
      of(
        id === 'bundle-1'
          ? { sessionfile: null, runState: 'running' }
          : {
              sessionfile: new SessionFile(
                'b.wav',
                2,
                new Date(2024, 0, 1),
                'audio/wav',
              ).toAny(),
              runState: 'queued',
            },
      ),
    );
    idbService.loadAnnotation.mockReturnValue(of(undefined));

    actions$.next(IDBActions.loadOptions.success({} as any));
    await Promise.resolve();

    expect(dispatchSpy).toHaveBeenCalledWith(
      PipelineQueueActions.restoreInterrupted({
        entries: [
          { bundleId: 'bundle-1', state: 'running' },
          { bundleId: 'bundle-2', state: 'queued' },
        ],
      }),
    );
  });

  it('does not dispatch restoreInterrupted when no bundle has a persisted runState', async () => {
    idbService.listLocalBundleIds.mockReturnValue(of(['bundle-1']));
    idbService.loadModeOptions.mockReturnValue(of({ sessionfile: null }));
    idbService.loadAnnotation.mockReturnValue(of(undefined));

    actions$.next(IDBActions.loadOptions.success({} as any));
    await Promise.resolve();

    expect(
      dispatchSpy.mock.calls.filter(
        ([a]: any[]) =>
          a.type === PipelineQueueActions.restoreInterrupted.type,
      ),
    ).toEqual([]);
  });
```

Add the imports this needs at the top of that spec: `import { PipelineQueueActions } from '../../pipeline-queue/pipeline-queue.actions';`.

- [ ] **Step 14: Run it to verify it fails**

Run: `npx nx test tratt --testPathPattern=bundle-restore`
Expected: FAIL — `restoreInterrupted` is never dispatched.

- [ ] **Step 15: Dispatch `restoreInterrupted` from `BundleRestoreEffects`**

In `apps/tratt/src/app/core/store/login-mode/annotation/bundle-restore.effects.ts`:

Add the import:

```ts
import { BundleRunState } from '../../pipeline-queue';
import { PipelineQueueActions } from '../../pipeline-queue/pipeline-queue.actions';
```

Change `loadBundle` so `DEFAULT_BUNDLE_ID` is loaded too (options only, for its run state) — replace the `switchMap((bundleIds) => {...})` body's filtering with:

```ts
            switchMap((bundleIds) => {
              const otherBundleIds = bundleIds.filter(
                (bundleId) => bundleId !== DEFAULT_BUNDLE_ID,
              );
              // bundle-1's ENTITY is restored by the pre-existing
              // loadOptions$/loadAnnotation$ boot effects (restoring it here
              // too would double-populate it) — but nothing else restores
              // its persisted runState, so load its options row here purely
              // for that one field. `loadBundle` is reused unchanged: its
              // extra loadAnnotation call for bundle-1 is a read, and the
              // result is discarded below by the DEFAULT_BUNDLE_ID skip in
              // the createBundle loop.
              const idsToLoad = bundleIds.includes(DEFAULT_BUNDLE_ID)
                ? [DEFAULT_BUNDLE_ID, ...otherBundleIds]
                : otherBundleIds;

              if (idsToLoad.length === 0) {
                return of([] as (RestoredBundleData | undefined)[]);
              }

              return forkJoin(
                idsToLoad.map((bundleId) =>
                  this.loadBundle(bundleId).pipe(
                    catchError((error) => {
                      console.error(
                        `[BundleRestoreEffects] failed to load bundle "${bundleId}" — skipping`,
                        error,
                      );
                      return of(undefined);
                    }),
                  ),
                ),
              );
            }),
```

Then, inside the existing `tap((results) => {...})`, guard the `createBundle` dispatch against `DEFAULT_BUNDLE_ID` and collect run states. Replace the `for (const result of results) {...}` loop with:

```ts
              const runEntries: { bundleId: string; state: BundleRunState }[] =
                [];

              for (const result of results) {
                if (!result) {
                  continue;
                }

                const persistedRunState = result.options?.runState;
                if (persistedRunState) {
                  runEntries.push({
                    bundleId: result.bundleId,
                    state: persistedRunState,
                  });
                }

                if (result.bundleId === DEFAULT_BUNDLE_ID) {
                  // Entity already restored by loadOptions$/loadAnnotation$;
                  // this row was loaded only for its runState above.
                  continue;
                }

                if (!result.options?.sessionfile) {
                  // Defensive skip: an unused/blank bundle should never have
                  // gotten a real bundleId beyond bundle-1 in the first
                  // place — but guard anyway.
                  continue;
                }

                const sessionFile = SessionFile.fromAny(
                  result.options.sessionfile,
                );
                if (!sessionFile) {
                  continue;
                }

                this.store.dispatch(
                  LoginModeActions.createBundle({
                    mode: LoginMode.LOCAL,
                    bundleId: result.bundleId,
                    sessionFile,
                    restoredOptions: result.options,
                    restoredAnnotation: result.annotation,
                  }),
                );
              }

              if (runEntries.length > 0) {
                // 'queued'/'running' become 'interrupted' in the reducer —
                // a run NEVER silently resumes across a reload.
                this.store.dispatch(
                  PipelineQueueActions.restoreInterrupted({
                    entries: runEntries,
                  }),
                );
              }
```

(The unconditional `selectBundle(DEFAULT_BUNDLE_ID)` dispatch after the loop stays exactly as it is.)

- [ ] **Step 16: Run the restore tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=bundle-restore`
Expected: PASS — including every pre-existing test in that file (especially the ones asserting `createBundle` is NOT dispatched for `bundle-1`).

- [ ] **Step 17: Run the full suite**

Run: `npx nx test tratt`
Expected: PASS.

- [ ] **Step 18: Commit**

```bash
git add apps/tratt/src/app/core/shared/tratt-database.ts apps/tratt/src/app/core/store/idb apps/tratt/src/app/core/store/pipeline-queue apps/tratt/src/app/core/store/login-mode/annotation/bundle-restore.effects.ts apps/tratt/src/app/core/store/login-mode/annotation/bundle-restore.effects.spec.ts apps/tratt/src/main.ts
git commit -m "feat(store): persist per-bundle pipeline runState and restore it as interrupted"
```

---

### Task 3: bundle run error classification

**Files:**
- Create: `apps/tratt/src/app/core/store/pipeline-queue/bundle-run-errors.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/bundle-run-errors.spec.ts`

**Interfaces:**
- Consumes: `classifyTranscriptionWorkerError(raw: string, usedWebGPU: boolean): { code: 'webgpu-backend-load-failed' | 'webgpu-runtime' | 'unknown'; shouldFallbackToWasm: boolean }` from `../../shared/service/local-transcription-errors`; `PipelineEvent` from `../../shared/service/pipeline-runner.service`; `BundleRunError` from `./index`.
- Produces: `classifyBundleRunError(error: unknown, usedWebGPU: boolean): BundleRunError`; `bundleRunErrorFromPipelineEvent(event: PipelineEvent): BundleRunError | null`; `DECODE_FAILURE_MESSAGE`.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `apps/tratt/src/app/core/store/pipeline-queue/bundle-run-errors.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import {
  bundleRunErrorFromPipelineEvent,
  classifyBundleRunError,
} from './bundle-run-errors';

describe('classifyBundleRunError', () => {
  it('classifies the audio-decode failure the runner surfaces as decode', () => {
    expect(
      classifyBundleRunError(
        new Error('Audio channel data not available'),
        false,
      ),
    ).toEqual({
      kind: 'decode',
      message: 'Audio channel data not available',
    });
  });

  it('classifies the friendly WebGPU runtime message as oom', () => {
    const friendly =
      'WebGPU error: the GPU ran out of memory or lost its connection ' +
      '(common with large models or after the display sleeps). ' +
      'Try disabling WebGPU in the transcription options and run with WASM instead.';
    expect(classifyBundleRunError(new Error(friendly), true).kind).toBe('oom');
  });

  it('classifies the raw backend-import failure as model-load', () => {
    const raw =
      'no available backend found. ERR: [webgpu] importing a module script failed';
    expect(classifyBundleRunError(new Error(raw), true).kind).toBe(
      'model-load',
    );
  });

  it('classifies a plain out-of-memory message as oom even without WebGPU', () => {
    expect(
      classifyBundleRunError(new Error('WASM allocation failed'), false).kind,
    ).toBe('oom');
  });

  it('classifies a model download failure as model-load', () => {
    expect(
      classifyBundleRunError(
        new Error('Failed to fetch model onnx-community/kb-whisper-small-ONNX'),
        false,
      ).kind,
    ).toBe('model-load');
  });

  it('falls back to unknown for anything unrecognised', () => {
    expect(classifyBundleRunError(new Error('something odd'), false)).toEqual({
      kind: 'unknown',
      message: 'something odd',
    });
  });

  it('accepts a plain string and a non-error value', () => {
    expect(classifyBundleRunError('plain string failure', false)).toEqual({
      kind: 'unknown',
      message: 'plain string failure',
    });
    expect(classifyBundleRunError(undefined, false)).toEqual({
      kind: 'unknown',
      message: 'Unknown pipeline error.',
    });
  });
});

describe('bundleRunErrorFromPipelineEvent', () => {
  it('maps the pipeline cancelled event to the cancelled kind', () => {
    expect(
      bundleRunErrorFromPipelineEvent({
        stage: 'pipeline',
        type: 'cancelled',
      }),
    ).toEqual({ kind: 'cancelled', message: 'Run cancelled.' });
  });

  it('returns null for every non-terminal event', () => {
    expect(
      bundleRunErrorFromPipelineEvent({
        stage: 'pipeline',
        type: 'stalled',
        phase: 'downloading',
        message: 'stalled',
      }),
    ).toBeNull();
    expect(
      bundleRunErrorFromPipelineEvent({ stage: 'diarization', type: 'skipped' }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx nx test tratt --testPathPattern=bundle-run-errors`
Expected: FAIL — `Cannot find module './bundle-run-errors'`.

- [ ] **Step 3: Write the classifier**

Create `apps/tratt/src/app/core/store/pipeline-queue/bundle-run-errors.ts`:

```ts
import { classifyTranscriptionWorkerError } from '../../shared/service/local-transcription-errors';
import type { PipelineEvent } from '../../shared/service/pipeline-runner.service';
import { BundleRunError } from './index';

/**
 * The exact message `LocalTranscriptionService` errors with when
 * `prepareMonoAudioForMlModel()` finds no channel data
 * (local-transcription.service.ts:88) — the one decode-class failure
 * `PipelineRunnerService.run()` itself can produce.
 */
export const DECODE_FAILURE_MESSAGE = 'Audio channel data not available';

const OOM_MARKERS = [
  'out of memory',
  'oom',
  'allocation failed',
  'array buffer allocation failed',
  'quotaexceeded',
];

const MODEL_LOAD_MARKERS = [
  'no available backend',
  'importing a module script failed',
  'failed to fetch',
  'failed to load model',
  'networkerror',
  'could not locate file',
];

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'Unknown pipeline error.';
}

/**
 * Maps whatever `PipelineRunnerService.run()`'s Observable errors with onto
 * the spec's five `BundleRunErrorKind` classes.
 *
 * `classifyTranscriptionWorkerError()` is reused rather than reimplemented,
 * but it alone is not sufficient here, for a reason found by reading the
 * source: `LocalTranscriptionService` wraps the FRIENDLY message
 * (`transcriptionFriendlyError(...)`) in the `Error` it errors with
 * (local-transcription.service.ts:181-185), not the raw worker message. The
 * friendly text still classifies as 'webgpu-runtime' (it contains "gpu"),
 * but can never classify as 'webgpu-backend-load-failed' — that branch needs
 * raw substrings the friendly text drops. The raw path IS still reachable
 * (diarization's worker errors are not rewritten, and an unrecognised
 * transcription error passes through verbatim since `transcriptionFriendly
 * Error` returns `raw` in its default branch), so both are handled: the
 * classifier is consulted first, then message markers fill the gaps.
 */
export function classifyBundleRunError(
  error: unknown,
  usedWebGPU: boolean,
): BundleRunError {
  const message = messageOf(error);
  const lower = message.toLowerCase();

  if (lower.includes(DECODE_FAILURE_MESSAGE.toLowerCase())) {
    return { kind: 'decode', message };
  }

  const info = classifyTranscriptionWorkerError(message, usedWebGPU);
  if (info.code === 'webgpu-backend-load-failed') {
    return { kind: 'model-load', message };
  }
  if (info.code === 'webgpu-runtime') {
    // 'webgpu-runtime' is specifically "the GPU ran out of memory or lost
    // its connection" — the spec's 'oom' class, not 'unknown'.
    return { kind: 'oom', message };
  }

  if (OOM_MARKERS.some((marker) => lower.includes(marker))) {
    return { kind: 'oom', message };
  }
  if (MODEL_LOAD_MARKERS.some((marker) => lower.includes(marker))) {
    return { kind: 'model-load', message };
  }

  return { kind: 'unknown', message };
}

/**
 * The one `PipelineEvent` that is itself a terminal failure for the queue:
 * `{stage:'pipeline', type:'cancelled'}`, emitted by
 * `PipelineRunnerService.cancel()` right before it completes the run
 * Observable. `'stalled'` is deliberately NOT terminal — the runner keeps
 * running after a stall; it is a warning, and treating it as a failure would
 * abandon runs that go on to succeed.
 */
export function bundleRunErrorFromPipelineEvent(
  event: PipelineEvent,
): BundleRunError | null {
  if (event.stage === 'pipeline' && event.type === 'cancelled') {
    return { kind: 'cancelled', message: 'Run cancelled.' };
  }
  return null;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx nx test tratt --testPathPattern=bundle-run-errors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/pipeline-queue/bundle-run-errors.ts apps/tratt/src/app/core/store/pipeline-queue/bundle-run-errors.spec.ts
git commit -m "feat(store): classify pipeline failures into bundle run error kinds"
```

---

### Task 4: `PipelineQueueService` — the FIFO drain loop

**Files:**
- Modify: `apps/tratt/src/app/core/shared/service/audio.service.ts` (make `ensureResident` public + outcome-reporting; add `getManager`)
- Modify: `apps/tratt/src/app/core/shared/service/audio.service.spec.ts` (cover the two changed/added members)
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-progress.ts`
- Create: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-progress.spec.ts`
- Create: `apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts`
- Create: `apps/tratt/src/app/core/shared/service/pipeline-queue.service.spec.ts`

**Interfaces:**
- Consumes: `PipelineRunnerService.run(input: PipelineInput): Observable<PipelineEvent>` and `PipelineRunnerService.cancel(): void` (both unchanged); `mapPipelineEventToAction(event: PipelineEvent): Action` and `dispatchPipelineActions(action$: Observable<Action>): Observable<Action>` from `../../store/pipeline/pipeline-event-mapping`; `PipelineQueueActions`, `computeReadyBundleIds`, `runStatusOf`, `selectAllRunStatuses`, `selectPipelineQueueFeature`; `classifyBundleRunError`, `bundleRunErrorFromPipelineEvent` (Task 3); `selectAllBundleSummaries`; `TranscriptionOptions`.
- Produces: `AudioService.ensureResident(bundleId: string): Promise<boolean>` (now public), `AudioService.getManager(bundleId: string): AudioManager | undefined`; `mapPipelineActionToQueueProgress(action, audioDurationS)`; `PipelineQueueService` with `setTranscribeOptions(options: TranscriptionOptions | null): void`, `enqueue(bundleIds: string[]): void`, `stop(): void`, `cancelActive(): void`, `retry(bundleId: string): void`, and a read-only `onResult` hook is NOT part of this task (the transcript write-back is Task 5).

**Steps:**

- [ ] **Step 1: Write the failing AudioService tests**

Append to `apps/tratt/src/app/core/shared/service/audio.service.spec.ts` (read the file first; reuse its existing `fakeFile` helper, its `AudioManager.create` mock, and its TestBed setup rather than re-deriving them):

```ts
  it('getManager returns the manager registered for that bundle, regardless of selection', () => {
    const manager = fakeManager();
    service.registerAudioManager('bundle-x', manager as any);
    expect(service.getManager('bundle-x')).toBe(manager);
    expect(service.getManager('bundle-y')).toBeUndefined();
  });

  it('ensureResident resolves true when the bundle is already resident', async () => {
    service.registerAudioManager('bundle-x', fakeManager() as any);
    await expect(service.ensureResident('bundle-x')).resolves.toBe(true);
  });

  it('ensureResident resolves false when no source file was ever retained', async () => {
    await expect(service.ensureResident('bundle-never-seen')).resolves.toBe(
      false,
    );
  });

  it('ensureResident resolves false when the re-decode throws', async () => {
    const manager = fakeManager();
    const file = fakeFile('a.wav', 4, 'audio/wav', 1);
    (file.arrayBuffer as jest.Mock<any>).mockRejectedValue(
      new Error('read failed') as never,
    );
    service.registerAudioManager('bundle-x', manager as any, file);
    service.evict('bundle-x');

    await expect(service.ensureResident('bundle-x')).resolves.toBe(false);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx nx test tratt --testPathPattern=audio.service`
Expected: FAIL — `service.getManager is not a function`, and `ensureResident` is `private` (TS error) / resolves `undefined`.

- [ ] **Step 3: Make `ensureResident` public and add `getManager`**

In `apps/tratt/src/app/core/shared/service/audio.service.ts`, add `getManager` next to `hasResident`:

```ts
  /**
   * The `AudioManager` registered for a SPECIFIC bundle, independent of the
   * current selection (`current` resolves through `selectedBundleId`). The
   * pipeline queue runs bundles the user has not selected, so it cannot use
   * `current`.
   */
  public getManager(bundleId: string): AudioManager | undefined {
    return this._audiomanagers.get(bundleId);
  }
```

and change `ensureResident`'s signature/return (keeping the whole existing body, only adding the returns):

```ts
  /**
   * Re-decodes `bundleId`'s audio from its retained source `File` and
   * re-registers the resulting `AudioManager`, if `bundleId` currently has
   * no resident manager (e.g. it was LRU-evicted by `trackSelection()`) but
   * does have a source `File` on record (registered via
   * `registerAudioManager(..., sourceFile)`).
   *
   * Resolves to whether `bundleId` has a resident manager afterwards. Public
   * (and outcome-reporting) since step 3b-i: the pipeline queue must ensure
   * residency before running a bundle and needs to distinguish "ready" from
   * "could not decode" (its `'decode'` error class) — the selection `effect`
   * in the constructor still calls it fire-and-forget and ignores the
   * result, exactly as before.
   */
  public async ensureResident(bundleId: string): Promise<boolean> {
    if (this._audiomanagers.has(bundleId)) {
      return true;
    }
    if (this._pendingResidency.has(bundleId)) {
      return false;
    }
    const sourceFile = this._sourceFiles.get(bundleId);
    if (!sourceFile) {
      return false;
    }
    this._pendingResidency.add(bundleId);
    try {
      const buffer = await sourceFile.arrayBuffer();
      const result = await firstValueFrom(
        AudioManager.create(sourceFile.name, sourceFile.type, buffer).pipe(
          filter((r) => r.progress === 1 && !!r.audioManager),
        ),
      );
      if (result.audioManager) {
        this.registerAudioManager(bundleId, result.audioManager);
      }
    } catch (e) {
      // Re-decode failed (corrupted/stale retained File, or the create()
      // stream completed without ever reaching progress===1) — best-effort,
      // matching evict()'s pattern above: leave the bundle unresident rather
      // than surfacing an unhandled rejection. The user sees a no-audio
      // state for that bundle and can retry by reselecting it again; the
      // queue turns the `false` return below into a 'decode' run error.
    } finally {
      this._pendingResidency.delete(bundleId);
    }
    return this._audiomanagers.has(bundleId);
  }
```

Move the `private _pendingResidency = new Set<string>();` field declaration so it still precedes this method (it already does — leave it where it is).

- [ ] **Step 4: Run the AudioService tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=audio.service`
Expected: PASS (existing tests included — the constructor `effect`'s `void this.ensureResident(id)` call is unaffected by the changed return type).

- [ ] **Step 5: Write the failing progress-mapping tests**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-progress.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import { PipelineActions } from '../pipeline/pipeline.actions';
import { mapPipelineActionToQueueProgress } from './pipeline-queue-progress';

describe('mapPipelineActionToQueueProgress', () => {
  it('maps transcription download progress to the asr stage', () => {
    const result = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: {
          type: 'download-progress',
          loaded: 25,
          total: 100,
          file: 'model.onnx',
        },
      }),
      0,
    );
    expect(result.update).toEqual({ stage: 'asr', progress: 0.25 });
    expect(result.audioDurationS).toBe(0);
  });

  it('captures the audio duration from transcribe-start and uses it for segment progress', () => {
    const started = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: { type: 'transcribe-start', audioDurationS: 40 },
      }),
      0,
    );
    expect(started.update).toEqual({ stage: 'asr', progress: 0 });
    expect(started.audioDurationS).toBe(40);

    const progressed = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: { type: 'segment-progress', segmentEndS: 10 },
      }),
      started.audioDurationS,
    );
    expect(progressed.update).toEqual({ stage: 'asr', progress: 0.25 });
  });

  it('reports segment progress with no stage progress value when the duration is unknown', () => {
    const result = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: { type: 'segment-progress', segmentEndS: 10 },
      }),
      0,
    );
    expect(result.update).toEqual({ stage: 'asr' });
  });

  it('maps diarization start and download progress to the diarization stage', () => {
    expect(
      mapPipelineActionToQueueProgress(PipelineActions.diarizationStarted(), 0)
        .update,
    ).toEqual({ stage: 'diarization', progress: 0 });

    expect(
      mapPipelineActionToQueueProgress(
        PipelineActions.diarizationEvent({
          event: {
            type: 'download-progress',
            loaded: 1,
            total: 4,
            file: 'seg.onnx',
          },
        }),
        0,
      ).update,
    ).toEqual({ stage: 'diarization', progress: 0.25 });
  });

  it('maps translation start and segment progress to the translation stage', () => {
    expect(
      mapPipelineActionToQueueProgress(PipelineActions.translationStart(), 0)
        .update,
    ).toEqual({ stage: 'translation', progress: 0 });

    expect(
      mapPipelineActionToQueueProgress(
        PipelineActions.translationEvent({
          event: { type: 'segment-progress', index: 3, total: 12 },
        }),
        0,
      ).update,
    ).toEqual({ stage: 'translation', progress: 0.25 });
  });

  it('guards against a zero total rather than emitting NaN', () => {
    expect(
      mapPipelineActionToQueueProgress(
        PipelineActions.transcriptionEvent({
          event: {
            type: 'download-progress',
            loaded: 0,
            total: 0,
            file: 'model.onnx',
          },
        }),
        0,
      ).update,
    ).toEqual({ stage: 'asr' });
  });

  it('returns no update for actions that carry no stage progress', () => {
    expect(
      mapPipelineActionToQueueProgress(PipelineActions.cancelled(), 0).update,
    ).toBeNull();
    expect(
      mapPipelineActionToQueueProgress(
        PipelineActions.diarizationSkipped(),
        0,
      ).update,
    ).toBeNull();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx nx test tratt --testPathPattern=pipeline-queue-progress`
Expected: FAIL — `Cannot find module './pipeline-queue-progress'`.

- [ ] **Step 7: Write the progress mapper**

Create `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-progress.ts`:

```ts
import { Action } from '@ngrx/store';
import { PipelineActions } from '../pipeline/pipeline.actions';
import { BundleRunStage } from './index';

export interface QueueProgressUpdate {
  stage: BundleRunStage;
  progress?: number;
}

export interface QueueProgressResult {
  /** null when the action carries no stage/progress information. */
  update: QueueProgressUpdate | null;
  /**
   * Carried forward between calls: transcription `segment-progress` events
   * report `segmentEndS` only, so the total duration must be remembered
   * from the earlier `transcribe-start` event to turn it into a fraction.
   */
  audioDurationS: number;
}

function fraction(loaded: number, total: number): number | undefined {
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return Math.min(1, Math.max(0, loaded / total));
}

function update(
  stage: BundleRunStage,
  progress: number | undefined,
): QueueProgressUpdate {
  return progress === undefined ? { stage } : { stage, progress };
}

/**
 * Turns one already-mapped `PipelineActions` action (produced by step 3a's
 * `mapPipelineEventToAction`, reused verbatim) into a bundle-scoped queue
 * progress update.
 *
 * Deliberately a pure function over the step-3a action type rather than over
 * the raw `PipelineEvent`: `PipelineQueueService` pipes the event stream
 * through `mapPipelineEventToAction` → `dispatchPipelineActions()` so it
 * inherits 3a's order-preserving ~4Hz throttle exactly, and this runs on the
 * far side of that throttle. The old singleton `pipeline` slice's ACTIONS
 * are reused as an intermediate representation; none of them are ever
 * dispatched by the queue, so the `pipeline` slice's own state is never
 * touched.
 */
export function mapPipelineActionToQueueProgress(
  action: Action,
  audioDurationS: number,
): QueueProgressResult {
  if (action.type === PipelineActions.transcriptionEvent.type) {
    const event = (action as ReturnType<
      typeof PipelineActions.transcriptionEvent
    >).event;
    switch (event.type) {
      case 'download-progress':
        return {
          update: update('asr', fraction(event.loaded, event.total)),
          audioDurationS,
        };
      case 'transcribe-start':
        return {
          update: update('asr', 0),
          audioDurationS: event.audioDurationS,
        };
      case 'segment-progress':
        return {
          update: update('asr', fraction(event.segmentEndS, audioDurationS)),
          audioDurationS,
        };
      case 'backend-fallback':
        return { update: update('asr', 0), audioDurationS };
      default:
        return { update: null, audioDurationS };
    }
  }

  if (action.type === PipelineActions.diarizationStarted.type) {
    return { update: update('diarization', 0), audioDurationS };
  }

  if (action.type === PipelineActions.diarizationEvent.type) {
    const event = (action as ReturnType<typeof PipelineActions.diarizationEvent>)
      .event;
    if (event.type === 'download-progress') {
      return {
        update: update('diarization', fraction(event.loaded, event.total)),
        audioDurationS,
      };
    }
    return { update: null, audioDurationS };
  }

  if (action.type === PipelineActions.translationStart.type) {
    return { update: update('translation', 0), audioDurationS };
  }

  if (action.type === PipelineActions.translationEvent.type) {
    const event = (action as ReturnType<typeof PipelineActions.translationEvent>)
      .event;
    if (event.type === 'download-progress') {
      return {
        update: update('translation', fraction(event.loaded, event.total)),
        audioDurationS,
      };
    }
    if (event.type === 'segment-progress') {
      return {
        update: update('translation', fraction(event.index, event.total)),
        audioDurationS,
      };
    }
    return { update: null, audioDurationS };
  }

  return { update: null, audioDurationS };
}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `npx nx test tratt --testPathPattern=pipeline-queue-progress`
Expected: PASS.

- [ ] **Step 9: Write the failing service tests**

Create `apps/tratt/src/app/core/shared/service/pipeline-queue.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Same workaround as pipeline-runner.service.spec.ts: these two services
// construct their Worker via `new URL('...', import.meta.url)` at module
// scope, which ts-jest's CommonJS config cannot compile. This spec never
// touches the real classes — PipelineRunnerService itself is replaced by a
// mock below.
jest.mock('./local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('./local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { OAnnotJSON } from '@tratt/annotation';
import { provideStore, Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { LoginMode, RootState } from '../../store/index';
import { PipelineQueueActions } from '../../store/pipeline-queue/pipeline-queue.actions';
import { reducer as pipelineQueueReducer } from '../../store/pipeline-queue/pipeline-queue.reducer';
import { selectPipelineQueueFeature } from '../../store/pipeline-queue/pipeline-queue.selectors';
import { AudioService } from './audio.service';
import type { PipelineEvent } from './pipeline-runner.service';
import { PipelineRunnerService } from './pipeline-runner.service';
import { PipelineQueueService } from './pipeline-queue.service';

const LOCAL_MODE_STATE = {
  bundles: {
    ids: ['a', 'b'],
    entities: {
      a: { bundleId: 'a', audio: { loaded: true }, sessionFile: { name: 'a.wav' } },
      b: { bundleId: 'b', audio: { loaded: false }, sessionFile: { name: 'b.wav' } },
    },
  },
  selectedBundleId: 'a',
};

function fakeManager() {
  return {
    resource: {
      getOAudioFile: () => ({ name: 'a.wav', sampleRate: 16000, duration: 1 }),
      info: { fullname: 'a.wav', sampleRate: 16000, duration: 1 },
    },
  } as any;
}

describe('PipelineQueueService', () => {
  let service: PipelineQueueService;
  let store: Store<RootState>;
  let runner: { run: jest.Mock<any>; cancel: jest.Mock<any> };
  let audio: { ensureResident: jest.Mock<any>; hasResident: jest.Mock<any>; getManager: jest.Mock<any> };
  let events: Subject<PipelineEvent>[];

  function queueState() {
    let value: any;
    store.select(selectPipelineQueueFeature).subscribe((v) => (value = v)).unsubscribe();
    return value;
  }

  beforeEach(() => {
    events = [];
    runner = {
      run: jest.fn(() => {
        const subject = new Subject<PipelineEvent>();
        events.push(subject);
        return subject.asObservable();
      }),
      cancel: jest.fn(),
    };
    audio = {
      ensureResident: jest.fn(async () => true),
      hasResident: jest.fn(() => true),
      getManager: jest.fn(() => fakeManager()),
    };

    TestBed.configureTestingModule({
      providers: [
        // A REAL store (not provideMockStore): the drain loop reads the
        // queue back immediately after dispatching into it, so the reducer
        // has to actually run.
        provideStore({
          pipelineQueue: pipelineQueueReducer,
          localMode: () => LOCAL_MODE_STATE as any,
        }),
        { provide: PipelineRunnerService, useValue: runner },
        { provide: AudioService, useValue: audio },
        PipelineQueueService,
      ],
    });

    store = TestBed.inject(Store);
    service = TestBed.inject(PipelineQueueService);
    service.setTranscribeOptions({
      modelId: 'onnx-community/kb-whisper-tiny-ONNX',
      useWebGPU: false,
    });
  });

  it('runs exactly one bundle at a time and advances on success', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(queueState().activeId).toBe('a');
    expect(queueState().runs['b']).toEqual({ state: 'queued' });

    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    events[0].complete();
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({ state: 'done' });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(queueState().activeId).toBe('b');
  });

  it('isolates a failure: marks the bundle failed and keeps draining', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    events[0].error(new Error('WASM allocation failed'));
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({
      state: 'failed',
      error: { kind: 'oom', message: 'WASM allocation failed' },
    });
    expect(queueState().activeId).toBe('b');
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('fails a bundle whose audio cannot be made resident, without calling the runner', async () => {
    audio.ensureResident.mockResolvedValue(false as never);
    service.enqueue(['a']);
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a'].state).toBe('failed');
    expect(queueState().runs['a'].error.kind).toBe('decode');
  });

  it('records a queue-initiated cancel as the cancelled error kind and continues', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    service.cancelActive();
    expect(runner.cancel).toHaveBeenCalledTimes(1);

    events[0].next({ stage: 'pipeline', type: 'cancelled' });
    events[0].complete();
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({
      state: 'failed',
      error: { kind: 'cancelled', message: 'Run cancelled.' },
    });
    expect(queueState().activeId).toBe('b');
  });

  it('stop() finishes the active bundle and does not start the next one', async () => {
    service.enqueue(['a', 'b']);
    await Promise.resolve();

    service.stop();
    expect(queueState().mode).toBe('pausing');

    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson: new OAnnotJSON('a.wav', 'a', 16000, []),
      diarizationWarning: null,
    });
    events[0].complete();
    await Promise.resolve();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(queueState().mode).toBe('idle');
    expect(queueState().queue).toEqual([]);
    // Pending ids reset to idle, not queued, so a later "run" recomputes.
    expect(queueState().runs['b']).toEqual({ state: 'idle' });
  });

  it('applies the skip rule on enqueue but not on retry', async () => {
    store.dispatch(
      PipelineQueueActions.restoreInterrupted({
        entries: [
          { bundleId: 'a', state: 'done' },
          { bundleId: 'b', state: 'running' },
        ],
      }),
    );

    service.enqueue(['a', 'b']);
    await Promise.resolve();
    // 'a' is done (skipped); 'b' restored as 'interrupted' (eligible).
    expect(queueState().activeId).toBe('b');
    expect(runner.run).toHaveBeenCalledTimes(1);

    service.retry('a');
    await Promise.resolve();
    expect(queueState().runs['a']).toEqual({ state: 'queued' });
  });

  it('skips a bundle whose media is missing and not resident', async () => {
    audio.hasResident.mockReturnValue(false as never);
    service.enqueue(['b']); // b.audio.loaded === false
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().queue).toEqual([]);
  });

  it('dispatches bundle-scoped progress while a bundle runs', async () => {
    service.enqueue(['a']);
    await Promise.resolve();

    events[0].next({
      stage: 'transcription',
      event: { type: 'transcribe-start', audioDurationS: 40 },
    });
    await Promise.resolve();

    expect(queueState().runs['a']).toEqual({
      state: 'running',
      stage: 'asr',
      progress: 0,
    });
  });

  it('fails the active bundle when no transcription options are configured', async () => {
    service.setTranscribeOptions(null);
    service.enqueue(['a']);
    await Promise.resolve();

    expect(runner.run).not.toHaveBeenCalled();
    expect(queueState().runs['a'].state).toBe('failed');
    expect(queueState().runs['a'].error.kind).toBe('unknown');
  });
});
```

- [ ] **Step 10: Run them to verify they fail**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.service`
Expected: FAIL — `Cannot find module './pipeline-queue.service'`.

- [ ] **Step 11: Write the service**

Create `apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts`:

```ts
import { Injectable } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { map, Subscription, tap } from 'rxjs';
import { RootState } from '../../store/index';
import { selectAllBundleSummaries } from '../../store/login-mode/annotation/annotation.selectors';
import {
  dispatchPipelineActions,
  mapPipelineEventToAction,
} from '../../store/pipeline/pipeline-event-mapping';
import {
  BundleRunError,
  computeReadyBundleIds,
  runStatusOf,
} from '../../store/pipeline-queue';
import {
  bundleRunErrorFromPipelineEvent,
  classifyBundleRunError,
} from '../../store/pipeline-queue/bundle-run-errors';
import { mapPipelineActionToQueueProgress } from '../../store/pipeline-queue/pipeline-queue-progress';
import { PipelineQueueActions } from '../../store/pipeline-queue/pipeline-queue.actions';
import {
  selectAllRunStatuses,
  selectPipelineQueueFeature,
} from '../../store/pipeline-queue/pipeline-queue.selectors';
import { AudioService } from './audio.service';
import { TranscriptionOptions } from './local-transcription.service';
import type { PipelineEvent } from './pipeline-runner.service';
import { PipelineRunnerService } from './pipeline-runner.service';

const NO_OPTIONS_MESSAGE =
  'No transcription options configured — enable auto transcription first.';

/**
 * FIFO queue over `PipelineRunnerService.run()`: one bundle in flight at a
 * time, a failure never stops the run, retry is per-row.
 *
 * `PipelineRunnerService` and the three worker-wrapper services underneath
 * it are used exactly as step 3a left them — every queued bundle reloads its
 * model from scratch, which is correct, just slow. Warm-worker refcounting
 * is step 3b-ii, deliberately out of scope here.
 *
 * Sequencing is hand-rolled rather than `concatMap`-over-a-source, because
 * the queue's source of truth is the store (`activateNext` pops the head in
 * the reducer), not an Observable of bundle ids — and because
 * `PipelineRunnerService` is a single-subscriber service that must never see
 * two overlapping `run()` calls.
 */
@Injectable({ providedIn: 'root' })
export class PipelineQueueService {
  private runSub: Subscription | null = null;
  private transcribeOptions: TranscriptionOptions | null = null;
  /** Carried across progress ticks within one run — see QueueProgressResult. */
  private audioDurationS = 0;
  /** Guards against double-finalizing one run (result + complete). */
  private finalized = false;

  private queueState = this.store.selectSignal(selectPipelineQueueFeature);
  private runs = this.store.selectSignal(selectAllRunStatuses);
  private summaries = this.store.selectSignal(selectAllBundleSummaries);

  constructor(
    private store: Store<RootState>,
    private pipelineRunnerService: PipelineRunnerService,
    private audioService: AudioService,
  ) {}

  /**
   * The one global pipeline configuration the queue runs every bundle with
   * (the spec's "one global config, run as a queue over all loaded media").
   * `null` disables running — the run button is disabled in that state.
   */
  setTranscribeOptions(options: TranscriptionOptions | null): void {
    this.transcribeOptions = options;
  }

  /** The ids `enqueue()` would actually accept right now. */
  readyBundleIds(): string[] {
    return computeReadyBundleIds(this.summaries(), this.runs(), (bundleId) =>
      this.audioService.hasResident(bundleId),
    );
  }

  enqueue(bundleIds: string[]): void {
    const ready = new Set(this.readyBundleIds());
    const eligible = bundleIds.filter((bundleId) => ready.has(bundleId));
    if (eligible.length === 0) {
      return;
    }
    const wasIdle = this.runSub === null && this.queueState().activeId === null;
    this.store.dispatch(
      PipelineQueueActions.enqueued({ bundleIds: eligible }),
    );
    if (wasIdle) {
      this.activateNext();
    }
  }

  /**
   * Re-enqueue a single bundle regardless of its current state — an explicit
   * per-row user action, so it deliberately bypasses `enqueue()`'s
   * eligibility filter (the spec's own wording). Residency is still checked
   * before the run itself, so retrying a bundle whose media is gone fails
   * cleanly as a 'decode' error rather than crashing.
   */
  retry(bundleId: string): void {
    const state = runStatusOf(this.runs(), bundleId).state;
    if (state === 'queued' || state === 'running') {
      return;
    }
    const wasIdle = this.runSub === null && this.queueState().activeId === null;
    this.store.dispatch(
      PipelineQueueActions.enqueued({ bundleIds: [bundleId] }),
    );
    if (wasIdle) {
      this.activateNext();
    }
  }

  /** Finish the in-flight bundle, then stop; don't drain the rest. */
  stop(): void {
    this.store.dispatch(PipelineQueueActions.pause());
  }

  /**
   * Cancel just the in-flight bundle. The resulting
   * `{stage:'pipeline', type:'cancelled'}` event is what actually records
   * the failure and advances the queue — `cancel()` emits it synchronously
   * before completing the run Observable (see PipelineRunnerService.cancel),
   * so there is exactly one code path that finalizes a cancelled run.
   */
  cancelActive(): void {
    if (this.queueState().activeId === null) {
      return;
    }
    this.pipelineRunnerService.cancel();
  }

  private activateNext(): void {
    // Read the head BEFORE dispatching so this never depends on how quickly
    // the store signal above reflects the reducer's output.
    const next = this.queueState().queue[0];
    this.store.dispatch(PipelineQueueActions.activateNext());
    if (next === undefined) {
      return;
    }
    void this.runBundle(next);
  }

  private async runBundle(bundleId: string): Promise<void> {
    const options = this.transcribeOptions;
    if (!options) {
      this.fail(bundleId, { kind: 'unknown', message: NO_OPTIONS_MESSAGE });
      return;
    }

    // Residency before running: an LRU-evicted bundle is exactly as
    // re-decodable as a freshly-selected one, and the queue must not skip or
    // crash on a bundle that simply isn't one of the 3 most recent.
    const resident = await this.audioService.ensureResident(bundleId);
    const manager = resident
      ? this.audioService.getManager(bundleId)
      : undefined;
    if (!manager) {
      this.fail(bundleId, {
        kind: 'decode',
        message: `Could not decode audio for this file.`,
      });
      return;
    }

    this.audioDurationS = 0;
    this.finalized = false;

    this.runSub = dispatchPipelineActions(
      this.pipelineRunnerService
        .run({
          audioManager: manager,
          oaudiofile: manager.resource.getOAudioFile(),
          transcribeOptions: options,
          // No translateOptions: /workbench has no translation
          // configuration UI in step 3b-i, so the queue runs
          // transcription + optional diarization only.
        })
        .pipe(
          tap((event: PipelineEvent) => this.onRawEvent(bundleId, event)),
          map(mapPipelineEventToAction),
        ),
    ).subscribe({
      next: (action: Action) => this.onThrottledAction(action),
      error: (err: unknown) =>
        this.fail(bundleId, classifyBundleRunError(err, options.useWebGPU)),
      complete: () => {
        if (!this.finalized) {
          this.fail(bundleId, {
            kind: 'unknown',
            message: 'The pipeline ended without producing a result.',
          });
        }
      },
    });
  }

  /**
   * Raw (unthrottled) event handling — only the terminal outcomes, which
   * must never be delayed or collapsed by the throttle.
   */
  private onRawEvent(bundleId: string, event: PipelineEvent): void {
    const cancelled = bundleRunErrorFromPipelineEvent(event);
    if (cancelled) {
      this.fail(bundleId, cancelled);
      return;
    }
    if (event.stage === 'pipeline' && event.type === 'result') {
      this.succeed(bundleId, event);
    }
  }

  /** Throttled progress ticks — bundle-scoped, never the old slice's actions. */
  private onThrottledAction(action: Action): void {
    const result = mapPipelineActionToQueueProgress(
      action,
      this.audioDurationS,
    );
    this.audioDurationS = result.audioDurationS;
    if (result.update) {
      this.store.dispatch(PipelineQueueActions.progress(result.update));
    }
  }

  private succeed(
    bundleId: string,
    _event: Extract<PipelineEvent, { stage: 'pipeline'; type: 'result' }>,
  ): void {
    if (this.finalized) {
      return;
    }
    this.finalized = true;
    this.store.dispatch(PipelineQueueActions.bundleDone({ bundleId }));
    this.advance();
  }

  private fail(bundleId: string, error: BundleRunError): void {
    if (this.finalized) {
      return;
    }
    this.finalized = true;
    this.store.dispatch(
      PipelineQueueActions.bundleFailed({ bundleId, error }),
    );
    this.advance();
  }

  private advance(): void {
    this.runSub?.unsubscribe();
    this.runSub = null;
    if (this.queueState().mode === 'pausing') {
      this.store.dispatch(PipelineQueueActions.stopped());
      return;
    }
    this.activateNext();
  }
}
```

- [ ] **Step 12: Run the service tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.service`
Expected: PASS (all 10 cases).

- [ ] **Step 13: Run the full suite and lint**

Run: `npx nx test tratt`
Expected: PASS.

Run: `npx nx lint tratt`
Expected: the same 3 pre-existing errors documented in the design doc's post-2.4 note (`tratt-database.ts:374` `no-empty-function`, two in `transcr-window.component.html:74`) and no new ones. Compare against `git stash`-ing your changes if unsure — do not "fix" the pre-existing three.

- [ ] **Step 14: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/audio.service.ts apps/tratt/src/app/core/shared/service/audio.service.spec.ts apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts apps/tratt/src/app/core/shared/service/pipeline-queue.service.spec.ts apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-progress.ts apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-progress.spec.ts
git commit -m "feat(pipeline): add PipelineQueueService FIFO drain loop over PipelineRunnerService"
```

---

### Task 5: write the queue's result back to the *correct* bundle

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts` (add `setBundleTranscript`)
- Modify: `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts` (route it explicitly by `bundleId`)
- Modify: `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts` (routing tests)
- Modify: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.ts` (persist the transcript)
- Modify: `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.spec.ts`
- Modify: `apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts` (dispatch it)
- Modify: `apps/tratt/src/app/core/shared/service/pipeline-queue.service.spec.ts`

**Interfaces:**
- Consumes: `TrattAnnotation`, `TrattAnnotationSegment`, `OAnnotJSON` from `@tratt/annotation`; `localBundleAdapter`; `AudioService.getManager` (Task 4); `IDBService.saveAnnotation(mode, annotation, bundleId?)`.
- Produces: `LoginModeActions.setBundleTranscript({ mode: LoginMode; bundleId: string; transcript: TrattAnnotation<TrattAnnotationSegment> })`.

**Why this task exists (not in the spec's own list):** every action other than `createBundle`/`selectBundle` is routed by `wrapAsLocalBundleCollectionReducer` to `state.selectedBundleId` (`login-mode.reducer.ts:162`). The queue runs bundles the user is usually *not* looking at, so dispatching the existing `AnnotationActions.overwriteTranscript.do` for a queue result would write bundle X's transcript into bundle Y — silent data corruption of the user's open document. Without some bundle-scoped write, the queue transcribes and then throws every result away. Neither outcome is acceptable, so this is the minimum correct write-back.

**Steps:**

- [ ] **Step 1: Write the failing reducer-routing tests**

Append to `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts` (read the file first and reuse its existing `reducer`/state fixtures and `IIDBModeOptions` import style):

```ts
  it('setBundleTranscript writes to the NAMED bundle, not the selected one', () => {
    const withTwo = reducer(
      reducer(undefined, { type: '@@INIT' } as any),
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-2',
        sessionFile: new SessionFile('b.wav', 2, new Date(2024, 0, 1), 'audio/wav'),
      }),
    );
    // createBundle selects the new bundle; select bundle-1 back so the
    // target of this write is explicitly NOT the selected bundle.
    const selectedIsOne = reducer(
      withTwo,
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: DEFAULT_BUNDLE_ID,
      }),
    );
    const transcript = { marker: 'queued-result' } as any;

    const state = reducer(
      selectedIsOne,
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-2',
        transcript,
      }),
    );

    expect(state.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(state.bundles.entities['bundle-2']!.transcript).toBe(transcript);
    expect(state.bundles.entities[DEFAULT_BUNDLE_ID]!.transcript).not.toBe(
      transcript,
    );
  });

  it('setBundleTranscript is a no-op for a bundle id that does not exist', () => {
    const before = reducer(undefined, { type: '@@INIT' } as any);
    const state = reducer(
      before,
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'ghost',
        transcript: {} as any,
      }),
    );
    expect(state).toBe(before);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx nx test tratt --testPathPattern=login-mode.reducer`
Expected: FAIL — `LoginModeActions.setBundleTranscript is not a function`.

- [ ] **Step 3: Add the action**

In `apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts`, add to the existing `@tratt/annotation` import (or create it if absent):

```ts
import { TrattAnnotation, TrattAnnotationSegment } from '@tratt/annotation';
```

and add the action right after `selectBundle`:

```ts
  /**
   * Writes a transcript into ONE named bundle, independent of the current
   * selection. `AnnotationActions.overwriteTranscript.do` cannot be used for
   * this: every action except createBundle/selectBundle is routed by
   * `wrapAsLocalBundleCollectionReducer` to `selectedBundleId`, so using it
   * for a background pipeline result would overwrite whatever bundle the
   * user currently has open. Dispatched by PipelineQueueService when a
   * queued run produces its annotation.
   */
  static setBundleTranscript = createAction(
    'annotation Set bundle transcript',
    props<{
      mode: LoginMode;
      bundleId: string;
      transcript: TrattAnnotation<TrattAnnotationSegment>;
    }>(),
  );
```

- [ ] **Step 4: Route it in the collection reducer**

In `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts`, inside `wrapAsLocalBundleCollectionReducer`'s returned reducer, add this block immediately after the existing `selectBundle` block and before `const currentInner = resolveLocalBundleState(state) ?? initialInner;`:

```ts
    if (action.type === LoginModeActions.setBundleTranscript.type) {
      const { bundleId, transcript } = action as ReturnType<
        typeof LoginModeActions.setBundleTranscript
      >;
      const existing = state.bundles.entities[bundleId];
      if (!existing) {
        return state;
      }
      // Written straight onto the entity, bypassing the undo-wrapped inner
      // reducer on purpose: a pipeline result is a machine-produced
      // document replacement, not a user edit, and pushing it onto that
      // bundle's ngrx-wieder history would let Ctrl+Z "undo" a
      // transcription the user never typed.
      return {
        ...state,
        bundles: localBundleAdapter.setOne(
          { ...existing, transcript },
          state.bundles,
        ),
      };
    }
```

- [ ] **Step 5: Run the reducer tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=login-mode.reducer`
Expected: PASS.

- [ ] **Step 6: Write the failing service test for the dispatch**

Add to `apps/tratt/src/app/core/shared/service/pipeline-queue.service.spec.ts` (inside the existing `describe`):

```ts
  it('writes the produced annotation back to the bundle that produced it', async () => {
    const dispatched: any[] = [];
    store.dispatch = ((action: any) => {
      dispatched.push(action);
      return Store.prototype.dispatch.call(store, action);
    }) as any;

    service.enqueue(['a']);
    await Promise.resolve();

    const annotJson = new OAnnotJSON('a.wav', 'a', 16000, []);
    events[0].next({
      stage: 'pipeline',
      type: 'result',
      annotJson,
      diarizationWarning: null,
    });
    await Promise.resolve();

    const write = dispatched.find(
      (a) => a.type === LoginModeActions.setBundleTranscript.type,
    );
    expect(write).toBeDefined();
    expect(write.bundleId).toBe('a');
    expect(write.mode).toBe(LoginMode.LOCAL);
    expect(write.transcript).toBeDefined();
  });
```

with `import { LoginModeActions } from '../../store/login-mode/login-mode.actions';` added at the top of that spec.

- [ ] **Step 7: Run it to verify it fails**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.service`
Expected: FAIL — no `setBundleTranscript` action is ever dispatched.

- [ ] **Step 8: Dispatch the write-back from the service**

In `apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts`, add imports:

```ts
import { TrattAnnotation } from '@tratt/annotation';
import { LoginMode } from '../../store/index';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
```

and replace `succeed()` with:

```ts
  private succeed(
    bundleId: string,
    event: Extract<PipelineEvent, { stage: 'pipeline'; type: 'result' }>,
  ): void {
    if (this.finalized) {
      return;
    }
    this.finalized = true;

    const transcript = TrattAnnotation.deserialize(event.annotJson);
    if (transcript) {
      // Explicitly bundle-scoped: AnnotationActions.overwriteTranscript.do
      // would land on whatever bundle the user currently has selected.
      this.store.dispatch(
        LoginModeActions.setBundleTranscript({
          mode: LoginMode.LOCAL,
          bundleId,
          transcript,
        }),
      );
    }

    this.store.dispatch(PipelineQueueActions.bundleDone({ bundleId }));
    this.advance();
  }
```

- [ ] **Step 9: Run the service tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=pipeline-queue.service`
Expected: PASS.

- [ ] **Step 10: Write the failing persistence test for the transcript**

Add to `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.spec.ts`:

```ts
  it('persists a queue-written transcript against that bundle\'s own id', () => {
    effects.saveBundleTranscript$.subscribe();

    const serialize = jest.fn(() => ({ name: 'a.wav', levels: [] }));
    store.setState({
      ...initialState,
      localMode: {
        ...(initialState as any).localMode,
        bundles: localBundleAdapter.setAll(
          [{ ...bundleA, audio: { fileName: 'a.wav' }, transcript: { serialize } }],
          localBundleAdapter.getInitialState(),
        ),
      },
    } as unknown as RootState);

    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript: { serialize } as any,
      }),
    );

    expect(idbService.saveAnnotation).toHaveBeenCalledTimes(1);
    const [mode, , bundleId] = idbService.saveAnnotation.mock.calls[0] as any[];
    expect(mode).toBe(LoginMode.LOCAL);
    expect(bundleId).toBe('a');
  });

  it('persists nothing when that bundle has no resident audio manager', () => {
    effects.saveBundleTranscript$.subscribe();
    audioService.getManager.mockReturnValue(undefined);

    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript: { serialize: jest.fn() } as any,
      }),
    );

    expect(idbService.saveAnnotation).not.toHaveBeenCalled();
  });
```

Extend that spec's `beforeEach` to add `saveAnnotation: jest.fn(() => of(undefined))` to the `idbService` mock and a new `audioService` mock provided as `{ provide: AudioService, useValue: audioService }`, where:

```ts
  audioService = {
    getManager: jest.fn(() => ({
      resource: { info: { fullname: 'a.wav', sampleRate: 16000, duration: 1 } },
    })),
  } as any;
```

- [ ] **Step 11: Run it to verify it fails**

Run: `npx nx test tratt --testPathPattern=pipeline-queue-persistence`
Expected: FAIL — `effects.saveBundleTranscript$ is undefined`.

- [ ] **Step 12: Add the transcript persistence effect**

In `apps/tratt/src/app/core/store/pipeline-queue/pipeline-queue-persistence.effects.ts`, add imports:

```ts
import { AudioService } from '../../shared/service/audio.service';
import { LoginModeActions } from '../login-mode/login-mode.actions';
```

inject `private audioService: AudioService` into the constructor, and add this effect next to `saveRunState$`:

```ts
  /**
   * Persists a transcript the queue produced for a bundle that is usually
   * NOT the selected one.
   *
   * A dedicated effect rather than another entry in `IDBEffects.
   * saveAnnotation`'s trigger list, for the same reason `saveRunState$` is
   * separate: that effect resolves its bundle id from `selectedBundleId` AND
   * reads sample rate/duration off `AudioService.current` — both of which
   * point at the wrong bundle here. This one uses the action's explicit
   * `bundleId` and that bundle's own `AudioManager`.
   */
  saveBundleTranscript$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(LoginModeActions.setBundleTranscript),
        withLatestFrom(this.store),
        mergeMap(([action, appState]) => {
          const modeState = appState.localMode.bundles.entities[action.bundleId];
          const manager = this.audioService.getManager(action.bundleId);
          if (!modeState || !manager) {
            // No resident audio means no sample rate/duration to serialize
            // against. The transcript is still in the store; it just isn't
            // persisted for this bundle until something re-saves it.
            return EMPTY;
          }
          return this.idbService
            .saveAnnotation(
              LoginMode.LOCAL,
              action.transcript.serialize(
                modeState.audio?.fileName ?? manager.resource.info.fullname,
                manager.resource.info.sampleRate,
                manager.resource.info.duration,
              ),
              action.bundleId,
            )
            .pipe(
              mergeMap(() => of(undefined)),
              catchError(() => of(undefined)),
            );
        }),
      ),
    { dispatch: false },
  );
```

- [ ] **Step 13: Run the persistence tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=pipeline-queue-persistence`
Expected: PASS.

- [ ] **Step 14: Run the full suite**

Run: `npx nx test tratt`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode apps/tratt/src/app/core/store/pipeline-queue apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts apps/tratt/src/app/core/shared/service/pipeline-queue.service.spec.ts
git commit -m "feat(pipeline): write queue results back to the bundle that produced them"
```

---

### Task 6: per-row status and retry in the bundle list

**Files:**
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts`
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.html`
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss`
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.spec.ts`
- Modify: all seven files in `apps/tratt/src/assets/i18n/` (`en`, `sv`, `de`, `it`, `ko`, `nl`, `zh`)

**Interfaces:**
- Consumes: `selectAllRunStatuses`, `runStatusOf`, `BundleRunStatus` (Task 1); `PipelineQueueService.retry(bundleId)` (Task 4).
- Produces: `BundleListComponent.bundles` rows now additionally carry `run: BundleRunStatus`; `BundleListComponent.onRetry(bundleId: string): void`.

**Steps:**

- [ ] **Step 1: Add the i18n keys to all seven locales**

Add to the `workbench.bundle_list` object in `apps/tratt/src/assets/i18n/en.json`:

```json
      "retry": "Retry",
      "status": {
        "queued": "Queued",
        "running": "Running",
        "done": "Done",
        "failed": "Failed",
        "interrupted": "Interrupted"
      },
      "error": {
        "decode": "Could not read the audio",
        "model-load": "Could not load the model",
        "oom": "Ran out of memory",
        "cancelled": "Cancelled",
        "unknown": "Failed"
      }
```

Same keys in `sv.json`, translated:

```json
      "retry": "Försök igen",
      "status": {
        "queued": "I kö",
        "running": "Körs",
        "done": "Klar",
        "failed": "Misslyckades",
        "interrupted": "Avbruten"
      },
      "error": {
        "decode": "Kunde inte läsa ljudet",
        "model-load": "Kunde inte ladda modellen",
        "oom": "Minnet tog slut",
        "cancelled": "Avbruten",
        "unknown": "Misslyckades"
      }
```

`de.json`, `it.json`, `ko.json`, `nl.json`, `zh.json` do not currently contain a `workbench` block at all. Add the full block to each, with the **English** strings copied verbatim (including the pre-existing `start session` / `tabs` / `bundle_list.title` / `bundle_list.reattach` keys, so those locales stop being behind on this subtree too):

```json
  "workbench": {
    "start session": "Start session",
    "tabs": { "upload": "Upload file", "record": "Record now" },
    "bundle_list": {
      "title": "Files",
      "reattach": "Attach file…",
      "retry": "Retry",
      "status": {
        "queued": "Queued",
        "running": "Running",
        "done": "Done",
        "failed": "Failed",
        "interrupted": "Interrupted"
      },
      "error": {
        "decode": "Could not read the audio",
        "model-load": "Could not load the model",
        "oom": "Ran out of memory",
        "cancelled": "Cancelled",
        "unknown": "Failed"
      }
    }
  },
```

- [ ] **Step 2: Record the i18n baseline and verify it did not get worse**

Before this step's edits, the counts are: `de` 62 missing, `it`/`ko`/`nl`/`zh` 225 each, `sv` 34.

Run: `npm run validate:i18n`
Expected: still FAILS (pre-existing, see Global Constraints), but each locale's missing count is **≤** its baseline above. `de`/`it`/`ko`/`nl`/`zh` should each drop by 4 (the four pre-existing `workbench.*` keys they were missing) and gain none.

- [ ] **Step 3: Write the failing component tests**

Append to `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.spec.ts` (read the file first and extend its existing `initialState` with a `pipelineQueue` slice; add `{ provide: PipelineQueueService, useValue: pipelineQueueService }` to its providers, where `pipelineQueueService = { retry: jest.fn() }`):

```ts
  it('renders the run status label for each bundle', async () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: 'bundle-b',
        mode: 'running',
        runs: {
          'bundle-b': { state: 'running', stage: 'asr', progress: 0.5 },
        },
      },
    } as unknown as RootState);
    fixture.detectChanges();

    const labels = fixture.debugElement
      .queryAll(By.css('.bundle-list__status'))
      .map((el) => el.nativeElement.textContent.trim());
    expect(labels).toContain('workbench.bundle_list.status.running');
  });

  it('renders no status element for a bundle with no run entry', () => {
    fixture.detectChanges();
    expect(
      fixture.debugElement.queryAll(By.css('.bundle-list__status')).length,
    ).toBe(0);
  });

  it('shows a retry button only for failed and interrupted rows and calls the queue service', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'idle',
        runs: {
          'bundle-a': { state: 'interrupted' },
          'bundle-b': {
            state: 'failed',
            error: { kind: 'oom', message: 'GPU out of memory' },
          },
        },
      },
    } as unknown as RootState);
    fixture.detectChanges();

    const retryButtons = fixture.debugElement.queryAll(
      By.css('.bundle-list__retry'),
    );
    expect(retryButtons.length).toBe(2);

    retryButtons[1].nativeElement.click();
    expect(pipelineQueueService.retry).toHaveBeenCalledWith('bundle-b');
  });

  it('exposes the raw failure message as the failed row\'s title', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'idle',
        runs: {
          'bundle-b': {
            state: 'failed',
            error: { kind: 'oom', message: 'GPU out of memory' },
          },
        },
      },
    } as unknown as RootState);
    fixture.detectChanges();

    const failed = fixture.debugElement.query(By.css('.bundle-list__error'));
    expect(failed.nativeElement.getAttribute('title')).toBe(
      'GPU out of memory',
    );
  });
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx nx test tratt --testPathPattern=bundle-list.component`
Expected: FAIL — no `.bundle-list__status` / `.bundle-list__retry` elements exist.

- [ ] **Step 5: Extend the component**

In `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts`, add imports:

```ts
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { runStatusOf } from '../../store/pipeline-queue';
import { selectAllRunStatuses } from '../../store/pipeline-queue/pipeline-queue.selectors';
```

add the signal and extend the `bundles` computed (keeping its existing `awaitingMedia` merge and doc comment intact):

```ts
  private runStatuses = this.store.selectSignal(selectAllRunStatuses);

  // `selectAllBundleSummaries`'s `awaitingMedia` only reflects the store's
  // `audio.loaded` flag, which the reducer only ever sets for whichever
  // bundle happens to be currently selected (see AnnotationActions.loadAudio.success).
  // A bundle created via a live multi-file drop (step 2.7) has a REAL
  // resident AudioManager from the moment it's registered, even before it's
  // ever been selected — combine the selector with that live signal so
  // switching to an unselected-but-already-resident bundle doesn't show the
  // re-attach control.
  //
  // Step 3b-i adds one more merge: each row's pipeline run status (absent
  // entry ⇒ idle, via runStatusOf) so a row can show queued/running/done/
  // failed/interrupted and offer a retry.
  bundles = computed(() => {
    const runs = this.runStatuses();
    return this.bundleSummaries().map((b) => ({
      ...b,
      awaitingMedia:
        b.awaitingMedia && !this.audioService.hasResident(b.bundleId),
      run: runStatusOf(runs, b.bundleId),
    }));
  });
```

add `private pipelineQueueService: PipelineQueueService,` to the constructor parameter list, and add the handler:

```ts
  /**
   * Per-row retry for a failed or interrupted bundle. Goes through
   * `PipelineQueueService.retry()`, which deliberately bypasses the
   * eligibility filter `enqueue()` applies — retry is an explicit user
   * action on one specific row.
   */
  onRetry(bundleId: string): void {
    this.pipelineQueueService.retry(bundleId);
  }
```

- [ ] **Step 6: Extend the template**

In `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.html`, replace the `@else` branch's `<button ...>{{ bundle.name }}</button>` block with:

```html
      } @else {
        <button
          type="button"
          class="bundle-list__item-btn"
          (click)="selectBundle(bundle.bundleId)"
        >
          <!-- `bundle.name` comes from `sessionFile?.name`; sessionFile is a
               required prop on the createBundle action, so this is always
               populated in practice for LOCAL bundles — no placeholder
               fallback needed. -->
          {{ bundle.name }}
        </button>
        @if (bundle.run.state !== 'idle') {
          <span
            class="bundle-list__status"
            [class.bundle-list__status--running]="bundle.run.state === 'running'"
            [class.bundle-list__status--done]="bundle.run.state === 'done'"
            [class.bundle-list__status--error]="
              bundle.run.state === 'failed' ||
              bundle.run.state === 'interrupted'
            "
          >
            {{ 'workbench.bundle_list.status.' + bundle.run.state | transloco }}
          </span>
        }
        @if (bundle.run.state === 'failed' && bundle.run.error) {
          <!-- The kind is the translated, user-facing summary; the raw
               message (often an untranslatable worker/browser string) is
               the tooltip, so nothing is hidden from the user. -->
          <span class="bundle-list__error" [attr.title]="bundle.run.error.message">
            {{
              'workbench.bundle_list.error.' + bundle.run.error.kind | transloco
            }}
          </span>
        }
        @if (
          bundle.run.state === 'failed' || bundle.run.state === 'interrupted'
        ) {
          <button
            type="button"
            class="bundle-list__retry"
            (click)="onRetry(bundle.bundleId)"
          >
            {{ 'workbench.bundle_list.retry' | transloco }}
          </button>
        }
      }
```

- [ ] **Step 7: Add the row styles**

Append to `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss` (read the file first and match its existing BEM/variable conventions — use the same `var(--tratt-*)` tokens it already uses rather than raw hex):

```scss
.bundle-list__status {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  opacity: 0.8;
}

.bundle-list__status--running {
  color: var(--tratt-accent-warning);
}

.bundle-list__status--done {
  color: var(--tratt-accent-success, currentColor);
}

.bundle-list__status--error {
  color: var(--tratt-accent-danger, currentColor);
}

.bundle-list__error {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  color: var(--tratt-accent-danger, currentColor);
}

.bundle-list__retry {
  margin-left: 0.5rem;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.75rem;
  text-decoration: underline;
  cursor: pointer;
  color: inherit;
}
```

If `--tratt-accent-success` / `--tratt-accent-danger` are not defined in this app's theme (grep `styles.scss` and `apps/tratt/src/assets`), the fallbacks above keep the text readable; replace them with whichever tokens do exist rather than introducing new ones.

- [ ] **Step 8: Run the component tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=bundle-list.component`
Expected: PASS (existing re-attach tests included).

- [ ] **Step 9: Run the full suite and lint**

Run: `npx nx test tratt`
Expected: PASS.

Run: `npx nx lint tratt`
Expected: only the 3 pre-existing errors.

- [ ] **Step 10: Commit**

```bash
git add apps/tratt/src/app/core/component/bundle-list apps/tratt/src/assets/i18n
git commit -m "feat(workbench): show per-bundle pipeline status with per-row retry"
```

---

### Task 7: run/pause control, pipeline options mount, and manual verification

**Files:**
- Modify: `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts` (add `idPrefix` input, default `''`)
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.scss`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts`
- Modify: all seven files in `apps/tratt/src/assets/i18n/`

**Interfaces:**
- Consumes: `PipelineQueueService.setTranscribeOptions/enqueue/stop/readyBundleIds` (Task 4); `selectQueueMode` (Task 1); `computeReadyBundleIds` (Task 1); `AutoTranscribeOptionsComponent`'s `audioLoaded`/`annotationAlreadyLoaded` inputs and `optionsChange` output emitting `TranscriptionOptions | null`.
- Produces: `AutoTranscribeOptionsComponent.idPrefix` input (default `''`); `WorkbenchComponent.readyBundleIds`, `.queueRunning`, `.onQueueOptionsChange(options)`, `.onRunPauseClick()`.

**Steps:**

- [ ] **Step 1: Add the i18n keys to all seven locales**

Add a `queue` object inside `workbench` in `en.json`:

```json
    "queue": {
      "run": "Transcribe {{count}} file(s)",
      "pause": "Pause queue",
      "options_title": "Pipeline settings"
    }
```

`sv.json`:

```json
    "queue": {
      "run": "Transkribera {{count}} fil(er)",
      "pause": "Pausa kön",
      "options_title": "Pipelineinställningar"
    }
```

and the English text verbatim in the `workbench` block of `de.json`, `it.json`, `ko.json`, `nl.json`, `zh.json`.

- [ ] **Step 2: Verify the i18n counts still did not get worse**

Run: `npm run validate:i18n`
Expected: still fails on the pre-existing backlog, with no locale's missing count higher than the Task 6 Step 2 numbers.

- [ ] **Step 3: Write the failing `idPrefix` test**

Create `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.spec.ts` (this component has no spec today):

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { getTranslocoModule } from '../../../transloco-testing.module';
import { AutoTranscribeOptionsComponent } from './auto-transcribe-options.component';

describe('AutoTranscribeOptionsComponent', () => {
  let fixture: ComponentFixture<AutoTranscribeOptionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutoTranscribeOptionsComponent, getTranslocoModule()],
    }).compileComponents();
    fixture = TestBed.createComponent(AutoTranscribeOptionsComponent);
    fixture.componentRef.setInput('audioLoaded', true);
  });

  it('uses unprefixed ids by default, so /local markup is unchanged', () => {
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.css('#autoTranscribeCheck')),
    ).not.toBeNull();
  });

  it('prefixes every generated id when idPrefix is set', () => {
    fixture.componentRef.setInput('idPrefix', 'queue-');
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.css('#queue-autoTranscribeCheck')),
    ).not.toBeNull();
    expect(
      fixture.debugElement.query(By.css('#autoTranscribeCheck')),
    ).toBeNull();
  });
});
```

If `apps/tratt/src/app/transloco-testing.module.ts` does not exist, use whatever Transloco test setup the existing specs use (grep `TranslocoTestingModule` / `TranslocoService` in `apps/tratt/src` — `bundle-list.component.spec.ts` provides a stubbed `TranslocoService`; copy that approach rather than inventing a new one).

- [ ] **Step 4: Run it to verify it fails**

Run: `npx nx test tratt --testPathPattern=auto-transcribe-options`
Expected: FAIL on the second test — `#queue-autoTranscribeCheck` is null.

- [ ] **Step 5: Add `idPrefix`**

In `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts`, add the input next to the existing ones:

```ts
  /**
   * Prefix for every element id this component generates. Default `''`
   * keeps `/local`'s rendered markup byte-identical. `/workbench` mounts a
   * SECOND instance of this component (the pipeline queue's own
   * configuration) which can be on screen at the same time as the dropzone's
   * instance — without a prefix the two would emit duplicate element ids and
   * every `<label for>` would resolve to the first one.
   */
  readonly idPrefix = input<string>('');
```

and thread it through all five id/`for` pairs in the template:

```html
            id="autoTranscribeCheck"      →  [id]="idPrefix() + 'autoTranscribeCheck'"
            for="autoTranscribeCheck"     →  [attr.for]="idPrefix() + 'autoTranscribeCheck'"
            id="languageSelect"           →  [id]="idPrefix() + 'languageSelect'"
            for="languageSelect"          →  [attr.for]="idPrefix() + 'languageSelect'"
            [id]="'model-' + model.modelId"   →  [id]="idPrefix() + 'model-' + model.modelId"
            [for]="'model-' + model.modelId"  →  [for]="idPrefix() + 'model-' + model.modelId"
            id="speakerSegmentationCheck" →  [id]="idPrefix() + 'speakerSegmentationCheck'"
            for="speakerSegmentationCheck" →  [attr.for]="idPrefix() + 'speakerSegmentationCheck'"
            for="numSpeakersInput"        →  [attr.for]="idPrefix() + 'numSpeakersInput'"
            id="numSpeakersInput"         →  [id]="idPrefix() + 'numSpeakersInput'"
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx nx test tratt --testPathPattern=auto-transcribe-options`
Expected: PASS.

- [ ] **Step 7: Write the failing workbench tests**

Append to `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` (read the file first; it already builds a full TestBed with store + service mocks — extend its `initialState` with a `pipelineQueue` slice and add `{ provide: PipelineQueueService, useValue: pipelineQueueService }` where `pipelineQueueService = { setTranscribeOptions: jest.fn(), enqueue: jest.fn(), stop: jest.fn(), retry: jest.fn(), readyBundleIds: jest.fn(() => []) }`):

```ts
  it('forwards pipeline options changes to the queue service', () => {
    const options = { modelId: 'm', useWebGPU: false } as any;
    component.onQueueOptionsChange(options);
    expect(pipelineQueueService.setTranscribeOptions).toHaveBeenCalledWith(
      options,
    );
  });

  it('enqueues every ready bundle when the run button is clicked while idle', () => {
    store.setState({
      ...initialState,
      pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
    } as unknown as RootState);
    fixture.detectChanges();

    expect(component.readyBundleIds()).toEqual(['bundle-a', 'bundle-b']);
    component.onRunPauseClick();
    expect(pipelineQueueService.enqueue).toHaveBeenCalledWith([
      'bundle-a',
      'bundle-b',
    ]);
    expect(pipelineQueueService.stop).not.toHaveBeenCalled();
  });

  it('pauses instead of enqueuing when the queue is already running', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: 'bundle-a',
        mode: 'running',
        runs: { 'bundle-a': { state: 'running' } },
      },
    } as unknown as RootState);
    fixture.detectChanges();

    expect(component.queueRunning()).toBe(true);
    component.onRunPauseClick();
    expect(pipelineQueueService.stop).toHaveBeenCalledTimes(1);
    expect(pipelineQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('excludes already-done bundles from the ready set', () => {
    store.setState({
      ...initialState,
      pipelineQueue: {
        queue: [],
        activeId: null,
        mode: 'idle',
        runs: { 'bundle-a': { state: 'done' } },
      },
    } as unknown as RootState);
    fixture.detectChanges();

    expect(component.readyBundleIds()).toEqual(['bundle-b']);
  });
```

The two bundle ids above must match whatever the spec's existing `localMode` fixture contains — read it and use those ids rather than inventing new ones; if the fixture has only one bundle, extend it to two so the "excludes done" assertion is meaningful.

- [ ] **Step 8: Run them to verify they fail**

Run: `npx nx test tratt --testPathPattern=workbench.component`
Expected: FAIL — `component.onQueueOptionsChange is not a function`.

- [ ] **Step 9: Extend the workbench component**

In `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`, add imports:

```ts
import { AutoTranscribeOptionsComponent } from '../../component/tratt-dropzone/auto-transcribe-options.component';
import { TranscriptionOptions } from '../../shared/service/local-transcription.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { computeReadyBundleIds } from '../../store/pipeline-queue';
import {
  selectAllRunStatuses,
  selectQueueMode,
} from '../../store/pipeline-queue/pipeline-queue.selectors';
```

add `AutoTranscribeOptionsComponent` to the `imports` array of the `@Component` decorator, add `private pipelineQueueService: PipelineQueueService,` to the constructor parameters, and add these members next to `hasAnyBundles`:

```ts
  private queueMode = this.store.selectSignal(selectQueueMode);
  private runStatuses = this.store.selectSignal(selectAllRunStatuses);

  /** True while a bundle is in flight — the run button becomes "pause". */
  queueRunning = computed(() => this.queueMode() !== 'idle');

  /**
   * The bundles a "run" would actually enqueue. Computed in the component
   * rather than in a selector because the skip rule needs a LIVE residency
   * check: `selectAllBundleSummaries`'s `awaitingMedia` is `!audio.loaded`,
   * which the reducer only ever sets for the SELECTED bundle, so every
   * other genuinely-resident bundle would be wrongly excluded. This mirrors
   * BundleListComponent's own long-standing merge of the same two sources.
   *
   * Known caveat (documented for step 2.8's identical pattern): the
   * AudioService manager registry is a plain Map, not a signal, so a code
   * path that changes residency WITHOUT a subsequent store write would
   * leave this stale until something else it depends on changes. Both real
   * residency-changing call sites (startSession, completeReattach) write to
   * the store immediately afterwards.
   */
  readyBundleIds = computed(() =>
    computeReadyBundleIds(
      this.bundleSummaries(),
      this.runStatuses(),
      (bundleId) => this.audioService.hasResident(bundleId),
    ),
  );

  /**
   * One global pipeline configuration for the whole queue (the spec's "one
   * global config, run as a queue over all loaded media"), fed from the
   * shell-mounted AutoTranscribeOptionsComponent rather than per bundle.
   */
  onQueueOptionsChange(options: TranscriptionOptions | null): void {
    this.pipelineQueueService.setTranscribeOptions(options);
  }

  onRunPauseClick(): void {
    if (this.queueRunning()) {
      this.pipelineQueueService.stop();
      return;
    }
    this.pipelineQueueService.enqueue(this.readyBundleIds());
  }
```

`bundleSummaries` is already a private field on this component; leave it private and read it from these computeds.

- [ ] **Step 10: Extend the workbench template**

In `apps/tratt/src/app/core/pages/workbench/workbench.component.html`, inside the existing `@if (sessionReady || hasAnyBundles()) { ... }` block, immediately **after** `<tratt-bundle-list></tratt-bundle-list>`, add:

```html
      <!-- The queue's own pipeline configuration. A SECOND mount of the
           component the dropzone already uses (deliberately — that one is
           bound to the dropzone's pre-session `hasAudio` and disappears the
           moment startSession() resets it, taking its emitted options with
           it). `idPrefix` keeps the two mounts' element ids distinct on the
           one screen where both can be visible at once: a returning user
           with restored bundles who drops a new file. -->
      <div class="workbench__queue">
        <h6 class="workbench__queue-title">
          {{ 'workbench.queue.options_title' | transloco }}
        </h6>
        <tratt-auto-transcribe-options
          idPrefix="queue-"
          [audioLoaded]="true"
          [annotationAlreadyLoaded]="false"
          (optionsChange)="onQueueOptionsChange($event)"
        ></tratt-auto-transcribe-options>
        <button
          type="button"
          class="btn btn-outline-primary workbench__queue-run"
          [disabled]="!queueRunning() && readyBundleIds().length === 0"
          (click)="onRunPauseClick()"
        >
          @if (queueRunning()) {
            <i class="bi bi-pause-fill me-1"></i>
            {{ 'workbench.queue.pause' | transloco }}
          } @else {
            <i class="bi bi-play-fill me-1"></i>
            {{
              'workbench.queue.run' | transloco: { count: readyBundleIds().length }
            }}
          }
        </button>
      </div>
```

- [ ] **Step 11: Add the styles**

Append to `apps/tratt/src/app/core/pages/workbench/workbench.component.scss`:

```scss
.workbench__queue {
  margin-top: 0.75rem;
}

.workbench__queue-title {
  margin-bottom: 0.25rem;
}

.workbench__queue-run {
  width: 100%;
  margin-top: 0.5rem;
}
```

- [ ] **Step 12: Run the workbench tests to verify they pass**

Run: `npx nx test tratt --testPathPattern=workbench.component`
Expected: PASS (every pre-existing test in that file too — especially "keeps the dropzone ViewChild resolved regardless of which tab/pane is active").

- [ ] **Step 13: Run the full suite, lint, and a production build**

Run: `npx nx test tratt`
Expected: PASS.

Run: `npx nx lint tratt`
Expected: only the 3 pre-existing errors.

Run: `npm run build`
Expected: succeeds, and the initial bundle stays under the 2MB budget (this step adds no new dependency; a budget warning here would mean something unexpected got pulled into the initial chunk).

- [ ] **Step 14: Manual verification in a real browser** (the first time any of this is visible outside tests)

Run: `npm start` and open `http://localhost:5321/workbench`.

1. **Drain the queue.** Drop **three** short audio files (10-30s each, any format). In the dropzone's own auto-transcribe panel, leave transcription *off* — you'll configure the queue separately. Click **Start session**. Confirm the bundle list shows three rows.
2. In the new **Pipeline settings** panel below the list, tick auto-transcribe, pick the **tiny** model (fastest download), language Swedish or English.
3. Confirm the run button reads "Transcribe 3 file(s)" and is enabled. Click it.
4. Watch the rows: exactly **one** row should show `Running` at a time, the others `Queued`, each flipping to `Done` in turn. **This is the core assertion of the whole step** — if two rows are ever `Running` simultaneously, stop and debug `PipelineQueueService.advance()`/`activateNext()`.
5. **Result lands on the right bundle.** While bundle 2 is running, click bundle **1** to select it and open the editor. Confirm bundle 1's transcript is bundle 1's audio (not bundle 2's), and that when bundle 2 finishes, selecting it shows *its* transcript. Selecting bundle 3 afterwards must not have clobbered anything.
6. **Force a failure and retry it.** Refresh the page, drop two files, start a session, and in Pipeline settings pick a model that is not available on this machine (a WebGPU-only model with WebGPU disabled in the browser), or open DevTools → Network → set "Offline" just after clicking run so the model download fails. Confirm: the failing row goes `Failed` with a translated reason and a tooltip carrying the raw message, and — critically — **the queue keeps going** and the other bundle still reaches `Done`. Then re-enable the network / pick a working model and click that row's **Retry**; confirm it re-runs and reaches `Done`.
7. **Pause.** With three queued bundles, click run, then click **Pause queue** while bundle 1 is running. Confirm bundle 1 finishes, nothing else starts, and the remaining rows show no status (reset to idle) with the button back to "Transcribe 2 file(s)".
8. **Interruption.** Start a run over three bundles and **reload the page** while one is running. After the reload, confirm the previously-running and previously-queued bundles show **Interrupted** (not Running, not Queued), that nothing auto-resumes, and that clicking Retry on one of them works.
9. **`/local` is unchanged.** Open `http://localhost:5321/local`, drop a file, enable auto-transcription, and run one transcription end to end. Confirm it behaves exactly as before this step (progress bar, phase text, elapsed time, finalization) and that the auto-transcribe panel's checkbox still toggles when you click its **label** (this is the `idPrefix` regression check).

Record any deviation in the task report rather than working around it silently.

- [ ] **Step 15: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench apps/tratt/src/app/core/component/tratt-dropzone apps/tratt/src/assets/i18n
git commit -m "feat(workbench): add pipeline run/pause control and queue configuration panel"
```

---

## Self-review record

Run after the plan was written, per the writing-plans skill.

**1. Spec coverage** — every requirement in "## Step 3b design (2026-09-17) — the queue":

| Spec requirement | Task |
| --- | --- |
| New `pipeline-queue` slice, separate from `pipeline` | 1 |
| Exact `PipelineQueueState` / `BundleRunStatus` / `BundleRunErrorKind` shapes | 1 |
| `runs` as a plain `Dictionary`, absent entry ⇒ idle | 1 (`runStatusOf`) |
| Ready/skip rule (`!awaitingMedia` and state ∉ {queued, running, done}) | 1 (`computeReadyBundleIds`), enforced in 4 |
| Failure isolation — mark failed, queue continues | 1 (reducer), 4 (service), verified in 7 |
| `'decode'` from residency failure | 3, 4 |
| `'model-load'`/`'oom'` derived from `classifyTranscriptionWorkerError()` | 3 |
| `'cancelled'` from the cancelled `PipelineEvent` | 3, 4 |
| Residency before running via `ensureResident()` | 4 |
| `IIDBModeOptions.runState`, written per-bundle via `saveModeOptions(mode, options, bundleId)` | 2 |
| New effect on queue actions, `savemodeOptions$` trigger-list convention | 2 |
| Restore `queued`/`running` as `interrupted` in `BundleRestoreEffects` | 2 |
| Queue *position* deliberately not persisted | 2 (nothing persists `queue[]`) |
| `enqueue`/`stop`/`cancelActive`/`retry` public API | 4 |
| One subscription at a time, never two concurrent `run()` calls | 4 |
| Progress reuses `mapPipelineEventToAction`/`isThrottleSafeProgressAction`, dispatches into the NEW actions | 4 (via `dispatchPipelineActions`, which is `isThrottleSafeProgressAction`'s only production consumer) |
| `bundle-list.component.ts`'s `bundles` computed gains the run status; retry for failed/interrupted | 6 |
| "Run pipeline on N ready bundles" ↔ "pause queue" button | 7 |
| `AutoTranscribeOptionsComponent` reused, mounted once in the shell | 7 |
| Warm worker explicitly out of scope | Global Constraints (no task touches the three worker services) |

Gap found and closed during review: the spec never says where a queued run's produced `annotJson` goes, and the obvious action for it corrupts the selected bundle — added as **Task 5** with its rationale stated in the task itself.

**2. Placeholder scan** — no "TBD", no "add appropriate error handling", no "similar to Task N", no test step without test code. The three places that say "read the file first" (Task 6 Step 3, Task 7 Steps 3/7, Task 2 Step 13) are instructions to reuse an existing fixture whose exact contents are spec-file-local, and each names precisely what to reuse and what to add — not a substitute for the code, which is given in full.

**3. Type consistency** — checked across tasks: `BundleRunStatus`/`BundleRunState`/`BundleRunStage`/`BundleRunError` defined once in Task 1 and used unchanged in 2/3/4/6; `runStatusOf(runs, bundleId)` has one signature everywhere; `computeReadyBundleIds(summaries, runs, isResident)` is called identically in Task 4's service and Task 7's component; `ensureResident` is `Promise<boolean>` at its definition (Task 4) and at both call sites; `getManager` is `AudioManager | undefined` in Tasks 4 and 5; `setBundleTranscript`'s props match between action (Task 5 Step 3), reducer (Step 4), dispatcher (Step 8) and effect (Step 12); `saveRunState$` and `saveBundleTranscript$` are the two effect field names used in both the effect file and its spec.

# Phase 3, Step 3c — Capacity Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/workbench` a live, honest capacity readout — a browser-storage bar and a working-memory (RAM) bar — so a user can see why their machine is straining before it does.

**Architecture:** One new root-provided `CapacityService` owns all measurement: it reads the browser's real `navigator.storage.estimate()` for storage, sums a corrected per-`AudioManager` formula over `AudioService`'s live registry for RAM, and refreshes both together on a single 5-second interval. One new standalone `OnPush` `CapacityIndicatorComponent` renders the two bars from that service's two signals and colours the RAM bar by threshold. `WorkbenchComponent` mounts the component in `.workbench__left` and feeds the service the queue's currently-configured pipeline options so the storage bar can split "models" from "annotations". No NgRx slice, no new actions, no change to any pipeline or ingest code path.

**Tech Stack:** Angular 19.2 standalone components + signals (`signal` / `computed` / `DestroyRef`), Transloco i18n, Jest 29.7 + `jest-preset-angular`, `@ngrx/store/testing`'s `provideMockStore` (for the store-backed suites only), Nx 20 monorepo.

**Spec:** `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md` — authoritative section: `## Step 3c design (2026-09-17) — capacity indicator` (line 957 onward). Two earlier sections are load-bearing for this step and must be read too: `## Finding (2026-09-11, during 2.5 planning): non-WAV playback is already permanently degraded to 16kHz mono` (the corrected single-PCM-copy RAM model) and `## Step 3b-i shipped shape (2026-09-17) — the queue` (the `workbench__<block>` naming and the spec-suite reactivity lesson).

## Global Constraints

- Scope is step 3c only. Do not touch `PipelineRunnerService`, the three worker-wrapper services, the `pipeline` or `pipeline-queue` NgRx slices, or anything under `apps/tratt/src/app/core/pages/login/` (`/local`).
- Do not modify the multi-file ingest flow (step 2.7) or add any new pre-drop interception logic — the "warn, don't block" behavior is the RAM bar's own live color only, per the design doc's explicit ruling.
- `RAM_BUDGET_BYTES`, `CAPACITY_POLL_MS`, and the diarization size placeholder must each be a single named, exported, documented constant — never inlined as a magic number at more than one call site.
- Every new piece of state/service/UI needs tests before being considered done — this codebase's established convention is unit tests with mocked dependencies (no real `navigator.storage.estimate()` call in tests — mock it; no real `Worker`/decode in tests).
- `OnPush` change detection on the new component.
- New user-facing strings go into all seven locale files (`en`, `sv`, `de`, `it`, `ko`, `nl`, `zh`) in `apps/tratt/src/assets/i18n/` — real `en`/`sv` translations, English text copied verbatim into the other five. The i18n gate is "missing-key counts per locale don't increase" (this repo's `validate:i18n` is already red on `main` for unrelated pre-existing reasons) — run `npm run validate:i18n` before and after and confirm no locale's count increased. **Use the direct binary** (`node_modules/.bin/*` / `node node_modules/.bin/<tool>`), not `npx`/`rtk`-wrapped invocations — a prior step on this branch found the `rtk` wrapper on this machine unreliable for both `prettier` and `jest` (though the user says they've since amended its config; verifying with the direct binary at least once per task is still the safer habit this plan should establish).
- Follow this codebase's plain-`createAction`-in-a-class convention if any NgRx actions are needed (unlikely for this step — `CapacityService` is designed as a plain signal-based service, no store slice; if your grounding reading finds a reason a store slice is actually needed, explain why and deviate, don't silently add one nobody asked for).

---

## Grounding facts verified against the current source (read this before Task 1)

Everything below was confirmed by reading the files named. Where it *diverges* from what the spec's step 3c section assumed, that is called out explicitly — do not silently "fix" the plan back toward the spec's wording.

1. **`MediaResource.size` is `number | undefined`, not `number`** (`libs/web-media/src/lib/media-resource.ts:41-43`). The spec writes the RAM formula as `manager.resource.size`; the real type forces `?? 0`. It *is* populated in practice — `html-audio-mechanism.ts:158-165` passes `bufferLength` as the `size` argument to `new AudioResource(...)` — but the type is optional and the plan honors it.
2. **`AudioManager.resource` can throw.** Its getter is `return this._audioMechanism.resource!;` (`libs/web-media/src/lib/audio/audio-manager.ts:32-34`) — no guard on `_audioMechanism`, and `resource` on the mechanism is itself optional (hence the `!`). A polled estimator must never throw, so the estimator wraps each manager's read in `try`/`catch`.
3. **`AudioManager.channel` is `Float32Array | undefined`** (`audio-manager.ts:66-68`) — a single array, confirming the spec's corrected formula.
4. **`AudioService.audiomanagers` is a side-effect-free getter** returning `Array.from(this._audiomanagers.values())` (`audio.service.ts:35-37`). Safe to call from a poll. It is a plain `Map`, not a signal — which is exactly why polling (rather than reactive derivation) is the mechanism here.
5. **`AudioService` is provided at the application root**, in `apps/tratt/src/main.ts:182`, not in a lazy route injector — so a `providedIn: 'root'` `CapacityService` can inject it without a `NullInjectorError`. Verified; this was the single biggest DI risk in the design.
6. **`navigator.storage.estimate()` needs no extra typings.** `tsconfig.base.json` sets `"lib": ["es2022", "dom"]`, and `StorageManager.estimate(): Promise<StorageEstimate>` is in `lib.dom`. The `navigator.storage?.estimate` optional chaining at `local-translation.service.ts:338` is **runtime** defensiveness (the API is absent in non-secure contexts and older engines), not a TS typing workaround. This plan uses the same optional-chaining shape for the same reason.
7. **No per-id Whisper size lookup exists.** `getModelsForLanguage()` (`auto-transcribe-options.component.ts:321-326`) is the only dispatcher and it is *module-private* (not exported). The four arrays and the `KbWhisperModel` interface *are* exported. `login.component.ts:246-247` already does an ad-hoc two-array `.find()` — which this plan deliberately does **not** refactor, because `core/pages/login/` is out of scope by Global Constraint.
8. **The four model arrays cannot be moved** out of `auto-transcribe-options.component.ts` without editing `apps/tratt/src/app/core/pages/login/login.component.ts:17-18`, which the Global Constraints forbid. The new lookup helper therefore lives in a *sibling* pure module that imports the arrays from the component file — mirroring the existing `auto-transcribe-options.helpers.ts` precedent for pure logic beside that component.
9. **DIVERGENCE — `/workbench` configures no translation at all.** `pipeline-queue.service.ts:234-237` passes `transcribeOptions` and explicitly comments `// No translateOptions: /workbench has no translation configuration UI`. So the translation term of `modelsEstimateBytes` is **always 0 on `/workbench` today**. The pure estimator still takes and tests a translation argument (the spec requires translation be part of the estimate, and the estimator is the app-wide one), but the `/workbench` call site passes nothing. Documented, not papered over.
10. **DIVERGENCE — `MULTILINGUAL_BYTES`, `MULTILINGUAL_MODEL_ID` and `TRANSLATION_REQUIRED_BYTES` are exported but referenced nowhere in the app.** `resolveAvailability()` (`local-translation.service.ts:151-187`) only ever returns `estimatedBytes` of `OPUS_MT_BYTES_PER_PAIR` (direct) or `OPUS_MT_BYTES_PER_PAIR * 2` (pivot); it never returns the multilingual model. The estimator therefore consumes `TranslationAvailability.estimatedBytes` — which *is* the existing constants, already applied — rather than re-deriving from the raw constants. This is the correct "reuse, don't duplicate" reading and avoids a second, divergent copy of the pivot arithmetic.
11. **`local-transcription.service.ts` and `local-translation.service.ts` cannot be imported under ts-jest.** Both build a `Worker` with `new URL('...', import.meta.url)` (`:116` and `:388`), which the CommonJS `tsconfig.spec.json` cannot compile (TS1343). Three existing specs work around this with a module-scope `jest.mock(...)` stub (`pipeline-runner.service.spec.ts`, `pipeline-queue.service.spec.ts`, `bundle-list.component.spec.ts`). New specs whose import graph can reach either module get the same two guards. **Production code in this step imports `TranscriptionOptions` and `TranslationAvailability` with `import type`**, so no runtime `require` of either module is emitted at all.
12. **`workbench.component.spec.ts` has two suites with different reactivity.** The outer `describe('WorkbenchComponent', ...)` (line 141) hand-rolls `Store.selectSignal` returning plain closures — `computed()`s read through it never re-evaluate, so that suite *cannot* prove a live-updating view. The second, `describe('WorkbenchComponent with real default LOCAL store state', ...)` (line 742) uses `provideMockStore` and *can*. The capacity component's own reactivity test does not need either: it injects a **stub `CapacityService` holding real writable signals**, which is genuinely reactive under `OnPush`.
13. **Current `validate:i18n` baseline on this branch** (run `node apps/tratt/scripts/validate-i18n.js`): `de` 57 missing, `it` 220, `ko` 220, `nl` 220, `sv` 34, `zh` 220, plus 5 extra keys in four locales. All seven locale files already contain a `workbench` object with `start session` / `tabs` / `bundle_list` / `queue`, so `workbench.capacity` is added as a sibling of `queue` in each.
14. **Mockup thresholds and copy**, from `docs/superpowers/specs/reference/TRATT Workbench.dc.html` (script at the file's `renderVals()`): `ramColor = ratio > 0.8 ? '#d7263d' : ratio > 0.55 ? '#d7b17c' : '#3d6b5c'`; diarization placeholder `90` MB; storage note `'Models … cached + annotations … MB. Media is never written to storage.'`; memory note `'Decoded audio for N resident bundles. This, not storage, is what limits how much media you can hold at once.'`. All sizes in that script are decimal MB, matching `OPUS_MT_BYTES_PER_PAIR = 80_000_000` — so this plan uses `1 MB = 1_000_000 bytes` throughout.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.ts` | Pure: flatten the four Whisper arrays, `findWhisperModelSizeMb(modelId)`. Sits beside `auto-transcribe-options.helpers.ts`, the existing precedent for pure logic next to that component. |
| `apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.spec.ts` | Tests for the above. |
| `apps/tratt/src/app/core/shared/service/capacity.service.ts` | `RAM_BUDGET_BYTES`, `CAPACITY_POLL_MS`, `DIARIZATION_MODEL_ESTIMATE_BYTES`, the two pure estimators, and the root `CapacityService` with its two signals and its poll. |
| `apps/tratt/src/app/core/shared/service/capacity.service.spec.ts` | Tests for the above, with a mocked `navigator.storage.estimate` and a stub `AudioService`. |
| `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.ts` | Standalone `OnPush` component: derives percentages, formatted byte strings and the RAM threshold level from `CapacityService`. Also exports the pure `formatBytes`. |
| `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.html` | The two-bar markup. |
| `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.scss` | `capacity-indicator__*` styles, including the three threshold colours. |
| `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.spec.ts` | Component tests, including live re-render on signal change. |

**Modified**

| File | Change |
| --- | --- |
| `apps/tratt/src/app/core/pages/workbench/workbench.component.html` | New `.workbench__capacity` block hosting `<tratt-capacity-indicator>`, between the `@if (sessionReady \|\| hasAnyBundles())` block and the `.workbench__start` button. |
| `apps/tratt/src/app/core/pages/workbench/workbench.component.scss` | `.workbench__capacity` spacing rule, next to the existing `.workbench__queue` rule. |
| `apps/tratt/src/app/core/pages/workbench/workbench.component.ts` | Import `CapacityIndicatorComponent`; inject `CapacityService`; forward the queue's options to it from `onQueueOptionsChange()`. |
| `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` | Provide a stub `CapacityService` in **both** suites; assert the block renders. |
| `apps/tratt/src/assets/i18n/{en,sv,de,it,ko,nl,zh}.json` | New `workbench.capacity` block (7 keys) in each. |

## Task decomposition (and why it is three, not four)

The starting-point breakdown in the brief holds. The model-size lookup helper is ~12 lines of pure code with four assertions; splitting it into its own task would create a task a reviewer could not meaningfully reject independently of the service that is its only consumer, so it is folded into Task 1 (per the skill's Task Right-Sizing rule: fold scaffolding into the task whose deliverable needs it). The three resulting tasks each end at a real gate: "is the measurement correct?", "is the readout correct?", "is it wired in and does the app still build?".

---

### Task 1: `CapacityService` — measurement, constants, and the poll

**Files:**

- Create: `apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.ts`
- Test: `apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.spec.ts`
- Create: `apps/tratt/src/app/core/shared/service/capacity.service.ts`
- Test: `apps/tratt/src/app/core/shared/service/capacity.service.spec.ts`

**Interfaces:**

- Consumes: `AudioService.audiomanagers: AudioManager[]` (`apps/tratt/src/app/core/shared/service/audio.service.ts:35`); `AudioManager.resource: AudioResource` and `AudioManager.channel: Float32Array | undefined` (`libs/web-media/src/lib/audio/audio-manager.ts:32,66`); `MediaResource.size: number | undefined` (`libs/web-media/src/lib/media-resource.ts:41`); `KB_WHISPER_MODELS`, `FINNISH_WHISPER_MODELS`, `NORWEGIAN_WHISPER_MODELS`, `OPENAI_WHISPER_MODELS`, `KbWhisperModel` (all exported from `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts:21,38,77,110,153`); types `TranscriptionOptions` (`local-transcription.service.ts:59`) and `TranslationAvailability` (`local-translation.service.ts:65`).
- Produces, for Tasks 2 and 3:
  - `findWhisperModelSizeMb(modelId: string): number | undefined`
  - `ALL_WHISPER_MODELS: readonly KbWhisperModel[]`
  - `RAM_BUDGET_BYTES: number` (`2_000_000_000`)
  - `CAPACITY_POLL_MS: number` (`5000`)
  - `DIARIZATION_MODEL_ESTIMATE_BYTES: number` (`90_000_000`)
  - `interface StorageCapacity { usedBytes: number; quotaBytes: number; modelsEstimateBytes: number }`
  - `interface ResidentMemoryEstimate { estimatedBytes: number; residentCount: number; budgetBytes: number }`
  - `estimateModelBytes(transcribe: TranscriptionOptions | null, translation: TranslationAvailability | null): number`
  - `estimateResidentBytes(managers: readonly AudioManager[]): number`
  - `class CapacityService` with `readonly storage: Signal<StorageCapacity>`, `readonly residentMemory: Signal<ResidentMemoryEstimate>`, and `setConfiguredOptions(transcribe: TranscriptionOptions | null, translation?: TranslationAvailability | null): void`

- [ ] **Step 1: Write the failing test for the Whisper size lookup**

Create `apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.spec.ts`:

```ts
import { describe, expect, it, jest } from '@jest/globals';

// Convention (see pipeline-queue.service.spec.ts / bundle-list.component.spec.ts):
// these two services build their Worker via `new URL('...', import.meta.url)`,
// which ts-jest's CommonJS config cannot compile (TS1343). This spec's import
// graph reaches auto-transcribe-options.component.ts, which references
// local-transcription.service.ts, so stub both leaf modules out.
jest.mock('../../shared/service/local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import {
  ALL_WHISPER_MODELS,
  findWhisperModelSizeMb,
} from './whisper-model-sizes';

describe('findWhisperModelSizeMb', () => {
  it('finds a KB (Swedish) model', () => {
    expect(
      findWhisperModelSizeMb('onnx-community/kb-whisper-small-ONNX'),
    ).toBe(400);
  });

  it('finds a Finnish model', () => {
    expect(
      findWhisperModelSizeMb(
        'FredrikKarlssonSpeech/whisper-medium-finnish-onnx',
      ),
    ).toBe(684);
  });

  it('finds a Norwegian model', () => {
    expect(
      findWhisperModelSizeMb('FredrikKarlssonSpeech/nb-whisper-large-onnx'),
    ).toBe(1210);
  });

  it('finds an OpenAI model', () => {
    expect(findWhisperModelSizeMb('onnx-community/whisper-tiny-ONNX')).toBe(95);
  });

  it('returns undefined for a model id in none of the four arrays', () => {
    expect(findWhisperModelSizeMb('some/unknown-model')).toBeUndefined();
  });

  it('returns undefined for an empty id rather than matching by accident', () => {
    expect(findWhisperModelSizeMb('')).toBeUndefined();
  });

  it('covers every model in all four arrays with a positive size', () => {
    expect(ALL_WHISPER_MODELS.length).toBe(15);
    for (const model of ALL_WHISPER_MODELS) {
      expect(findWhisperModelSizeMb(model.modelId)).toBe(model.sizeMb);
      expect(model.sizeMb).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "whisper-model-sizes.spec.ts"
```

Expected: FAIL — `Cannot find module './whisper-model-sizes'`.

- [ ] **Step 3: Write `whisper-model-sizes.ts`**

Create `apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.ts`:

```ts
import {
  FINNISH_WHISPER_MODELS,
  KB_WHISPER_MODELS,
  KbWhisperModel,
  NORWEGIAN_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from './auto-transcribe-options.component';

/**
 * Every Whisper model this app can offer, across all four language families.
 *
 * The arrays themselves stay where they are (in the options component) — they
 * cannot move without editing `core/pages/login/login.component.ts`, which is
 * outside step 3c's scope. This module is the sibling pure helper, the same
 * shape as `auto-transcribe-options.helpers.ts`.
 *
 * Note the deliberate ordering: KB (Swedish) first, OpenAI last. No `modelId`
 * appears in more than one array today, so ordering is presentational only —
 * but if that ever changed, the more specific fine-tune would win over the
 * generic OpenAI base model, which is the answer a size estimate wants.
 */
export const ALL_WHISPER_MODELS: readonly KbWhisperModel[] = [
  ...KB_WHISPER_MODELS,
  ...FINNISH_WHISPER_MODELS,
  ...NORWEGIAN_WHISPER_MODELS,
  ...OPENAI_WHISPER_MODELS,
];

/**
 * The advertised download size, in decimal MB, of the Whisper model with this
 * id — or `undefined` if the id is not one this app offers (e.g. a stale id
 * persisted from an older release).
 *
 * There was no per-id lookup before step 3c: `getModelsForLanguage()` in the
 * options component dispatches by LANGUAGE and is module-private, and
 * `login.component.ts` hand-rolls a two-array `.find()` that misses the
 * Finnish and Norwegian families entirely. Callers that have a model id and
 * need its size should use this, not re-derive it.
 */
export function findWhisperModelSizeMb(modelId: string): number | undefined {
  if (!modelId) {
    return undefined;
  }
  return ALL_WHISPER_MODELS.find((model) => model.modelId === modelId)?.sizeMb;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "whisper-model-sizes.spec.ts"
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit the helper**

```bash
git add apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.ts \
        apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.spec.ts
git commit -m "feat(capacity): add findWhisperModelSizeMb across all four model families"
```

- [ ] **Step 6: Write the failing tests for the pure estimators**

Create `apps/tratt/src/app/core/shared/service/capacity.service.spec.ts` with **only** this content for now (the service suite is added in Step 10):

```ts
import { describe, expect, it, jest } from '@jest/globals';

// Convention (see pipeline-queue.service.spec.ts): both services build their
// Worker via `new URL('...', import.meta.url)`, which ts-jest's CommonJS
// config cannot compile (TS1343). capacity.service.ts imports both modules
// with `import type` only, so nothing here touches the real classes — these
// guards protect against any future value import sneaking into the graph.
jest.mock('./local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('./local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { AudioManager } from '@tratt/web-media';
import { DIARIZATION_DEFAULT_MODEL_ID } from './local-diarization-runtime.service';
import type { TranscriptionOptions } from './local-transcription.service';
import type { TranslationAvailability } from './local-translation.service';
import {
  DIARIZATION_MODEL_ESTIMATE_BYTES,
  estimateModelBytes,
  estimateResidentBytes,
} from './capacity.service';

function asrOptions(
  modelId: string,
  withDiarization = false,
): TranscriptionOptions {
  return {
    modelId,
    useWebGPU: false,
    language: 'sv',
    ...(withDiarization
      ? {
          diarization: {
            modelId: DIARIZATION_DEFAULT_MODEL_ID,
            useWebGPU: false,
          },
        }
      : {}),
  };
}

/**
 * A stand-in for a resident AudioManager. Only the two properties the
 * estimator reads are present — `resource.size` (source bytes) and `channel`
 * (the single resident PCM array). See the design doc's 2.5 finding: there is
 * never a second, 16 kHz copy resident on the manager.
 */
function managerWith(
  sizeBytes: number | undefined,
  channelSamples: number | undefined,
): AudioManager {
  return {
    resource: { size: sizeBytes },
    channel:
      channelSamples === undefined
        ? undefined
        : new Float32Array(channelSamples),
  } as unknown as AudioManager;
}

describe('estimateModelBytes', () => {
  it('is zero when nothing is configured', () => {
    expect(estimateModelBytes(null, null)).toBe(0);
  });

  it('counts the configured ASR model at its advertised decimal-MB size', () => {
    expect(
      estimateModelBytes(asrOptions('onnx-community/kb-whisper-small-ONNX'), null),
    ).toBe(400_000_000);
  });

  it('adds the flat diarization placeholder when diarization is configured', () => {
    expect(
      estimateModelBytes(
        asrOptions('onnx-community/kb-whisper-small-ONNX', true),
        null,
      ),
    ).toBe(400_000_000 + DIARIZATION_MODEL_ESTIMATE_BYTES);
  });

  it('still counts diarization when the ASR model id is unknown', () => {
    expect(estimateModelBytes(asrOptions('some/unknown-model', true), null)).toBe(
      DIARIZATION_MODEL_ESTIMATE_BYTES,
    );
  });

  it('reuses TranslationAvailability.estimatedBytes for a direct pair', () => {
    const availability: TranslationAvailability = {
      kind: 'direct',
      modelId: 'Xenova/opus-mt-sv-en',
      estimatedBytes: 80_000_000,
    };
    expect(
      estimateModelBytes(
        asrOptions('onnx-community/kb-whisper-small-ONNX'),
        availability,
      ),
    ).toBe(400_000_000 + 80_000_000);
  });

  it('reuses TranslationAvailability.estimatedBytes for a pivot pair', () => {
    const availability: TranslationAvailability = {
      kind: 'pivot',
      legA: 'Xenova/opus-mt-sv-en',
      legB: 'Xenova/opus-mt-en-de',
      estimatedBytes: 160_000_000,
    };
    expect(estimateModelBytes(null, availability)).toBe(160_000_000);
  });

  it('counts nothing for an unavailable translation pair', () => {
    const availability: TranslationAvailability = {
      kind: 'unavailable',
      reason: 'no path',
    };
    expect(estimateModelBytes(null, availability)).toBe(0);
  });
});

describe('estimateResidentBytes', () => {
  it('is zero with no resident managers', () => {
    expect(estimateResidentBytes([])).toBe(0);
  });

  it('sums source bytes plus 4 bytes per resident Float32 sample', () => {
    // 1 MB source + 1000 samples * 4 bytes.
    expect(estimateResidentBytes([managerWith(1_000_000, 1000)])).toBe(
      1_000_000 + 4000,
    );
  });

  it('sums across several resident managers', () => {
    expect(
      estimateResidentBytes([
        managerWith(1_000_000, 1000),
        managerWith(2_000_000, 500),
      ]),
    ).toBe(1_000_000 + 4000 + 2_000_000 + 2000);
  });

  it('counts only source bytes for a manager whose PCM has been freed', () => {
    expect(estimateResidentBytes([managerWith(1_000_000, undefined)])).toBe(
      1_000_000,
    );
  });

  it('treats an undefined resource size as zero rather than NaN', () => {
    expect(estimateResidentBytes([managerWith(undefined, 1000)])).toBe(4000);
  });

  it('does not throw when a manager\'s resource getter throws', () => {
    const broken = {
      get resource(): never {
        throw new Error('audio mechanism not constructed');
      },
      channel: undefined,
    } as unknown as AudioManager;

    expect(() =>
      estimateResidentBytes([broken, managerWith(1_000_000, 0)]),
    ).not.toThrow();
    expect(estimateResidentBytes([broken, managerWith(1_000_000, 0)])).toBe(
      1_000_000,
    );
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "capacity.service.spec.ts"
```

Expected: FAIL — `Cannot find module './capacity.service'`.

- [ ] **Step 8: Write `capacity.service.ts` — constants and pure estimators only**

Create `apps/tratt/src/app/core/shared/service/capacity.service.ts` with exactly this content (the class is added in Step 9):

```ts
import { AudioManager } from '@tratt/web-media';
import { findWhisperModelSizeMb } from '../../component/tratt-dropzone/whisper-model-sizes';
import type { TranscriptionOptions } from './local-transcription.service';
import type { TranslationAvailability } from './local-translation.service';

/**
 * Decimal megabyte. Every size figure this app already carries is decimal —
 * `KbWhisperModel.sizeMb` (120 MB for kb-whisper-tiny),
 * `OPUS_MT_BYTES_PER_PAIR = 80_000_000` — and `navigator.storage.estimate()`
 * returns plain bytes, so the whole capacity readout is decimal end to end.
 */
const BYTES_PER_MB = 1_000_000;

/** A `Float32Array` sample is 4 bytes. Named so the RAM formula reads. */
const BYTES_PER_FLOAT32_SAMPLE = 4;

/**
 * The working-memory ceiling the RAM bar is drawn against: 2 GB.
 *
 * Deliberately a conservative, device-INDEPENDENT floor. The browser exposes
 * no reliable per-tab memory ceiling to query, and this codebase has no
 * existing `navigator.deviceMemory` sizing convention to extend. Exported as
 * one named constant precisely so that if real-world use shows it wrong, the
 * fix is this one line — not a value buried inside a formula. See the design
 * doc's step 3c section.
 */
export const RAM_BUDGET_BYTES = 2_000_000_000;

/**
 * How often `CapacityService` re-measures BOTH signals, in milliseconds.
 *
 * A deliberate scope ruling, recorded in the design doc's step 3c section:
 * the master plan asked for event-driven refresh ("on mount, after a model
 * download, after a save"), which would mean threading a trigger through
 * every ASR/diarization/translation/IDB completion path across the app — a
 * wide, unrelated surface for a readout that is explicitly labelled an
 * approximation. Polling is a few seconds stale at worst; that is enough for
 * "warn, don't block".
 */
export const CAPACITY_POLL_MS = 5000;

/**
 * Approximate on-disk size of the speaker-diarization model, in bytes.
 *
 * APPROXIMATION, not a measured figure. Unlike ASR (`KbWhisperModel.sizeMb`,
 * real per-model numbers) and translation (`OPUS_MT_BYTES_PER_PAIR`), this
 * app has no per-model size registry for diarization at all — there is one
 * model (`DIARIZATION_DEFAULT_MODEL_ID`) and no size recorded for it
 * anywhere. 90 MB is the same flat placeholder the interactive mockup uses
 * (`docs/superpowers/specs/reference/TRATT Workbench.dc.html`, `renderVals()`).
 * Replace this with a real figure the moment one exists; do not inline it.
 */
export const DIARIZATION_MODEL_ESTIMATE_BYTES = 90 * BYTES_PER_MB;

/** Browser-storage figures backing the storage bar. */
export interface StorageCapacity {
  /** Real bytes in use, straight from `navigator.storage.estimate()`. 0 when unavailable. */
  usedBytes: number;
  /** Real quota, straight from `navigator.storage.estimate()`. 0 when unavailable. */
  quotaBytes: number;
  /**
   * Client-side ESTIMATE of how much of `usedBytes` is cached ML models.
   * Storage cannot be attributed per item in this app — `tratt-database.ts`
   * never records a serialized byte length — so the "annotations" figure the
   * UI shows is `usedBytes - modelsEstimateBytes`, an approximation, not a sum
   * of real per-row sizes.
   */
  modelsEstimateBytes: number;
}

/** Working-memory figures backing the RAM bar. */
export interface ResidentMemoryEstimate {
  /** Sum of `estimateResidentBytes` over every currently-resident AudioManager. */
  estimatedBytes: number;
  /** How many bundles have a resident `AudioManager` right now. */
  residentCount: number;
  /** Always `RAM_BUDGET_BYTES`; carried on the signal so the UI needs no second import. */
  budgetBytes: number;
}

/**
 * Bytes of browser storage the currently-configured pipeline models would
 * occupy once downloaded.
 *
 * Note this is what is CONFIGURED, not what has actually been downloaded —
 * there is no API to ask which models are in the browser's cache. The UI
 * clamps this against the real `usedBytes` before drawing, so a configured-
 * but-not-yet-downloaded model can never make the storage bar overflow.
 *
 * Translation reuses `TranslationAvailability.estimatedBytes` — which
 * `LocalTranslationService.resolveAvailability()` already computes from
 * `OPUS_MT_BYTES_PER_PAIR` (×1 direct, ×2 pivot) — rather than re-deriving
 * the same arithmetic here. As of step 3c nothing on `/workbench` configures
 * translation at all (`pipeline-queue.service.ts` passes no `translateOptions`),
 * so that term is zero there; the parameter exists because this is the
 * app-wide estimator, and it is fully covered by tests.
 */
export function estimateModelBytes(
  transcribe: TranscriptionOptions | null,
  translation: TranslationAvailability | null,
): number {
  let total = 0;

  if (transcribe) {
    const sizeMb = findWhisperModelSizeMb(transcribe.modelId);
    if (sizeMb !== undefined) {
      total += sizeMb * BYTES_PER_MB;
    }
    if (transcribe.diarization) {
      total += DIARIZATION_MODEL_ESTIMATE_BYTES;
    }
  }

  if (translation && translation.kind !== 'unavailable') {
    total += translation.estimatedBytes;
  }

  return total;
}

/**
 * Bytes of working memory the given resident `AudioManager`s hold.
 *
 * Per manager: the source bytes (`resource.size`) plus whatever single PCM
 * array is resident right now (`channel.length * 4`). There is deliberately
 * NO native-rate-plus-16kHz double count: the design doc's 2.5 finding
 * established that at most ONE PCM array is ever resident per manager, and
 * `prepareMonoAudioForMlModel()` builds its 16 kHz copy fresh and uncached per
 * pipeline run.
 *
 * Never throws: `AudioManager.resource` dereferences its mechanism without a
 * guard (`audio-manager.ts:32-34`), so a manager caught mid-construction or
 * mid-destroy can throw from a plain property read. A polled estimate must
 * degrade to "counts zero for that manager", not take the poll down.
 */
export function estimateResidentBytes(
  managers: readonly AudioManager[],
): number {
  let total = 0;
  for (const manager of managers) {
    try {
      total += manager.resource?.size ?? 0;
      total += (manager.channel?.length ?? 0) * BYTES_PER_FLOAT32_SAMPLE;
    } catch {
      // See doc comment: a manager whose mechanism/resource is not there
      // contributes nothing rather than breaking the whole estimate.
    }
  }
  return total;
}
```

> If `@typescript-eslint` flags `manager.resource?.size` as an unnecessary optional chain (the declared return type is non-nullable `AudioResource`, but the getter's body is `this._audioMechanism.resource!`, so it is nullable in fact), replace that one line with `const resource: AudioResource | undefined = manager.resource; total += resource?.size ?? 0;`. Do **not** remove the `try`/`catch`.

- [ ] **Step 9: Run the estimator tests and watch them pass**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "capacity.service.spec.ts"
```

Expected: PASS, 13 tests.

- [ ] **Step 10: Write the failing tests for the service itself**

Append this to `apps/tratt/src/app/core/shared/service/capacity.service.spec.ts`. Two edits to that file's existing import block first, so nothing is imported twice:

1. Replace `import { describe, expect, it, jest } from '@jest/globals';` (the line above the two `jest.mock(...)` guards) with `import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';`.
2. Replace the `import { DIARIZATION_MODEL_ESTIMATE_BYTES, estimateModelBytes, estimateResidentBytes } from './capacity.service';` line with:

```ts
import { TestBed } from '@angular/core/testing';
import { AudioService } from './audio.service';
import {
  CAPACITY_POLL_MS,
  CapacityService,
  DIARIZATION_MODEL_ESTIMATE_BYTES,
  estimateModelBytes,
  estimateResidentBytes,
  RAM_BUDGET_BYTES,
} from './capacity.service';
```

and append:

```ts
describe('CapacityService', () => {
  let managers: AudioManager[];
  let estimate: jest.Mock<() => Promise<StorageEstimate>>;
  let originalStorage: PropertyDescriptor | undefined;

  /** Installs a fake `navigator.storage` — no real quota API is ever called. */
  function installStorage(value: unknown): void {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value,
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    managers = [];
    estimate = jest.fn(async () => ({ usage: 500_000_000, quota: 8_000_000_000 }));
    originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
    installStorage({ estimate });

    TestBed.configureTestingModule({
      providers: [
        CapacityService,
        {
          provide: AudioService,
          useValue: {
            get audiomanagers() {
              return managers;
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
    if (originalStorage) {
      Object.defineProperty(navigator, 'storage', originalStorage);
    } else {
      delete (navigator as unknown as Record<string, unknown>).storage;
    }
    jest.restoreAllMocks();
  });

  it('reads real storage figures once, immediately on construction', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(service.storage().usedBytes).toBe(500_000_000);
    expect(service.storage().quotaBytes).toBe(8_000_000_000);
  });

  it('reports zeroes when the browser exposes no storage manager', async () => {
    installStorage(undefined);
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    expect(service.storage().usedBytes).toBe(0);
    expect(service.storage().quotaBytes).toBe(0);
  });

  it('keeps the last known figures when estimate() rejects', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    estimate.mockRejectedValueOnce(new Error('denied'));
    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS);

    expect(service.storage().usedBytes).toBe(500_000_000);
  });

  it('sums resident memory over the live AudioService registry', async () => {
    managers = [managerWith(1_000_000, 1000), managerWith(2_000_000, 500)];
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    expect(service.residentMemory().estimatedBytes).toBe(
      1_000_000 + 4000 + 2_000_000 + 2000,
    );
    expect(service.residentMemory().residentCount).toBe(2);
    expect(service.residentMemory().budgetBytes).toBe(RAM_BUDGET_BYTES);
  });

  it('picks up a newly resident bundle on the next poll', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(service.residentMemory().residentCount).toBe(0);

    managers = [managerWith(1_000_000, 1000)];
    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS);

    expect(service.residentMemory().residentCount).toBe(1);
    expect(service.residentMemory().estimatedBytes).toBe(1_000_000 + 4000);
  });

  it('polls storage again on each interval', async () => {
    TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(estimate).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS * 3);
    expect(estimate).toHaveBeenCalledTimes(4);
  });

  it('stops polling once its injector is destroyed', async () => {
    TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(estimate).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS * 3);

    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('applies configured model sizes immediately, without waiting for a poll', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(service.storage().modelsEstimateBytes).toBe(0);

    service.setConfiguredOptions(
      asrOptions('onnx-community/kb-whisper-small-ONNX', true),
    );

    expect(service.storage().modelsEstimateBytes).toBe(
      400_000_000 + DIARIZATION_MODEL_ESTIMATE_BYTES,
    );
  });

  it('clears the model estimate when options are cleared', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    service.setConfiguredOptions(
      asrOptions('onnx-community/kb-whisper-small-ONNX'),
    );
    expect(service.storage().modelsEstimateBytes).toBe(400_000_000);

    service.setConfiguredOptions(null);

    expect(service.storage().modelsEstimateBytes).toBe(0);
  });
});
```

- [ ] **Step 11: Run them and watch them fail**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "capacity.service.spec.ts"
```

Expected: FAIL — `CapacityService is not exported` / `'CapacityService' refers to a value that does not exist`.

- [ ] **Step 12: Add the `CapacityService` class**

Add two imports at the very top of `apps/tratt/src/app/core/shared/service/capacity.service.ts`, above the existing `import { AudioManager } from '@tratt/web-media';` line:

```ts
import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  Signal,
  signal,
} from '@angular/core';
```

and one beside the other relative imports:

```ts
import { AudioService } from './audio.service';
```

then append the class to the end of the file:

```ts
/**
 * Live, approximate capacity readout for `/workbench`: how much browser
 * storage this app is using, and how much working memory the currently
 * resident decoded audio holds.
 *
 * Both figures refresh together on ONE `CAPACITY_POLL_MS` interval, started
 * on construction (which, for a `providedIn: 'root'` service, is the first
 * time anything injects it — in practice when the capacity indicator first
 * mounts) and torn down with the injector via `DestroyRef`. See
 * `CAPACITY_POLL_MS` for why this is polled rather than event-driven.
 *
 * This service only MEASURES. It never blocks, warns, gates, or intercepts —
 * the "warn, don't block" behaviour of step 3c is entirely the RAM bar's own
 * live colour, in `CapacityIndicatorComponent`.
 */
@Injectable({ providedIn: 'root' })
export class CapacityService {
  /**
   * Bumped on every poll. `residentMemory` depends on it so that a `computed`
   * can re-read `AudioService`'s plain (non-signal) `Map` on each tick.
   */
  private readonly pollTick = signal(0);

  private readonly rawStorage = signal<{ usedBytes: number; quotaBytes: number }>(
    { usedBytes: 0, quotaBytes: 0 },
  );

  private readonly transcribeOptions = signal<TranscriptionOptions | null>(null);
  private readonly translationAvailability =
    signal<TranslationAvailability | null>(null);

  readonly storage: Signal<StorageCapacity> = computed(() => {
    const raw = this.rawStorage();
    return {
      usedBytes: raw.usedBytes,
      quotaBytes: raw.quotaBytes,
      modelsEstimateBytes: estimateModelBytes(
        this.transcribeOptions(),
        this.translationAvailability(),
      ),
    };
  });

  readonly residentMemory: Signal<ResidentMemoryEstimate> = computed(() => {
    this.pollTick();
    const managers = this.audioService.audiomanagers;
    return {
      estimatedBytes: estimateResidentBytes(managers),
      residentCount: managers.length,
      budgetBytes: RAM_BUDGET_BYTES,
    };
  });

  constructor(private audioService: AudioService) {
    void this.refresh();
    const handle = setInterval(() => void this.refresh(), CAPACITY_POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(handle));
  }

  /**
   * Tells the storage bar which pipeline models are currently configured, so
   * it can split "models" from "annotations". Applied immediately — a user
   * ticking a bigger model should not wait up to `CAPACITY_POLL_MS` to see the
   * models segment grow.
   *
   * `translation` is optional and defaults to `null`: `/workbench` configures
   * no translation (see `estimateModelBytes`'s doc comment).
   */
  setConfiguredOptions(
    transcribe: TranscriptionOptions | null,
    translation: TranslationAvailability | null = null,
  ): void {
    this.transcribeOptions.set(transcribe);
    this.translationAvailability.set(translation);
  }

  /**
   * One measurement pass over both figures. `residentMemory` is synchronous
   * and simply re-derives from `pollTick`; storage needs the async browser
   * API, whose failure (or absence) leaves the last known figures in place
   * rather than flashing the bar back to zero.
   */
  private async refresh(): Promise<void> {
    this.pollTick.update((n) => n + 1);
    if (!navigator.storage?.estimate) {
      return;
    }
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      this.rawStorage.set({ usedBytes: usage, quotaBytes: quota });
    } catch {
      // Storage estimation can reject (permissions, private mode). Keep the
      // previous figures — a capacity readout going momentarily blank is
      // worse than one being a few seconds stale.
    }
  }
}
```

- [ ] **Step 13: Run the full spec and watch it pass**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "capacity.service.spec.ts"
```

Expected: PASS, 22 tests (13 estimator + 9 service).

- [ ] **Step 14: Format and lint**

```bash
node node_modules/.bin/prettier --write \
  apps/tratt/src/app/core/shared/service/capacity.service.ts \
  apps/tratt/src/app/core/shared/service/capacity.service.spec.ts \
  apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.ts \
  apps/tratt/src/app/core/component/tratt-dropzone/whisper-model-sizes.spec.ts
npm run lint
```

Expected: prettier rewrites nothing substantive; lint reports no NEW errors. Three pre-existing lint errors are known and tracked separately (one in `core/shared/tratt-database.ts:374`, two in `editors/2D-editor/transcr-window/transcr-window.component.html:74`) — do not fix them here.

- [ ] **Step 15: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/capacity.service.ts \
        apps/tratt/src/app/core/shared/service/capacity.service.spec.ts
git commit -m "feat(capacity): add CapacityService with polled storage and resident-memory signals"
```

---

### Task 2: `CapacityIndicatorComponent` — the two bars and their copy

**Files:**

- Create: `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.ts`
- Create: `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.html`
- Create: `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.scss`
- Test: `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.spec.ts`
- Modify: `apps/tratt/src/assets/i18n/en.json:808-813` (add a `capacity` sibling after `queue`), and the same position in `sv.json:756-761`, `de.json:731-736`, `it.json:513-518`, `ko.json:513-518`, `nl.json:513-518`, `zh.json:513-518`

**Interfaces:**

- Consumes (from Task 1): `CapacityService` with `storage: Signal<StorageCapacity>` and `residentMemory: Signal<ResidentMemoryEstimate>`; `StorageCapacity` = `{ usedBytes, quotaBytes, modelsEstimateBytes }`; `ResidentMemoryEstimate` = `{ estimatedBytes, residentCount, budgetBytes }`.
- Produces, for Task 3: `class CapacityIndicatorComponent` — standalone, selector `tratt-capacity-indicator`, no inputs, no outputs; plus the exported pure `formatBytes(bytes: number): string`.

- [ ] **Step 1: Add the seven i18n keys to `en.json`**

In `apps/tratt/src/assets/i18n/en.json`, the `workbench` object currently ends at line 813-814 with the `queue` block's closing brace. Replace:

```json
      "no_options_hint": "No transcription options configured — enable auto transcription first."
    }
  }
}
```

with:

```json
      "no_options_hint": "No transcription options configured — enable auto transcription first."
    },
    "capacity": {
      "storage_label": "Browser storage",
      "storage_text": "{{used}} of {{quota}}",
      "storage_note": "Models {{models}} cached + annotations {{annotations}}. Media is never written to storage.",
      "storage_unavailable": "This browser does not report storage usage.",
      "memory_label": "Working memory (est.)",
      "memory_text": "{{used}} of ~{{budget}}",
      "memory_note": "Decoded audio for {{count}} resident file(s). This, not storage, is what limits how much media you can hold at once."
    }
  }
}
```

- [ ] **Step 2: Add the same keys to `sv.json`, with real Swedish**

In `apps/tratt/src/assets/i18n/sv.json`, replace:

```json
      "no_options_hint": "Inga transkriptionsalternativ inställda — aktivera automatisk transkribering först."
    }
  }
}
```

with:

```json
      "no_options_hint": "Inga transkriptionsalternativ inställda — aktivera automatisk transkribering först."
    },
    "capacity": {
      "storage_label": "Webbläsarlagring",
      "storage_text": "{{used}} av {{quota}}",
      "storage_note": "Modeller {{models}} cachade + annotationer {{annotations}}. Media skrivs aldrig till lagringen.",
      "storage_unavailable": "Den här webbläsaren rapporterar inte lagringsanvändning.",
      "memory_label": "Arbetsminne (uppskattat)",
      "memory_text": "{{used}} av ~{{budget}}",
      "memory_note": "Avkodat ljud för {{count}} fil(er) i minnet. Det är detta, inte lagringen, som begränsar hur mycket media du kan ha igång samtidigt."
    }
  }
}
```

- [ ] **Step 3: Copy the English strings verbatim into the other five locales**

In each of `de.json`, `it.json`, `ko.json`, `nl.json`, `zh.json`, the `queue` block ends the `workbench` object the same way. In **`de.json`** replace:

```json
      "no_options_hint": "Keine Transkriptionsoptionen festgelegt — aktivieren Sie zuerst die automatische Transkription."
    }
  }
}
```

and in **each of `it.json`, `ko.json`, `nl.json`, `zh.json`** replace:

```json
      "no_options_hint": "No transcription options configured — enable auto transcription first."
    }
  }
}
```

with the same block in all five (only the preceding `no_options_hint` line differs — keep each file's own):

```json
    },
    "capacity": {
      "storage_label": "Browser storage",
      "storage_text": "{{used}} of {{quota}}",
      "storage_note": "Models {{models}} cached + annotations {{annotations}}. Media is never written to storage.",
      "storage_unavailable": "This browser does not report storage usage.",
      "memory_label": "Working memory (est.)",
      "memory_text": "{{used}} of ~{{budget}}",
      "memory_note": "Decoded audio for {{count}} resident file(s). This, not storage, is what limits how much media you can hold at once."
    }
  }
}
```

(i.e. the `no_options_hint` line stays untouched; the `}` that closed `queue` becomes `},` and the `capacity` block follows.)

- [ ] **Step 4: Confirm no locale's missing-key count went up**

```bash
node apps/tratt/scripts/validate-i18n.js 2>&1 | grep -E "^\[.*\] Missing"
```

Expected, unchanged from the pre-task baseline:

```
[de] Missing 57 key(s):
[it] Missing 220 key(s):
[ko] Missing 220 key(s):
[nl] Missing 220 key(s):
[sv] Missing 34 key(s):
[zh] Missing 220 key(s):
```

The script still exits non-zero overall — that is the pre-existing red state on `main`, not this task's doing. If any number is 7 higher than the baseline, a locale is missing the `capacity` block; add it there.

- [ ] **Step 5: Write the failing component tests**

Create `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal, WritableSignal } from '@angular/core';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import {
  CapacityService,
  RAM_BUDGET_BYTES,
  ResidentMemoryEstimate,
  StorageCapacity,
} from '../../shared/service/capacity.service';
import {
  CapacityIndicatorComponent,
  formatBytes,
} from './capacity-indicator.component';

describe('formatBytes', () => {
  it('renders sub-gigabyte figures as whole decimal MB', () => {
    expect(formatBytes(400_000_000)).toBe('400 MB');
  });

  it('renders gigabyte figures with one decimal', () => {
    expect(formatBytes(8_000_000_000)).toBe('8.0 GB');
  });

  it('renders zero as 0 MB rather than an empty string', () => {
    expect(formatBytes(0)).toBe('0 MB');
  });

  it('clamps a negative figure to zero', () => {
    expect(formatBytes(-5)).toBe('0 MB');
  });
});

describe('CapacityIndicatorComponent', () => {
  let fixture: ComponentFixture<CapacityIndicatorComponent>;
  let storage: WritableSignal<StorageCapacity>;
  let residentMemory: WritableSignal<ResidentMemoryEstimate>;

  function memoryFill(): HTMLElement {
    return fixture.debugElement.query(
      By.css('.capacity-indicator__memory-fill'),
    ).nativeElement as HTMLElement;
  }

  function text(selector: string): string {
    return (
      fixture.debugElement.query(By.css(selector)).nativeElement as HTMLElement
    ).textContent!.trim();
  }

  beforeEach(async () => {
    storage = signal<StorageCapacity>({
      usedBytes: 500_000_000,
      quotaBytes: 8_000_000_000,
      modelsEstimateBytes: 400_000_000,
    });
    residentMemory = signal<ResidentMemoryEstimate>({
      estimatedBytes: 200_000_000,
      residentCount: 2,
      budgetBytes: RAM_BUDGET_BYTES,
    });

    await TestBed.configureTestingModule({
      imports: [CapacityIndicatorComponent],
      providers: [
        // A stub CapacityService built on REAL writable signals. This is the
        // mechanism that actually supports reactivity under OnPush — unlike
        // workbench.component.spec.ts's outer suite, whose hand-rolled
        // selectSignal returns plain closures that never re-evaluate. See the
        // "live" test at the bottom of this suite.
        { provide: CapacityService, useValue: { storage, residentMemory } },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            selectTranslate: () => of(''),
            config: { reRenderOnLangChange: false },
            // TranslocoPipe.transform() resolves its scope through this
            // before it will call translate() at all — without it every
            // piped label renders as the pipe's empty initial value.
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CapacityIndicatorComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders both bars', () => {
    expect(
      fixture.debugElement.query(By.css('.capacity-indicator__storage-models')),
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(
        By.css('.capacity-indicator__storage-annotations'),
      ),
    ).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.capacity-indicator__memory-fill'))).toBeTruthy();
  });

  it('splits the storage bar into a models segment and an annotations segment', () => {
    const models = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-models'),
    ).nativeElement as HTMLElement;
    const annotations = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-annotations'),
    ).nativeElement as HTMLElement;

    // 400 MB of 8 GB = 5%; the remaining 100 MB of the 500 MB used = 1.25%.
    expect(models.style.width).toBe('5%');
    expect(annotations.style.width).toBe('1.25%');
  });

  it('never lets a configured-but-undownloaded model overflow the used figure', () => {
    storage.set({
      usedBytes: 100_000_000,
      quotaBytes: 8_000_000_000,
      modelsEstimateBytes: 1_200_000_000,
    });
    fixture.detectChanges();

    const models = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-models'),
    ).nativeElement as HTMLElement;
    const annotations = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-annotations'),
    ).nativeElement as HTMLElement;

    // Models clamp to the real 100 MB used (1.25%), annotations to zero.
    expect(models.style.width).toBe('1.25%');
    expect(annotations.style.width).toBe('0%');
  });

  it('shows the unavailable note instead of the breakdown when there is no quota', () => {
    storage.set({ usedBytes: 0, quotaBytes: 0, modelsEstimateBytes: 0 });
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('.capacity-indicator__storage-note')),
    ).toBeFalsy();
    expect(text('.capacity-indicator__storage-unavailable')).toBe(
      'workbench.capacity.storage_unavailable',
    );
  });

  it('colours the memory bar green below 55% of budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.3,
      residentCount: 1,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain('capacity-indicator__memory-fill--ok');
  });

  it('colours the memory bar amber between 55% and 80% of budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.6,
      residentCount: 3,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--warn',
    );
  });

  it('colours the memory bar red above 80% of budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.9,
      residentCount: 5,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--danger',
    );
  });

  it('caps the memory bar width at 100% when the estimate exceeds the budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 2,
      residentCount: 9,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().style.width).toBe('100%');
  });

  // The coverage gap step 3b-i's own review had to retro-fix: a suite that
  // only ever renders one fixed state proves nothing about a LIVE bar. This
  // drives the same fixture through two states and asserts both the colour
  // class and the width actually change.
  it('re-renders live when the resident-memory signal changes under it', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.1,
      residentCount: 1,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();
    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--ok',
    );
    expect(memoryFill().style.width).toBe('10%');

    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.85,
      residentCount: 6,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--danger',
    );
    expect(memoryFill().classList).not.toContain(
      'capacity-indicator__memory-fill--ok',
    );
    expect(memoryFill().style.width).toBe('85%');
  });

  it('exposes the formatted figures the copy interpolates', () => {
    const component = fixture.componentInstance;

    expect(component.storageUsedText()).toBe('500 MB');
    expect(component.storageQuotaText()).toBe('8.0 GB');
    expect(component.modelsText()).toBe('400 MB');
    expect(component.annotationsText()).toBe('100 MB');
    expect(component.memoryUsedText()).toBe('200 MB');
    expect(component.memoryBudgetText()).toBe('2.0 GB');
    expect(component.residentCount()).toBe(2);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "capacity-indicator.component.spec.ts"
```

Expected: FAIL — `Cannot find module './capacity-indicator.component'`.

- [ ] **Step 7: Write the component class**

Create `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CapacityService } from '../../shared/service/capacity.service';

/**
 * Renders a byte count the way the capacity copy reads it: whole decimal
 * megabytes below a gigabyte, one decimal above. Decimal throughout, matching
 * every other size figure in this app (`KbWhisperModel.sizeMb`,
 * `OPUS_MT_BYTES_PER_PAIR`) and `navigator.storage.estimate()`'s own units.
 */
export function formatBytes(bytes: number): string {
  const safe = Math.max(0, bytes);
  if (safe >= 1_000_000_000) {
    return `${(safe / 1_000_000_000).toFixed(1)} GB`;
  }
  return `${Math.round(safe / 1_000_000)} MB`;
}

/** Fraction of the RAM budget at which the bar turns amber. */
const MEMORY_WARN_RATIO = 0.55;
/** Fraction of the RAM budget at which the bar turns red. */
const MEMORY_DANGER_RATIO = 0.8;

/**
 * Two bars in the `/workbench` left rail: browser storage, and estimated
 * working memory.
 *
 * The working-memory bar's colour IS step 3c's "warn, don't block": it turns
 * amber past 55% of `RAM_BUDGET_BYTES` and red past 80%, within one
 * `CAPACITY_POLL_MS` of a drop pushing residency there. Nothing here blocks,
 * gates, or intercepts anything — the multi-file ingest flow is untouched.
 *
 * Both figures are approximations and the copy says so. Storage cannot be
 * attributed per item in this app (no serialized byte length is ever
 * recorded), so the "annotations" figure is `usedBytes - modelsEstimateBytes`
 * and the models figure is clamped to `usedBytes` — a model configured but
 * not yet downloaded must never make the bar overflow.
 */
@Component({
  selector: 'tratt-capacity-indicator',
  templateUrl: './capacity-indicator.component.html',
  styleUrls: ['./capacity-indicator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
})
export class CapacityIndicatorComponent {
  private readonly capacity = inject(CapacityService);

  private readonly storage = this.capacity.storage;
  private readonly memory = this.capacity.residentMemory;

  /** False when the browser exposes no storage estimate at all. */
  readonly storageAvailable = computed(() => this.storage().quotaBytes > 0);

  /** Models, never counted above what is really on disk. */
  private readonly modelsBytes = computed(() =>
    Math.min(this.storage().modelsEstimateBytes, this.storage().usedBytes),
  );

  private readonly annotationsBytes = computed(() =>
    Math.max(0, this.storage().usedBytes - this.modelsBytes()),
  );

  readonly modelsPercent = computed(() =>
    this.percentOf(this.modelsBytes(), this.storage().quotaBytes),
  );

  readonly annotationsPercent = computed(() =>
    this.percentOf(this.annotationsBytes(), this.storage().quotaBytes),
  );

  readonly memoryPercent = computed(() =>
    this.percentOf(this.memory().estimatedBytes, this.memory().budgetBytes),
  );

  readonly memoryLevel = computed<'ok' | 'warn' | 'danger'>(() => {
    const budget = this.memory().budgetBytes;
    if (budget <= 0) {
      return 'ok';
    }
    const ratio = this.memory().estimatedBytes / budget;
    if (ratio > MEMORY_DANGER_RATIO) {
      return 'danger';
    }
    if (ratio > MEMORY_WARN_RATIO) {
      return 'warn';
    }
    return 'ok';
  });

  readonly storageUsedText = computed(() => formatBytes(this.storage().usedBytes));
  readonly storageQuotaText = computed(() =>
    formatBytes(this.storage().quotaBytes),
  );
  readonly modelsText = computed(() => formatBytes(this.modelsBytes()));
  readonly annotationsText = computed(() => formatBytes(this.annotationsBytes()));
  readonly memoryUsedText = computed(() =>
    formatBytes(this.memory().estimatedBytes),
  );
  readonly memoryBudgetText = computed(() =>
    formatBytes(this.memory().budgetBytes),
  );
  readonly residentCount = computed(() => this.memory().residentCount);

  private percentOf(value: number, total: number): number {
    if (total <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, (value / total) * 100));
  }
}
```

- [ ] **Step 8: Write the template**

Create `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.html`:

```html
<div class="capacity-indicator">
  <div class="capacity-indicator__row">
    <span class="capacity-indicator__label">
      {{ 'workbench.capacity.storage_label' | transloco }}
    </span>
    <span class="capacity-indicator__value">
      {{
        'workbench.capacity.storage_text'
          | transloco: { used: storageUsedText(), quota: storageQuotaText() }
      }}
    </span>
  </div>
  <div class="capacity-indicator__bar">
    <div
      class="capacity-indicator__storage-models"
      [style.width.%]="modelsPercent()"
    ></div>
    <div
      class="capacity-indicator__storage-annotations"
      [style.width.%]="annotationsPercent()"
    ></div>
  </div>
  @if (storageAvailable()) {
    <div class="capacity-indicator__note capacity-indicator__storage-note">
      {{
        'workbench.capacity.storage_note'
          | transloco: { models: modelsText(), annotations: annotationsText() }
      }}
    </div>
  } @else {
    <div
      class="capacity-indicator__note capacity-indicator__storage-unavailable"
    >
      {{ 'workbench.capacity.storage_unavailable' | transloco }}
    </div>
  }

  <div class="capacity-indicator__row capacity-indicator__row--spaced">
    <span class="capacity-indicator__label">
      {{ 'workbench.capacity.memory_label' | transloco }}
    </span>
    <span class="capacity-indicator__value">
      {{
        'workbench.capacity.memory_text'
          | transloco: { used: memoryUsedText(), budget: memoryBudgetText() }
      }}
    </span>
  </div>
  <div class="capacity-indicator__bar">
    <div
      class="capacity-indicator__memory-fill"
      [class.capacity-indicator__memory-fill--ok]="memoryLevel() === 'ok'"
      [class.capacity-indicator__memory-fill--warn]="memoryLevel() === 'warn'"
      [class.capacity-indicator__memory-fill--danger]="
        memoryLevel() === 'danger'
      "
      [style.width.%]="memoryPercent()"
    ></div>
  </div>
  <div class="capacity-indicator__note capacity-indicator__memory-note">
    {{
      'workbench.capacity.memory_note'
        | transloco: { count: residentCount() }
    }}
  </div>
</div>
```

- [ ] **Step 9: Write the styles**

Create `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.scss`:

```scss
.capacity-indicator {
  background: #fff;
  border: 1px solid #d4d9e0;
  border-radius: 4px;
  padding: 9px 11px 10px 11px;
}

.capacity-indicator__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #667a90;
}

.capacity-indicator__row--spaced {
  margin-top: 9px;
}

.capacity-indicator__label {
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.capacity-indicator__value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.capacity-indicator__bar {
  margin-top: 5px;
  height: 8px;
  border-radius: 4px;
  background: #e6e8ed;
  overflow: hidden;
  display: flex;
}

.capacity-indicator__storage-models {
  height: 100%;
  background: #2a4765;
}

.capacity-indicator__storage-annotations {
  height: 100%;
  background: #3d6b5c;
}

.capacity-indicator__memory-fill {
  height: 100%;
}

// The three thresholds the design doc pins to the mockup's own script:
// green below 55% of RAM_BUDGET_BYTES, amber 55-80%, red above 80%.
.capacity-indicator__memory-fill--ok {
  background: #3d6b5c;
}

.capacity-indicator__memory-fill--warn {
  background: #d7b17c;
}

.capacity-indicator__memory-fill--danger {
  background: #d7263d;
}

.capacity-indicator__note {
  margin-top: 4px;
  font-size: 11px;
  color: #6b7c90;
  line-height: 1.4;
}
```

- [ ] **Step 10: Run the component tests and watch them pass**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "capacity-indicator.component.spec.ts"
```

Expected: PASS, 15 tests (4 `formatBytes` + 11 component).

- [ ] **Step 11: Format and lint**

```bash
node node_modules/.bin/prettier --write \
  "apps/tratt/src/app/core/component/capacity-indicator/*" \
  "apps/tratt/src/assets/i18n/*.json"
npm run lint
```

Expected: no NEW lint errors (the three pre-existing ones remain).

- [ ] **Step 12: Re-confirm the i18n gate after prettier touched the locale files**

```bash
node apps/tratt/scripts/validate-i18n.js 2>&1 | grep -E "^\[.*\] Missing"
```

Expected: identical to Step 4's output (`de` 57, `it` 220, `ko` 220, `nl` 220, `sv` 34, `zh` 220).

- [ ] **Step 13: Commit**

```bash
git add apps/tratt/src/app/core/component/capacity-indicator \
        apps/tratt/src/assets/i18n/en.json \
        apps/tratt/src/assets/i18n/sv.json \
        apps/tratt/src/assets/i18n/de.json \
        apps/tratt/src/assets/i18n/it.json \
        apps/tratt/src/assets/i18n/ko.json \
        apps/tratt/src/assets/i18n/nl.json \
        apps/tratt/src/assets/i18n/zh.json
git commit -m "feat(capacity): add CapacityIndicatorComponent with storage and working-memory bars"
```

---

### Task 3: Mount it in the workbench left rail

**Files:**

- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html:95-103` (between the `@if` block's closing `}` and the `.workbench__start` button)
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.scss:14-26` (add `.workbench__capacity` beside the `.workbench__queue` rules)
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts:64-79` (imports array), `:206-216` (constructor), `:176-182` (`onQueueOptionsChange`)
- Test: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` — both suites (`describe` at line 141 and at line 742)

**Interfaces:**

- Consumes (from Tasks 1 and 2): `CapacityIndicatorComponent` (standalone, selector `tratt-capacity-indicator`, no inputs); `CapacityService.setConfiguredOptions(transcribe: TranscriptionOptions | null, translation?: TranslationAvailability | null): void`, `CapacityService.storage`, `CapacityService.residentMemory`.
- Produces: nothing new — this task only wires existing pieces together.

**Insertion point, and why.** `.workbench__left` currently runs: the upload/record `ngbNav` → its outlet → a single `@if (sessionReady || hasAnyBundles())` block containing `<tratt-bundle-list>` and the `.workbench__queue` panel → the `.workbench__start` button. The capacity block goes **after that `@if` block and before the Start button**, unconditionally, because:

1. **It must render for every user, including one with no bundles yet.** Cached ML models are the dominant storage consumer and they can be downloaded from the `/local` route before `/workbench` ever has a bundle. Putting the block inside the `@if` would hide exactly the "why is my browser storage full" answer from the user most likely to be asking it.
2. **Keeping it outside the `@if` keeps `CapacityService`'s poll lifecycle stable.** Inside, the component would be created and destroyed as session state flips, churning the interval for no benefit.
3. **It preserves the rail's existing rhythm** — measurement above, primary action (Start session) last — and matches the mockup's own ordering, where the capacity card sits below the pipeline settings.

- [ ] **Step 1: Write the failing mount test in the reactive suite**

In `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts`, inside `describe('WorkbenchComponent with real default LOCAL store state', ...)` (the suite starting at line 742 — the one whose `provideMockStore` produces genuinely reactive signals), add this test at the end of the suite, just before its closing `});`:

```ts
  // Step 3c: the capacity block is deliberately OUTSIDE the
  // `@if (sessionReady || hasAnyBundles())` gate — cached models are the
  // dominant storage consumer and can exist before any bundle does, so the
  // readout must render on a completely empty workbench too.
  it('renders the capacity indicator even with no named bundles', async () => {
    const localMode = {
      bundles: bundlesState([
        { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
      ]),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    };

    const fx = await createWithLocalMode(localMode);

    expect(fx.componentInstance.hasAnyBundles()).toBe(false);
    expect(fx.debugElement.query(By.css('.workbench__capacity'))).toBeTruthy();
    expect(
      fx.debugElement.query(By.css('tratt-capacity-indicator')),
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Write the failing options-forwarding test in the outer suite**

In the same file, inside `describe('WorkbenchComponent', ...)` (line 141), add:

```ts
  it('forwards the queue pipeline options to CapacityService so the storage bar can split models from annotations', () => {
    const options = {
      modelId: 'onnx-community/kb-whisper-small-ONNX',
      useWebGPU: false,
      language: 'sv',
    };

    component.onQueueOptionsChange(options as never);

    expect(pipelineQueueService.setTranscribeOptions).toHaveBeenCalledWith(
      options,
    );
    expect(capacityService.setConfiguredOptions).toHaveBeenCalledWith(options);
  });

  it('clears the CapacityService model estimate when the options are cleared', () => {
    component.onQueueOptionsChange(null);

    expect(capacityService.setConfiguredOptions).toHaveBeenCalledWith(null);
  });
```

- [ ] **Step 3: Provide the `CapacityService` stub in BOTH suites**

`WorkbenchComponent` will now import the real `CapacityIndicatorComponent`, which injects the real root `CapacityService`, which injects `AudioService` — and both suites stub `AudioService` with an object that has no `audiomanagers` getter and would blow up the poll. Stub `CapacityService` in both.

In the **outer** suite (line 141), add to the `let` declarations near `pipelineQueueService`:

```ts
  // Step 3c: WorkbenchComponent now mounts CapacityIndicatorComponent, which
  // injects the real root CapacityService — which would start a 5s poll over
  // an AudioService stub that has no `audiomanagers`. Provide signals-backed
  // fakes instead; the component's own behaviour is covered in
  // capacity-indicator.component.spec.ts.
  let capacityService: {
    storage: WritableSignal<StorageCapacity>;
    residentMemory: WritableSignal<ResidentMemoryEstimate>;
    setConfiguredOptions: jest.Mock;
  };
```

in its `beforeEach`, before `TestBed.configureTestingModule`:

```ts
    capacityService = {
      storage: signal<StorageCapacity>({
        usedBytes: 0,
        quotaBytes: 0,
        modelsEstimateBytes: 0,
      }),
      residentMemory: signal<ResidentMemoryEstimate>({
        estimatedBytes: 0,
        residentCount: 0,
        budgetBytes: RAM_BUDGET_BYTES,
      }),
      setConfiguredOptions: jest.fn(),
    };
```

and in its `providers` array, next to `{ provide: PipelineQueueService, useValue: pipelineQueueService },`:

```ts
        { provide: CapacityService, useValue: capacityService },
```

In the **second** suite (line 742), add the identical provider to whatever `providers` array `createWithLocalMode()` builds — construct the stub inline there since that helper has no shared `beforeEach` fixture for it:

```ts
        {
          provide: CapacityService,
          useValue: {
            storage: signal<StorageCapacity>({
              usedBytes: 0,
              quotaBytes: 0,
              modelsEstimateBytes: 0,
            }),
            residentMemory: signal<ResidentMemoryEstimate>({
              estimatedBytes: 0,
              residentCount: 0,
              budgetBytes: RAM_BUDGET_BYTES,
            }),
            setConfiguredOptions: jest.fn(),
          },
        },
```

Add to that file's import block (after the existing `@angular/core` / service imports):

```ts
import { signal, WritableSignal } from '@angular/core';
import {
  CapacityService,
  RAM_BUDGET_BYTES,
  ResidentMemoryEstimate,
  StorageCapacity,
} from '../../shared/service/capacity.service';
```

(If `signal` is already imported from `@angular/core` in that file, extend the existing import instead of adding a second one.)

- [ ] **Step 4: Run the workbench spec and watch the new tests fail**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "workbench.component.spec.ts"
```

Expected: FAIL — `.workbench__capacity` query returns `null`, and `capacityService.setConfiguredOptions` was never called.

- [ ] **Step 5: Mount the component in the template**

In `apps/tratt/src/app/core/pages/workbench/workbench.component.html`, replace lines 95-103:

```html
    }
    <button
      type="button"
      class="btn btn-primary workbench__start"
      [disabled]="sessionStarting"
      (click)="startSession(false)"
    >
      {{ 'workbench.start session' | transloco }}
    </button>
```

with:

```html
    }
    <!-- Deliberately OUTSIDE the `@if` above: cached ML models are the
         dominant browser-storage consumer and can exist long before this
         workbench has a single bundle (they are downloaded from /local too),
         so the storage readout has to render on an empty workbench as well.
         Keeping it outside also keeps CapacityService's 5s poll from being
         torn down and restarted every time session state flips. Its own
         markup lives in the component; this wrapper only carries the
         left-rail spacing, matching `.workbench__queue`. -->
    <div class="workbench__capacity">
      <tratt-capacity-indicator></tratt-capacity-indicator>
    </div>
    <button
      type="button"
      class="btn btn-primary workbench__start"
      [disabled]="sessionStarting"
      (click)="startSession(false)"
    >
      {{ 'workbench.start session' | transloco }}
    </button>
```

- [ ] **Step 6: Add the spacing rule**

In `apps/tratt/src/app/core/pages/workbench/workbench.component.scss`, append after the existing `.workbench__queue-run` rule:

```scss
.workbench__capacity {
  margin-top: 0.75rem;
}
```

- [ ] **Step 7: Wire the component and the service into `WorkbenchComponent`**

In `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`:

(a) add these two imports beside the existing component/service imports:

```ts
import { CapacityIndicatorComponent } from '../../component/capacity-indicator/capacity-indicator.component';
import { CapacityService } from '../../shared/service/capacity.service';
```

(b) in the `@Component` decorator's `imports` array, replace:

```ts
    AutoTranscribeOptionsComponent,
  ],
```

with:

```ts
    AutoTranscribeOptionsComponent,
    CapacityIndicatorComponent,
  ],
```

(c) in the constructor parameter list, replace:

```ts
    private pipelineQueueService: PipelineQueueService,
  ) {
```

with:

```ts
    private pipelineQueueService: PipelineQueueService,
    private capacityService: CapacityService,
  ) {
```

(d) replace `onQueueOptionsChange()` in full:

```ts
  /**
   * One global pipeline configuration for the whole queue (the spec's "one
   * global config, run as a queue over all loaded media"), fed from the
   * shell-mounted AutoTranscribeOptionsComponent rather than per bundle.
   *
   * Step 3c also forwards it to CapacityService, which needs to know which
   * models are configured to split the storage bar into "models" vs
   * "annotations" — browser storage cannot be attributed per item, so that
   * split is an estimate derived from the configuration, not a sum of real
   * per-row sizes. Applied here rather than on the 5s poll so a user picking
   * a bigger model sees the models segment move immediately.
   */
  onQueueOptionsChange(options: TranscriptionOptions | null): void {
    this.queueOptions.set(options);
    this.pipelineQueueService.setTranscribeOptions(options);
    this.capacityService.setConfiguredOptions(options);
  }
```

- [ ] **Step 8: Run the workbench spec and watch it pass**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt \
  --testPathPattern "workbench.component.spec.ts"
```

Expected: PASS — every previously-green test still green, plus the three new ones.

- [ ] **Step 9: Run the whole app test suite**

```bash
node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt
```

Expected: no NEW failures versus the branch baseline. If the baseline is unknown, capture it first with `git stash && node node_modules/.bin/jest --config apps/tratt/jest.config.ts --rootDir apps/tratt; git stash pop`.

- [ ] **Step 10: Format, lint, and confirm the production build**

```bash
node node_modules/.bin/prettier --write \
  apps/tratt/src/app/core/pages/workbench/workbench.component.html \
  apps/tratt/src/app/core/pages/workbench/workbench.component.scss \
  apps/tratt/src/app/core/pages/workbench/workbench.component.ts \
  apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts
npm run lint
npm run build
```

Expected: lint shows no NEW errors; `npm run build` succeeds and stays inside the 2 MB initial / 6 MB error budget (the new service and component add well under 10 KB of source).

- [ ] **Step 11: Confirm the i18n gate one final time**

```bash
node apps/tratt/scripts/validate-i18n.js 2>&1 | grep -E "^\[.*\] Missing"
```

Expected: `de` 57, `it` 220, `ko` 220, `nl` 220, `sv` 34, `zh` 220 — unchanged from the pre-step baseline.

- [ ] **Step 12: Record what was and was not verified**

There is **no real browser in this environment**, so be explicit in the commit body and in any handoff note about the boundary between "proven" and "unproven":

**Verified here (automated):**
- The RAM formula, the model-size lookup, the poll cadence, the poll teardown, and the storage-unavailable fallback — unit tests with a mocked `navigator.storage.estimate` and a stub `AudioService`.
- The three colour thresholds, the width clamping, the models/annotations split, and that the bar genuinely re-renders when the underlying signal changes — component tests over a signals-backed stub service.
- That the block mounts in `.workbench__left` even with no bundles, and that queue options reach `CapacityService` — workbench component tests.
- That the app compiles and the production build stays in budget.
- That no locale's missing-key count increased.

**NOT verified here (needs a human with a browser):**
- That `navigator.storage.estimate()` returns sensible `usage`/`quota` in Chrome/Firefox/Safari on this app's origin, and that Safari's notoriously conservative quota does not make the storage bar read as permanently full.
- That the RAM estimate tracks reality — i.e. drop 3-4 large files, watch the bar climb, then select a 4th distinct bundle and confirm the LRU eviction (`MAX_RESIDENT_BUNDLES = 3`) makes it visibly fall.
- That the bar actually crosses into amber/red on a real machine with real audio — the 2 GB `RAM_BUDGET_BYTES` floor is a guess and this is the observation that would justify changing it.
- Visual fit of the card in the 340 px rail at real browser font sizes, and its appearance in the app's dark/alternate theme (the SCSS uses literal hex colours copied from the mockup, not the `--tratt-*` custom properties the rest of the app uses in places — if the theme review objects, that is a follow-up, not a regression).

- [ ] **Step 13: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/workbench.component.html \
        apps/tratt/src/app/core/pages/workbench/workbench.component.scss \
        apps/tratt/src/app/core/pages/workbench/workbench.component.ts \
        apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts
git commit -m "feat(capacity): mount the capacity indicator in the workbench left rail"
```

---

## Self-Review (run after the plan, before execution)

**Spec coverage — every requirement in `## Step 3c design (2026-09-17)`:**

| Spec requirement | Where |
| --- | --- |
| `CapacityService` at `core/shared/service/capacity.service.ts`, `providedIn: 'root'` | Task 1, Step 12 |
| `storage` signal `{usedBytes, quotaBytes, modelsEstimateBytes}` from real `navigator.storage.estimate()` | Task 1, Steps 8 + 12 |
| `residentMemory` signal `{estimatedBytes, residentCount, budgetBytes}` summed over `AudioService.audiomanagers` | Task 1, Steps 8 + 12 |
| Corrected RAM formula: `resource.size` + `channel.length * 4`, no double copy | Task 1, Step 8 (`estimateResidentBytes`) |
| New `findWhisperModelSizeMb(modelId)` across all four arrays | Task 1, Step 3 |
| Flat, documented-as-approximate diarization placeholder (90 MB) | Task 1, Step 8 (`DIARIZATION_MODEL_ESTIMATE_BYTES`) |
| Translation sizing reuses the existing constants, no new ones | Task 1, Step 8 (`estimateModelBytes` reads `TranslationAvailability.estimatedBytes`, itself built from `OPUS_MT_BYTES_PER_PAIR`) — see Grounding fact 10 |
| `RAM_BUDGET_BYTES = 2_000_000_000`, one named export | Task 1, Step 8 |
| Periodic polling only, `CAPACITY_POLL_MS = 5000`, once on construction | Task 1, Step 12 |
| "Annotations" figure is `max(0, used − models)`, labeled approximate | Task 2, Step 7 (`annotationsBytes`) + Step 1 (`storage_note` copy) |
| RAM bar colour green <55% / amber 55-80% / red >80% is the whole "warn, don't block" | Task 2, Steps 7 + 9; no ingest-flow change anywhere in the plan |
| Standalone `OnPush` `CapacityIndicatorComponent` | Task 2, Step 7 |
| Mounted as a new sibling block inside `.workbench__left`, `workbench__<block>` naming | Task 3, Steps 5 + 6 |
| "Media is never written to storage" copy, verbatim | Task 2, Step 1 (`storage_note`) |
| "This, not storage, is what limits…" copy | Task 2, Step 1 (`memory_note`) |
| Storage cannot be attributed per-bundle — treat browser `{quota, usage}` as ground truth | Task 1, Step 8 (`StorageCapacity` doc comment); Task 2, Step 7 (models clamped to `usedBytes`) |

No spec requirement is unclaimed.

**Placeholder scan:** no "TBD", no "add appropriate error handling", no "similar to Task N", no "write tests for the above". Every error path is written out (`estimateResidentBytes`'s `try`/`catch`, `refresh()`'s `catch`, the `storage_unavailable` branch), and every test body is real code. The one conditional instruction in the plan (Task 1, Step 8's note about `@typescript-eslint` and the optional chain) gives the exact replacement line rather than a description.

**Type consistency:** `StorageCapacity` / `ResidentMemoryEstimate` are defined in Task 1, Step 8 and used with identical field names in Task 1's tests, Task 2's component and spec, and Task 3's stubs. `setConfiguredOptions` has the same two-parameter signature (second optional, defaulting to `null`) at its definition (Task 1, Step 12), its tests (Task 1, Step 10), its call site (Task 3, Step 7d) and its assertions (Task 3, Step 2). `findWhisperModelSizeMb` returns `number | undefined` in its definition, its tests, and its single consumer. The component's CSS class names used in the spec's selectors (`capacity-indicator__storage-models`, `capacity-indicator__storage-annotations`, `capacity-indicator__memory-fill`, `--ok`/`--warn`/`--danger`, `capacity-indicator__storage-note`, `capacity-indicator__storage-unavailable`) all appear verbatim in the template and the SCSS. The i18n keys used in the template (`workbench.capacity.storage_label`, `storage_text`, `storage_note`, `storage_unavailable`, `memory_label`, `memory_text`, `memory_note`) are exactly the seven added to all seven locale files.

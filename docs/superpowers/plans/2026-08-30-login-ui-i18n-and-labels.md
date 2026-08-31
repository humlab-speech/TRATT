# Login-Page UI i18n & Button-Label Amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four localization/UX gaps on the local-mode login screen: (1) hardcoded English speaker-separation/diarization text, (2) overly technical translation-model detail, (3) an overlong navbar language-selector label, (4) a bottom submit button whose label never reflects what will actually happen when clicked.

**Architecture:** All four amendments are copy/localization-key changes plus one small piece of new decision logic (a pure method on `LoginComponent` that maps existing dropzone state to an i18n key for the submit button). No new services, no new components. Translation keys are added to `en.json` (source of truth) and `sv.json` (explicitly requested locale); `de`/`it`/`ko`/`nl`/`zh` fall back to English automatically via Transloco's `fallbackLang: 'en'` + `useFallbackTranslation: true` (`apps/tratt/src/app/app.transloco.ts:24-35`), so they are intentionally not touched.

**Tech Stack:** Angular 19 standalone components, `@jsverse/transloco` for i18n, Jest for tests.

**Spec:** This plan's spec is the four numbered amendments given directly by the user, screenshot-verified against the current build:
1. Localize all speaker diarization/separation UI text (currently hardcoded English in `auto-transcribe-options.component.ts`, plus an unlocalized runtime warning built in `login.component.ts`).
2. Strip the technical "opus-mt model" jargon from the translation-model detail line in `auto-translate-options.component.ts`, keeping the download-size/step-count information (per user's explicit choice when asked).
3. Shorten the navbar's visible language-selector text from "Språk som denna sida visas på" / "Language this page is displayed in" to "Språk : " / "Language: ", while preserving the fuller sentence as the toggle's `aria-label` for accessibility.
4. Make the bottom submit button on the local-mode login card show one of four labels depending on state (three explicitly specified by the user, one preserving current behavior for the unmentioned combination — see decision table in Task 4).

## Global Constraints

- Add new translation keys to **`en.json` and `sv.json` only** — other locale files rely on `fallbackLang: 'en'` and must not be touched.
- Keep existing translation keys that are still referenced elsewhere (`p.language selector label`, `transcription.start`, `transcription.new`) — only add new keys or edit values that are provably used in exactly one place.
- Swedish button/label copy must match the user's literal wording: "Manuell transkription", "Genomför automatisk behandling", "Ersätt de lagrade annoteringarna", "Språk : ".
- Do not touch `apps/tratt/src/app/core/pages/features/features.component.ts` — its entire feature list (7 items, including a "Speaker separation" title) is hardcoded English as a pre-existing, unrelated condition; localizing one of seven entries there would be inconsistent, and localizing all seven is a separate, unscoped task.
- Do not change functional submit behavior (`onOfflineSubmit`, `_startTranscription`, `_startTranslation`) — only the button's displayed label and the diarization-warning string's localization.

---

### Task 1: Localize speaker-separation options UI

**Files:**
- Modify: `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts:474-517` (template)
- Modify: `apps/tratt/src/assets/i18n/en.json:364-365` (insert after)
- Modify: `apps/tratt/src/assets/i18n/sv.json:403-404` (insert after)

**Interfaces:**
- Consumes: existing `login.auto-transcription.*` transloco keys already used in this template (no new component inputs/outputs).
- Produces: five new transloco keys under `login.auto-transcription`: `speaker separation label`, `speaker separation help`, `speaker count label`, `speaker count auto`, `speaker count help`.

- [ ] **Step 1: Add the new keys to `en.json`**

In `apps/tratt/src/assets/i18n/en.json`, the `auto-transcription` object currently has, at lines 364-365:

```json
      "diarizingLabel": "Identifying speakers…",
      "initializing speaker segmentation": "Loading speaker segmentation model",
```

Change to:

```json
      "diarizingLabel": "Identifying speakers…",
      "initializing speaker segmentation": "Loading speaker segmentation model",
      "speaker separation label": "Speaker separation",
      "speaker separation help": "Runs locally in your browser and may increase processing time.",
      "speaker count label": "Expected number of speakers",
      "speaker count auto": "Auto",
      "speaker count help": "Set to 2 for a typical interview. Leave blank for auto-detection.",
```

- [ ] **Step 2: Add the new keys to `sv.json`**

In `apps/tratt/src/assets/i18n/sv.json`, the `auto-transcription` object currently ends, at lines 403-404:

```json
      "diarizingLabel": "Identifierar talare…",
      "initializing speaker segmentation": "Talarsegmenteringsmodellen laddas"
```

Change to:

```json
      "diarizingLabel": "Identifierar talare…",
      "initializing speaker segmentation": "Talarsegmenteringsmodellen laddas",
      "speaker separation label": "Talarseparation",
      "speaker separation help": "Körs lokalt i din webbläsare och kan öka bearbetningstiden.",
      "speaker count label": "Förväntat antal talare",
      "speaker count auto": "Auto",
      "speaker count help": "Ange 2 för en typisk intervju. Lämna tomt för automatisk detektering."
```

(Note: this was the last key in the object before, so the trailing comma moves — the previous last line loses nothing since it already had no trailing comma in the middle; just make sure only the new final line (`speaker count help`) has no trailing comma.)

- [ ] **Step 3: Verify both JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/sv.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Replace hardcoded strings in the component template**

In `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts`, replace this block (around line 474-517):

```typescript
              <label class="form-check-label" for="speakerSegmentationCheck">
                Speaker separation
              </label>
            </div>
            <small class="text-muted d-block mt-1">
              Runs locally in your browser and may increase processing time.
            </small>

            @if (speakerSegmentationEnabled) {
              <div class="mt-2 ms-3">
                <label class="form-label small mb-1" for="numSpeakersInput">
                  Expected number of speakers
                </label>
                <div class="d-flex align-items-center gap-2">
                  <input
                    type="number"
                    id="numSpeakersInput"
                    class="form-control form-control-sm"
                    style="width: 80px"
                    min="1"
                    max="10"
                    [placeholder]="'Auto'"
                    [(ngModel)]="numSpeakersValue"
                    (ngModelChange)="emitChange()"
                  />
                  <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm"
                    (click)="clearNumSpeakers()"
                    [disabled]="numSpeakers === null"
                  >
                    Auto
                  </button>
                </div>
                <small class="text-muted d-block mt-1">
                  Set to 2 for a typical interview. Leave blank for
                  auto-detection.
                </small>
              </div>
            }
```

with:

```typescript
              <label class="form-check-label" for="speakerSegmentationCheck">
                {{
                  'login.auto-transcription.speaker separation label'
                    | transloco
                }}
              </label>
            </div>
            <small class="text-muted d-block mt-1">
              {{
                'login.auto-transcription.speaker separation help' | transloco
              }}
            </small>

            @if (speakerSegmentationEnabled) {
              <div class="mt-2 ms-3">
                <label class="form-label small mb-1" for="numSpeakersInput">
                  {{
                    'login.auto-transcription.speaker count label' | transloco
                  }}
                </label>
                <div class="d-flex align-items-center gap-2">
                  <input
                    type="number"
                    id="numSpeakersInput"
                    class="form-control form-control-sm"
                    style="width: 80px"
                    min="1"
                    max="10"
                    [placeholder]="
                      'login.auto-transcription.speaker count auto'
                        | transloco
                    "
                    [(ngModel)]="numSpeakersValue"
                    (ngModelChange)="emitChange()"
                  />
                  <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm"
                    (click)="clearNumSpeakers()"
                    [disabled]="numSpeakers === null"
                  >
                    {{
                      'login.auto-transcription.speaker count auto'
                        | transloco
                    }}
                  </button>
                </div>
                <small class="text-muted d-block mt-1">
                  {{
                    'login.auto-transcription.speaker count help' | transloco
                  }}
                </small>
              </div>
            }
```

- [ ] **Step 5: Run the component's existing spec to confirm nothing broke**

Run: `npx jest apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.spec.ts`
Expected: PASS (this spec does not assert on the hardcoded strings being replaced — confirmed by prior grep — so it should be unaffected)

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/assets/i18n/en.json apps/tratt/src/assets/i18n/sv.json apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts
git commit -m "i18n: localize speaker separation options UI"
```

---

### Task 2: Localize the diarization-failure warning shown on screen

**Files:**
- Modify: `apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.ts`
- Modify: `apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.spec.ts`
- Modify: `apps/tratt/src/app/core/pages/login/login.component.ts:337-383`
- Modify: `apps/tratt/src/assets/i18n/en.json` (new key)
- Modify: `apps/tratt/src/assets/i18n/sv.json` (new key)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ApplyOptionalSpeakerSegmentationResult.errorMessage: string | null` (replaces the old `warning: string | null` field, which held a hardcoded English sentence). `LoginComponent.diarizationWarning` keeps its existing type (`string | null`) but is now built via `TranslocoService.translate(...)`.

This is currently the one other place hardcoded diarization-related English text reaches the screen: `login.component.html:466-470` renders `{{ diarizationWarning }}` verbatim, and `diarizationWarning` was being set directly from `applyOptionalSpeakerSegmentation`'s `warning` field, which is built as `` `Speaker separation failed: ${message}` `` in `local-offline-transcription.helpers.ts:38`.

- [ ] **Step 1: Add the new key to `en.json`**

Add to the `login.auto-transcription` object (same object edited in Task 1 — place after the keys added there):

```json
      "diarization failed": "Speaker separation failed: {{message}}",
```

- [ ] **Step 2: Add the new key to `sv.json`**

Add to the same object in `sv.json`:

```json
      "diarization failed": "Talarseparation misslyckades: {{message}}",
```

- [ ] **Step 3: Update the failing test to match the new field name**

In `apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.spec.ts`, find the assertion (around line 72):

```typescript
    expect(result.warning).toContain('Speaker separation failed');
```

Replace with:

```typescript
    expect(result.errorMessage).toBe('network-ish model failure');
```

(This test's `runDiarization` mock rejects with `new Error('network-ish model failure')` — confirmed in the current file, around line 62.)

Also update the two other assertions in that file (around lines 34 and 54):

```typescript
    expect(result.warning).toBeNull();
```

Replace both occurrences with:

```typescript
    expect(result.errorMessage).toBeNull();
```

- [ ] **Step 4: Run the test to verify it now fails against the old implementation**

Run: `npx jest apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.spec.ts`
Expected: FAIL — `result.errorMessage` is `undefined` (field doesn't exist yet)

- [ ] **Step 5: Update the helper implementation**

In `apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.ts`, replace the whole file with:

```typescript
import { OAnnotJSON } from '@tratt/annotation';
import {
  applySpeakerTurnsToAnnotJson,
  SpeakerTurn,
} from '../../shared/service/local-diarization.service';

interface ApplyOptionalSpeakerSegmentationArgs {
  annotJson: OAnnotJSON;
  diarizationEnabled: boolean;
  runDiarization: () => Promise<SpeakerTurn[]>;
}

interface ApplyOptionalSpeakerSegmentationResult {
  annotJson: OAnnotJSON;
  /** Raw error message when diarization failed, for the caller to localize. Null on success or when disabled. */
  errorMessage: string | null;
}

export async function applyOptionalSpeakerSegmentation(
  args: ApplyOptionalSpeakerSegmentationArgs,
): Promise<ApplyOptionalSpeakerSegmentationResult> {
  if (!args.diarizationEnabled) {
    return {
      annotJson: args.annotJson,
      errorMessage: null,
    };
  }

  try {
    const turns = await args.runDiarization();
    return {
      annotJson: applySpeakerTurnsToAnnotJson(args.annotJson, turns),
      errorMessage: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      annotJson: args.annotJson,
      errorMessage: message,
    };
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.spec.ts`
Expected: PASS

- [ ] **Step 7: Update `login.component.ts` to localize the warning**

Add the `TranslocoService` import and inject it. Near the top of `login.component.ts`, the import list includes:

```typescript
import { TranslocoPipe } from '@jsverse/transloco';
```

Change to:

```typescript
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
```

Add `inject` to the `@angular/core` import (currently `import { Component, ElementRef, ViewChild } from '@angular/core';`):

```typescript
import { Component, ElementRef, inject, ViewChild } from '@angular/core';
```

Add a field right after the `@ViewChild` declarations (after line 100, before `email_link = '';`):

```typescript
  private readonly transloco = inject(TranslocoService);
```

Then in `handleCompletedTranscription` (around lines 380-383), replace:

```typescript
    this.diarizationWarning = segmented.warning;
    if (this.diarizationWarning) {
      console.error('[diarization]', this.diarizationWarning);
    }
```

with:

```typescript
    this.diarizationWarning = segmented.errorMessage
      ? this.transloco.translate('login.auto-transcription.diarization failed', {
          message: segmented.errorMessage,
        })
      : null;
    if (this.diarizationWarning) {
      console.error('[diarization]', this.diarizationWarning);
    }
```

- [ ] **Step 8: Verify the JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/sv.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 9: Type-check / build the affected library**

Run: `npx tsc -p apps/tratt/tsconfig.app.json --noEmit`
Expected: no new errors

- [ ] **Step 10: Commit**

```bash
git add apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.ts apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.spec.ts apps/tratt/src/app/core/pages/login/login.component.ts apps/tratt/src/assets/i18n/en.json apps/tratt/src/assets/i18n/sv.json
git commit -m "i18n: localize the diarization-failure warning"
```

---

### Task 3: Simplify the translation-model detail line

**Files:**
- Modify: `apps/tratt/src/assets/i18n/en.json:343-344`
- Modify: `apps/tratt/src/assets/i18n/sv.json:337-338`

**Interfaces:**
- Consumes: nothing new — `auto-translate-options.component.ts:131-153` already renders `login.translation.path direct` / `login.translation.path pivot` via transloco; only the JSON values change, no `.ts` edit needed.
- Produces: nothing new for other tasks.

Per explicit confirmation from the user: drop the "opus-mt model" architecture jargon, but keep telling the user the download is one step vs. two steps (the size is already appended separately by the component: `{{ 'login.translation.path direct' | transloco }} — {{ formatBytes(estimatedBytes()) }}`).

- [ ] **Step 1: Edit `en.json`**

Find (around lines 343-344):

```json
      "path direct": "Direct opus-mt model",
      "path pivot": "Pivot via English (two opus-mt models)",
```

Replace with:

```json
      "path direct": "One-step download",
      "path pivot": "Two-step download (via English)",
```

- [ ] **Step 2: Edit `sv.json`**

Find (around lines 337-338):

```json
      "path direct": "Direkt opus-mt-modell",
      "path pivot": "Pivot via engelska (två opus-mt-modeller)",
```

Replace with:

```json
      "path direct": "Engångsnedladdning",
      "path pivot": "Nedladdning i två steg (via engelska)",
```

- [ ] **Step 3: Verify the JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/sv.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add apps/tratt/src/assets/i18n/en.json apps/tratt/src/assets/i18n/sv.json
git commit -m "i18n: drop opus-mt model jargon from translation detail line"
```

---

### Task 4: Shorten the navbar language-selector label

**Files:**
- Modify: `apps/tratt/src/assets/i18n/en.json:621` (insert after)
- Modify: `apps/tratt/src/assets/i18n/sv.json:569` (insert after)
- Modify: `apps/tratt/src/app/core/component/navbar/navbar.component.html:909-911`

**Interfaces:**
- Consumes: nothing new.
- Produces: new key `p.language selector short label`. The existing `p.language selector label` key is kept — it stays in use as the toggle's `[attr.aria-label]` (`navbar.component.html:927`) so screen-reader users still get the full sentence.

- [ ] **Step 1: Add the new key to `en.json`**

In the `p` object (around line 621), find:

```json
    "language selector label": "Language this page is displayed in",
```

Change to:

```json
    "language selector label": "Language this page is displayed in",
    "language selector short label": "Language: ",
```

- [ ] **Step 2: Add the new key to `sv.json`**

In the `p` object (around line 569), find:

```json
    "language selector label": "Språk som denna sida visas på",
```

Change to:

```json
    "language selector label": "Språk som denna sida visas på",
    "language selector short label": "Språk : ",
```

- [ ] **Step 3: Verify the JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/sv.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Update the navbar template**

In `apps/tratt/src/app/core/component/navbar/navbar.component.html`, find (around lines 909-911):

```html
          <li class="nav-item d-flex align-items-center me-1">
            <span class="nav-link">{{
              'p.language selector label' | transloco
            }}</span>
          </li>
```

Replace with:

```html
          <li class="nav-item d-flex align-items-center me-1">
            <span class="nav-link">{{
              'p.language selector short label' | transloco
            }}</span>
          </li>
```

Leave the dropdown toggle's `[attr.aria-label]="'p.language selector label' | transloco"` (around line 927) unchanged — it keeps using the full descriptive key.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/assets/i18n/en.json apps/tratt/src/assets/i18n/sv.json apps/tratt/src/app/core/component/navbar/navbar.component.html
git commit -m "i18n: shorten visible navbar language-selector label"
```

---

### Task 5: State-dependent bottom submit-button label

**Files:**
- Create: `apps/tratt/src/app/core/pages/login/offline-submit-label.helper.ts`
- Create: `apps/tratt/src/app/core/pages/login/offline-submit-label.helper.spec.ts`
- Modify: `apps/tratt/src/app/core/pages/login/login.component.ts`
- Modify: `apps/tratt/src/app/core/pages/login/login.component.html:607-624`
- Modify: `apps/tratt/src/assets/i18n/en.json` (new keys under `transcription`)
- Modify: `apps/tratt/src/assets/i18n/sv.json` (new keys under `transcription`)

**Interfaces:**
- Consumes: `TrattDropzoneComponent.hasAnnotation: boolean`, `TrattDropzoneComponent.transcribeOptions: TranscriptionOptions | null`, `TrattDropzoneComponent.translateOptions: TranslationOptions | null` (all already exist — see `tratt-dropzone.component.ts:49-50,85-87`).
- Produces: `offlineSubmitLabelKey(state: OfflineSubmitLabelState): string` — a pure function returning a transloco key. `LoginComponent.offlineSubmitLabelKey(): string` — a method calling it with live dropzone state, used from the template.

**Decision table** (this is the actual spec for this task — derived from the user's three explicit cases, with a fourth fallback preserving current behavior for the one combination the user didn't mention):

| `transcribeSelected` | `hasAnnotation` | `automaticSelected` (transcribe or translate) | Label key |
|---|---|---|---|
| true | true | — | `transcription.replace cached annotation` ("Ersätt de lagrade annoteringarna") — user's 3rd case: automatic transcription was selected *and* a previous annotation is cached. This is a real reachable state: `AutoTranscribeOptionsComponent` is only rendered while `!hasAnnotation` (`tratt-dropzone.component.html:126`), so if the user enables it and then a matching cached file is dropped, `hasAnnotation` flips true, the component unmounts, but `TrattDropzoneComponent.transcribeOptions` keeps its last non-null value — this exact combination is already special-cased in `onOfflineSubmit` (`login.component.ts:261,266`), which is why the label needs to reflect it too. |
| — | — | true | `transcription.automatic` ("Genomför automatisk behandling") — user's 2nd case: automatic transcription or translation was selected (and the 1st row didn't already match). |
| false | false | false | `transcription.manual` ("Manuell transkription") — user's 1st case: no cached annotation and nothing automatic selected. |
| false | true | false | `transcription.start` ("Fortsätt transkription" / "Continue transcription") — not one of the user's three cases; this is the pre-existing "resume with a previously cached annotation, no automatic option chosen" state. Falls back to the existing, unmodified key so current behavior is preserved exactly. |

- [ ] **Step 1: Write the failing test for the pure helper**

Create `apps/tratt/src/app/core/pages/login/offline-submit-label.helper.spec.ts`:

```typescript
import { offlineSubmitLabelKey } from './offline-submit-label.helper';

describe('offlineSubmitLabelKey', () => {
  it('returns the manual-transcription key when nothing is cached or selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: false,
        transcribeSelected: false,
        translateSelected: false,
      }),
    ).toBe('transcription.manual');
  });

  it('returns the automatic-processing key when transcription is selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: false,
        transcribeSelected: true,
        translateSelected: false,
      }),
    ).toBe('transcription.automatic');
  });

  it('returns the automatic-processing key when translation is selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: false,
        transcribeSelected: false,
        translateSelected: true,
      }),
    ).toBe('transcription.automatic');
  });

  it('returns the replace-cached key when transcription is selected and an annotation is already cached', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: true,
        transcribeSelected: true,
        translateSelected: false,
      }),
    ).toBe('transcription.replace cached annotation');
  });

  it('returns the replace-cached key even if translation is also selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: true,
        transcribeSelected: true,
        translateSelected: true,
      }),
    ).toBe('transcription.replace cached annotation');
  });

  it('falls back to the existing continue-transcription key when an annotation is cached and nothing automatic is selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: true,
        transcribeSelected: false,
        translateSelected: false,
      }),
    ).toBe('transcription.start');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest apps/tratt/src/app/core/pages/login/offline-submit-label.helper.spec.ts`
Expected: FAIL with "Cannot find module './offline-submit-label.helper'"

- [ ] **Step 3: Implement the helper**

Create `apps/tratt/src/app/core/pages/login/offline-submit-label.helper.ts`:

```typescript
export interface OfflineSubmitLabelState {
  hasAnnotation: boolean;
  transcribeSelected: boolean;
  translateSelected: boolean;
}

/**
 * Decides which i18n key the local-mode submit button should show.
 * See the decision table in docs/superpowers/plans/2026-08-30-login-ui-i18n-and-labels.md
 * (Task 5) for the reasoning behind each branch.
 */
export function offlineSubmitLabelKey(state: OfflineSubmitLabelState): string {
  if (state.transcribeSelected && state.hasAnnotation) {
    return 'transcription.replace cached annotation';
  }
  if (state.transcribeSelected || state.translateSelected) {
    return 'transcription.automatic';
  }
  if (!state.hasAnnotation) {
    return 'transcription.manual';
  }
  return 'transcription.start';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest apps/tratt/src/app/core/pages/login/offline-submit-label.helper.spec.ts`
Expected: PASS

- [ ] **Step 5: Add the new translation keys to `en.json`**

In the top-level `transcription` object (around line 713), find:

```json
  "transcription": {
    "check": "Check transcription",
```

Change to:

```json
  "transcription": {
    "automatic": "Run automatic processing",
    "check": "Check transcription",
```

Then, in the same object, find:

```json
    "no prompttext": "The prompt text can not be shown.",
```

Change to:

```json
    "no prompttext": "The prompt text can not be shown.",
    "replace cached annotation": "Replace the stored annotations",
```

And find:

```json
    "manual": ...
```

There is no existing `"manual"` key — add it next to `"invalid"` for alphabetical order. Find:

```json
    "invalid": "Only valid transcripts are accepted. Please correct your transcript.",
```

Change to:

```json
    "invalid": "Only valid transcripts are accepted. Please correct your transcript.",
    "manual": "Manual transcription",
```

- [ ] **Step 6: Add the new translation keys to `sv.json`**

In the top-level `transcription` object (around line 658), find:

```json
  "transcription": {
    "check": "Kontrollera transkription",
```

Change to:

```json
  "transcription": {
    "automatic": "Genomför automatisk behandling",
    "check": "Kontrollera transkription",
```

Find:

```json
    "invalid": "Endast giltiga transkript accepteras. Vänligen korrigera din transkript.",
```

Change to:

```json
    "invalid": "Endast giltiga transkript accepteras. Vänligen korrigera din transkript.",
    "manual": "Manuell transkription",
```

Find:

```json
    "no prompttext": "Instruktions-texten kan inte visas.",
```

Change to:

```json
    "no prompttext": "Instruktions-texten kan inte visas.",
    "replace cached annotation": "Ersätt de lagrade annoteringarna",
```

- [ ] **Step 7: Verify the JSON files still parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/sv.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 8: Wire the helper into `LoginComponent`**

In `apps/tratt/src/app/core/pages/login/login.component.ts`, add the import near the other same-directory import:

```typescript
import { applyOptionalSpeakerSegmentation } from './local-offline-transcription.helpers';
```

becomes:

```typescript
import { applyOptionalSpeakerSegmentation } from './local-offline-transcription.helpers';
import { offlineSubmitLabelKey } from './offline-submit-label.helper';
```

Add a method near `onOfflineSubmit` (after its closing `};` around line 272):

```typescript
  offlineSubmitLabelKey(): string {
    return offlineSubmitLabelKey({
      hasAnnotation: this.dropzone?.hasAnnotation ?? false,
      transcribeSelected: !!this.dropzone?.transcribeOptions,
      translateSelected: !!this.dropzone?.translateOptions,
    });
  }
```

- [ ] **Step 9: Use it in the template**

In `apps/tratt/src/app/core/pages/login/login.component.html`, find (around line 623):

```html
                    {{ 'transcription.start' | transloco }}
```

This line is inside the `@if (dropzone?.statistics && dropzone?.statistics?.new === 0) { <button ...> ... </button> }` block (lines 607-624) — the `<button id="offline-submit" ...>` that submits the primary local-mode flow. Replace just that interpolation with:

```html
                    {{ offlineSubmitLabelKey() | transloco }}
```

Do **not** change the sibling `@else` branch (lines 625-641, the danger "Starta ny transkription" / `transcription.new` button) — that branch is for the unrelated "new file added, old work will be discarded" flow and is out of scope for this amendment.

- [ ] **Step 10: Type-check**

Run: `npx tsc -p apps/tratt/tsconfig.app.json --noEmit`
Expected: no new errors

- [ ] **Step 11: Commit**

```bash
git add apps/tratt/src/app/core/pages/login/offline-submit-label.helper.ts apps/tratt/src/app/core/pages/login/offline-submit-label.helper.spec.ts apps/tratt/src/app/core/pages/login/login.component.ts apps/tratt/src/app/core/pages/login/login.component.html apps/tratt/src/assets/i18n/en.json apps/tratt/src/assets/i18n/sv.json
git commit -m "feat(login): state-dependent submit-button label"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full Jest suite for touched areas**

Run: `npx jest apps/tratt/src/app/core/pages/login apps/tratt/src/app/core/component/tratt-dropzone apps/tratt/src/app/core/component/navbar`
Expected: all PASS

- [ ] **Step 2: Run linting on all touched files**

Run: `npx eslint apps/tratt/src/app/core/pages/login/login.component.ts apps/tratt/src/app/core/pages/login/offline-submit-label.helper.ts apps/tratt/src/app/core/pages/login/local-offline-transcription.helpers.ts apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts apps/tratt/src/app/core/component/navbar/navbar.component.html`
Expected: no errors

- [ ] **Step 3: Confirm both locale JSON files parse and contain every new key**

Run:
```bash
node -e "
const en = JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/en.json','utf8'));
const sv = JSON.parse(require('fs').readFileSync('apps/tratt/src/assets/i18n/sv.json','utf8'));
const checks = [
  ['en', en, ['login','auto-transcription','speaker separation label']],
  ['en', en, ['login','auto-transcription','speaker count help']],
  ['en', en, ['login','auto-transcription','diarization failed']],
  ['en', en, ['p','language selector short label']],
  ['en', en, ['transcription','manual']],
  ['en', en, ['transcription','automatic']],
  ['en', en, ['transcription','replace cached annotation']],
  ['sv', sv, ['login','auto-transcription','speaker separation label']],
  ['sv', sv, ['login','auto-transcription','speaker count help']],
  ['sv', sv, ['login','auto-transcription','diarization failed']],
  ['sv', sv, ['p','language selector short label']],
  ['sv', sv, ['transcription','manual']],
  ['sv', sv, ['transcription','automatic']],
  ['sv', sv, ['transcription','replace cached annotation']],
];
for (const [lang, obj, path] of checks) {
  let cur = obj;
  for (const key of path) cur = cur?.[key];
  if (cur === undefined) throw new Error(lang + ' missing ' + path.join('.'));
}
console.log('all keys present');
"
```
Expected: `all keys present`

- [ ] **Step 4: Manual smoke test in the browser**

Run: `npm start`, open the local-mode login card, and confirm:
- Speaker-separation checkbox, help text, "Expected number of speakers" label, "Auto" button/placeholder, and the "typical interview" hint are all in the active UI language.
- The translation panel's model-detail line no longer says "opus-mt", but still shows a size and whether it's one-step or two-step.
- The navbar shows "Språk : " (or "Language: ") instead of the long sentence; hovering/inspecting the toggle still exposes the full sentence via its `aria-label`.
- Dropping a fresh file with nothing selected shows "Manuell transkription".
- Enabling "Automatisk transkribering med Whisper" (or translation) shows "Genomför automatisk behandling".
- Enabling transcription, then dropping a file whose cached annotation is picked up, shows "Ersätt de lagrade annoteringarna".
- Dropping a previously-cached file with nothing automatic enabled still shows "Fortsätt transkription" (unchanged).

## Self-Review Notes

- **Spec coverage:** Item 1 → Tasks 1–2 (options UI + runtime warning). Item 2 → Task 3. Item 3 → Task 4. Item 4 → Task 5. All four amendments have a task.
- **Placeholder scan:** no TBD/TODO; every step has literal code/JSON to write.
- **Type consistency:** `offlineSubmitLabelKey` (function) and `LoginComponent.offlineSubmitLabelKey()` (method) share a name deliberately — the method is a thin instance wrapper around the pure function, consistent with how the codebase already separates pure helpers (`local-offline-transcription.helpers.ts`) from component glue.

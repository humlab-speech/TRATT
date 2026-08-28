# Review Findings Amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the still-open findings from `REVIEW-FINDINGS.md` that don't require a product decision: dedupe helpers (D4/D8/D9), remove dead debug logging (S7), hoist magic colors (S10), delete a dead comment (S13), close the BroadcastChannel auth-spoofing gap (E3 remainder), re-enable trn-editor with a scoped TODO triage (S2), add OnPush to the identified hot components (S4), reduce `any` in the four worst files (S8), and split the two god classes (S1 audio-viewer.service.ts, S3 annotation.effects.ts/annotation.store.service.ts).

**Explicitly out of scope (need a product decision per REVIEW-FINDINGS.md, not included here):** E1 (script-injection via `addFunctions()` — needs a decision on hash-pin vs static-asset vs sandbox delivery of tool functions), E10 (sessionStorage token — needs a decision on whether the backend can issue an httpOnly cookie). Also out of scope: S1/S3's followers S11/S12/D9's schemata-generator gap and the repo-wide `any` long tail beyond the 4 named files (S8) — flagged as future work at the end of this plan, not tasked here.

**Architecture:** No new architectural direction — this is cleanup within the existing Angular/Nx/NgRx conventions already used in the repo (`@tratt/*` libs, NgRx effects-per-slice, signals-based facades). The two splits (S1, S3) decompose existing god classes into cooperating, dependency-injected services along a one-directional call graph, keeping today's public surface unchanged for their sole consumers.

**Tech Stack:** Angular 19, NgRx, Konva (canvas), Jest, Nx.

**Spec:** `/Users/frkkan96/Documents/src/tratt/REVIEW-FINDINGS.md`

## Global Constraints

- Prettier formatting (single quotes, 2-space indent) — run `npm run format` before each commit if touched files show diffs beyond your own edits.
- `@tratt/*` path aliases resolve to `libs/*/src/index.ts` — new files must be exported through their lib's `index.ts` if consumed outside the lib.
- Commitizen/conventional-changelog commit style: `fix:`, `refactor:`, `chore:` prefixes as appropriate, referencing the finding ID (e.g. `refactor: split audio-viewer.service.ts into rendering/segments/interaction/time-utils (S1)`).
- Every task must leave `npm run lint` and `npm test` (scoped to affected projects is fine: `npx nx affected -t lint,test`) green before its commit.
- Never `git push` — commits only, per this session's standing instructions.

---

## Phase 1 — Mechanical, independent, low risk

### Task 1: D9 — consolidate `escapeXml`/`escapeHtml`

**Files:**
- Modify: `libs/utilities/src/lib/functions.ts:125-132` (existing `escapeHtml`)
- Modify: `libs/annotation/src/lib/converters/Converter.ts:124-131` (existing `escapeXml`)
- Test: `libs/utilities/src/lib/functions.spec.ts`

**Interfaces:**
- Produces: `escapeXmlEntities(text: string, apostropheEntity: string): string`, exported from `@tratt/utilities`.
- Consumes (unchanged call sites): `escapeHtml(text)` in `libs/utilities/src/lib/functions.ts`; `Converter.escapeXml(s)` (protected, unchanged signature) in `libs/annotation/src/lib/converters/Converter.ts`, called from `WebVTTConverter.ts:103`, `DocxConverter.ts:234`, `OdtConverter.ts:212`.

The two functions replace the same 5 characters (`& < > " '`) and differ only in the apostrophe entity (`&#039;` for HTML, `&apos;` for XML). A blind merge into one function would be wrong for one caller — parameterize the apostrophe entity instead of picking one.

- [ ] **Step 1: Write the failing test**

```typescript
// libs/utilities/src/lib/functions.spec.ts
import { escapeXmlEntities, escapeHtml } from './functions';

describe('escapeXmlEntities', () => {
  it('escapes the 5 reserved characters with the given apostrophe entity', () => {
    expect(escapeXmlEntities(`<a href="x">it's & "that"</a>`, '&apos;')).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&apos;s &amp; &quot;that&quot;&lt;/a&gt;',
    );
  });

  it('escapeHtml delegates with the HTML apostrophe entity', () => {
    expect(escapeHtml(`it's`)).toBe('it&#039;s');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test utilities -- --testPathPattern=functions.spec.ts`
Expected: FAIL — `escapeXmlEntities` is not exported.

- [ ] **Step 3: Add the shared helper and rewrite `escapeHtml` in terms of it**

In `libs/utilities/src/lib/functions.ts`, replace the existing `escapeHtml` (lines 125-132) with:

```typescript
export function escapeXmlEntities(
  text: string,
  apostropheEntity: string,
): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, apostropheEntity);
}

export function escapeHtml(text: string): string {
  return escapeXmlEntities(text, '&#039;');
}
```

- [ ] **Step 4: Point `Converter.escapeXml` at the shared helper**

In `libs/annotation/src/lib/converters/Converter.ts`, add the import and replace the body of `escapeXml` (lines 124-131):

```typescript
import { escapeXmlEntities } from '@tratt/utilities';
// ...
protected escapeXml(s: string): string {
  return escapeXmlEntities(s, '&apos;');
}
```

Verify `libs/annotation` already lists `@tratt/utilities` as a dependency (check `libs/annotation/package.json` / project.json `implicitDependencies` or existing imports — `libs/annotation/src/lib/functions.ts:26` already imports from `@tratt/utilities`, so the dependency edge exists).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test utilities -- --testPathPattern=functions.spec.ts && npx nx test annotation`
Expected: PASS, including existing `WebVTTConverter`/`DocxConverter`/`OdtConverter` spec files (their expected XML/DOCX/ODT output strings must still contain `&apos;` unchanged).

- [ ] **Step 6: Commit**

```bash
git add libs/utilities/src/lib/functions.ts libs/utilities/src/lib/functions.spec.ts libs/annotation/src/lib/converters/Converter.ts
git commit -m "refactor: consolidate escapeXml/escapeHtml into shared escapeXmlEntities (D9)"
```

---

### Task 2: D8 — consolidate the `m:ss` duration formatters

**Files:**
- Modify: `libs/utilities/src/lib/functions.ts` (add helper)
- Modify: `apps/tratt/src/app/core/pages/login/login.component.ts:58-62`
- Modify: `apps/tratt/src/app/core/component/recording-panel/recording-panel.component.ts:203-207`
- Test: `libs/utilities/src/lib/functions.spec.ts`

**Interfaces:**
- Produces: `formatMinutesSeconds(totalSeconds: number): string` from `@tratt/utilities`, returning `"m:ss"` (no leading zero on minutes, zero-padded seconds — matches both existing implementations byte-for-byte).
- Consumes: `login.component.ts`'s module-level `formatDuration(seconds: number)` becomes a one-line delegate; `recording-panel.component.ts`'s `formatElapsed(ms: number)` becomes a one-line delegate converting ms→s first.

- [ ] **Step 1: Write the failing test**

```typescript
// libs/utilities/src/lib/functions.spec.ts
import { formatMinutesSeconds } from './functions';

describe('formatMinutesSeconds', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatMinutesSeconds(0)).toBe('0:00');
    expect(formatMinutesSeconds(65)).toBe('1:05');
    expect(formatMinutesSeconds(3661)).toBe('61:01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test utilities -- --testPathPattern=functions.spec.ts`
Expected: FAIL — `formatMinutesSeconds` not exported.

- [ ] **Step 3: Add the helper**

In `libs/utilities/src/lib/functions.ts`:

```typescript
export function formatMinutesSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 4: Delegate both call sites**

In `apps/tratt/src/app/core/pages/login/login.component.ts`, replace lines 58-62:

```typescript
import { formatMinutesSeconds } from '@tratt/utilities';
// ...
function formatDuration(seconds: number): string {
  return formatMinutesSeconds(seconds);
}
```

(Keep the module-level function and the `readonly formatDuration = formatDuration;` field at line 144 as-is — only the body changes — since the template binds to the instance field.)

In `apps/tratt/src/app/core/component/recording-panel/recording-panel.component.ts`, replace lines 203-207:

```typescript
import { formatMinutesSeconds } from '@tratt/utilities';
// ...
formatElapsed(ms: number): string {
  return formatMinutesSeconds(Math.floor(ms / 1000));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx nx test utilities -- --testPathPattern=functions.spec.ts && npx nx test tratt`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/utilities/src/lib/functions.ts libs/utilities/src/lib/functions.spec.ts apps/tratt/src/app/core/pages/login/login.component.ts apps/tratt/src/app/core/component/recording-panel/recording-panel.component.ts
git commit -m "refactor: consolidate m:ss duration formatting into formatMinutesSeconds (D8)"
```

---

### Task 3: D4 — extract the shared zero-padding helper from `getNewFileName`

**Scope correction from REVIEW-FINDINGS.md:** the review's suggested fix ("keep one [lib] version with a small segment-descriptor param") doesn't hold up under a full read of both bodies. `cutting-format.ts:104`'s `secondsDur` case divides `cutList[segmentNumber].sampleDur` directly; `audio-cutter.ts:110`'s `secondsDur` case recomputes duration as `(totalSamples - segment.sampleStart)` — a different derivation for the streaming-cut use case where the last segment's `sampleDur` may be `undefined`. Merging the whole function risks a silent behavior change for the naming-convention `<secondsDur>` placeholder. The genuinely byte-identical part is only the leading-zero-padding loop — extract just that.

**Files:**
- Modify: `libs/utilities/src/lib/functions.ts` (add helper)
- Modify: `apps/tratt/src/app/core/obj/tools/audio-cutting/cutting-format.ts:104-150`
- Modify: `libs/web-media/src/lib/audio/audio-cutter.ts:110-157`
- Test: `libs/utilities/src/lib/functions.spec.ts`

**Interfaces:**
- Produces: `padSequenceNumber(oneBasedNumber: number, maxDecimals: number): string`, e.g. `padSequenceNumber(3, 4) === '0003'`.

- [ ] **Step 1: Write the failing test**

```typescript
// libs/utilities/src/lib/functions.spec.ts
import { padSequenceNumber } from './functions';

describe('padSequenceNumber', () => {
  it('zero-pads to maxDecimals digits', () => {
    expect(padSequenceNumber(3, 4)).toBe('0003');
    expect(padSequenceNumber(42, 4)).toBe('0042');
    expect(padSequenceNumber(10000, 4)).toBe('10000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test utilities -- --testPathPattern=functions.spec.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the helper**

In `libs/utilities/src/lib/functions.ts`:

```typescript
export function padSequenceNumber(
  oneBasedNumber: number,
  maxDecimals: number,
): string {
  const decimals = oneBasedNumber.toString().length;
  let leadingNull = '';
  for (let i = 0; i < maxDecimals - decimals; i++) {
    leadingNull += '0';
  }
  return `${leadingNull}${oneBasedNumber}`;
}
```

- [ ] **Step 4: Use it in `cutting-format.ts`**

In `apps/tratt/src/app/core/obj/tools/audio-cutting/cutting-format.ts`, replace lines 112-125 (the `leadingNull`/`maxDecimals`/`decimals`/loop block and the `sequNumber` case) with:

```typescript
import { padSequenceNumber } from '@tratt/utilities';
// ...
export function getNewFileName(
  namingConvention: string,
  fileName: string,
  segmentNumber: number,
  cutList: Segment[],
  audioInfo: AudioInfo,
) {
  const name = fileName.substring(0, fileName.lastIndexOf('.'));
  const extension = fileName.substring(fileName.lastIndexOf('.'));

  return (
    namingConvention.replace(/<([^<>]+)>/g, (g0, g1) => {
      switch (g1) {
        case 'name':
          return name;
        case 'sequNumber':
          return padSequenceNumber(segmentNumber + 1, 4);
        case 'sampleStart':
          return cutList[segmentNumber].sampleStart;
        case 'sampleDur':
          return cutList[segmentNumber].sampleDur;
        case 'secondsStart':
          return (
            Math.round(
              (cutList[segmentNumber].sampleStart /
                audioInfo.duration.sampleRate) *
                1000,
            ) / 1000
          );
        case 'secondsDur':
          return (
            Math.round(
              (cutList[segmentNumber].sampleDur /
                audioInfo.duration.sampleRate) *
                1000,
            ) / 1000
          );
      }
      return g1;
    }) + extension
  );
}
```

- [ ] **Step 5: Use it in `audio-cutter.ts`**

In `libs/web-media/src/lib/audio/audio-cutter.ts`, replace lines 118-123 (the same loop block) and the `sequNumber` case:

```typescript
import { padSequenceNumber } from '@tratt/utilities';
// ...
getNewFileName(
  namingConvention: string,
  fileName: string,
  segment: NumeratedSegment,
) {
  const name = fileName.substring(0, fileName.lastIndexOf('.'));
  const extension = fileName.substring(fileName.lastIndexOf('.'));

  return namingConvention.replace(/<([^<>]+)>/g, (g0, g1) => {
    switch (g1) {
      case 'name':
        return name;
      case 'sequNumber':
        return padSequenceNumber(segment.number + 1, 4);
      case 'sampleStart':
        return segment.sampleStart;
      case 'sampleDur':
        return (
          segment.sampleDur ??
          (this.audioInfo.audioBufferInfo?.samples ??
            this.audioInfo.duration.samples) - segment.sampleStart
        );
      case 'secondsStart':
        return (
          Math.round(
            (segment.sampleStart / this.audioInfo.sampleRate) * 1000,
          ) / 1000
        );
      case 'secondsDur':
        return (
          Math.round(
            (((this.audioInfo.audioBufferInfo?.samples ??
              this.audioInfo.duration.samples) -
              segment.sampleStart) /
              this.audioInfo.sampleRate) *
              1000,
          ) / 1000
        );
    }
    return g1;
  });
}
```

Note `extension` is now unused in this method if it was already unused before (check — in the original it's computed but never referenced in the return, same as before this change, so this is pre-existing, not introduced by this task; leave as-is to avoid unrelated scope creep, unless the linter flags it as newly unused, in which case remove the now-genuinely-dead `const extension = ...` line here only).

- [ ] **Step 6: Run tests**

Run: `npx nx test utilities -- --testPathPattern=functions.spec.ts && npx nx test web-media && npx nx test tratt -- --testPathPattern=cutting-format`
Expected: PASS, identical output to before (this is a pure extraction, not a semantics change).

- [ ] **Step 7: Commit**

```bash
git add libs/utilities/src/lib/functions.ts libs/utilities/src/lib/functions.spec.ts apps/tratt/src/app/core/obj/tools/audio-cutting/cutting-format.ts libs/web-media/src/lib/audio/audio-cutter.ts
git commit -m "refactor: extract shared padSequenceNumber helper from getNewFileName (D4)"
```

---

### Task 4: S13 — delete the dead German comment

**Files:**
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts:1752`

The comment `// TODO hier werden segmente entfernt` ("segments get removed here") just restates what the adjacent `this.removeSegmentFromCanvas(segment.id);` call already says. Per this repo's comment convention, delete rather than translate — it adds nothing an English reader wouldn't already get from the method name.

- [ ] **Step 1: Delete the comment**

Change line 1752 from:
```typescript
            this.removeSegmentFromCanvas(segment.id); // TODO hier werden segmente entfernt
```
to:
```typescript
            this.removeSegmentFromCanvas(segment.id);
```

- [ ] **Step 2: Commit**

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts
git commit -m "chore: drop dead German TODO comment (S13)"
```

---

### Task 5: S10 — hoist the ASR-blocked-status canvas colors into `TRATT_COLORS`

**Files:**
- Modify: `libs/ngx-components/src/lib/obj/tratt-colors.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts:188,4504-4519`

Scope note: the review also flagged magic `* 1000` ms conversions (lines 3906, 3911, 3914-3915, 4446) as a smell. Skipping those — they're plain unit conversions (`unix ms → seconds` in time-display math) with no repeated/inconsistent value to hoist; a named `MS_PER_SECOND = 1000` constant wouldn't make `startTime / 1000` any clearer than it already is. Only the color literals (a real "same color spelled out 3 times with no name" duplication-of-meaning smell) are worth fixing.

**Interfaces:**
- Produces: new keys on `TRATT_COLORS` — `asrBlockedFill`, `asrBlockedProgress`, `asrMausBlockedFill`, `asrMausBlockedProgress`, `mausBlockedFill`, `mausBlockedProgress`.

- [ ] **Step 1: Add the new color tokens**

In `libs/ngx-components/src/lib/obj/tratt-colors.ts`, add before the closing `} as const;`:

```typescript
  /** ASR queue item blocked-by-ASR overlay fill (canvas segment progress bar). */
  asrBlockedFill: 'rgba(255,191,0,0.5)',
  /** ASR queue item blocked-by-ASR progress bar fill. */
  asrBlockedProgress: 'rgba(221,167,14,0.8)',
  /** ASR queue item blocked-by-ASR+MAUS overlay fill. */
  asrMausBlockedFill: 'rgba(179,10,179,0.5)',
  /** ASR queue item blocked-by-ASR+MAUS progress bar fill. */
  asrMausBlockedProgress: 'rgba(179,10,179,0.8)',
  /** ASR queue item blocked-by-MAUS overlay fill. */
  mausBlockedFill: 'rgba(26,229,160,0.5)',
  /** ASR queue item blocked-by-MAUS progress bar fill. */
  mausBlockedProgress: 'rgba(17,176,122,0.8)',
```

- [ ] **Step 2: Replace the inline literals in `audio-viewer.service.ts`**

Replace lines 4504-4519:

```typescript
              if (
                sceneSegment.context?.asr?.isBlockedBy === ASRQueueItemType.ASR
              ) {
                // blocked by ASR
                context.fillStyle = TRATT_COLORS.asrBlockedFill;
                progressBarFillColor = TRATT_COLORS.asrBlockedProgress;
                progressBarForeColor = 'black';
              } else if (
                sceneSegment.context?.asr?.isBlockedBy ===
                ASRQueueItemType.ASRMAUS
              ) {
                context.fillStyle = TRATT_COLORS.asrMausBlockedFill;
                progressBarFillColor = TRATT_COLORS.asrMausBlockedProgress;
                progressBarForeColor = TRATT_COLORS.surfaceBackground;
              } else if (
                sceneSegment.context?.asr?.isBlockedBy === ASRQueueItemType.MAUS
              ) {
                context.fillStyle = TRATT_COLORS.mausBlockedFill;
                progressBarFillColor = TRATT_COLORS.mausBlockedProgress;
                progressBarForeColor = TRATT_COLORS.surfaceBackground;
              }
```

Confirm `TRATT_COLORS` is already imported in this file (it's referenced at the same lines via `TRATT_COLORS.surfaceBackground` already — no new import needed).

- [ ] **Step 3: Replace the stray `strokeColor` literal at line 188**

Line 188 has `strokeColor: 'rgba(42, 71, 101, 0.8)'`, which is byte-identical to the already-defined `TRATT_COLORS.waveformSignal`. Replace with `strokeColor: TRATT_COLORS.waveformSignal`.

- [ ] **Step 4: Run tests and visually smoke-test**

Run: `npx nx test ngx-components`
Then use the `run` skill to launch the app, open a task with ASR-blocked segments, and confirm the overlay colors are unchanged.

- [ ] **Step 5: Commit**

```bash
git add libs/ngx-components/src/lib/obj/tratt-colors.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts
git commit -m "refactor: hoist ASR-blocked canvas colors into TRATT_COLORS (S10)"
```

---

### Task 6: S7 — delete stray `console.log`/`console.debug` calls

**Files:** all non-spec `.ts` files currently matching `console.log(` or `console.debug(` — 98 call sites across `apps/tratt/src/app/**` (80) and `libs/**` (18, in `web-media/src/lib/data-info/file-info.ts`, `web-media/src/lib/audio/audio-cutter.ts`, `web-media/src/lib/audio/binary/BinaryReader.ts`, `web-media/src/lib/audio/binary/wavwriter.ts`, `annotation/src/lib/annotation.ts`, `annotation/src/lib/converters/AnnotJSONConverter.ts`, `annotation/src/lib/converters/SRTConverter.ts`, `ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts`, `ngx-components/src/lib/version-checker/version-checker.service.ts`).

This continues the precedent already set by commit `1d93c5c8b` ("drop debug logging"). `console.error`/`console.warn` calls are untouched — only `.log`/`.debug`.

- [ ] **Step 1: Enumerate current call sites**

Run: `grep -rn "console\.\(log\|debug\)(" --include="*.ts" apps/ libs/ | grep -v spec > /tmp/console-audit.txt && wc -l /tmp/console-audit.txt`

- [ ] **Step 2: Delete each call site**

For each file in the list, open it and delete the `console.log(...)`/`console.debug(...)` statement(s). Where the call spans multiple lines (multi-arg logging), delete the whole statement including its closing `);`. Do not delete surrounding logic — only the logging statement itself. Where a `console.log` is the only statement inside an `if` block that exists purely to guard the log (e.g. `if (isDev) { console.log(...); }`), delete the whole `if` block too — don't leave an empty block.

- [ ] **Step 3: Verify none remain**

Run: `grep -rn "console\.\(log\|debug\)(" --include="*.ts" apps/ libs/ | grep -v spec`
Expected: no output.

- [ ] **Step 4: Typecheck and test**

Run: `npx nx affected -t lint,test --base=main`
Expected: PASS — deleting a side-effect-only statement cannot change program logic; any failure indicates a call site was doing more than logging (re-inspect that specific diff hunk before proceeding).

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore: remove remaining stray console.log/console.debug calls (S7)"
```

---

## Phase 2 — E3 remainder: validate the BroadcastChannel payload with a nonce

Confirmed backend-free: `AuthSuccessPageComponent` (`apps/tratt/src/app/core/pages/intern/auth-success/auth-success.page.component.ts`) is this app's own code, reached because `authentication.effects.ts` sets the popup's return URL (`r` param) to its own `/intern/auth-success` route before opening the popup. No other file posts on the `ocb_authentication` channel. The one assumption this depends on — that the backend's `auth.openURL` redirect preserves the `r` query string verbatim, including any extra params appended to it — should be verified empirically in Step 5 below before merging.

### Task 7: add nonce validation to the Shibboleth BroadcastChannel handshake

**Files:**
- Modify: `apps/tratt/src/app/core/store/authentication/authentication.effects.ts:57-111` (add nonce generation + validation)
- Modify: `apps/tratt/src/app/core/pages/intern/auth-success/auth-success.page.component.ts` (read nonce, echo it back)
- Test: `apps/tratt/src/app/core/store/authentication/authentication.effects.spec.ts` (create if it doesn't exist, or extend if it does — check first)

**Interfaces:**
- The `bc.postMessage(...)` payload changes shape from bare `true` to `{ ok: true, nonce: string }`. Both sides of the channel (effect listener, `auth-success` page) must agree on this shape — this task changes both in the same commit.

- [ ] **Step 1: Check for an existing spec file**

Run: `ls apps/tratt/src/app/core/store/authentication/authentication.effects.spec.ts 2>&1`. If it exists, read it to match existing test setup/mocking conventions (TestBed, marble testing, or plain instantiation) before writing Step 2's test.

- [ ] **Step 2: Write a failing test for nonce validation**

Add to the effects spec (adapt to the existing test harness style found in Step 1; sketch below assumes a plain instantiation + manual BroadcastChannel mock, adjust `provideMockStore`/`provideMockActions` wiring to match what the file already uses for `login$`):

```typescript
it('ignores a reauthentication success message with a mismatched nonce', () => {
  const dispatched: unknown[] = [];
  store.dispatch = (action: unknown) => dispatched.push(action);

  // trigger login$ so it opens a BroadcastChannel and starts listening
  actions$.next(AuthenticationActions.reauthenticate.do({ /* ...minimal payload matching existing tests... */ }));

  const bc = new BroadcastChannel('ocb_authentication');
  bc.postMessage({ ok: true, nonce: 'not-the-real-nonce' });

  expect(
    dispatched.some(
      (a) => (a as { type: string }).type ===
        AuthenticationActions.needReAuthentication.success.type,
    ),
  ).toBe(false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx nx test tratt -- --testPathPattern=authentication.effects`
Expected: FAIL — current code accepts any `e.data === true`/truthy message with no nonce check, so this test's assertion about it being ignored fails (or the test doesn't compile yet against the new payload shape — either failure mode confirms the gap).

- [ ] **Step 4: Implement the nonce round-trip**

In `authentication.effects.ts`, replace lines 57-111 (the `waitForWindowResponse` closure body) with:

```typescript
          const waitForWindowResponse = (
            actionAfterSuccess: Action | undefined,
            url: string,
            params: Record<string, string | number | undefined | null | boolean>,
          ) => {
            const baseURL = getBaseHrefURL();
            const nonce = crypto.randomUUID();

            const bc = new BroadcastChannel('ocb_authentication');
            let settled = false;
            const timeoutId = window.setTimeout(
              () => {
                if (!settled) {
                  settled = true;
                  bc.close();
                  this.store.dispatch(
                    AuthenticationActions.reauthenticate.fail({
                      error:
                        'Re-authentication window timed out. Please try again.',
                    }),
                  );
                }
              },
              AuthenticationEffects.REAUTHENTICATION_TIMEOUT_MS,
            );

            bc.addEventListener('message', (e) => {
              const data = e.data as { ok?: boolean; nonce?: string } | undefined;
              if (data?.ok === true && data.nonce === nonce && !settled) {
                settled = true;
                window.clearTimeout(timeoutId);
                this.store.dispatch(
                  AuthenticationActions.needReAuthentication.success({
                    actionAfterSuccess,
                  }),
                );
                bc.close();
              }
            });

            params = {
              ...params,
              r: appendURLQueryParams(joinURL(baseURL, 'auth-success'), {
                nonce,
              }),
            };

            const filteredParams = Object.fromEntries(
              Object.entries(params).filter(([, v]) => v != null),
            ) as Record<string, string | number | boolean>;
            const newURL = appendURLQueryParams(url, filteredParams);
            popupCenter(
              newURL,
              'Octra-Backend - Authenticate via Shibboleth',
              760,
              760,
            );

            return AuthenticationActions.reauthenticate.wait();
          };
```

Confirm `appendURLQueryParams` and `joinURL` are already imported in this file (they're used elsewhere in the same effect, per the research — `joinURL` at the original line 97, `appendURLQueryParams` at the original line 103/163).

- [ ] **Step 5: Update `AuthSuccessPageComponent` to echo the nonce**

Replace the full body of `apps/tratt/src/app/core/pages/intern/auth-success/auth-success.page.component.ts`:

```typescript
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'tratt-auth-success',
  template: '',
})
export class AuthSuccessPageComponent implements OnInit {
  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    const nonce = this.route.snapshot.queryParamMap.get('nonce');
    const bc = new BroadcastChannel('ocb_authentication');
    bc.postMessage({ ok: true, nonce });
    bc.close();
    window.close();
  }
}
```

Check the existing component for its current `@Component` decorator options (selector/template/standalone flag) before replacing — match its existing metadata shape exactly rather than the sketch above if it differs (e.g. if it's `standalone: true` per Angular 19 convention used elsewhere in this repo, keep that).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx nx test tratt -- --testPathPattern=authentication.effects`
Expected: PASS.

- [ ] **Step 7: Manually verify the `r` param survives the backend redirect**

This is the one assumption not verifiable from the frontend repo alone. Using the `run` skill (or `npm start` + browser), trigger a reauthentication flow (log in, force a 401, or use whatever existing manual trigger the app has for `reauthenticate.do`), and in the popup window's DevTools Network tab confirm the final redirect back to `/intern/auth-success` still has `?nonce=...` in its URL. If the backend strips or re-encodes the `r` query string, this task's approach needs backend coordination after all — stop and flag rather than merging a change that silently doesn't validate anything.

- [ ] **Step 8: Commit**

```bash
git add apps/tratt/src/app/core/store/authentication/authentication.effects.ts apps/tratt/src/app/core/pages/intern/auth-success/auth-success.page.component.ts apps/tratt/src/app/core/store/authentication/authentication.effects.spec.ts
git commit -m "fix: validate BroadcastChannel auth message with a nonce (E3 remainder)"
```

---

## Phase 3 — S2: re-enable trn-editor (registration only) + TODO triage

**Scope, as agreed before this plan was written:** the 20 `TODO` blocks in `trn-editor.component.ts` (18) and `permutations-replace-modal.component.ts` (2) are large commented-out chunks of core editing logic (segment splitting/validation/saving/cloning), not one-line notes, and three lifecycle methods (`enableAllShortcuts`, `disableAllShortcuts`, `afterFirstInitialization`) and `openSegment` are no-op stubs. Fully restoring this editor's functionality is a multi-day feature-completion effort that can't be responsibly speced without reading and understanding each of the 20 commented blocks against the current (changed-since-comment-out) state of `TrattEditor`/`transcrService`. This plan covers re-enabling the registration (making it selectable again, currently impossible) and producing the triage inventory that a dedicated follow-up plan will consume — not the restoration itself.

### Task 8: re-enable trn-editor in the editor registry and produce the restoration triage doc

**Files:**
- Modify: `apps/tratt/src/app/editors/components.ts:1-3,29-36`
- Create: `docs/superpowers/plans/2026-08-26-trn-editor-restoration-triage.md`

**Interfaces:**
- No new interfaces — `TrnEditorComponent` already satisfies `TRATTEditor`/`TrattEditorRequirements` structurally (confirmed: extends `TRATTEditor`, implements `TrattEditorRequirements`, has `editorname`, `initialized`, all required lifecycle hooks present as stubs).

- [ ] **Step 1: Import and re-enable the registry entry**

In `apps/tratt/src/app/editors/components.ts`, add the import (matching the existing pattern at lines 1-3):

```typescript
import { TrnEditorComponent } from './trn-editor';
```

Replace the commented block (lines 29-36):

```typescript
    {
      name: TrnEditorComponent.editorname,
      editor: TrnEditorComponent,
      translate: 'interfaces.TRN editor',
      icon: 'bi bi-table',
    },
```

- [ ] **Step 2: Confirm the module registration still matches**

`TrnEditorComponent` and `PermutationsReplaceModalComponent` are already declared/exported via the `EDITORS` array in `apps/tratt/src/app/core/pages/intern/intern.module.ts:46-51,92,116` and `:100,124` — no change needed there. Run `npx nx build tratt` to confirm it still compiles with the editor now reachable from the UI.

- [ ] **Step 3: Manually verify the editor loads without crashing**

Use the `run` skill to launch the app, open a short task (TRN-Editor's `openSegment` comment says "only needed if a segment can be opened. For audio files smaller than 35 sec" — use one under 35s), and select TRN-Editor from the editor switcher (now visible per Step 1). Confirm it loads without throwing, even though most editing actions are known no-ops per the triage doc below. Screenshot and note actual behavior (what's visibly broken/missing) in the triage doc's "Observed behavior" section.

- [ ] **Step 4: Write the triage doc**

Create `docs/superpowers/plans/2026-08-26-trn-editor-restoration-triage.md` with this structure (fill in the "Observed behavior" section from Step 3; the rest is the inventory already gathered):

```markdown
# trn-editor Restoration Triage

Not a plan yet — an inventory to turn into one. `TrnEditorComponent`
(`apps/tratt/src/app/editors/trn-editor/trn-editor.component.ts`, 1581
lines) was re-enabled in the editor registry (see
2026-08-26-review-findings-amendments.md Task 8) but its core editing
behavior is still commented out or stubbed. A follow-up plan needs to
read each block below against the current `TrattEditor`/`transcrService`
API (both may have changed shape since these were commented out) and
decide restore-vs-rewrite-vs-delete per block.

## Stub methods (currently no-op, block basic operation)
- `enableAllShortcuts()` (~line 574) — empty body, no keyboard shortcuts work.
- `disableAllShortcuts()` (~line 577) — empty body.
- `afterFirstInitialization()` (~line 571) — empty body.
- `openSegment()` (~line 589) — comment-only body, segment opening is a no-op.

## Commented-out blocks (18 in trn-editor.component.ts)
Lines: 333, 411, 498, 520, 544, 687, 791, 793, 812, 890, 893, 949, 1016,
1115, 1378, 1386, 1400, 1514. Cover: interval/segment splitting,
`transcrService.validateAll()` calls, error-detail lookup, segment
saving, sample-position lookup, segment cloning/replacement, "audio not
playing" guards, text-editor state sync, ASR-context segment cloning.

## Commented-out blocks (2 in modals/permutations-replace-modal/permutations-replace-modal.component.ts)
Lines: 33, 102 — both wrap loops over
`transcrService.currentlevel!.segments`.

## Observed behavior (filled in from Task 8 Step 3)
[what actually happens when the editor is selected and used, post-re-enable]

## Suggested next step
Dedicated plan, one task per commented block, each task: read the block,
check whether `TrattEditor`/`transcrService`'s current API still matches
what the block calls, restore-or-rewrite-or-delete, add a test.
```

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/editors/components.ts docs/superpowers/plans/2026-08-26-trn-editor-restoration-triage.md
git commit -m "feat: re-enable trn-editor in the editor registry, add restoration triage (S2)"
```

---

## Phase 4 — S3: split annotation.effects.ts / annotation.store.service.ts

Design source: full method/effect inventory with line ranges gathered against the current file (1999 lines / 29 effects; store service 1089 lines). Registration point confirmed: `apps/tratt/src/app/core/pages/intern/intern.module.ts:32` (import) and `:77` (`EffectsModule.forFeature([AnnotationEffects])`).

One real cross-bucket dependency exists: `saveTaskToServer` (currently private, lines 1909-1961) is called from both `onQuit$` (arguably session-teardown/maintenance) and `onAnnotationSend$` (save). Extract it into a small injectable service both new effect classes can inject, rather than forcing `onQuit$` into the save file or duplicating the method.

### Task 9: extract `AnnotationPersistenceService.saveTaskToServer`

**Files:**
- Create: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-persistence.service.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.effects.ts` (remove the private method, inject the new service)
- Test: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-persistence.service.spec.ts`

**Interfaces:**
- Produces: `AnnotationPersistenceService.saveTaskToServer(state: RootState, status: TaskStatus): <same return type as today>` — read the current private method at lines 1909-1961 verbatim and move its body unchanged (this is extraction, not a rewrite); keep whatever dependencies it currently closes over (`this.apiService`, etc. — read the method to find them) as constructor-injected params on the new `@Injectable({ providedIn: 'root' })` class instead of closure captures.
- Consumes (by Task 10 and Task 11 below): `AnnotationSaveEffects` and `AnnotationMaintenanceEffects` (or wherever `onQuit$` lands) both inject `AnnotationPersistenceService` and call `.saveTaskToServer(...)` instead of `this.saveTaskToServer(...)`.

- [ ] **Step 1: Read the current method and its dependencies**

Read `apps/tratt/src/app/core/store/login-mode/annotation/annotation.effects.ts:1909-1961` in full, and note every `this.X` it references (likely a subset of the 10 injected services listed at the current constructor, lines 1965-1977: `apiService`, `alertService`, etc. — confirm exact subset by reading the method body, don't guess).

- [ ] **Step 2: Write a test for the extracted service**

Base the test on the existing test conventions for effects/services in this NgRx slice (check whether `annotation.effects.spec.ts` or similar exists first and match its mocking style — likely `TestBed` with mocked `ApiService`/etc.). Assert `saveTaskToServer` calls the same API method with the same shape it does today (read the current body in Step 1 to know what to assert — do not invent behavior).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx nx test tratt -- --testPathPattern=annotation-persistence`
Expected: FAIL — file doesn't exist yet.

- [ ] **Step 4: Create the service with the method body moved verbatim**

```typescript
import { Injectable } from '@angular/core';
// import exactly the services this.X-referenced in Step 1, e.g.:
// import { ApiService } from '...';

@Injectable({ providedIn: 'root' })
export class AnnotationPersistenceService {
  constructor(/* the services identified in Step 1, e.g. private apiService: ApiService */) {}

  // paste the body of the current private saveTaskToServer (lines 1909-1961)
  // unchanged, replacing `this.apiService` etc. with the same `this.X`
  // now pointing at this class's own constructor-injected fields.
}
```

- [ ] **Step 5: Update `annotation.effects.ts` to delegate**

Remove the private `saveTaskToServer` method (lines 1909-1961). Add `private persistence: AnnotationPersistenceService` to the constructor injection list. At both call sites (inside `onQuit$` and `onAnnotationSend$`), replace `this.saveTaskToServer(state, TaskStatus.paused)` / `this.saveTaskToServer(state, TaskStatus.finished)` with `this.persistence.saveTaskToServer(state, TaskStatus.paused)` / `this.persistence.saveTaskToServer(state, TaskStatus.finished)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx nx test tratt -- --testPathPattern=annotation`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation-persistence.service.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation-persistence.service.spec.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation.effects.ts
git commit -m "refactor: extract AnnotationPersistenceService.saveTaskToServer (S3 prep)"
```

---

### Task 10: split `annotation.effects.ts` into 4 effect classes by feature

**Files:**
- Create: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.ts`
- Create: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.ts`
- Create: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-maintenance.effects.ts`
- Create: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-tools.effects.ts`
- Delete: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.effects.ts`
- Modify: `apps/tratt/src/app/core/pages/intern/intern.module.ts:32,77`

**Interfaces:**
- Each new class is `@Injectable()` with its own `constructor` injecting only the services its own effects use (read each effect's body to determine its actual dependency subset — do not just copy all 10 services into all 4 classes).
- Registration becomes `EffectsModule.forFeature([AnnotationLoadEffects, AnnotationSaveEffects, AnnotationMaintenanceEffects, AnnotationToolsEffects])`.

This is a mechanical move-by-line-range extraction — the method bodies are unchanged, only their file and class location move, since no consumer outside NgRx's own effect registration touches these classes directly (effects communicate only via dispatched actions).

- [ ] **Step 1: Create `annotation-load.effects.ts`**

Move these effects and their private helpers, unchanged, into a new `@Injectable() export class AnnotationLoadEffects`: `startNewAnnotation$` (was 92-159), `onPrepareTaskForAnnotation$` (161-219), `prepareTaskSuccess$` (221-261), `onAnnotationStart$` (263-326), `onAudioLoad$` (345-470), `onAnnotationLoadFailed$` (472-495), `loadSegments$` (627-636), `loadSegmentsSuccess$` (638-655), `initTranscriptService$` (657-667), `onAudioLoadSuccess$` (669-686), `onLoadOnlineInfo$` (688-1073), `resumeTaskManually$` (1357-1380), `redirectToTranscription$` (1382-1395), plus private helpers `addFunctions` (1586-1603), `readGuidelines` (1605-1628), `loadSegments()` (1630-1822), and the module-level function `renamePlaceholderLevels` (1980-1999, can stay module-level or become a private method — keep it a plain exported function if anything outside this file imports it; grep first: `grep -rn "renamePlaceholderLevels" apps/`).

Constructor: inject only the services these effects actually call (read each body — likely includes `actions$`, `store`, `apiService`, `http`, `routingService`, `modalsService`, `audio`, `transloco`, `uiService`, `subscrManager`-equivalent; confirm exact set from the source, don't assume).

- [ ] **Step 2: Create `annotation-save.effects.ts`**

Move `onQuit$` (513-597), `onAnnotationSend$` (1200-1271), `sendAnnotationFail$` (1273-1286), `afterAnnotationSent$` (1288-1320) into `@Injectable() export class AnnotationSaveEffects`. Inject `AnnotationPersistenceService` (from Task 9) instead of duplicating `saveTaskToServer`. Also inject `transcrSendingModal`'s owning service dependencies (`modalsService` etc. — read the current field at lines 84-88 and its usages to find what it needs).

- [ ] **Step 3: Create `annotation-maintenance.effects.ts`**

Move `setLogging$` (328-343), `onTranscriptionEnd$` (497-511), `showNoRemainingTasksModal$` (599-613), `afterLogoutSuccess$` (615-625), `afterClearOnlineSession$` (1322-1330), `redirectToProjects$` (1342-1355), `levelIndexChange$` (1824-1844), and the public `initMaintenance()` method (1846-1907) into `@Injectable() export class AnnotationMaintenanceEffects`. **Do not move `onClearWholeSession$` (1332-1340)** — per the design research it's a byte-identical duplicate of `afterClearOnlineSession$` listening to the same action; delete it instead (confirm the byte-for-byte claim by diffing the two bodies yourself before deleting, per this plan's own standard of not trusting a description without checking).

- [ ] **Step 4: Create `annotation-tools.effects.ts`**

Move `combinePhrases$` (1075-1198), `combinePhrasesSuccess$` (1397-1412), `combinePhrasesFailed$` (1414-1429), `asrRunWordAlignmentSuccess$` (1431-1584) into `@Injectable() export class AnnotationToolsEffects`.

- [ ] **Step 5: Delete the original file and update registration**

Delete `annotation.effects.ts`. In `apps/tratt/src/app/core/pages/intern/intern.module.ts`, replace the import at line 32:

```typescript
import { AnnotationLoadEffects } from '../../store/login-mode/annotation/annotation-load.effects';
import { AnnotationSaveEffects } from '../../store/login-mode/annotation/annotation-save.effects';
import { AnnotationMaintenanceEffects } from '../../store/login-mode/annotation/annotation-maintenance.effects';
import { AnnotationToolsEffects } from '../../store/login-mode/annotation/annotation-tools.effects';
```

And line 77:

```typescript
EffectsModule.forFeature([
  AnnotationLoadEffects,
  AnnotationSaveEffects,
  AnnotationMaintenanceEffects,
  AnnotationToolsEffects,
]),
```

Grep for any other reference to `AnnotationEffects` repo-wide (`grep -rn "AnnotationEffects" apps/ libs/`) and update it — the earlier research found none besides `intern.module.ts`, but re-verify since this plan may execute after other changes land.

- [ ] **Step 6: Run tests**

Run: `npx nx test tratt -- --testPathPattern=annotation && npx nx build tratt`
Expected: PASS, build succeeds. If any effect spec imports `AnnotationEffects` directly, update its import to whichever new class now owns the effect under test.

- [ ] **Step 7: Manually verify the annotation flow end-to-end**

Use the `run` skill: start a new annotation task (exercises load effects), make an edit and combine two phrases (tools), let the app idle to trigger any maintenance path if observable, then send/quit the task (save effects). Confirm no regressions.

- [ ] **Step 8: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation-maintenance.effects.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation-tools.effects.ts apps/tratt/src/app/core/pages/intern/intern.module.ts
git rm apps/tratt/src/app/core/store/login-mode/annotation/annotation.effects.ts
git commit -m "refactor: split annotation.effects.ts into load/save/maintenance/tools effect classes (S3)"
```

---

### Task 11: split the pure text-processing methods out of `annotation.store.service.ts`

**Files:**
- Create: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.store.service.ts`

**Interfaces:**
- Produces: `AnnotationTextProcessingService` with the ~450 lines of methods that have no NgRx-effect dependency: `validate` (472-520), `replaceSingleTags` (522-543), `extractUI` (545-586), `rawToHTML` (591-732), `underlineTextRed` (734-825), `getErrorDetails` (827-852), `validateAll` (858-905), `getMarkerPositions` (907-933), `analyse` (952-978).
- `AnnotationStoreService` keeps its signals/computed/effects wiring (62-338) and all dispatch-facade methods, and injects `AnnotationTextProcessingService` for the methods moved out, re-exposing them as thin delegating methods with the exact same names/signatures so every existing template/component call site (`this.annotationStoreService.validate(...)` etc.) keeps working unchanged.

This is the one part of S3 the design research called out as orthogonal/optional — it reduces `AnnotationStoreService` from 1089 to ~600 lines without touching the effects split in Task 10.

- [ ] **Step 1: Grep for all external call sites of the 9 methods being moved**

Run: `grep -rn "\.\(validate\|replaceSingleTags\|extractUI\|rawToHTML\|underlineTextRed\|getErrorDetails\|validateAll\|getMarkerPositions\|analyse\)(" apps/tratt/src apps/web-components/src 2>/dev/null | grep -v "annotation.store.service"`

This tells you every place that must keep working through `AnnotationStoreService`'s delegating methods (Angular DI means components already inject `AnnotationStoreService`, not the new service, so delegation is required — don't skip it and force call sites to change their injection).

- [ ] **Step 2: Create the new service with the 9 methods moved verbatim**

```typescript
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AnnotationTextProcessingService {
  // paste validate, replaceSingleTags, extractUI, rawToHTML,
  // underlineTextRed, getErrorDetails, validateAll, getMarkerPositions,
  // analyse here, unchanged, replacing any `this.X` reference to
  // AnnotationStoreService's own state (signals/fields) with an explicit
  // parameter instead — read each method body first to identify whether
  // it touches instance state or is purely functional on its arguments;
  // the design research flagged these as "pure/independent", so expect
  // most to already take everything they need as parameters.
}
```

- [ ] **Step 3: Update `AnnotationStoreService` to delegate**

Remove the 9 method bodies from `annotation.store.service.ts`, inject `private textProcessing: AnnotationTextProcessingService` in the constructor, and replace each removed method with a one-line delegate, e.g.:

```typescript
validate(...args: Parameters<AnnotationTextProcessingService['validate']>) {
  return this.textProcessing.validate(...args);
}
```

(Repeat for all 9 — match each one's actual parameter/return types from the original rather than using `Parameters<...>` boilerplate if the original signatures are simple enough to just restate directly; use whichever reads cleaner once you see the real signatures.)

- [ ] **Step 4: Run tests**

Run: `npx nx test tratt -- --testPathPattern=annotation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation.store.service.ts
git commit -m "refactor: extract pure text-processing methods from AnnotationStoreService (S3)"
```

---

## Phase 5 — S1: split `audio-viewer.service.ts`

Design source: full 126-method inventory with line ranges, state-per-bucket mapping, and cross-dependency graph gathered against the current 5401-line file. Sole consumer: `AudioViewerComponent` (`libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.component.ts`), which injects `AudioViewerService` as a component-level provider (line 49) and calls it via the public field `av` (line 104) — no template touches `av` directly. The facade class must keep every method/property the research identified as used by the component (listed in Task 12 below) with unchanged signatures.

**Circular-dependency mitigation (do this before moving code, not after):** the real graph today is "everything calls everything" — `onKeyDown` alone calls into rendering, segment-model, and playback. The target graph is a DAG: `interaction → {rendering, segments, time-utils}`, `segments → time-utils` (and reaches rendering only through the facade), `rendering → time-utils` only. Two call sites currently break this by having non-facade code reach directly into another bucket: the `dragableBoundaryID` setter (today ~line 304-311) calls `redrawSegment`/`drawAllBoundaries`/`drawWholeSelection` directly, and `onKeyDown` calls across all three buckets directly. Both must become facade-orchestrated: the bucket-internal setter/handler emits/returns what changed, and the facade (the slimmed `AudioViewerService`) is the one place that calls both services in sequence.

### Task 12: create `AudioViewerTimeUtils` (leaf, no dependencies — do this first)

**Files:**
- Create: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-time-utils.ts`
- Test: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-time-utils.spec.ts`

**Interfaces:**
- Produces: a plain class (not `@Injectable` — stateless-ish pure math per the design research) `AudioViewerTimeUtils` with methods `getPixelPerSecond`, `computeWholeDisplayData`, `computeDisplayData`, `calculateZoom`, `getPlayCursorPositionOfLineByAbsX`, `getRelativeSelectionByLine`, `getNumberOfLines`, `getLineNumber`, moved verbatim from `audio-viewer.service.ts` (current line ranges: 541-558, 3202-3274, 3670-3739, 3740-3777, 3275-3300, 3301-3357, 4806-4812, 5313-5327 — re-verify each range against the file at execution time since earlier tasks in this plan don't touch this file, but confirm nothing has drifted).
- Consumed by: Tasks 13-15 below (rendering, segments, interaction services) and the Task 16 facade.

This is the safest first step — the design research confirmed this bucket has no outgoing calls into the other three buckets.

- [ ] **Step 1: Read each method's current body and exact dependencies**

Read `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts` at the 8 line ranges above. Note every field each one reads (expect: `audioTCalculator`, `audioPxW`, `hZoom`, `_innerWidth`, `_minmaxarray`, `audioChunk`/`audioManager`, per the design research — confirm against the actual bodies).

- [ ] **Step 2: Write characterization tests for at least the 3 most complex methods**

```typescript
// audio-viewer-time-utils.spec.ts
import { AudioViewerTimeUtils } from './audio-viewer-time-utils';

describe('AudioViewerTimeUtils', () => {
  let utils: AudioViewerTimeUtils;
  beforeEach(() => {
    utils = new AudioViewerTimeUtils();
  });

  it('getPixelPerSecond computes pixels from secondsPerLine and innerWidth', () => {
    // Arrange whatever state getPixelPerSecond needs per Step 1's findings,
    // call utils.getPixelPerSecond(...), assert against a value you compute
    // by hand from the current (pre-move) implementation's formula.
  });

  // Repeat for calculateZoom and getLineNumber — pick the 3 methods
  // whose formulas are least obvious from a read, per Step 1.
});
```

(These are characterization tests — their job is to pin today's actual output before the move, so a mistake in Step 3's copy is caught. Write the concrete assertions after reading the real formulas in Step 1, not from the sketch above.)

- [ ] **Step 3: Create the new file with all 8 methods moved verbatim**

```typescript
export class AudioViewerTimeUtils {
  // paste the 8 methods here unchanged, adjusting only `this.` references
  // to fields that must now be either constructor parameters or method
  // parameters (per Step 1's findings) since this class no longer shares
  // AudioViewerService's instance state.
}
```

- [ ] **Step 4: Run the new tests**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer-time-utils`
Expected: PASS.

- [ ] **Step 5: Have `AudioViewerService` delegate to the new class (facade not yet slimmed)**

At this stage, don't remove the 8 methods from `audio-viewer.service.ts` yet — instead have it hold a `private timeUtils = new AudioViewerTimeUtils();` field and change each of the 8 methods' bodies to call `this.timeUtils.X(...)` with whatever state they need passed in. This keeps every other part of the file (which still calls `this.getPixelPerSecond()` etc. internally) working unchanged while proving the extraction is behavior-preserving, ahead of Task 16's full facade cleanup.

- [ ] **Step 6: Run the full service's existing tests**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer.service`
Expected: PASS, unchanged from before this task.

- [ ] **Step 7: Commit**

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-time-utils.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-time-utils.spec.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts
git commit -m "refactor: extract AudioViewerTimeUtils from audio-viewer.service.ts (S1, step 1/5)"
```

---

### Task 13: create `AudioViewerSegmentsService`

**Files:**
- Create: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-segments.service.ts`
- Test: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-segments.service.spec.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts` (delegate, same pattern as Task 12 Step 5)

**Interfaces:**
- Produces: `@Injectable() class AudioViewerSegmentsService` owning `annotation`, `tempAnnotation`, `currentLevel`/`currentLevelID`, `itemIDCounter` state, with methods `getChanges` (4023-4319 — decompose per Step 2 below), `applyChanges` (470-532, minus its rendering calls — see Step 3), `addSegment` (3988-4006), `changeSegment` (4007-4022), `removeSegmentByIndex` (3952-3987), `getSegmentSelection` (3543-3613), `selectSegment` (3046-3174, minus its rendering call — see Step 3), `getNextItemID` (379-383).
- Depends on: `AudioViewerTimeUtils` (Task 12) if any of these methods use it (check during Step 1).
- Does NOT depend on rendering or interaction — `applyChanges` and `selectSegment` currently call into rendering directly (`updateAllSegments`/`drawAllBoundaries`, and a redraw respectively); per this phase's DAG, these calls move to the facade (Task 16), and this service instead returns/emits what changed for the facade to act on.

- [ ] **Step 1: Read all 8 methods' current bodies**

Read the line ranges above in the current `audio-viewer.service.ts`. For `applyChanges` and `selectSegment` specifically, identify exactly which lines are the rendering call(s) that need to move to the facade — note the surrounding context (what triggers the call, what data it needs) precisely enough to reproduce it in Task 16.

- [ ] **Step 2: Decompose `getChanges` while moving it**

`getChanges` (296 lines) is flagged by the design research as needing internal decomposition regardless of destination file. While copying it into the new service, split its level/item/link diffing into three private helpers: `diffLevels`, `diffItems`, `diffLinks`, called from a slimmed `getChanges` that composes their results. Read the current method fully first to find the natural boundaries (it diffs `oldAnnotation`/`newAnnotation` — the loop structure should make the three sections visually obvious).

- [ ] **Step 3: Write tests for `getChanges` (the highest-value method to characterize) before moving it**

```typescript
// audio-viewer-segments.service.spec.ts
import { AudioViewerSegmentsService } from './audio-viewer-segments.service';

describe('AudioViewerSegmentsService', () => {
  let service: AudioViewerSegmentsService;
  beforeEach(() => {
    service = new AudioViewerSegmentsService();
  });

  describe('getChanges', () => {
    it('detects an added level', () => {
      // Build a minimal oldAnnotation/newAnnotation pair (reuse whatever
      // test fixtures/builders the existing audio-viewer.service.spec.ts
      // already has for TrattAnnotation, if any — check first) where
      // newAnnotation has one extra level, call service.getChanges(...),
      // assert the resulting AnnotationChange[] contains an 'add' entry
      // for that level. Base the exact assertion shape on AnnotationChange's
      // actual type definition, read it before writing this.
    });
    // Add cases for: removed level, changed item, added link, removed link
    // — one per branch you find while reading the diff loops in Step 2.
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer-segments`
Expected: FAIL — file doesn't exist yet.

- [ ] **Step 5: Create the service**

Move the 8 methods (with `getChanges` already decomposed per Step 2, and `applyChanges`/`selectSegment` with their rendering calls removed per Step 1) into the new `@Injectable() class AudioViewerSegmentsService`, owning `annotation`, `tempAnnotation`, `currentLevel`, `currentLevelID`, `itemIDCounter` as its own fields (moved from `audio-viewer.service.ts`, not duplicated).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer-segments`
Expected: PASS.

- [ ] **Step 7: Delegate from `audio-viewer.service.ts`**

Same pattern as Task 12 Step 5 — `audio-viewer.service.ts` holds a `private segments: AudioViewerSegmentsService` field (via constructor injection now that this is `@Injectable`, since `AudioViewerService` is itself provided per-component and can use Angular DI) and its own `getChanges`/`applyChanges`/etc. become thin delegates, with `applyChanges`'s rendering call kept in `audio-viewer.service.ts` for now (it'll move to the true facade role in Task 16, but this task's job is just proving the segments-state extraction, not the full DAG cleanup yet).

- [ ] **Step 8: Run the full service's existing tests**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer.service`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-segments.service.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-segments.service.spec.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts
git commit -m "refactor: extract AudioViewerSegmentsService from audio-viewer.service.ts (S1, step 2/5)"
```

---

### Task 14: create `AudioViewerRendererService`

**Files:**
- Create: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-renderer.service.ts`
- Test: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-renderer.service.spec.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts`

**Interfaces:**
- Produces: `@Injectable() class AudioViewerRendererService` owning `stage`, `konvaContainer`, `layers`, `canvasElements`, `styles`, `animation`, `croppingData`, `grid`, `viewport`, `size`, with all ~35 canvas-rendering methods identified by the design research (the full list spans lines 397-5231 in the current file — re-verify each range at execution time; the largest are `updateAllSegments` 1280-1469, `createSegmentOnCanvas` 1684-1893, `drawTextLabel` 4942-5147, `overlaySceneFunction` 4399-4591 — decompose these 4 per Step 2 below, same rationale as `getChanges` in Task 13).
- Depends on: `AudioViewerTimeUtils` (Task 12) — check which rendering methods call time-math during Step 1.
- Does NOT depend on segments or interaction services — takes segment/annotation data as method parameters instead of reaching into `AudioViewerSegmentsService`.

- [ ] **Step 1: Read all rendering methods' current bodies and their call parameters**

This is the largest bucket (~2400 lines across ~35 methods). Read them in the current file at the ranges the design research identified (canvas-rendering bucket list from the earlier investigation). For each, note whether it currently reads `this.annotation`/`this.currentLevel` (segment-model state) directly — those reads must become parameters once this moves to its own service, since it no longer shares state with the segments service.

- [ ] **Step 2: Decompose the 4 large methods while moving them**

- `updateAllSegments` (190 lines) — the review's own flagged example; extract the per-segment layout loop body into a private `layoutSegment` helper.
- `createSegmentOnCanvas` (210 lines) — extract per-shape builders (boundary shape, transcript shape, overlay shape) into private helpers.
- `drawTextLabel` (205 lines) — extract the text-wrapping/measurement logic into a private pure helper separate from Konva `Text` node construction.
- `overlaySceneFunction` (193 lines) — extract the progress-bar geometry calculation from the drawing calls.

Read each fully before splitting — use the natural boundaries visible in the code (a loop body, a sequence of "build shape A, build shape B" blocks) rather than an arbitrary line-count split.

- [ ] **Step 3: Write a smoke test for the trickiest rendering path**

Canvas/Konva code is hard to unit-test meaningfully — the design research notes this is Konva Stage/Layer manipulation. Rather than deep unit tests per method, write one instantiation smoke test:

```typescript
// audio-viewer-renderer.service.spec.ts
import { AudioViewerRendererService } from './audio-viewer-renderer.service';

describe('AudioViewerRendererService', () => {
  it('initializes a Konva stage without throwing', () => {
    const service = new AudioViewerRendererService();
    const container = document.createElement('div');
    // Call whatever the moved `initialize`/`initializeStageContainer`
    // method's actual signature requires per Step 1's reading — this
    // sketch assumes it takes a container element, confirm against the
    // real signature before writing the final assertion.
    expect(() => service.initialize(container, /* ...other required args per real signature... */)).not.toThrow();
  });
});
```

Rely primarily on Step 7's manual verification (real browser, real canvas) for this bucket rather than exhaustive unit tests — that's consistent with how this code is verified today (no existing per-method Konva unit tests were found in the design research).

- [ ] **Step 4: Run test to verify it fails**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer-renderer`
Expected: FAIL — file doesn't exist yet.

- [ ] **Step 5: Create the service**

Move all ~35 rendering methods (with the 4 large ones decomposed per Step 2) into `@Injectable() class AudioViewerRendererService`, owning the rendering-bucket state fields listed above. Methods that read segment/annotation data take it as parameters now instead of via `this.annotation`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer-renderer`
Expected: PASS.

- [ ] **Step 7: Delegate from `audio-viewer.service.ts` and manually verify rendering**

Same delegation pattern as prior tasks. Then use the `run` skill to open a task in 2D-editor or linear-editor and visually confirm: waveform renders, segments draw correctly, scrolling/zooming redraws correctly, segment boundaries and transcript overlays look unchanged. This is the highest-risk task in the plan for silent visual regressions — do not skip the manual check.

- [ ] **Step 8: Commit**

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-renderer.service.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-renderer.service.spec.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts
git commit -m "refactor: extract AudioViewerRendererService from audio-viewer.service.ts (S1, step 3/5)"
```

---

### Task 15: create `AudioViewerInteractionService`

**Files:**
- Create: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-interaction.service.ts`
- Test: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-interaction.service.spec.ts`
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts`

**Interfaces:**
- Produces: `@Injectable() class AudioViewerInteractionService` owning `mouseClickPos`, `_mouseDown`, `_mouseCursor`, `_dragableBoundaryID`, `shiftPressed`, `_focused`, `hoveredLine`, `shortcutsManager`, `_boundaryDragging`, `zoomX`/`zoomY`, `secondsPerLine`, with methods: `onKeyDown` (2391-3024 — decompose per Step 2), `onKeyUp` (2249-2256), `handleBoundaryDragging` (2088-2248), `setMouseClickPosition` (1978-2087), `setMouseMovePosition` (3358-3399), `moveCursor` (3614-3669), `isDisabledKey` (3175-3187), `onMouseEnter`/`onMouseLeave` (2270-2279), `onWheel` (5206-5231), `scrollWithDeltaY` (5232-5256), `onScrollbarDragged` (5257-5270), `mouseChange` (5277-5312), `onMouseMove` (5328-5373), `addOrRemoveSegment` (3400-3542), `updateShortcuts` (4934-4941), `changeMouseCursorSamples` (4813-4835), `focus` (5380-5383).
- Depends on `AudioViewerSegmentsService` (Task 13) and `AudioViewerTimeUtils` (Task 12) — injected directly, per the DAG (`interaction → {rendering, segments, time-utils}` is allowed).
- Does NOT call `AudioViewerRendererService` directly — per the DAG, rendering calls triggered by interaction (the `dragableBoundaryID` setter's `redrawSegment`/`drawAllBoundaries`/`drawWholeSelection` calls, and `onKeyDown`'s rendering calls) move to the facade in Task 16. This service instead exposes what changed (e.g. an event emitter or return value the facade reacts to) rather than calling the renderer itself.

- [ ] **Step 1: Read all interaction methods' current bodies, flagging every cross-bucket call**

This is the bucket with the most cross-cutting calls per the design research — `onKeyDown` alone touches rendering, segment-model, and playback. Read the full method and list every `this.X(...)` call that belongs to another bucket (rendering, segments, or the playback methods staying in the facade). This list is the exact set of calls that must be removed from this service and re-homed in Task 16's facade.

- [ ] **Step 2: Decompose `onKeyDown` while moving it**

`onKeyDown` (633 lines — the single largest method in the original file) is one giant `switch(shortcutName)`. Split it into one private handler method per shortcut (or per logical group of related shortcuts, if several are trivially one-line each — use judgment based on what you read, don't force exactly one method per case if that produces 40 near-empty methods). The top-level `onKeyDown` becomes a dispatch table or slim switch calling the handlers.

- [ ] **Step 3: Write tests for the cross-bucket boundary, not just individual methods**

The highest-value test here isn't "does `onWheel` compute the right zoom" (though write that too) — it's confirming the interaction service correctly reports what needs re-rendering instead of calling the renderer directly, since that's the exact bug class this split is designed to prevent from creeping back in.

```typescript
// audio-viewer-interaction.service.spec.ts
import { AudioViewerInteractionService } from './audio-viewer-interaction.service';

describe('AudioViewerInteractionService', () => {
  it('does not import or reference AudioViewerRendererService', () => {
    // A cheap, durable guard against regression: read this file's own
    // source at test time and assert it contains no import of the
    // renderer service. This is a structural test, not a behavioral one,
    // but it's exactly the invariant this task is designed to hold.
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('./audio-viewer-interaction.service.ts'),
      'utf-8',
    );
    expect(source).not.toContain('AudioViewerRendererService');
  });

  // Add functional tests per method as you read their real signatures in
  // Step 1 — e.g. onWheel's zoom-clamping behavior, setMouseClickPosition's
  // coordinate math — using the current implementation's actual formulas
  // as the expected values (characterization, not new behavior).
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer-interaction`
Expected: FAIL — file doesn't exist yet.

- [ ] **Step 5: Create the service with cross-bucket calls replaced by outputs**

Move the 17 methods (with `onKeyDown` decomposed per Step 2) into `@Injectable() class AudioViewerInteractionService`. Where Step 1 found a rendering call (e.g. in the `dragableBoundaryID` setter or inside `onKeyDown`'s branches), replace the direct call with either (a) an `EventEmitter`/`Subject` the facade subscribes to, or (b) a return value from the public method the facade checks and acts on — pick whichever matches the existing emitter-heavy style already used elsewhere in this file (`currentLevelChange`, `selchange`, etc. are existing precedent for the emitter approach — prefer consistency with that pattern).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx nx test ngx-components -- --testPathPattern=audio-viewer-interaction`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-interaction.service.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-interaction.service.spec.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts
git commit -m "refactor: extract AudioViewerInteractionService from audio-viewer.service.ts (S1, step 4/5)"
```

---

### Task 16: slim `audio-viewer.service.ts` into the orchestration facade

**Files:**
- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts`
- Test: existing `audio-viewer.service.spec.ts` (if present — check) plus new facade-specific tests

**Interfaces:**
- `AudioViewerService`'s public surface must remain exactly what `AudioViewerComponent` uses (the full list gathered by the design research: properties `annotation`, `focused`, `secondsPerLine`, `currentLevelChange`, `annotationChange`, `refreshOnInternChanges`, `currentLevelID`, `boundaryDragging`, `mouseCursorCanvasElement`, `settings`, `AudioPxWidth`, `name`, `shortcut`, `selchange`, `playcursorchange`, `segmententer`, `mousecursorchange`, `alert`, `onInitialized`, `silencePlaceholder`, `shortcutsManager`, `renderer`; methods `getChanges`, `updateAllSegments`, `destroy`, `initialize`, `initializeSettings`, `initializeView`, `applyChanges`, `selectSegment`, `scrollToAbsY`, `onSecondsPerLineChanged`, `onResize`, `redraw`, `onPlaybackStarted/Paused/Stopped/Ended`) — every one of these becomes either a real orchestration method here or a thin delegate to one of the 4 new services.
- Constructor now injects `AudioViewerRendererService`, `AudioViewerSegmentsService`, `AudioViewerInteractionService`, and uses `AudioViewerTimeUtils` (plain, not injected, per Task 12).

- [ ] **Step 1: Re-home the cross-bucket calls identified in Task 15 Step 1**

For each cross-bucket call Task 15 removed from the interaction service (the `dragableBoundaryID` setter's rendering calls, `onKeyDown`'s calls into rendering/segments), the facade now owns that orchestration: subscribe to the interaction service's emitter (or call its method and inspect the return value, per whichever Task 15 Step 5 chose), and call the appropriate renderer/segments method in response. Also re-home `applyChanges`'s and `selectSegment`'s rendering calls that Task 13 Step 1 identified.

- [ ] **Step 2: Verify every property/method in this task's Interfaces section is present**

Go through the full list above one by one against the current file state and confirm each is either implemented here or delegates to one of the 4 services. Anything missing breaks `AudioViewerComponent` at compile time — `npx nx build ngx-components` (Step 4) will catch it, but check by hand first since a missing delegate is easy to miss in review.

- [ ] **Step 3: Remove now-dead code**

Anything left in `audio-viewer.service.ts` that isn't orchestration, lifecycle (`constructor`, `initialize`, `destroy`, `initializeSettings`), or one of the required delegates should have already moved to one of the 4 services in Tasks 12-15 — if something remains uncategorized, re-check which bucket it belongs to (per the design research's "other/unclear" bucket: `destroy`, `refreshComputedData`, `afterChannelInitialized`, `onSecondsPerLineChanged`, playback event handlers, `playSelection`, `afterAudioEnded` all stay here as orchestration/lifecycle, per the design).

- [ ] **Step 4: Run the full build and test suite**

Run: `npx nx build ngx-components && npx nx test ngx-components && npx nx build tratt`
Expected: PASS. A compile failure here means Step 2's surface-completeness check missed something — fix before proceeding.

- [ ] **Step 5: Full manual regression pass**

Use the `run` skill. Open 2D-editor: verify waveform render, zoom (wheel), pan/scroll, segment select/create/delete/split (via keyboard shortcuts — this exercises the re-homed `onKeyDown` paths), boundary dragging, playback start/pause/stop and cursor tracking. Repeat the same checklist in linear-editor and dictaphone-editor (all three consume `AudioViewerComponent`, confirm via `grep -rn "tratt-audio-viewer" apps/tratt/src`). This is the single highest-risk task in the whole plan — do not skip any item on this checklist.

- [ ] **Step 6: Commit**

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.spec.ts
git commit -m "refactor: slim audio-viewer.service.ts to an orchestration facade over the 4 split services (S1, step 5/5)"
```

---

## Phase 6 — S4: add OnPush to the hot components named by the review

The review's own suggestion — "audit hot components (editors, navbar)" — is bounded enough to task directly rather than a repo-wide 89-component sweep. `AudioViewerComponent` itself is already `OnPush` (confirmed: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.component.ts:50`). Target the editor shells and navbar, which currently are not.

### Task 17: add `ChangeDetectionStrategy.OnPush` to the editor components and navbar

**Files:**
- Modify: `apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts`
- Modify: `apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts`
- Modify: `apps/tratt/src/app/editors/dictaphone-editor/dictaphone-editor.component.ts` (confirm exact filename via `ls apps/tratt/src/app/editors/dictaphone-editor/`)
- Modify: `apps/tratt/src/app/editors/trn-editor/trn-editor.component.ts` (only if Phase 3's Task 8 already landed — this editor is re-enabled by that task; if executing Phase 6 before Phase 3, skip trn-editor here and do it as part of Task 8 instead)
- Modify: `apps/tratt/src/app/core/component/navbar/navbar.component.ts`

**Interfaces:** none — this is a change-detection strategy change, not an API change. Risk is behavioral: OnPush stops checking a component on every change-detection cycle and only checks it on `@Input()` reference change, an emitted `Output`, an event handler firing, or an explicit `markForCheck()`/`detectChanges()` call. Any state mutation these components currently rely on happening "for free" (e.g. a callback from outside Angular's zone — Konva event handlers, worker `onmessage`, `setInterval`) will stop updating the view unless it already calls `markForCheck()`/`detectChanges()` or goes through an `@Input`/`Output`.

- [ ] **Step 1: For each component, grep for zone-external callback sources before flipping the flag**

For each of the 4-5 files, run: `grep -n "\.subscribe(\|addEventListener\|setInterval\|setTimeout\|postMessage\|onmessage" <file>` and read each hit. If a callback mutates component state that the template reads, and nothing nearby already calls `this.cdr.markForCheck()` (or the component already injects `ChangeDetectorRef` — check the constructor), OnPush will silently stop that part of the UI from updating. Note every such spot per file — these need a `markForCheck()` call added in Step 3.

(2D-editor's `onZoomInOut` is already known from the review to call `detectChanges()` — that's a positive signal this component was already written with OnPush-awareness even though the decorator wasn't set; expect fewer surprises there than in the others.)

- [ ] **Step 2: Add the decorator**

For each file, add `ChangeDetectionStrategy` to the `@angular/core` import if not already present, and add `changeDetection: ChangeDetectionStrategy.OnPush` to the `@Component({...})` decorator.

- [ ] **Step 3: Add `markForCheck()` calls at the spots found in Step 1**

Inject `ChangeDetectorRef` in the constructor if not already present (`private cdr: ChangeDetectorRef`), and call `this.cdr.markForCheck();` at the end of each zone-external callback identified in Step 1 that mutates template-read state.

- [ ] **Step 4: Run the existing component tests**

Run: `npx nx test tratt -- --testPathPattern="(2D-editor|linear-editor|dictaphone-editor|navbar)"`
Expected: PASS.

- [ ] **Step 5: Manual regression pass per component**

Use the `run` skill. For each of the 4-5 components: open it, exercise every UI element that updates from a non-`@Input`/`@Output` source (the spots from Step 1) — e.g. navbar's connection-status indicator if it's socket/interval-driven, an editor's ASR-progress overlay if it's driven by a subscription. Confirm it still updates live. This is the actual test that matters for OnPush changes — the automated tests only prove the component still renders, not that it stays live-updating.

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts apps/tratt/src/app/editors/dictaphone-editor/*.component.ts apps/tratt/src/app/core/component/navbar/navbar.component.ts
git commit -m "perf: add ChangeDetectionStrategy.OnPush to editor shells and navbar (S4)"
```

---

## Phase 7 — S8: reduce `any` in the 4 worst files

Scope: only the 4 files the review named as worst offenders (`libs/annotation/src/lib/annotation.ts`, `apps/tratt/.../tool-configurator.component.ts`, `annotation.store.service.ts`, `apps/tratt/.../transcr-editor.component.ts`, ~23-24 occurrences each). The repo-wide ~600+ remaining occurrences are explicitly deferred — see "Future work" at the end of this plan. Note `annotation.store.service.ts` will have moved/shrunk if Phase 4's Task 11 already ran; re-count its `any` occurrences before starting if so.

### Task 18: type-audit `libs/annotation/src/lib/annotation.ts`

**Files:**
- Modify: `libs/annotation/src/lib/annotation.ts`
- Test: `libs/annotation/src/lib/annotation.spec.ts` (extend existing coverage for any behavior clarified by adding real types — a wrong `any` often hides an actual bug, per `tsc`'s new complaints)

- [ ] **Step 1: List every `any`/`as any` occurrence with context**

Run: `grep -n ": any\|as any\|<any>\|any\[\]" libs/annotation/src/lib/annotation.ts`

- [ ] **Step 2: For each occurrence, find or define the real type**

Work through the list from Step 1 one at a time. For each: read the surrounding usage to infer the actual shape (what properties are accessed, what's assigned to it), check whether a type already exists in `@tratt/annotation`/`@tratt/media` that fits (`grep -rn "interface\|type " libs/annotation/src/lib/ libs/media/src/lib/` for candidates), and either import the existing type or define a new minimal interface next to its usage if genuinely local. Replace the `any` with it.

- [ ] **Step 3: Run `tsc` after each replacement, not just at the end**

Run: `npx tsc --noEmit -p libs/annotation/tsconfig.lib.json` after every few replacements. A real type surfaces real type errors at call sites — fix those forward (correct the call site) rather than reaching for `any` again to silence the new error, unless the call site genuinely needs a broader/union type, in which case widen the type rather than erasing it back to `any`.

- [ ] **Step 4: Run tests**

Run: `npx nx test annotation`
Expected: PASS. If a newly-surfaced type error pointed at an actual latent bug (a property access that was always unsafe), fix it and add a regression test.

- [ ] **Step 5: Commit**

```bash
git add libs/annotation/src/lib/annotation.ts libs/annotation/src/lib/annotation.spec.ts
git commit -m "refactor: replace any usage with real types in annotation.ts (S8)"
```

---

### Task 19: type-audit `tool-configurator.component.ts`

**Files:**
- Modify: `apps/tratt/src/app/core/tools/table-configurator/table-configurator.component.ts` if this is the file the review meant (confirm exact path — the S11 finding's verified location for a similarly-named file moved to `apps/tratt/src/app/core/tools/table-configurator/`; run `find apps/tratt/src -iname "tool-configurator*"` and `find apps/tratt/src -iname "table-configurator*"` first to resolve which file S8's count applies to, since the review may have meant either name — check both for `any` density and pick the one matching ~23 occurrences)

Follow the identical 5-step procedure as Task 18 (list occurrences, find/define real types, `tsc --noEmit` incrementally, run tests, commit), applied to whichever file Step 0 resolves to.

- [ ] **Step 0: Resolve the exact file**

Run: `find apps/tratt/src -iname "*configurator*"` and `grep -c ": any\|as any" <each match>` to find the one with ~23 occurrences.

- [ ] **Step 1-4: (same procedure as Task 18 Steps 1-4, applied to this file)**

- [ ] **Step 5: Commit**

```bash
git add <resolved file path> <its spec file if modified>
git commit -m "refactor: replace any usage with real types in table-configurator (S8)"
```

---

### Task 20: type-audit `annotation.store.service.ts`

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.store.service.ts`

Follow the identical procedure as Task 18. If Phase 4's Task 11 has already run, this file is ~600 lines (post text-processing extraction) — re-run the Step 1 grep against its current state rather than assuming the original ~23 count still applies (some `any` usages may have moved into `annotation-text-processing.service.ts`).

- [ ] **Step 1: List every `any`/`as any` occurrence with context**

Run: `grep -n ": any\|as any\|<any>\|any\[\]" apps/tratt/src/app/core/store/login-mode/annotation/annotation.store.service.ts`

- [ ] **Step 2-4: (same procedure as Task 18 Steps 2-4)**

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation.store.service.ts
git commit -m "refactor: replace any usage with real types in annotation.store.service.ts (S8)"
```

---

### Task 21: type-audit `transcr-editor.component.ts`

**Files:**
- Modify: `apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.ts` (confirmed path — referenced already in Task 1/D9 as an `escapeHtml` consumer at line 25/594)

Follow the identical procedure as Task 18.

- [ ] **Step 1: List every `any`/`as any` occurrence with context**

Run: `grep -n ": any\|as any\|<any>\|any\[\]" apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.ts`

- [ ] **Step 2-4: (same procedure as Task 18 Steps 2-4)**

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.ts
git commit -m "refactor: replace any usage with real types in transcr-editor.component.ts (S8)"
```

---

## Future work (deliberately not tasked in this plan)

- **E1** (script injection via `addFunctions()`) and **E10** (sessionStorage token) — need a product decision per REVIEW-FINDINGS.md before any fix can be chosen; raise with whoever owns that call.
- **S8 long tail** — ~600 remaining `any`/`as any` occurrences outside the 4 files in Phase 7. Same procedure as Tasks 18-21, applied file-by-file as a standing cleanup, not a single plan.
- **S11** (deep nesting in `table-configurator`/`trn-editor`/worker files) and **S12** (signals-vs-BehaviorSubject direction repo-wide) — smaller/lower-severity findings the review marked LOW; pick up opportunistically.
- **D9's schemata generator gap** — the `.json`/`.ts` pairs under `libs/assets/src/lib/schemata/` claim to be generated but no generator script exists in the repo; needs someone who knows the original tooling to either recover or replace it.
- **trn-editor's 20 commented blocks** — see `docs/superpowers/plans/2026-08-26-trn-editor-restoration-triage.md`, produced by Task 8, for the dedicated follow-up plan this needs.

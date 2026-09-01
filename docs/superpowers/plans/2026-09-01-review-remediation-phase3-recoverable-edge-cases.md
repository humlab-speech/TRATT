# Review Remediation Phase 3: Recoverable Edge-Case Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 of the 15 Tier-3 ("wrong output / recoverable edge cases", score 2/4) findings from the code review — a PCM chunk index race, a missing separator in merged SRT transcript text, an 8-bit WAV silence-decodes-to-noise bug, an orphaned modal timer, a permanently-silenced permission-loss notifier, and two bugs in the same linear-editor method (a Promise that never resolves, a missing null guard).

**Scope note:** 8 of the 15 Tier-3 findings are deliberately NOT in this plan (N2, N6, N9, N10, C9, C15, C23, B5) — each was independently re-verified live during planning, but each also needs a real design decision (a UX call, a new store action, an idempotency-guard shape, a security host-allowlist policy) rather than a mechanical fix. See `docs/superpowers/plans/2026-09-01-review-remediation-roadmap.md`'s Phase 3 section for the reasoning behind each deferral. This plan covers only the 7 that have one clear, well-defined fix.

**Architecture:** Seven independent, single-concern bugfixes across `apps/tratt/src/app/core/shared/service/recording.service.ts`, `libs/annotation/src/lib/converters/SRTConverter.ts`, `libs/web-media/src/lib/audio/audio-decoder.ts`, `apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.ts`, `apps/tratt/src/app/core/shared/service/audio.service.ts`, and `apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts` (2 tasks, sequential). Every fix was independently re-derived from current source before this plan was written; every fix location was confirmed still live (not stale) by direct inspection.

**Tech Stack:** Angular 19, RxJS, Jest (`nx test tratt`), Vitest for `libs/annotation` (`npx vitest run` from `libs/annotation`).

**Spec:** `REVIEW-FINDINGS 1.md` (repo root) — findings N12, B8, B9, C7, C8, C10, C11, cross-referenced against `docs/superpowers/plans/2026-09-01-review-remediation-roadmap.md` for scope rationale.

## Global Constraints

- Every fix must be the minimal change that closes the reproduced bug — no refactoring beyond what's needed.
- App tests (`apps/tratt`): Jest, `describe`/`expect`/`it` from `'@jest/globals'`.
- Lib tests (`libs/annotation`): Vitest, `describe`/`expect`/`it` from `'vitest'`.
- `libs/web-media` uses Vitest via `@nx/vite:test`; run with `npx nx test web-media -- --run <path>`. Its `vite.config.ts` already has a `test` block (added in Phase 2) — no further config work needed.
- A plain `new SomeAngularClass(stub1, stub2, ...)` (bypassing `TestBed`/Angular DI entirely) is an accepted, already-used pattern in this codebase for calling a class's plain TypeScript methods without needing Angular's rendering or change-detection machinery — confirmed safe for `LinearEditorComponent`: neither it, its `TRATTEditor` base, `DefaultComponent`, nor `SubscriberComponent` (`@tratt/ngx-utilities`) declares a constructor with Angular-DI-only requirements; every constructor param is a plain injected service class, safely stubbable with a bare object.
- Accessing a `private` class member from a test via `(instance as any).fieldName` is an accepted pattern in this codebase.
- After all seven tasks: `npm run build:dev` must be clean.
- Do not touch `docs/manual/` or any i18n files.

---

### Task 1: Fix the PCM chunk index race between overlapping flushes (N12)

**Files:**
- Modify: `apps/tratt/src/app/core/shared/service/recording.service.ts`
- Test: `apps/tratt/src/app/core/shared/service/recording.service.spec.ts` (already exists, from Phase 2 — append to it)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `flushPcmPending()`'s behavior on success is unchanged; only when `this.pcmIndex` is incremented changes.

**The bug (confirmed by direct read of the current file, cross-checked against the Dexie schema):** `flushPcmPending()` (recording.service.ts, inside the `try` block after Phase 2's Task 1 changes) does:

```typescript
    const index = this.pcmIndex;
    try {
      await this.persistence.appendChunk({
        sessionId: this.sessionId,
        index,
        kind: 'pcm',
        blob,
      });
      this.pcmIndex++;
      this.bumpChunkStats(blob.size);
    } catch (error) {
```

`this.pcmIndex` is read into a local `index` *before* the `await`, and only incremented *after* the write succeeds. If two `flushPcmPending()` calls overlap (the 1s interval fires again while a previous flush's `await` is still pending — or `stop()`'s final flush overlaps with an in-flight interval flush), both read the *same* `this.pcmIndex` value before either has a chance to increment it, producing two chunks with a duplicate `index`.

This does not lose data: `libs`-adjacent inspection confirms `tratt-recording-database.ts:40`'s schema is `chunks: '++autoId, sessionId, [sessionId+index], kind'` — the primary key is Dexie's auto-incrementing `++autoId`; `[sessionId+index]` is a plain (non-unique) compound *index*, not a unique constraint, so `db.chunks.add(...)` never throws a `ConstraintError` on a duplicate `[sessionId, index]` pair — both chunks get stored. But `loadChunks()` (recording-persistence.service.ts) does `filtered.sort((a, b) => a.index - b.index)` — a stable sort — so two chunks sharing the same `index` value keep whatever relative order they happened to land in `.toArray()` (insertion/autoId order), which is not guaranteed to match capture-time order if the later-starting flush's write happens to resolve first. Net effect: possible chunk reordering in the assembled WAV, not chunk loss.

**The fix:** increment `this.pcmIndex` synchronously, before the `await` — not because it needs an in-flight flag or a chained promise (the review's own suggested fix), but because JavaScript is single-threaded: two overlapping async calls to `flushPcmPending()` can never interleave *between* two synchronous statements, only at an `await`. Moving the increment before the `await` means the second overlapping call's synchronous `this.pcmIndex++` always sees the first call's already-incremented value — the race is closed with no new state needed.

- [ ] **Step 1: Write the failing test**

Append to the existing `recording.service.spec.ts` (reuse its existing `createService()` helper):

```typescript
describe('RecordingService PCM index race (N12)', () => {
  it('assigns distinct indices to two overlapping flushes instead of racing on the same one', async () => {
    let resolveFirstAppend: () => void;
    const firstAppendGate = new Promise<void>((resolve) => {
      resolveFirstAppend = resolve;
    });
    const appendedIndices: number[] = [];
    const appendChunk = jest.fn(async (params: { index: number }) => {
      appendedIndices.push(params.index);
      if (appendedIndices.length === 1) {
        await firstAppendGate; // hold the first append open until the second has started
      }
    });
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';

    (service as any).pcmPending = [new Float32Array(10)];
    const firstFlush = (service as any).flushPcmPending();

    // Let the first flush's synchronous prefix (including the index read/queue-time increment) run.
    await Promise.resolve();

    (service as any).pcmPending = [new Float32Array(10)];
    const secondFlush = (service as any).flushPcmPending();

    resolveFirstAppend!();
    await Promise.all([firstFlush, secondFlush]);

    expect(appendedIndices.length).toBe(2);
    expect(appendedIndices[0]).not.toBe(appendedIndices[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/tratt/src/app/core/shared/service/recording.service.spec.ts`
Expected: FAIL — `appendedIndices[0]` equals `appendedIndices[1]` (both `0`, since the increment doesn't happen until after each individual `await` resolves, and the second flush's synchronous prefix reads `this.pcmIndex` before the first flush's `await` — and therefore its own increment — has resolved).

- [ ] **Step 3: Write minimal implementation**

Change (inside `flushPcmPending()`, immediately before the `try` block containing `appendChunk`):

```typescript
    const index = this.pcmIndex;
    try {
      await this.persistence.appendChunk({
        sessionId: this.sessionId,
        index,
        kind: 'pcm',
        blob,
      });
      this.pcmIndex++;
      this.bumpChunkStats(blob.size);
    } catch (error) {
```

to:

```typescript
    const index = this.pcmIndex++;
    try {
      await this.persistence.appendChunk({
        sessionId: this.sessionId,
        index,
        kind: 'pcm',
        blob,
      });
      this.bumpChunkStats(blob.size);
    } catch (error) {
```

(Only the increment moved — `const index = this.pcmIndex; ... this.pcmIndex++;` inside the try's success path becomes `const index = this.pcmIndex++;` up front, and the old post-await increment line is deleted. `bumpChunkStats` and every other line stay exactly as they are. Note: on a failed append, the index is now "spent" — not reused by the retry — this is fine and expected, since `loadChunks` sorts by `index` value and does not require contiguity; a gap is harmless.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/tratt/src/app/core/shared/service/recording.service.spec.ts`
Expected: all tests (Phase 2's + this new one) PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/recording.service.ts apps/tratt/src/app/core/shared/service/recording.service.spec.ts
git commit -m "fix(recording): increment pcmIndex at queue time, not after the write

this.pcmIndex was read before the appendChunk await and only
incremented after it resolved, so two overlapping flushes (interval vs
stop()'s final flush) could read the same index and produce two chunks
with a duplicate [sessionId, index] pair. The compound index isn't
unique (confirmed against the Dexie schema — ++autoId is the real
primary key), so nothing throws, but loadChunks' stable sort on a
duplicate index can reorder the two chunks in the assembled file.
Increment synchronously at queue time instead — single-threaded JS
means two overlapping async calls can't interleave between two
synchronous statements, closing the race without needing an in-flight
flag or chained promise."
```

---

### Task 2: Add a separator when merging same-speaker SRT segments (B8)

**Files:**
- Modify: `libs/annotation/src/lib/converters/SRTConverter.ts`
- Test: `libs/annotation/src/lib/converters/SRTConverter.spec.ts` (already exists, from Phase 2 — append to it)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**The bug (confirmed by direct read of the current file):** in the same-speaker merge block (inside the `combineSegmentsWithSameSpeakerThreshold` handling):

```typescript
                const label = previousItem.getFirstLabelWithoutName('Speaker');
                if (label) {
                  label.value +=
                    nextItem.getFirstLabelWithoutName('Speaker')?.value ?? '';
                }
```

Direct string concatenation with no separator: if `previousItem`'s transcript is `"Hello"` and `nextItem`'s is `"world"`, the merged result is `"Helloworld"`.

- [ ] **Step 1: Write the failing test**

Append to `SRTConverter.spec.ts` (reuse its existing `audiofile()`/`srtFile()` helpers):

```typescript
describe('SRTConverter — same-speaker merge separator (B8)', () => {
  it('joins merged same-speaker segment text with a space, not a bare concatenation', () => {
    const c = new SRTConverter();
    const audio = audiofile(48000 * 10);
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      '[Alice]: Hello',
      '',
      '2',
      '00:00:01,000 --> 00:00:01,500',
      '',
      '',
      '3',
      '00:00:01,500 --> 00:00:02,500',
      '[Alice]: world',
      '',
    ].join('\n');

    const r = c.import(
      srtFile(srt),
      audio as any,
      new (c.defaultImportOptions.constructor as any)({
        combineSegmentsWithSameSpeakerThreshold: 2000,
      }),
    );
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items;
    const merged = items.find((it: any) =>
      it.labels?.some((l: any) => l.value?.includes('Hello')),
    );
    expect(merged.labels.find((l: any) => l.name !== 'Speaker')?.value).toBe(
      'Hello world',
    );
  });
});
```

Check `SRTConverterImportOptions`'s actual constructor/export shape before finalizing this test — the sketch above assumes it's importable and constructible with a partial options object (matching the class definition seen at the top of `SRTConverter.ts`: `constructor(partial?: Partial<SRTConverterImportOptions>) { if (partial) Object.assign(this, partial); }`); import `SRTConverterImportOptions` directly from `./SRTConverter` rather than reaching through `c.defaultImportOptions.constructor` if that's cleaner — adjust the test to whatever's idiomatic once you've read the actual exports. The core requirement is: import an SRT with two `[Alice]`-labeled cues separated by a short silent gap (within the combine threshold), and assert the merged transcript text has a space between the two original words, not a bare concatenation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run libs/annotation/src/lib/converters/SRTConverter.spec.ts` (from `libs/annotation`)
Expected: FAIL — merged value is `'Helloworld'`, not `'Hello world'`.

- [ ] **Step 3: Write minimal implementation**

Change:

```typescript
                const label = previousItem.getFirstLabelWithoutName('Speaker');
                if (label) {
                  label.value +=
                    nextItem.getFirstLabelWithoutName('Speaker')?.value ?? '';
                }
```

to:

```typescript
                const label = previousItem.getFirstLabelWithoutName('Speaker');
                if (label) {
                  const nextValue =
                    nextItem.getFirstLabelWithoutName('Speaker')?.value ?? '';
                  label.value = [label.value, nextValue]
                    .filter((v) => v !== '')
                    .join(' ');
                }
```

(Using `.filter(...).join(' ')` rather than a bare `+ ' ' +` avoids a leading/trailing space when either side is empty.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run libs/annotation/src/lib/converters/SRTConverter.spec.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/annotation/src/lib/converters/SRTConverter.ts libs/annotation/src/lib/converters/SRTConverter.spec.ts
git commit -m "fix(annotation): add a separator when merging same-speaker SRT segments

label.value += nextValue concatenated two segments' text with nothing
between them ('Helloworld'). Join with a space instead, skipping empty
sides so no stray leading/trailing space is introduced."
```

---

### Task 3: Fix 8-bit WAV decoding (silence was decoding to a full-scale square wave) (B9)

**Files:**
- Modify: `libs/web-media/src/lib/audio/audio-decoder.ts`
- Test: `libs/web-media/src/lib/audio/audio-decoder.spec.ts` (already exists, from Phase 2 — append to it)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `getChannelData`'s signature and behavior for 16/24/32-bit input are unchanged; only the 8-bit (`unsigned`) branch's math changes.

**The bug (confirmed by direct read of the current file):** `getChannelData` (private method) handles the 8-bit case as:

```typescript
      const maxNum = Math.pow(2, bitsPerSample) / 2;
      const unsigned = bitsPerSample === 8;

      let sign = unsigned ? -1 : 1;

      for (let i = 0; i < duration; i++) {
        let entry = data[i];
        ...
        if (unsigned) {
          entry = entry / 2;
        }

        result[i] = (entry / maxNum) * sign;
        ...
        if (unsigned) {
          sign = sign * -1;
        }
```

For 8-bit WAV (unsigned bytes, 0-255, with 128 as the silence midpoint), the correct conversion is `(byte - 128) / 128`. The current code instead halves the raw byte (`entry / 2`) and multiplies by an alternating `sign` that flips every sample. For silence (every byte = 128): `entry = 64`, `result[i] = (64/128) * sign = 0.5 * sign` — and since `sign` starts at `-1` and flips every iteration, silence decodes to `[-0.5, 0.5, -0.5, 0.5, ...]`, a full-scale square wave instead of near-zero.

- [ ] **Step 1: Write the failing test**

Append to `audio-decoder.spec.ts` (reuse whatever minimal `AudioDecoder` construction pattern Task 3 of Phase 2 already established in this file — check the existing `new AudioDecoder(...)` call and its polyfills for `Worker`/`URL.createObjectURL`, and reuse them):

```typescript
describe('AudioDecoder 8-bit WAV decode (B9)', () => {
  it('decodes 8-bit silence (byte value 128) to near-zero, not an alternating square wave', () => {
    const decoder = new AudioDecoder(
      'wav' as any,
      { sampleRate: 8000, duration: { samples: 4 } } as any,
      new ArrayBuffer(8),
    );
    const silence = new Uint8Array([128, 128, 128, 128]);
    const result = (decoder as any).getChannelData(silence, 4, 8);
    return result.then((floatData: Float32Array) => {
      for (const sample of floatData) {
        expect(Math.abs(sample)).toBeLessThan(0.01);
      }
    });
  });
});
```

Adjust the `AudioDecoder` constructor args and the `getChannelData` call's exact param shapes to match what Task 3's already-established test in this same file actually uses if the sketch above doesn't line up (e.g. if `AudioInfo`'s minimal valid shape differs, or if `getChannelData`'s `data` param needs a different typed-array wrapper than a bare `Uint8Array`) — the point of the test is calling the real private `getChannelData` method with an all-128-bytes 8-bit input and asserting the output is near-zero, not alternating ±0.5.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web-media -- --run src/lib/audio/audio-decoder.spec.ts`
Expected: FAIL — samples alternate between approximately `-0.5` and `0.5`, well outside the `0.01` tolerance.

- [ ] **Step 3: Write minimal implementation**

Change:

```typescript
      const maxNum = Math.pow(2, bitsPerSample) / 2;
      const unsigned = bitsPerSample === 8;

      let sign = unsigned ? -1 : 1;

      for (let i = 0; i < duration; i++) {
        let entry = data[i];

        if (isNaN(entry)) {
          console.error(`entry is NaN at ${i}`);
          break;
        }
        if (unsigned) {
          entry = entry / 2;
        }

        result[i] = (entry / maxNum) * sign;
        const t = result[i];
        if (result[i] > 1) {
          console.error(`entry greater than 1: ${result[i]} at ${i}`);
          break;
        }
        if (unsigned) {
          sign = sign * -1;
        }
```

to:

```typescript
      const maxNum = Math.pow(2, bitsPerSample) / 2;
      const unsigned = bitsPerSample === 8;

      for (let i = 0; i < duration; i++) {
        let entry = data[i];

        if (isNaN(entry)) {
          console.error(`entry is NaN at ${i}`);
          break;
        }
        if (unsigned) {
          entry = entry - maxNum;
        }

        result[i] = entry / maxNum;
        const t = result[i];
        if (result[i] > 1) {
          console.error(`entry greater than 1: ${result[i]} at ${i}`);
          break;
        }
```

(Removes the `sign` variable and its per-sample toggle entirely — for 8-bit, `entry - maxNum` (i.e. `entry - 128`) centers the unsigned byte around zero, matching the signed 16/24/32-bit path's `result[i] = entry / maxNum` exactly, no special-casing needed beyond the centering subtraction. `maxNum` is already `128` for `bitsPerSample === 8`, so `entry - maxNum` is exactly `entry - 128`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web-media -- --run src/lib/audio/audio-decoder.spec.ts`
Expected: all tests PASS. Also run the full `web-media` suite (`npx nx test web-media -- --run`) to confirm the 16/24/32-bit path (unaffected by this change, since `unsigned` is only ever true for 8-bit) has no regression.

- [ ] **Step 5: Commit**

```bash
git add libs/web-media/src/lib/audio/audio-decoder.ts libs/web-media/src/lib/audio/audio-decoder.spec.ts
git commit -m "fix(web-media): correct 8-bit WAV sample conversion

The unsigned (8-bit) branch halved the raw byte and multiplied by a
sign that flipped every sample, instead of centering the byte around
its 128 midpoint. Silence (byte 128) decoded to an alternating
[-0.5, 0.5, ...] full-scale square wave. Use (entry - 128) / 128,
matching the signed path's entry / maxNum shape with just the
centering subtraction added."
```

---

### Task 4: Unsubscribe the prior sending-modal timer before reassigning (C7)

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.ts`
- Test (new file): `apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**The bug (confirmed by direct read of the current file):** `onAnnotationSend$`'s `exhaustMap` callback (for `LoginMode.ONLINE`) does:

```typescript
          this.transcrSendingModal.timeout = timer(2000).subscribe({
            next: () => {
              this.transcrSendingModal.ref = this.modalsService.openModalRef(
                TranscriptionSendingModalComponent,
                TranscriptionSendingModalComponent.options,
              );
              ...
```

with no `this.transcrSendingModal.timeout?.unsubscribe();` before the reassignment — the exact same class of bug as Phase 2's C3 (`html-audio-mechanism.ts`'s `_playbackEndChecker`). If a network failure (status 0) or similar error causes the outer `exhaustMap` to complete/error and accept a new `sendOnlineAnnotation.do` before the *first* attempt's 2-second timer has fired, the first timer is orphaned (never fires its intended "show sending modal" callback at the right time relative to the second attempt) and reassigning `this.transcrSendingModal.timeout` loses the only reference to it — it keeps running and can still fire its `next` callback later, opening a stray second "sending" modal.

- [ ] **Step 1: Write the failing test**

`annotation-save.effects.ts` has no existing `.spec.ts`. Follow the same `provideMockActions`/`provideMockStore` pattern already established in this repo (`authentication.effects.spec.ts`, `annotation-load.effects.spec.ts`, `idb-effects.service.spec.ts` from Phase 2) — read `AnnotationSaveEffects`'s constructor first (7 params: `Actions`, `Store<RootState>`, `OctraAPIService`, `AlertService`, `TrattModalService`, `TranslocoService`, `AnnotationPersistenceService`) and stub each minimally. Create `annotation-save.effects.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { TranslocoService } from '@jsverse/transloco';
import { ReplaySubject } from 'rxjs';
import { AlertService } from '../../../shared/service';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { AnnotationPersistenceService } from './annotation-persistence.service';
import { AnnotationSaveEffects } from './annotation-save.effects';
import { AnnotationActions } from './annotation.actions';
import { LoginMode, RootState } from '../index';

describe('AnnotationSaveEffects.onAnnotationSend$ timer unsubscribe (C7)', () => {
  let effects: AnnotationSaveEffects;
  let actions$: ReplaySubject<unknown>;

  const initialState = {
    application: { mode: LoginMode.ONLINE },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);

    TestBed.configureTestingModule({
      providers: [
        AnnotationSaveEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: OctraAPIService, useValue: {} },
        { provide: AlertService, useValue: { showAlert: () => undefined } },
        { provide: TrattModalService, useValue: { openModalRef: () => ({ componentInstance: {} }) } },
        { provide: TranslocoService, useValue: {} },
        { provide: AnnotationPersistenceService, useValue: {} },
      ],
    });

    effects = TestBed.inject(AnnotationSaveEffects);
  });

  it('unsubscribes the prior pending sending-modal timer before starting a new one', () => {
    const subscription = effects.onAnnotationSend$.subscribe();

    actions$.next(AnnotationActions.sendOnlineAnnotation.do({ mode: LoginMode.ONLINE }));
    const firstTimeout = (effects as any).transcrSendingModal.timeout;
    expect(firstTimeout.closed).toBe(false);

    actions$.next(AnnotationActions.sendOnlineAnnotation.do({ mode: LoginMode.ONLINE }));

    expect(firstTimeout.closed).toBe(true);

    subscription.unsubscribe();
  });
});
```

Read `AnnotationActions.sendOnlineAnnotation.do`'s actual payload shape before finalizing (confirmed elsewhere in this codebase as `{ mode: LoginMode }` — verify against `annotation.actions.ts` directly) and adjust. Also check whether `onAnnotationSend$`'s `exhaustMap` actually lets a second `sendOnlineAnnotation.do` through while the first is still "in flight" from the effect's perspective — since `exhaustMap` *ignores* new source emissions while the current inner observable is still active, you may need to make the *inner* observable complete/error between the two dispatches for the second one to be accepted (e.g. because the mocked `apiService`/whatever call inside the effect throws or completes synchronously with the minimal stubs above) — trace the actual control flow once you have the real file open, and if the effect's structure doesn't let a bare double-dispatch reach the second `timer(2000).subscribe()` call at all with these minimal stubs, adjust the test setup (not the production fix) until it does. The fix itself is one line; getting the test to actually exercise the reassignment path is the real work here — ask if you get stuck rather than guessing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.spec.ts`
Expected: FAIL — `firstTimeout.closed` is `false` after the second dispatch.

- [ ] **Step 3: Write minimal implementation**

Change:

```typescript
          this.transcrSendingModal.timeout = timer(2000).subscribe({
```

to:

```typescript
          this.transcrSendingModal.timeout?.unsubscribe();
          this.transcrSendingModal.timeout = timer(2000).subscribe({
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation-save.effects.spec.ts
git commit -m "fix(annotation): unsubscribe the prior sending-modal timer before reassigning

transcrSendingModal.timeout was reassigned without unsubscribing a
prior pending timer(2000) first — same class of bug as C3
(html-audio-mechanism.ts's _playbackEndChecker). A retry before the
first attempt's 2s timer fires orphans it, which can still open a
stray second 'sending' modal later."
```

---

### Task 5: Stop permanently silencing `missingPermission` after the first emission (C8)

**Files:**
- Modify: `apps/tratt/src/app/core/shared/service/audio.service.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**No automated test for this task**, for the same reason as Phase 2's Task 5 (B2): the only production code path that reaches this line is deep inside a real `AudioManager.create()` call reacting to a real `AudioMechanism`'s `missingPermission` event — itself only reachable through browser permission-denial machinery this environment cannot simulate meaningfully. Verify by code inspection and `tsc`, not a fabricated test double.

**The bug (confirmed by direct read of the current file):** inside `loadAudio`'s nested subscription:

```typescript
          manager.audioMechanism!.missingPermission.subscribe(() => {
            this.missingPermission.emit();
            this.missingPermission.complete();
          });
```

`this.missingPermission` is a public `EventEmitter<void>` (Angular's `EventEmitter` extends RxJS `Subject`). Calling `.complete()` on a `Subject` permanently ends it: no future `.next()`/`.emit()` calls will reach any current or future subscriber (a `Subject` immediately completes new subscriptions once it has completed). So the *first* permission loss in a session is delivered once, and every subsequent one — or any component that subscribes to `missingPermission` after the first loss — silently gets nothing.

- [ ] **Step 1: Apply the fix**

Change:

```typescript
          manager.audioMechanism!.missingPermission.subscribe(() => {
            this.missingPermission.emit();
            this.missingPermission.complete();
          });
```

to:

```typescript
          manager.audioMechanism!.missingPermission.subscribe(() => {
            this.missingPermission.emit();
          });
```

(Delete the `.complete()` call — nothing else changes. `EventEmitter` behaves correctly as a multi-emission notifier once nothing artificially completes it.)

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit -p apps/tratt/tsconfig.app.json` (or the repo's standard type-check script) and confirm no new type errors. Re-read the surrounding subscription to confirm no other code relies on `missingPermission` being completed after one emission (e.g. no `.pipe(take(1))`-style consumer that depended on the Subject self-terminating) — grep for other usages of `.missingPermission` across the app before committing.

- [ ] **Step 3: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/audio.service.ts
git commit -m "fix(audio): stop permanently silencing missingPermission after first emit

missingPermission.complete() ran right after the first .emit(),
permanently ending the EventEmitter (it extends RxJS Subject) — every
later permission loss in the same session, and any component that
subscribes after the first loss, silently received nothing.

No automated test: the only reachable production path is deep inside
a real AudioManager.create() reacting to a real AudioMechanism's
permission-denial event, which needs actual browser permission
machinery this environment can't simulate meaningfully. Verified by
code inspection and tsc; same category of exception as Phase 2's B2."
```

---

### Task 6: Resolve `selectSegment()`'s Promise on non-segment levels instead of hanging forever (C10)

**Files:**
- Modify: `apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts`
- Test (new file): `apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `selectSegment(index: number): Promise<AudioSelection | undefined>` — return type widens to include `undefined` (previously typed `Promise<AudioSelection>` but could already hang forever rather than ever actually violating that type at runtime; Task 7 in this same file consumes this).

**The bug (confirmed by direct read of the current file):** `selectSegment` (private method):

```typescript
  private selectSegment(index: number): Promise<AudioSelection> {
    return new Promise<AudioSelection>((resolve) => {
      if (
        this.annotationStoreService.currentLevel?.items &&
        this.annotationStoreService.currentLevel instanceof
          TrattAnnotationSegmentLevel
      ) {
        const segment = this.annotationStoreService.currentLevel.items[index];
        this.transcript =
          segment!.getFirstLabelWithoutName('Speaker')?.value ?? '';
        this.selectedIndex = index;
        this.segmentselected = true;
        let start = this.audioManager.createSampleUnit(0);
        if (index > 0) {
          start =
            this.annotationStoreService.currentLevel.items[index - 1]!.time;
        }
        resolve(new AudioSelection(start, segment!.time));
      }
    });
  }
```

`resolve(...)` is only called inside the `if (currentLevel instanceof TrattAnnotationSegmentLevel)` branch. If the current level is not a SEGMENT level (e.g. an EVENT level), the `if` is false and `resolve` is never called — the returned Promise hangs forever, so every `.then(...)` caller (two call sites in this file) never runs, meaning `audioChunkDown` never gets created and whatever runs inside those `.then` callbacks (including `editor.focus()`) never executes.

- [ ] **Step 1: Write the failing test**

`linear-editor.component.ts` has no existing `.spec.ts`. Create `linear-editor.component.spec.ts`, instantiating the component directly (bypassing Angular's `TestBed`/DI entirely — see this plan's Global Constraints for why this is safe for this class):

```typescript
import { describe, expect, it, jest } from '@jest/globals';
import { LinearEditorComponent } from './linear-editor.component';

function createComponent(currentLevel: any) {
  const annotationStoreService = { currentLevel } as any;
  const audio = { audiomanagers: [], audioManager: { createSampleUnit: (n: number) => ({ samples: n }) } } as any;
  const component = new LinearEditorComponent(
    audio,
    {} as any, // alertService
    annotationStoreService,
    {} as any, // shortcutService
    { markForCheck: () => undefined } as any, // cd
    {} as any, // uiService
    {} as any, // settingsService
    {} as any, // appStorage
  );
  (component as any).audioManager = audio.audioManager;
  return component;
}

describe('LinearEditorComponent.selectSegment resolves on non-segment levels (C10)', () => {
  it('resolves (with undefined) instead of hanging forever when currentLevel is not a SEGMENT level', async () => {
    const nonSegmentLevel = { items: [{}] }; // deliberately not a TrattAnnotationSegmentLevel instance
    const component = createComponent(nonSegmentLevel);

    const result = await Promise.race([
      (component as any).selectSegment(0),
      new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 200)),
    ]);

    expect(result).not.toBe('TIMED_OUT');
    expect(result).toBeUndefined();
  });
});
```

Check `LinearEditorComponent`'s actual imports needed (`TrattAnnotationSegmentLevel` for constructing a proper contrast fixture if useful, though the test above only needs a plain object that fails the `instanceof` check, which any non-`TrattAnnotationSegmentLevel` object satisfies) and adjust constructor stub shapes once you've read the file — the 8 constructor params are typed as concrete service classes; a bare `{}` cast to `any` is fine for services the method under test never touches (verify `selectSegment` only touches `annotationStoreService` and `audioManager`, per the code shown above, before assuming the other 6 stubs can stay empty).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts`
Expected: FAIL — the race resolves to `'TIMED_OUT'` (the Promise never settles within 200ms).

- [ ] **Step 3: Write minimal implementation**

Change:

```typescript
  private selectSegment(index: number): Promise<AudioSelection> {
    return new Promise<AudioSelection>((resolve) => {
      if (
        this.annotationStoreService.currentLevel?.items &&
        this.annotationStoreService.currentLevel instanceof
          TrattAnnotationSegmentLevel
      ) {
        const segment = this.annotationStoreService.currentLevel.items[index];
        this.transcript =
          segment!.getFirstLabelWithoutName('Speaker')?.value ?? '';
        this.selectedIndex = index;
        this.segmentselected = true;
        let start = this.audioManager.createSampleUnit(0);
        if (index > 0) {
          start =
            this.annotationStoreService.currentLevel.items[index - 1]!.time;
        }
        resolve(new AudioSelection(start, segment!.time));
      }
    });
  }
```

to:

```typescript
  private selectSegment(index: number): Promise<AudioSelection | undefined> {
    return new Promise<AudioSelection | undefined>((resolve) => {
      if (
        this.annotationStoreService.currentLevel?.items &&
        this.annotationStoreService.currentLevel instanceof
          TrattAnnotationSegmentLevel
      ) {
        const segment = this.annotationStoreService.currentLevel.items[index];
        this.transcript =
          segment!.getFirstLabelWithoutName('Speaker')?.value ?? '';
        this.selectedIndex = index;
        this.segmentselected = true;
        let start = this.audioManager.createSampleUnit(0);
        if (index > 0) {
          start =
            this.annotationStoreService.currentLevel.items[index - 1]!.time;
        }
        resolve(new AudioSelection(start, segment!.time));
      } else {
        resolve(undefined);
      }
    });
  }
```

Then find the two `.then((selection: AudioSelection) => {...})` call sites in this same file (grep `this.selectSegment(` — expect 2 matches) and change each callback's parameter type to `AudioSelection | undefined`, adding a guard at the top of each callback body: `if (!selection) return;` before the body proceeds to use `selection`. Read each call site's full body before editing — do not guess at what follows; only add the guard, do not restructure anything else in either callback.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts
git commit -m "fix(linear-editor): resolve selectSegment() on non-segment levels

resolve() was only called inside the SEGMENT-level branch — on any
other level type the returned Promise hung forever, so both call
sites' .then() callbacks (including the one that focuses the editor)
never ran. Resolve with undefined in the else branch and guard both
callers."
```

---

### Task 7: Guard `update()`'s dereference of `audioChunkDown` (C11)

**Files:**
- Modify: `apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts`
- Test: `apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts` (created by Task 6 — append to it)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**The bug (confirmed by direct read of the current file):** `update()` (public method):

```typescript
  public update() {
    this.segmentselected = false;
    this.audioChunkTop.startpos = this.audioChunkTop.time.start.clone();
    this.audioChunkDown!.startpos = this.audioChunkDown!.time.start.clone();
    this.cd.markForCheck();
  }
```

`this.audioChunkDown!` uses TypeScript's non-null assertion with no runtime guard — if `audioChunkDown` is genuinely `undefined` (no selection made yet), this throws `TypeError: Cannot read properties of undefined (reading 'startpos')` (or `'time'`) at runtime, despite `audioChunkTop` on the line above being dereferenced safely (implying it's always initialized, but `audioChunkDown` is not always initialized at the point `update()` can be called).

- [ ] **Step 1: Write the failing test**

Append to `linear-editor.component.spec.ts` (reuse `createComponent` from Task 6, or a similar minimal-stub pattern — `update()` only touches `this.audioChunkTop`, `this.audioChunkDown`, and `this.cd`):

```typescript
describe('LinearEditorComponent.update guards audioChunkDown (C11)', () => {
  it('does not throw when audioChunkDown is undefined', () => {
    const component = createComponent({ items: [] });
    (component as any).audioChunkTop = {
      startpos: undefined,
      time: { start: { clone: () => 'top-start' } },
    };
    (component as any).audioChunkDown = undefined;
    (component as any).cd = { markForCheck: () => undefined };

    expect(() => component.update()).not.toThrow();
  });

  it('still updates audioChunkDown.startpos when it is set', () => {
    const component = createComponent({ items: [] });
    (component as any).audioChunkTop = {
      startpos: undefined,
      time: { start: { clone: () => 'top-start' } },
    };
    (component as any).audioChunkDown = {
      startpos: undefined,
      time: { start: { clone: () => 'down-start' } },
    };
    (component as any).cd = { markForCheck: () => undefined };

    component.update();

    expect((component as any).audioChunkDown.startpos).toBe('down-start');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts`
Expected: the first new test FAILs — `component.update()` throws a `TypeError` since `audioChunkDown` is `undefined`. The second should already pass (establishing the no-regression baseline).

- [ ] **Step 3: Write minimal implementation**

Change:

```typescript
  public update() {
    this.segmentselected = false;
    this.audioChunkTop.startpos = this.audioChunkTop.time.start.clone();
    this.audioChunkDown!.startpos = this.audioChunkDown!.time.start.clone();
    this.cd.markForCheck();
  }
```

to:

```typescript
  public update() {
    this.segmentselected = false;
    this.audioChunkTop.startpos = this.audioChunkTop.time.start.clone();
    if (this.audioChunkDown) {
      this.audioChunkDown.startpos = this.audioChunkDown.time.start.clone();
    }
    this.cd.markForCheck();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts`
Expected: all tests (Task 6's + these 2) PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts apps/tratt/src/app/editors/linear-editor/linear-editor.component.spec.ts
git commit -m "fix(linear-editor): guard update()'s audioChunkDown dereference

this.audioChunkDown! asserted non-null with no runtime guard, unlike
the audioChunkTop line above it — a TypeError with no selection made
yet. Guard with a plain if, matching the pattern audioChunkTop's own
(always-initialized) safety implies was intended here too."
```

---

## Final Verification

After all seven tasks:

- [ ] `nx test tratt` (or `npx jest apps/tratt`) — full app suite green, modulo the 2 pre-existing unrelated failures already known on `main`
- [ ] `npx vitest run` from `libs/annotation` — pass count increases by 1 (Task 2's new test) over Phase 2's baseline / 8 pre-existing ENOENT converter-fixture failures (unrelated to this plan, present on `main`)
- [ ] `npx nx test web-media -- --run` — pass count increases by 1 (Task 3's new test) over Phase 2's baseline
- [ ] `npm run build:dev` — clean
- [ ] Use `superpowers:finishing-a-development-branch` to integrate

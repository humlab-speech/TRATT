# Review Remediation Phase 2: Silent-Loss and Broken-Feature Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the nine Tier-2 ("silent loss / broken feature / frequent annoyance", score 3/4) findings from the code review — recording data loss, a multi-line SRT truncation bug, a WebGPU transcription fallback that can corrupt or empty its own retry, an AudioContext leak, a playback-timer race, an undo/redo crash, a reproducible `validate()` crash, paused time baked into recordings, and shortcuts dying on every editor switch.

**Architecture:** Nine independent, single-concern bugfixes across `apps/tratt/src/app/core/shared/service/recording.service.ts`, `libs/web-media/src/lib/audio/{audio-mechanism,html-audio-mechanism,audio-decoder}.ts`, `apps/tratt/src/app/core/shared/service/local-transcription.service.ts`, `libs/annotation/src/lib/converters/SRTConverter.ts`, `apps/tratt/src/app/core/store/idb/idb-effects.service.ts`, `apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.ts`, and three editor components (`2D-editor`, `linear-editor`, `dictaphone-editor`). Unlike Phase 1, **no spec file exists yet for six of these nine files** — Tasks 1, 3, 5, 6, 7 each create new test scaffolding; Task 2 and Task 4 append to the spec files Tasks 1 and 3 create.

Every fix below was independently re-derived from the current source (not transcribed from the review doc's line numbers uninspected) — for six of the nine, a working reproduction was actually run (in Node or Jest) before this plan was written, and the fix verified to close it. Task 5 (B2) is the one exception: its trigger requires a real WebGPU-capable browser Worker, unavailable in this environment — see that task's own note on why it ships without an automated test, matching the review document's own caveat.

**Tech Stack:** Angular 19, RxJS, Jest (`nx test tratt` for the app), Vitest (`npx vitest run` from `libs/annotation` for the lib — only Task 6 touches the lib).

**Spec:** `REVIEW-FINDINGS 1.md` (repo root) — findings N3, B7, B1, C3, B2, B3, C12, C26, C14, cross-referenced against `docs/superpowers/plans/2026-09-01-review-remediation-roadmap.md` for why this is Phase 2's exact scope and how it was prioritized.

## Global Constraints

- Every fix must be the minimal change that closes the reproduced bug — no refactoring beyond what's needed, no touching adjacent code even if it looks similar.
- App tests (`apps/tratt`): Jest, `nx test tratt` or `npx jest apps/tratt/<path>`, `describe`/`expect`/`it` from `'@jest/globals'`.
- Lib tests (`libs/annotation`, Task 6 only): Vitest, `npx vitest run` from `libs/annotation`, `describe`/`expect`/`it` from `'vitest'`.
- jsdom (this repo's Jest environment) does not implement `AudioContext`, `MediaRecorder`, or `AudioWorkletNode`. Tasks 1, 2, 3, 4 each need a small local polyfill/stub scoped to their own spec file — follow the pattern already established in `apps/tratt/src/app/core/store/authentication/authentication.effects.spec.ts` (a `globalThis`-level polyfill guarded by `typeof ... === 'undefined'`, added once near the top of the spec file, not touching any shared jest config).
- Accessing a `private` class member from a test via `(instance as any).fieldName` is an accepted, already-used pattern in this codebase when the class has no other way to reach internal state needed for the test (e.g. `recording.service.ts`'s `pcmPending` has no public getter) — don't introduce a public getter/setter just to avoid this; that would be scope creep beyond the task's fix.
- After all nine tasks: `npm run build:dev` must be clean.
- Do not touch `docs/manual/` or any i18n files — out of scope for this plan.

---

### Task 1: Cap unbounded PCM retry and stop swallowing the final-flush error (N3)

**Files:**
- Modify: `apps/tratt/src/app/core/shared/service/recording.service.ts`
- Test (new file): `apps/tratt/src/app/core/shared/service/recording.service.spec.ts`

**Interfaces:**
- Consumes: `RecordingPersistenceService` (constructor dep — mock with `{ appendChunk: jest.fn() }`), `RecordingDevicesService` (constructor dep — mock with `{}`, unused by this task's code path).
- Produces: nothing new — `RecordingService`'s public API (`error$: Subject<Error>`, `stop(): Promise<RecordingResult>`) is unchanged; only the internal retry/error behavior changes.

**The bug (confirmed by direct read of the current file):**

1. `flushPcmPending()` (recording.service.ts:328-357) catches an `appendChunk` failure and does `this.pcmPending = [...pending, ...this.pcmPending];` — unconditionally re-merging the failed chunk back in, with **no size cap**. On a persistent IDB failure, every subsequent flush (every 2000ms — `TIMESLICE_MS`/`PCM_FLUSH_INTERVAL_MS`) re-merges the same growing array and re-attempts the same failing write: `O(n²)` work per flush, and the recording never stops itself.
2. `stop()` (recording.service.ts:190-197) does `await this.flushPcmPending();` as its final flush. If that fails, the `catch` block only `console.error`s — no `emitError`, no re-throw — so the caller of `stop()` never learns a chunk was dropped, and `stop()` proceeds to assemble the file from whatever chunks *did* persist.

The fix pattern already exists in this exact file: `bumpChunkStats()` (recording.service.ts:518-534) has a byte-cap check (`MAX_RECORDING_BYTES = 500 * 1024 * 1024`) that calls `this.emitError(new Error(...))` then `void this.stop().catch(() => undefined)` when the cap is hit. Reuse this idiom for the PCM-retry cap, at a much smaller cap (10 MB is enough headroom for the network hiccup this is meant to survive, per the review's "Decided fix").

- [ ] **Step 1: Write the failing tests**

Create `apps/tratt/src/app/core/shared/service/recording.service.spec.ts`:

```typescript
import { describe, expect, it, jest } from '@jest/globals';
import { RecordingService } from './recording.service';

function createService(appendChunk: jest.Mock) {
  const persistence = { appendChunk } as any;
  const devices = {} as any;
  return new RecordingService(persistence, devices);
}

describe('RecordingService PCM retry cap (N3)', () => {
  it('caps the retry buffer instead of growing it unboundedly on persistent IDB failure', async () => {
    const appendChunk = jest.fn().mockRejectedValue(new Error('IDB unavailable'));
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';

    // Simulate ~11 MB of PCM already queued (each Float32Array below is 1 MB).
    const oneMbSamples = new Float32Array(262144); // 262144 * 4 bytes = 1 MiB
    (service as any).pcmPending = Array.from({ length: 11 }, () => oneMbSamples);

    const errors: Error[] = [];
    service.error$.subscribe((e) => errors.push(e));

    await (service as any).flushPcmPending();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/exceeded|cap/i);
  });

  it('still retries (does not emit an error) when comfortably under the cap', async () => {
    const appendChunk = jest.fn().mockRejectedValue(new Error('transient'));
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';

    const smallSamples = new Float32Array(1000);
    (service as any).pcmPending = [smallSamples];

    const errors: Error[] = [];
    service.error$.subscribe((e) => errors.push(e));

    await (service as any).flushPcmPending();

    expect(errors.length).toBe(0);
    expect((service as any).pcmPending.length).toBe(1); // re-merged for next retry
  });
});

describe('RecordingService stop() surfaces a final-flush failure (N3)', () => {
  it('emits an error when the final flush inside stop() fails, instead of silently dropping the chunk', async () => {
    const appendChunk = jest.fn().mockRejectedValue(new Error('IDB unavailable'));
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';
    (service as any).pcmPending = [new Float32Array(10)];
    // Minimal state to let flushPcmPending's failure path run without needing
    // the rest of stop()'s machinery (media recorder, stream, etc.) — this
    // test calls flushPcmPending directly rather than the full stop(), since
    // stop() needs real MediaRecorder/AudioContext that jsdom doesn't provide.

    const errors: Error[] = [];
    service.error$.subscribe((e) => errors.push(e));

    await (service as any).flushPcmPending();

    expect(errors.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest apps/tratt/src/app/core/shared/service/recording.service.spec.ts`
Expected: the first test FAILs (`errors.length` is 0 — no cap exists yet); the second and third are consistent with current behavior and may already pass (they're establishing the *retry-continues-under-cap* baseline and probing whether an error is emitted on final-flush failure, which today it is not — the third test should also FAIL for the same reason as the first).

- [ ] **Step 3: Write minimal implementation**

In `recording.service.ts`, add a cap constant near the existing `MAX_RECORDING_BYTES` (line ~45):

```typescript
const MAX_PCM_RETRY_BYTES = 10 * 1024 * 1024; // 10 MB
```

Change `flushPcmPending()`'s catch block (currently lines 351-357):

```typescript
    } catch (error) {
      console.error(
        '[recording.service] failed to persist PCM chunk, will retry on next flush',
        error,
      );
      this.pcmPending = [...pending, ...this.pcmPending];
    }
```

to:

```typescript
    } catch (error) {
      const retryBytes =
        pending.reduce((s, a) => s + a.length, 0) * Float32Array.BYTES_PER_ELEMENT +
        this.pcmPending.reduce((s, a) => s + a.length, 0) * Float32Array.BYTES_PER_ELEMENT;
      if (retryBytes >= MAX_PCM_RETRY_BYTES) {
        this.emitError(
          new Error(
            'PCM recording data exceeded the retry cap after repeated persistence failures — stopping.',
          ),
        );
        return;
      }
      console.error(
        '[recording.service] failed to persist PCM chunk, will retry on next flush',
        error,
      );
      this.pcmPending = [...pending, ...this.pcmPending];
    }
```

(The cap check runs *before* re-merging, using the combined size of the chunk that just failed plus whatever's already queued — once that combined size would exceed the cap, stop re-merging and emit instead. This also directly fixes the `stop()`-swallows-the-error half of N3: `stop()`'s final flush now goes through this same catch block, so a persistent failure at stop-time also emits on `error$` instead of being silently dropped — no separate change needed in `stop()` itself.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/shared/service/recording.service.spec.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/recording.service.ts apps/tratt/src/app/core/shared/service/recording.service.spec.ts
git commit -m "fix(recording): cap unbounded PCM retry buffer on persistent IDB failure

flushPcmPending's catch block re-merged a failed chunk back into
pcmPending with no size limit, retrying every 2s forever and doing
O(n^2) work as the buffer grew — including inside stop()'s final flush,
where the same failure was silently swallowed (console.error only, no
emitError). Cap the retry buffer at 10MB and emit + stop once exceeded,
reusing the same emitError idiom bumpChunkStats already uses for the
500MB total-recording cap."
```

---

### Task 2: Stop capturing audio into the PCM buffer while paused (B7)

**Files:**
- Modify: `apps/tratt/src/app/core/shared/service/recording.service.ts`
- Test: `apps/tratt/src/app/core/shared/service/recording.service.spec.ts` (created by Task 1 — append to it)

**Interfaces:**
- Consumes: `RecordingService.state$: BehaviorSubject<RecordingState>` (already public).
- Produces: a new private method `handleWorkletMessage(samples: Float32Array): void`, extracted from the worklet's inline `onmessage` closure so it's directly callable from a test without a real `AudioWorkletNode`.

**The bug (confirmed by direct read of the current file):** `pause()` (recording.service.ts:178-181) only calls `this.mediaRecorder?.pause()` and sets `state$` to `'paused'`. The PCM worklet's message handler (recording.service.ts:314-319) is unconditional:

```typescript
    this.workletNode.port.onmessage = (ev: MessageEvent) => {
      const { samples } = ev.data as { samples: Float32Array };
      if (samples && samples.length) {
        this.pcmPending.push(samples);
      }
    };
```

It keeps pushing samples into `pcmPending` regardless of `state$`. Since the assembled WAV is built entirely from `pcmPending`/persisted PCM chunks (independent of `MediaRecorder`'s own pause state), paused time is captured and baked into the final recording.

- [ ] **Step 1: Write the failing test**

Append to `recording.service.spec.ts`:

```typescript
describe('RecordingService does not capture PCM while paused (B7)', () => {
  it('drops worklet samples that arrive while state$ is paused', () => {
    const service = createService(jest.fn());
    (service as any).pcmPending = [];

    service.state$.next('recording');
    (service as any).handleWorkletMessage(new Float32Array([1, 2, 3]));
    expect((service as any).pcmPending.length).toBe(1);

    service.state$.next('paused');
    (service as any).handleWorkletMessage(new Float32Array([4, 5, 6]));
    expect((service as any).pcmPending.length).toBe(1); // unchanged — paused sample dropped

    service.state$.next('recording');
    (service as any).handleWorkletMessage(new Float32Array([7, 8, 9]));
    expect((service as any).pcmPending.length).toBe(2); // resumes capturing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/tratt/src/app/core/shared/service/recording.service.spec.ts`
Expected: FAIL — `handleWorkletMessage` doesn't exist yet (the logic is still an inline closure), so this errors with `TypeError: (service as any).handleWorkletMessage is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `recording.service.ts`, extract the closure body into a private method and add the pause guard. Replace the current inline handler (lines 314-319):

```typescript
    this.workletNode.port.onmessage = (ev: MessageEvent) => {
      const { samples } = ev.data as { samples: Float32Array };
      if (samples && samples.length) {
        this.pcmPending.push(samples);
      }
    };
```

with:

```typescript
    this.workletNode.port.onmessage = (ev: MessageEvent) => {
      const { samples } = ev.data as { samples: Float32Array };
      this.handleWorkletMessage(samples);
    };
```

and add the new private method near `flushPcmPending` (e.g. directly above it):

```typescript
  private handleWorkletMessage(samples: Float32Array): void {
    if (samples && samples.length && this.state$.value !== 'paused') {
      this.pcmPending.push(samples);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/tratt/src/app/core/shared/service/recording.service.spec.ts`
Expected: all 4 tests (3 from Task 1, 1 new) PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/recording.service.ts apps/tratt/src/app/core/shared/service/recording.service.spec.ts
git commit -m "fix(recording): stop capturing PCM samples while paused

pause() only paused the MediaRecorder; the AudioWorkletNode's message
handler kept pushing samples into pcmPending unconditionally, so paused
time was baked into the assembled WAV. Extract the handler into
handleWorkletMessage() and skip pushing while state\$ is 'paused'."
```

---

### Task 3: Stop leaking AudioContexts on every prepare()/decode (B1)

**Files:**
- Modify: `libs/web-media/src/lib/audio/audio-mechanism.ts`
- Modify: `libs/web-media/src/lib/audio/audio-decoder.ts`
- Test (new file): `libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts`
- Test (new file): `libs/web-media/src/lib/audio/audio-decoder.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `initAudioContext()`'s signature and every caller are unchanged; it now reuses an existing open context instead of always creating one. `AudioDecoder`'s public surface is unchanged (the `audioContext` field is unused today — confirmed by `grep -rn "this.audioContext"` returning only its own assignment — so deleting it changes no external behavior).

**The bug (confirmed by direct read of the current files):**

1. `AudioMechanism.initAudioContext()` (audio-mechanism.ts:91-99) unconditionally does `this._audioContext = new audioContext();` with no guard. `AudioMechanism.prepare()` (line 74-80, the base class's own entry point) calls it unconditionally on every call. `HtmlAudioMechanism` overrides `prepare()` (html-audio-mechanism.ts:72) and never calls `super.prepare()`; instead its override calls both `prepareAudioChannel()` (which calls `initAudioContext()` again at line ~253, inside a decode `Observable`) and `prepareAudioPlayback()` (which calls it again, unconditionally, at line 112) — so a single `prepare()` on an `HtmlAudioMechanism` instance creates **two** new `AudioContext`s, keeping only the second in `_audioContext` and leaking the first (never `.close()`d). The one caller that *does* guard (`play()`, audio-mechanism.ts:117-123: `if (this._audioContext === undefined || this._audioContext.state === 'closed') { this.initAudioContext(); }`) proves the intended discipline was meant to live at the call site — moving the guard *inside* `initAudioContext()` itself closes the gap for every caller at once, including the two unguarded ones.
2. `AudioDecoder`'s constructor (audio-decoder.ts:68-69) creates `this.audioContext = new (...)()` and never uses `this.audioContext` anywhere else in the class (confirmed: it's the only occurrence of that identifier in the file) — dead code, never closed, one leaked context per `AudioDecoder` instantiation.

- [ ] **Step 1: Write the failing tests**

Create `libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts`:

```typescript
import { describe, expect, it, jest } from '@jest/globals';
import { HtmlAudioMechanism } from './html-audio-mechanism';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'running' | 'closed' = 'running';
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  close = jest.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  resume = jest.fn(() => Promise.resolve());
  createMediaElementSource = jest.fn(() => ({ connect: jest.fn() }));
}

describe('AudioMechanism.initAudioContext reuses an open context (B1)', () => {
  it('does not leak a second AudioContext when called twice in a row', () => {
    FakeAudioContext.instances = [];
    (globalThis as any).AudioContext = FakeAudioContext;
    const mechanism = new HtmlAudioMechanism();

    (mechanism as any).initAudioContext();
    (mechanism as any).initAudioContext();

    const openInstances = FakeAudioContext.instances.filter(
      (i) => i.state !== 'closed',
    );
    expect(openInstances.length).toBe(1);
  });

  it('does create a fresh context if the previous one was closed', () => {
    FakeAudioContext.instances = [];
    (globalThis as any).AudioContext = FakeAudioContext;
    const mechanism = new HtmlAudioMechanism();

    (mechanism as any).initAudioContext();
    (mechanism as any)._audioContext.state = 'closed';
    (mechanism as any).initAudioContext();

    expect(FakeAudioContext.instances.length).toBe(2);
  });
});
```

Create `libs/web-media/src/lib/audio/audio-decoder.spec.ts` (check the exact constructor params by reading `audio-decoder.ts`'s constructor signature before writing this — it takes `format`, `audioInfo`, `arrayBuffer` per the class definition at the top of the file):

```typescript
import { describe, expect, it, jest } from '@jest/globals';
import { AudioDecoder } from './audio-decoder';

describe('AudioDecoder does not create an unused AudioContext (B1)', () => {
  it('never constructs an AudioContext', () => {
    const ctorSpy = jest.fn();
    class SpyAudioContext {
      constructor() {
        ctorSpy();
      }
    }
    (globalThis as any).AudioContext = SpyAudioContext;

    new AudioDecoder(
      'wav' as any,
      { sampleRate: 48000, duration: { samples: 100 } } as any,
      new ArrayBuffer(8),
    );

    expect(ctorSpy).not.toHaveBeenCalled();
  });
});
```

If `AudioInfo`'s actual shape requires more fields than `{ sampleRate, duration: { samples } }` for the constructor to run without throwing, read `audio-decoder.ts`'s constructor body and the `AudioInfo` type to find the minimal valid shape — the test only needs to get past construction, not exercise decoding.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test web-media -- --run src/lib/audio/html-audio-mechanism.spec.ts src/lib/audio/audio-decoder.spec.ts`
Expected: the first `html-audio-mechanism` test FAILs (`openInstances.length` is 2, not 1 — no guard yet). The `audio-decoder` test FAILs (`ctorSpy` was called once — the dead context is still constructed).

- [ ] **Step 3: Write minimal implementation**

In `libs/web-media/src/lib/audio/audio-mechanism.ts`, change `initAudioContext()` (lines 91-99):

```typescript
  protected initAudioContext() {
    const audioContext =
      window.AudioContext || // Default
      window.webkitAudioContext || // Safari and old versions of Chrome
      window.mozAudioContext ||
      false;
    if (audioContext) {
      this._audioContext = new audioContext();
    }
  }
```

to:

```typescript
  protected initAudioContext() {
    if (this._audioContext !== undefined && this._audioContext.state !== 'closed') {
      return;
    }
    const audioContext =
      window.AudioContext || // Default
      window.webkitAudioContext || // Safari and old versions of Chrome
      window.mozAudioContext ||
      false;
    if (audioContext) {
      this._audioContext = new audioContext();
    }
  }
```

In `libs/web-media/src/lib/audio/audio-decoder.ts`, delete the dead `audioContext` field and its assignment. Remove line 39 (`private audioContext: AudioContext;`) and lines 68-69 (`this.audioContext = new ((window as any).AudioContext || (window as any).webkitAudioContext)();`) — read the surrounding constructor first to confirm no blank-line cleanup is needed beyond removing those exact lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test web-media -- --run src/lib/audio/html-audio-mechanism.spec.ts src/lib/audio/audio-decoder.spec.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/web-media/src/lib/audio/audio-mechanism.ts libs/web-media/src/lib/audio/audio-decoder.ts libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts libs/web-media/src/lib/audio/audio-decoder.spec.ts
git commit -m "fix(web-media): stop leaking AudioContexts on repeated prepare()/decode

initAudioContext() always created a new AudioContext even when a live
one already existed — HtmlAudioMechanism.prepare() calls it twice per
load (once via prepareAudioChannel, once via prepareAudioPlayback), so
every load orphaned the first one. Guard inside initAudioContext()
itself so every caller benefits. Also delete AudioDecoder's own
AudioContext field, confirmed dead code (never read anywhere in the
class) that leaked one context per decoder instance."
```

---

### Task 4: Unsubscribe the previous playback-end timer before creating a new one (C3)

**Files:**
- Modify: `libs/web-media/src/lib/audio/html-audio-mechanism.ts`
- Test: `libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts` (created by Task 3 — append to it)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `initPlayback`'s signature (a private arrow-function class field, called only via the `canplay` DOM listener) is unchanged.

**The bug (confirmed by direct read of the current file, and by the review's own corrected framing — do not "fix" listener add/remove symmetry, it's already a DOM no-op since the handlers are same-reference class-field arrow functions):** `initPlayback` (html-audio-mechanism.ts:541-559) unconditionally reassigns:

```typescript
    this._playbackEndChecker = timer(
      Math.round(this.audioSelection.duration.unix / this._playbackRate),
    ).subscribe({
      next: this.onEnd,
    });
```

with no `this._playbackEndChecker?.unsubscribe()` first. `initPlayback` runs on every `canplay` DOM event, which can re-fire during the same playback session (seek, buffering). If it fires twice, the *first* `_playbackEndChecker` subscription is orphaned (still running, its reference dropped) while the *second* becomes the tracked one — two live end-checkers, the first of which fires `onEnd` prematurely at its own (now-stale) scheduled time.

- [ ] **Step 1: Write the failing test**

Append to `html-audio-mechanism.spec.ts`:

```typescript
describe('HtmlAudioMechanism.initPlayback unsubscribes the prior end-checker (C3)', () => {
  it('closes the first _playbackEndChecker subscription when canplay re-fires', () => {
    const mechanism = new HtmlAudioMechanism();
    // Satisfy initPlayback's guards without going through the full play() flow.
    (mechanism as any)._audio = {};
    (mechanism as any).audioSelection = { duration: { unix: 10000 } };
    (mechanism as any)._playbackRate = 1;

    (mechanism as any).initPlayback();
    const firstChecker = (mechanism as any)._playbackEndChecker;
    expect(firstChecker.closed).toBe(false);

    (mechanism as any).initPlayback();

    expect(firstChecker.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test web-media -- --run src/lib/audio/html-audio-mechanism.spec.ts`
Expected: FAIL — `firstChecker.closed` is `false` after the second `initPlayback()` call (the first timer subscription is still live, orphaned but not unsubscribed).

- [ ] **Step 3: Write minimal implementation**

In `html-audio-mechanism.ts`, change `initPlayback` (lines 541-559):

```typescript
  private initPlayback = () => {
    if (!this._audio) {
      throw new Error(`AudioElement not initialized`);
    }
    if (!this.audioSelection) {
      throw new Error(`AudioSelection not initialized`);
    }
    if (!this._playbackRate) {
      throw new Error(`PlaybackRate not initialized`);
    }

    this.changeStatus(PlayBackStatus.PLAYING);

    this._playbackEndChecker = timer(
      Math.round(this.audioSelection.duration.unix / this._playbackRate),
    ).subscribe({
      next: this.onEnd,
    });
  };
```

to (only the added `this._playbackEndChecker?.unsubscribe();` line, right before the reassignment):

```typescript
  private initPlayback = () => {
    if (!this._audio) {
      throw new Error(`AudioElement not initialized`);
    }
    if (!this.audioSelection) {
      throw new Error(`AudioSelection not initialized`);
    }
    if (!this._playbackRate) {
      throw new Error(`PlaybackRate not initialized`);
    }

    this.changeStatus(PlayBackStatus.PLAYING);

    this._playbackEndChecker?.unsubscribe();
    this._playbackEndChecker = timer(
      Math.round(this.audioSelection.duration.unix / this._playbackRate),
    ).subscribe({
      next: this.onEnd,
    });
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test web-media -- --run src/lib/audio/html-audio-mechanism.spec.ts`
Expected: all tests (3 from Task 3, 1 new) PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/web-media/src/lib/audio/html-audio-mechanism.ts libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts
git commit -m "fix(web-media): unsubscribe the previous playback-end timer before reassigning

initPlayback (the canplay handler) reassigned _playbackEndChecker on
every fire without unsubscribing the prior one. canplay can re-fire
mid-session (seek, buffering), leaving two end-checker timers alive —
the orphaned first one still fires onEnd prematurely at its own stale
schedule. Listener add/remove symmetry is intentionally untouched: the
handlers are same-reference class-field arrow functions, so re-adding
them is already a DOM no-op, not a real defect."
```

---

### Task 5: Don't re-transfer an already-detached buffer on WebGPU→WASM fallback (B2)

**Files:**
- Modify: `apps/tratt/src/app/core/shared/service/local-transcription.service.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `startWorker`'s signature and every caller are unchanged; only the buffer given to `postMessage` changes.

**No automated test for this task.** This finding's trigger is a real `Worker` running with a real WebGPU backend that fails to initialize — `new Worker(new URL(...), { type: 'module' })` cannot run inside Jest/jsdom, and there is no WebGPU implementation available in this environment to fail on cue. The review document itself notes this: *"Status: valid (code-traced twice); runtime repro needs a real WebGPU browser — not available in this environment."* This plan reaches the same conclusion independently, by reading the same code. Verify this fix by code inspection and `tsc --noEmit`, not a test run — do not invent a test double for `Worker`/`postMessage` transfer semantics just to have a green checkmark; a fake that doesn't actually detach a buffer the way the real structured-clone algorithm does would prove nothing and would itself be a maintenance liability. If you disagree after reading the code and believe a meaningful test is feasible, stop and say so rather than writing one that doesn't actually exercise the transfer semantics.

**The bug (confirmed by direct read of the current file):** `startWorker()`'s final step (local-transcription.service.ts:218-225):

```typescript
    const message: WorkerTranscribeMessage = {
      type: 'transcribe',
      modelId: options.modelId,
      audio: mono,
      useWebGPU: options.useWebGPU,
      audioDurationS,
      ...(options.dtype ? { dtype: options.dtype } : {}),
      ...(options.language ? { language: options.language } : {}),
    };
    worker.postMessage(message, [mono.buffer]);
```

passes `mono.buffer` as a **transferable** — this detaches `mono`'s underlying `ArrayBuffer` in the main thread once the message is posted. On a WebGPU backend-load failure, the `onmessage` handler's fallback path (lines 139-166) calls `this.startWorker(subject, mono, oaudiofile, { ...options, useWebGPU: false }, audioDurationS, true)` — **the same `mono` reference**, whose buffer is already detached from the first `postMessage` call. The retry's own `worker.postMessage(message, [mono.buffer])` then attempts to transfer an already-detached `ArrayBuffer`, which throws `DataCloneError` in spec-compliant engines (or, in some implementations, silently posts a zero-length buffer) — exactly the failure mode the WASM fallback exists to avoid.

- [ ] **Step 1: Apply the fix**

In `local-transcription.service.ts`, change the final block of `startWorker()` (lines 218-225) from:

```typescript
    const message: WorkerTranscribeMessage = {
      type: 'transcribe',
      modelId: options.modelId,
      audio: mono,
      useWebGPU: options.useWebGPU,
      audioDurationS,
      ...(options.dtype ? { dtype: options.dtype } : {}),
      ...(options.language ? { language: options.language } : {}),
    };
    worker.postMessage(message, [mono.buffer]);
```

to:

```typescript
    // Clone before transferring: `mono` may be re-used by a WebGPU→WASM
    // retry (see the fallback branch above), and a transferred buffer is
    // detached in this thread once postMessage returns — transferring the
    // original would leave the retry with a detached buffer.
    const audioForTransfer = mono.slice();
    const message: WorkerTranscribeMessage = {
      type: 'transcribe',
      modelId: options.modelId,
      audio: audioForTransfer,
      useWebGPU: options.useWebGPU,
      audioDurationS,
      ...(options.dtype ? { dtype: options.dtype } : {}),
      ...(options.language ? { language: options.language } : {}),
    };
    worker.postMessage(message, [audioForTransfer.buffer]);
```

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit -p apps/tratt/tsconfig.app.json` (or the repo's standard type-check command if different — check `package.json` scripts) and confirm no new type errors. Re-read the fallback branch (lines 139-166) to confirm `mono` is still the original, never-transferred reference at the point of the retry call — it is, since `audioForTransfer` is a new local variable scoped to the end of `startWorker`, never reassigned back onto `mono`.

- [ ] **Step 3: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/local-transcription.service.ts
git commit -m "fix(transcription): clone audio buffer before transferring to the worker

postMessage(message, [mono.buffer]) detaches mono's buffer once posted.
The WebGPU-load-failure fallback retries with the same mono reference
via a recursive startWorker() call — its own postMessage then tries to
transfer an already-detached buffer (DataCloneError, or an empty
transcription depending on the engine). Clone with .slice() before
transfer so the original mono survives for the retry.

No automated test: this only reproduces with a real WebGPU-capable
Worker failing to initialize, which Jest/jsdom cannot provide. Verified
by code inspection and tsc; matches the review document's own
runtime-repro caveat."
```

---

### Task 6: Stop silently dropping all but the first line of a multi-line SRT cue (B3)

**Files:**
- Modify: `libs/annotation/src/lib/converters/SRTConverter.ts`
- Test (new file): `libs/annotation/src/lib/converters/SRTConverter.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `SRTConverter.import()`'s signature and return shape (`ImportResult`) are unchanged; only how much of each cue's text it captures changes.

**The bug (confirmed by direct read of the current file, and reproduced/fixed/verified in a standalone Node prototype before writing this task):** the cue-parsing regex (SRTConverter.ts:238-241) captures the transcript text with `(.*)\r?\n\r?` — JavaScript's `.` does not match `\n` without the `s` (dotAll) flag, and the regex is only constructed with `'g'` (line 246: `new RegExp(regexStr, 'g')`). For a cue with more than one text line, only the first line is captured; every line after it is left unconsumed, and — worse — this can prevent the *next* cue from being found at all, since `regex.exec` resumes scanning from wherever the previous match ended, which now lands mid-way through the orphaned lines rather than at the next cue's index number.

The verified fix: change the transcript group from `(.*)\r?\n\r?` to `([\s\S]*?)(?:\r?\n\r?\n|\r?\n?$)` — a non-greedy, newline-inclusive capture bounded by a blank line (the next cue's separator) or end-of-string. Prototyped against LF and CRLF fixtures with single-line, multi-line, and no-trailing-blank-line cues; all parsed correctly (all cues found, full multi-line text captured) where the current regex drops text and, in the worst case, fails to find subsequent cues at all.

- [ ] **Step 1: Write the failing tests**

Create `libs/annotation/src/lib/converters/SRTConverter.spec.ts`, modeled on `WebVTTConverter.spec.ts`'s fixture-building style in this same directory (`audiofile()`/file-builder helpers, `describe`/`it` from `'vitest'`):

```typescript
import { describe, expect, it } from 'vitest';
import { SRTConverter } from './SRTConverter';

const SR = 48000;

function audiofile(duration: number) {
  return {
    name: 'test.wav',
    size: 0,
    duration,
    sampleRate: SR,
    arraybuffer: undefined,
  };
}

function srtFile(content: string) {
  return { name: 'test.srt', type: 'text/srt', content, encoding: 'UTF-8' };
}

describe('SRTConverter — multi-line cues (B3)', () => {
  const c = new SRTConverter();
  const audio = audiofile(SR * 10); // 10 s

  it('keeps every line of a multi-line cue', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:02,000',
      'Line one',
      'Line two',
      '',
      '2',
      '00:00:02,000 --> 00:00:04,000',
      'Hello world',
      '',
    ].join('\n');

    const r = c.import(srtFile(srt), audio as any);
    expect(r.error).toBeUndefined();
    const items = r.annotjson!.levels[0].items;
    const texts = items
      .map((it: any) => it.labels?.[0]?.value)
      .filter((v: string | undefined) => v !== undefined && v !== '');
    expect(texts).toContain('Line one\nLine two');
    expect(texts).toContain('Hello world');
  });

  it('still parses the second cue after a multi-line first cue (regression: the old regex could fail to find it at all)', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:02,000',
      'Line one',
      'Line two',
      '',
      '2',
      '00:00:02,000 --> 00:00:04,000',
      'Second cue',
      '',
    ].join('\n');

    const r = c.import(srtFile(srt), audio as any);
    expect(r.error).toBeUndefined();
    const items = r.annotjson!.levels[0].items;
    const texts = items
      .map((it: any) => it.labels?.[0]?.value)
      .filter((v: string | undefined) => v !== undefined && v !== '');
    expect(texts.some((t: string) => t.includes('Second cue'))).toBe(true);
  });

  it('still parses a single-line cue correctly (no regression)', () => {
    const srt = ['1', '00:00:00,000 --> 00:00:02,000', 'Hello world', ''].join(
      '\n',
    );

    const r = c.import(srtFile(srt), audio as any);
    expect(r.error).toBeUndefined();
    const items = r.annotjson!.levels[0].items;
    const texts = items
      .map((it: any) => it.labels?.[0]?.value)
      .filter((v: string | undefined) => v !== undefined && v !== '');
    expect(texts).toContain('Hello world');
  });
});
```

If `r.annotjson!.levels[0].items[n].labels[0]` isn't the right accessor for the transcript label (e.g. if a padding/silence segment is inserted before the real content and shifts indices, matching the padding behavior `annotation.spec.ts` already covers in `@tratt/annotation`'s `TrattAnnotation.serialize()` tests from Phase 1), adjust the accessor after running the test once and inspecting the actual `items` array — the assertions on cue *text content* (`'Line one\nLine two'`, `'Second cue'`, `'Hello world'`) are the actual requirement; the exact array indexing is secondary and fine to adjust.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run libs/annotation/src/lib/converters/SRTConverter.spec.ts` (from `libs/annotation`)
Expected: the first test FAILs (`'Line two'` is missing from the captured text — only `'Line one'` survives). The second test's outcome depends on exactly how far the current regex's `lastIndex` drifts after the botched first match — it may also FAIL (second cue never found) or PASS by chance; either way, run it once against the *unfixed* code to record the actual baseline in your report. The third (single-line) test should already PASS — it establishes the no-regression baseline.

- [ ] **Step 3: Write minimal implementation**

In `SRTConverter.ts`, change the `regexStr` construction (lines 238-241) from:

```typescript
      const regexStr =
        `([0-9]+)[\\n\\r]*([0-9]{2}:[0-9]{2}:[0-9]{2}(?:,[0-9]{3})?) --> ` +
        `([0-9]{2}:[0-9]{2}:[0-9]{2}(?:,[0-9]{3})?)\\r?\\n\\r?` +
        `(.*)\\r?\\n\\r?`;
```

to:

```typescript
      const regexStr =
        `([0-9]+)[\\n\\r]*([0-9]{2}:[0-9]{2}:[0-9]{2}(?:,[0-9]{3})?) --> ` +
        `([0-9]{2}:[0-9]{2}:[0-9]{2}(?:,[0-9]{3})?)\\r?\\n\\r?` +
        `([\\s\\S]*?)(?:\\r?\\n\\r?\\n|\\r?\\n?$)`;
```

No other line in the file needs to change — `matches[4].replace(/(\n|\s)+$/g, '')` (the existing post-capture trim, line ~253) still runs on the (now potentially multi-line) captured group and continues to work as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run libs/annotation/src/lib/converters/SRTConverter.spec.ts`
Expected: all 3 tests PASS. Also run the full lib suite (`npx vitest run` from `libs/annotation`) to confirm no other converter test regresses.

- [ ] **Step 5: Commit**

```bash
git add libs/annotation/src/lib/converters/SRTConverter.ts libs/annotation/src/lib/converters/SRTConverter.spec.ts
git commit -m "fix(annotation): capture every line of a multi-line SRT cue

The cue-text capture group (.*) can't span newlines without the 's'
flag, which this regex never had — every line after the first in a
multi-line cue was silently dropped, and in some inputs the dropped
lines could also prevent the next cue from being found. Bound the
capture with [\\s\\S]*? up to the next blank-line separator or end of
string instead. Verified against LF and CRLF, single-line and
multi-line, with-and-without-trailing-blank-line fixtures before
writing this fix."
```

---

### Task 7: Guard the two remaining unguarded `audioManager.resource` reads in undo/redo (C12)

**Files:**
- Modify: `apps/tratt/src/app/core/store/idb/idb-effects.service.ts`
- Test (new file): `apps/tratt/src/app/core/store/idb/idb-effects.service.spec.ts`

**Interfaces:**
- Consumes: `AudioService.audioManager` getter (already exists — returns `undefined` when no audio is registered).
- Produces: nothing new — `saveAfterUndo$`/`saveAfterRedo` still dispatch `ApplicationActions.undoSuccess`/`redoSuccess`/`undoFailed`/`redoFailed` as before; only the new failure path (no audio loaded) is added.

**Scope correction from the review doc:** the review cites three unguarded sites (idb-effects.service.ts:273-275, 312-314, 828-829). Direct inspection found the **third site is already guarded** — `if (!this.audio.audioManager) { return of(IDBActions.saveAnnotation.success()); }` exists immediately before it (this is the exact idiom this task's fix reuses). Only the first two sites — `saveAfterUndo$` and `saveAfterRedo` — remain unguarded. This task fixes those two only.

**The bug (confirmed by direct read of the current file):** `saveAfterUndo$` (idb-effects.service.ts:258-297) and `saveAfterRedo` (idb-effects.service.ts:299-330) both call `this.audio.audioManager.resource.info.{fullname,sampleRate,duration}` as *arguments* to `modeState.transcript.serialize(...)`, evaluated eagerly inside the `exhaustMap`/`mergeMap` callback — **before** the `.pipe(catchError(...))` chain exists to catch anything. If `this.audio.audioManager` is `undefined` (no audio loaded — reachable via `ApplicationActions.undo`/`redo` before any audio has been registered), this throws a synchronous `TypeError` inside the projection function, which RxJS turns into an error on the effect's own outer subscription — the specific `undoFailed`/`redoFailed` action is never dispatched, and the effect's subscription itself can be torn down by NgRx's default effect-error handling, silently breaking all future undo/redo for the rest of the session.

- [ ] **Step 1: Write the failing tests**

Create `apps/tratt/src/app/core/store/idb/idb-effects.service.spec.ts`, following the `provideMockActions`/`provideMockStore` pattern already established in `apps/tratt/src/app/core/store/authentication/authentication.effects.spec.ts` and `apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { SessionStorageService } from 'ngx-webstorage';
import { ReplaySubject } from 'rxjs';
import { AudioService } from '../../shared/service';
import { RoutingService } from '../../shared/service/routing.service';
import { IDBService } from './idb.service';
import { ApplicationActions } from '../application/application.actions';
import { IDBEffects } from './idb-effects.service';
import { LoginMode, RootState } from '../index';

describe('IDBEffects undo/redo guards missing audio (C12)', () => {
  let effects: IDBEffects;
  let store: MockStore<RootState>;
  let actions$: ReplaySubject<unknown>;

  const initialState = {
    application: { mode: LoginMode.LOCAL },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);

    TestBed.configureTestingModule({
      providers: [
        IDBEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: { saveAnnotation: jest.fn() } },
        { provide: SessionStorageService, useValue: {} },
        { provide: RoutingService, useValue: {} },
        { provide: AudioService, useValue: { audioManager: undefined } },
      ],
    });

    effects = TestBed.inject(IDBEffects);
    store = TestBed.inject(MockStore);
  });

  it('dispatches undoFailed instead of throwing when no audio is loaded', (done) => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const subscription = effects.saveAfterUndo$.subscribe();

    actions$.next(ApplicationActions.undo());

    setTimeout(() => {
      expect(
        dispatchSpy.mock.calls.some(
          ([a]) => (a as any).type === ApplicationActions.undoFailed.type,
        ),
      ).toBe(true);
      subscription.unsubscribe();
      done();
    }, 0);
  });

  it('dispatches redoFailed instead of throwing when no audio is loaded', (done) => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const subscription = effects.saveAfterRedo.subscribe();

    actions$.next(ApplicationActions.redo());

    setTimeout(() => {
      expect(
        dispatchSpy.mock.calls.some(
          ([a]) => (a as any).type === ApplicationActions.redoFailed.type,
        ),
      ).toBe(true);
      subscription.unsubscribe();
      done();
    }, 0);
  });
});
```

`getModeState(appState)` (used internally by both effects to build `modeState`) needs to return a truthy value for these effects to reach the `audioManager` check at all — if the minimal `initialState` above isn't enough (read `getModeState`'s implementation in `../index` if the test fails with `modeState` falsy rather than the expected TypeError/guard behavior) — extend `initialState` with whatever `getModeState` needs for `LoginMode.LOCAL` (likely a `localMode` slice with a `transcript` on it), matching the shape `annotation.reducer.spec.ts`'s `buildState()` helper constructs from Phase 1, but keep it to the minimum this test's path actually reads.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest apps/tratt/src/app/core/store/idb/idb-effects.service.spec.ts`
Expected: both FAIL — either the test times out / never sees `undoFailed`/`redoFailed` dispatched (the effect throws instead), or an unhandled `TypeError` surfaces in the test run, depending on how RxJS's default effect error path behaves in this harness. Either failure mode is expected and correct for this stage: it demonstrates the guard doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `idb-effects.service.ts`, add a guard to `saveAfterUndo$` (currently lines 258-297) right after `if (modeState) {` (line 266):

```typescript
        if (modeState) {
          if (!this.audio.audioManager) {
            return of(
              ApplicationActions.undoFailed({
                error: 'No audio loaded — cannot save undo state.',
              }),
            );
          }

          const links = modeState.transcript.links.map((a) => a.link);
          // ...rest of the existing block unchanged...
```

and the same shape in `saveAfterRedo` (currently lines 299-330), after its own `if (modeState) {`:

```typescript
        if (modeState) {
          if (!this.audio.audioManager) {
            return of(
              ApplicationActions.redoFailed({
                error: 'No audio loaded — cannot save redo state.',
              }),
            );
          }

          return this.idbService
          // ...rest of the existing block unchanged...
```

(This matches the exact idiom already used at the third, already-fixed site: `if (!this.audio.audioManager) { return of(...); }` before any `.resource` access.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/store/idb/idb-effects.service.spec.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/idb/idb-effects.service.ts apps/tratt/src/app/core/store/idb/idb-effects.service.spec.ts
git commit -m "fix(idb): guard undo/redo saves against missing audioManager

saveAfterUndo\$ and saveAfterRedo read this.audio.audioManager.resource
eagerly, before any catchError exists to catch a TypeError if no audio
is loaded — the specific undoFailed/redoFailed action was never
dispatched, and the effect's own subscription could be torn down,
silently breaking undo/redo for the rest of the session. Guard both
with the same 'return of(...Failed(...))' idiom the third
audioManager.resource site in this file already uses."
```

---

### Task 8: Fix the reproducible crash in `validate()` at adjacent boundary markers (C26)

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.ts`
- Test: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.spec.ts` (already exists — append to its `describe('validate', ...)` block)

**Interfaces:**
- Consumes: nothing new — reuses the existing spec file's `(global as any).validateAnnotation = jest.fn().mockReturnValue([...])` mocking pattern (see the existing test `'delegates to the global validateAnnotation and filters selection-range hits'` in the same file) and its `createService()`/`guidelines` fixtures already defined at the top of the spec file.
- Produces: nothing new — `validate()`'s signature and return type are unchanged; only the internal double-splice crash is fixed.

**The bug (reproduced in a standalone Jest spec before writing this task; the exact crash was triggered, observed, fixed, and reverted for the real task to redo under proper TDD):** `validate()`'s outer `for` loop (annotation-text-processing.service.ts:50-81) reads `const validation = results[i]` once per outer iteration, then runs an inner `while (match != undefined)` loop over `segRegex` matches (lines 68-80) that can `results.splice(i, 1); i--;` **without breaking** — so if the same (stale) `validation` object satisfies the boundary-range check against a *second* regex match in the same inner-loop pass (this happens at the junction of two adjacent boundary markers, e.g. `{123}{456}`, because the range check's `<=` allows the validation to sit exactly on the shared edge), it splices a **second** time. Since `i` was already decremented once, this second splice removes a *different*, unrelated element — not a further reference to the (already-removed) original. If this drops `results` down to zero elements, `i` goes negative and the outer `for` loop's `i < results.length` condition (`-1 < 0`) is still true on the next iteration, so `results[i]` reads as `undefined` — and if the sel-start/sel-end markers are present in `rawText` (`sPos > -1 && ePos > -1`), the very next line dereferences `validation.start` on that `undefined`, throwing `TypeError: Cannot read properties of undefined (reading 'start')` and crashing the entire `validate()` call, not just producing a wrong result.

Confirmed by direct reproduction: `rawText` containing both sel-start and sel-end markers plus `'{123}{456}'`, with a mocked `validateAnnotation` returning `[{ start: <the exact junction offset between the two boundary markers>, length: 0, code: 'E1' }, { start: <far outside>, length: 1, code: 'E2' }]`, throws exactly this `TypeError` at `annotation-text-processing.service.ts:57` on the unfixed code. Adding `break;` immediately after `results.splice(i, 1); i--;` inside the `while` loop (so the loop exits instead of re-checking the stale `validation` against the next match) closes it: the same input then returns `[{ start: <far outside>, length: 1, code: 'E2' }]` with no throw — the unrelated second result correctly survives, only the junction-matching one is removed.

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('validate', ...)` block in `annotation-text-processing.service.spec.ts` (reuse the file's existing `createService()` and `guidelines` from its module scope):

```typescript
    it('does not crash on a zero-length validation at the junction of two adjacent boundary markers, and does not drop an unrelated result (C26)', () => {
      const rawText =
        '✉✉✉sel-start/📩📩📩' + 'a{123}{456}b' + '✉✉✉sel-end/📩📩📩';
      const junctionStart = rawText.indexOf('{123}{456}') + 5; // the '}' / '{' junction

      (global as any).validateAnnotation = jest.fn().mockReturnValue([
        { start: junctionStart, length: 0, code: 'E1' },
        { start: rawText.length - 2, length: 1, code: 'E2' }, // unrelated, near the end
      ]);
      const service = createService();

      let result: any[] = [];
      expect(() => {
        result = service.validate(rawText, guidelines);
      }).not.toThrow();

      expect(result.some((r) => r.code === 'E2')).toBe(true);
      expect(result.some((r) => r.code === 'E1')).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.spec.ts`
Expected: FAIL — `service.validate(...)` throws `TypeError: Cannot read properties of undefined (reading 'start')`.

- [ ] **Step 3: Write minimal implementation**

In `annotation-text-processing.service.ts`, add `break;` after the splice inside the `while` loop (currently lines 74-77):

```typescript
        if (
          validation.start >= match.index &&
          validation.start + validation.length <= match.index + match[0].length
        ) {
          // remove
          results.splice(i, 1);
          i--;
        }

        match = segRegex.exec(rawText);
```

to:

```typescript
        if (
          validation.start >= match.index &&
          validation.start + validation.length <= match.index + match[0].length
        ) {
          // remove
          results.splice(i, 1);
          i--;
          break;
        }

        match = segRegex.exec(rawText);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.spec.ts`
Expected: all tests in the file PASS (17 existing + 1 new = 18), no throw, `E2` survives, `E1` is correctly removed.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation-text-processing.service.spec.ts
git commit -m "fix(annotation): stop validate() from crashing at adjacent boundary markers

The inner while loop over segment-boundary regex matches could splice
results[i] a second time against the same stale 'validation' reference
after already removing it once, if a zero-length validation sat at the
exact junction of two adjacent {N}{M} boundary markers — over-splicing
an unrelated result, driving the outer loop's index negative, and
crashing on the next iteration's validation.start dereference. Break
out of the while loop right after the first splice instead of
continuing to check the stale reference against further matches."
```

---

### Task 9: Stop wiping every registered shortcut group when an editor is destroyed (C14)

**Files:**
- Modify: `apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts`
- Modify: `apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts`
- Modify: `apps/tratt/src/app/editors/dictaphone-editor/dictaphone-editor.component.ts`
- Test (new file): `apps/tratt/src/app/core/shared/service/shortcut.service.spec.ts`

**Interfaces:**
- Consumes: `ShortcutService.unregisterShortcutGroup(name: string): boolean` (already exists at `shortcut.service.ts:34-36`; already used by `dictaphone-editor.component.ts:228` for a different purpose — re-registering its own group on init).
- Produces: nothing new — no new public methods; each editor's `ngOnDestroy` now calls `unregisterShortcutGroup` once per group it itself registered, instead of the global `destroy()`.

**The bug (confirmed by direct read of all three files and of `ShortcutService`):** `ShortcutService._groups` (shortcut.service.ts:17) is a single app-wide array — shared by every editor, the navbar, and any modal (e.g. the transcript-overview modal) that registers its own shortcut group. `ShortcutService.destroy()` (shortcut.service.ts:70-72) unconditionally does `this._groups = [];` — wiping *every* registered group, not just the calling editor's own. All three editors' `ngOnDestroy` call it:

- `2D-editor.component.ts:482`
- `linear-editor.component.ts:550`
- `dictaphone-editor.component.ts:243`

So switching away from any editor wipes shortcut groups belonging to unrelated parts of the app (e.g. an open overview modal's shortcuts go dead) — and, since navigating *to* a new editor doesn't re-register groups it never owned, they stay dead until a full page reload.

Each editor registers a fixed, enumerable set of groups on init — confirmed by reading each file's registration calls:

- **2D-editor** (4 groups): `'2D-Editor viewer'` (line 368), `'2D-Editor audio'` (line 373), `this.miniMagnifierShortcuts` → name `'mini magnifier'` (line 297, registered line 377), `this.windowShortcuts` → name `'transcription window'` (line 253, registered line 378).
- **linear-editor** (5 groups): `'signaldisplay_top_audio'` (line 473), `'signaldisplay_top'` (line 479), `'signaldisplay_down_audio'` (line 494), `'signaldisplay_down'` (line 499), `this.miniMagnifierShortcuts` → name `'mini magnifier'` (line 366, registered line 503).
- **dictaphone-editor** (1 group): `this.shortcuts` → name `'audioplayer'` (line 150, registered line 229).

`unregisterShortcutGroup(name)` already exists and does exactly the scoped removal needed: `this._groups = this._groups.filter((a) => a.name !== name);`.

- [ ] **Step 1: Write the failing test**

`ShortcutService` has no existing spec file. Create `apps/tratt/src/app/core/shared/service/shortcut.service.spec.ts` — this test exercises the *service*, not the editors themselves (verifying each editor's exact `ngOnDestroy` wiring end-to-end would need a full component harness for three different editor shells; the service-level test below directly proves the mechanism the fix relies on — that scoped removal leaves unrelated groups intact where global `destroy()` doesn't — which is the actual defect):

```typescript
import { describe, expect, it } from '@jest/globals';
import { ShortcutService } from './shortcut.service';

describe('ShortcutService.unregisterShortcutGroup scopes removal (C14)', () => {
  it('removes only the named group, leaving unrelated groups registered', () => {
    const service = new ShortcutService();
    service.registerShortcutGroup({ name: 'editor group', items: [] } as any);
    service.registerShortcutGroup({ name: 'overview modal', items: [] } as any);

    service.unregisterShortcutGroup('editor group');

    const names = service.groups.map((g: any) => g.name);
    expect(names).not.toContain('editor group');
    expect(names).toContain('overview modal');
  });

  it('destroy() (the old behavior) wipes everything, demonstrating why editors must not call it', () => {
    const service = new ShortcutService();
    service.registerShortcutGroup({ name: 'editor group', items: [] } as any);
    service.registerShortcutGroup({ name: 'overview modal', items: [] } as any);

    service.destroy();

    expect(service.groups.length).toBe(0);
  });
});
```

Check `ShortcutService`'s constructor and the `groups` getter's exact name/shape (`shortcut.service.ts:14`, `get groups()`) before finalizing — the sketch above assumes a no-arg constructor and a `groups` getter returning `_groups`; adjust only if either differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/tratt/src/app/core/shared/service/shortcut.service.spec.ts`
Expected: both tests should already PASS — `unregisterShortcutGroup` and `destroy()` both already behave correctly in isolation; this task's bug is in *which one the editors call*, not in the service itself. This step is a sanity check that the service-level primitives work as expected before touching the three editor files; if either test fails, stop and report — it would mean the service itself has a bug beyond C14's scope.

- [ ] **Step 3: Write minimal implementation**

In `apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts`, replace the single line `this.shortcutService.destroy();` (line 482) with:

```typescript
    this.shortcutService.unregisterShortcutGroup('2D-Editor viewer');
    this.shortcutService.unregisterShortcutGroup('2D-Editor audio');
    this.shortcutService.unregisterShortcutGroup(this.miniMagnifierShortcuts.name);
    this.shortcutService.unregisterShortcutGroup(this.windowShortcuts.name);
```

In `apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts`, replace `this.shortcutService.destroy();` (line 550) with:

```typescript
    this.shortcutService.unregisterShortcutGroup('signaldisplay_top_audio');
    this.shortcutService.unregisterShortcutGroup('signaldisplay_top');
    this.shortcutService.unregisterShortcutGroup('signaldisplay_down_audio');
    this.shortcutService.unregisterShortcutGroup('signaldisplay_down');
    this.shortcutService.unregisterShortcutGroup(this.miniMagnifierShortcuts.name);
```

In `apps/tratt/src/app/editors/dictaphone-editor/dictaphone-editor.component.ts`, replace `this.shortcutService.destroy();` (line 243) with:

```typescript
    this.shortcutService.unregisterShortcutGroup(this.shortcuts.name);
```

Do not change anything else in any of the three `ngOnDestroy` methods (the `audioManager.stopPlayback()` call and, for 2D-editor, the `clearInterval`/`scrolltimer.unsubscribe()` lines, stay exactly as they are).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/shared/service/shortcut.service.spec.ts` — expect the same 2 tests to pass (unchanged, this task didn't touch the service). Then run each editor's existing spec file, if any exists, to confirm no regression: check for and run `2D-editor.component.spec.ts`, `linear-editor.component.spec.ts`, `dictaphone-editor.component.spec.ts` — if none exist, `npm run build:dev` afterward is the regression check for these three files (this task doesn't add component-level tests; the service-level test is the regression guard for the mechanism, and the three edits are each a one-line-to-five-line mechanical swap directly traceable to the group names enumerated above).

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts apps/tratt/src/app/editors/linear-editor/linear-editor.component.ts apps/tratt/src/app/editors/dictaphone-editor/dictaphone-editor.component.ts apps/tratt/src/app/core/shared/service/shortcut.service.spec.ts
git commit -m "fix(editors): unregister only this editor's own shortcut groups on destroy

All three editors called shortcutService.destroy() in ngOnDestroy,
wiping ShortcutService's single app-wide _groups array — including
groups registered by unrelated parts of the app (e.g. an open overview
modal), which then stayed dead until a full reload. Each editor now
calls unregisterShortcutGroup() once per group it itself registered
(2D: 4, linear: 5, dictaphone: 1), reusing the same method
dictaphone-editor already uses elsewhere for re-registration."
```

---

## Final Verification

After all nine tasks:

- [ ] `nx test tratt` (or `npx jest apps/tratt`) — full app suite green, modulo the 2 pre-existing unrelated failures already known on `main` (`AutoTranscribeOptionsComponent` locale-default test, `TranscriptionFeedbackComponent` DI test)
- [ ] `npx vitest run` from `libs/annotation` — 45 pass (44 + Task 6's new suite) / 8 pre-existing ENOENT converter-fixture failures (unrelated to this plan, present on `main`, documented in Phase 1's plan)
- [ ] `npm run build:dev` — clean
- [ ] Use `superpowers:finishing-a-development-branch` to integrate

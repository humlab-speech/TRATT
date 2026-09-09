# External Eval Report Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two confirmed bugs from the external TRATT evaluation report (missing i18n key, playback-stop race condition) and get a reproducible root cause for the intermittent console errors before touching that code.

**Architecture:** Three independent tasks, no shared state between them — can be done in any order or in parallel by separate workers.
1. Add a missing translation key across all 7 locales.
2. Fix a confirmed race condition in `HtmlAudioMechanism.stop()`/`play()` where a stop issued while a `play()` promise is still pending never reaches the underlying `<audio>` element, so playback silently continues.
3. Reproduce the reported `Cannot read properties of undefined (reading 'length')` console errors with the `browse` skill's instrumented headless browser before writing a fix, since the current code in the two most likely suspects (`recording-devices.service.ts`, `device-picker.component.ts`/`.html`) is already defensive and does not show an obvious cause.

**Tech Stack:** Angular 19 (standalone components), RxJS, Jest, Transloco i18n, native `HTMLMediaElement` playback via `HtmlAudioMechanism` (`libs/web-media`).

**Spec:** External evaluation report pasted into conversation on 2026-09-09 (no separate spec file — this plan's Global Constraints section captures the report's exact claims that were verified against the current codebase). The report describes testing against an "unmerged `feature/octra-to-tratt` branch" and a separate `docker/tratt/Dockerfile`; neither exists in this repository (`main`, no `Dockerfile` anywhere in the tree), so the third reported issue ("build issue... `npm ci` / lockfile mismatch") is **not actionable here** — this repo's own CI (`main.yml`, `node.js.yml`, `ci.yml`) already runs `npm ci --legacy-peer-deps`, which would itself fail on a lockfile/package.json drift, so no separate guard is needed in this repo.

## Global Constraints

- Formatting: Prettier, single quotes, 2-space indent (`npm run format`).
- Commit convention: Commitizen / conventional-changelog style commit messages.
- Do not touch unrelated i18n keys or playback code paths beyond what each task specifies.
- Run `npm test` for any spec file touched by a task before committing that task.

---

### Task 1: Add missing `modal.shortcuts.cycle_speaker` translation key

**Confirmed root cause:** `apps/tratt/src/app/core/modals/shortcuts-modal/shortcuts-modal.component.html:26,61` renders `{{ 'modal.shortcuts.' + entry.title | transloco }}`. The 2D-Editor's speaker-cycling shortcut is registered with `title: 'cycle_speaker'` (`apps/tratt/src/app/editors/2D-editor/2D-editor.component.ts:291`), but `modal.shortcuts.cycle_speaker` does not exist in **any** of the 7 locale files — confirmed by inspecting `modal.shortcuts` in all of them:

```
apps/tratt/src/assets/i18n/en.json
apps/tratt/src/assets/i18n/de.json
apps/tratt/src/assets/i18n/it.json
apps/tratt/src/assets/i18n/ko.json
apps/tratt/src/assets/i18n/nl.json
apps/tratt/src/assets/i18n/sv.json
apps/tratt/src/assets/i18n/zh.json
```

This is why the Shortcuts modal shows the raw key `modal.shortcuts.cycle_speaker` instead of translated text (report bug #1).

**Files:**
- Modify: `apps/tratt/src/assets/i18n/en.json` (`modal.shortcuts` object, alphabetically between `"close_save"` and `"delete boundaries"`)
- Modify: `apps/tratt/src/assets/i18n/de.json` (same location)
- Modify: `apps/tratt/src/assets/i18n/it.json` (same location)
- Modify: `apps/tratt/src/assets/i18n/ko.json` (same location)
- Modify: `apps/tratt/src/assets/i18n/nl.json` (same location)
- Modify: `apps/tratt/src/assets/i18n/sv.json` (same location)
- Modify: `apps/tratt/src/assets/i18n/zh.json` (same location)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the English key (source of truth for phrasing)**

In `apps/tratt/src/assets/i18n/en.json`, inside the `modal.shortcuts` object, add (matching the existing `"close_save": "Save & close window"` phrasing style):

```json
"cycle_speaker": "Cycle to next speaker",
```

- [ ] **Step 2: Add machine-appropriate translations to the other 6 locales**

For each of `de.json`, `it.json`, `ko.json`, `nl.json`, `sv.json`, `zh.json`, add the same key inside `modal.shortcuts` with a translation matching that file's existing tone for the neighboring `close_save` entry (short imperative phrase, sentence case matching the file's convention). Use these values:

- `de.json`: `"cycle_speaker": "Zum nächsten Sprecher wechseln"`
- `it.json`: `"cycle_speaker": "Passa al parlante successivo"`
- `ko.json`: `"cycle_speaker": "다음 화자로 전환"`
- `nl.json`: `"cycle_speaker": "Naar volgende spreker wisselen"`
- `sv.json`: `"cycle_speaker": "Växla till nästa talare"`
- `zh.json`: `"cycle_speaker": "切换到下一位说话人"`

- [ ] **Step 3: Verify the key resolves in every locale**

Run:
```bash
for f in apps/tratt/src/assets/i18n/*.json; do
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'cycle_speaker' in d['modal']['shortcuts'], sys.argv[1]" "$f"
done
echo "all locales OK"
```
Expected: prints `all locales OK` with no `AssertionError`.

- [ ] **Step 4: Manual UI check**

Run `npm start`, open the app, open a session in the 2D editor, open the Shortcuts modal (Help → Shortcuts, or whatever menu path is wired to `shortcuts-modal.component.ts`), and confirm the speaker-cycling row now shows translated text instead of `modal.shortcuts.cycle_speaker`.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/assets/i18n/*.json
git commit -m "fix(i18n): add missing modal.shortcuts.cycle_speaker translation key"
```

---

### Task 2: Fix playback-stop race in `HtmlAudioMechanism`

**Confirmed root cause** (traced through `libs/web-media/src/lib/audio/`):

1. `AudioChunk.startPlayback()` (`audio-manager.ts:516`) calls `AudioManager.startPlayback()` → `HtmlAudioMechanism.play()` (`html-audio-mechanism.ts:~495`), which calls `this._audio.play()` (line 524) and awaits the returned promise. The mechanism's `_state` is **not** flipped to `PlayBackStatus.PLAYING` until the `<audio>` element's native `canplay` event fires and calls `initPlayback()` (line 544), which calls `changeStatus(PlayBackStatus.PLAYING)` (line 555). Until `canplay` fires, `_state` stays at whatever it was before (`INITIALIZED`/`PREPARE`/`PAUSED`/`STOPPED`).
2. `AudioChunk.stopPlayback()` (`audio-manager.ts:627`) checks `this._audioManger.isPlaying`, which is `this._audioMechanism?.state === PlayBackStatus.PLAYING` (`audio-manager.ts:28`). If the user clicks Stop during the window described in step 1 (i.e., between `_audio.play()` being invoked and `canplay` firing), `isPlaying` is `false`.
3. Because `isPlaying` is `false`, `AudioChunk.stopPlayback()` takes the `else` branch and calls only `this.afterPlaybackStopped()` (`audio-manager.ts:632`), which just resets `startpos`/`playPosition` bookkeeping (`audio-manager.ts:737-740`) — it never calls `this._audioManger.stopPlayback()`, so `HtmlAudioMechanism.stop()` is never invoked at all.
4. Separately, even if `HtmlAudioMechanism.stop()` (`html-audio-mechanism.ts:639`) *were* called during this window, it has the same bug internally: it only calls `this._audio.pause()` when `this._state === PlayBackStatus.PLAYING` (line 647); otherwise it just resolves immediately without pausing the element (line 656-663), on the (here, incorrect) assumption that "audio element is not actively playing."

Net effect: the already-issued native `_audio.play()` call is never cancelled. The `<audio>` element keeps playing audibly (the browser doesn't know or care about our internal `_state` field), while the app's UI and internal state both believe playback is stopped. This exactly matches the reported "playback difficult to stop once started" behavior and the reporter's own hypothesis ("a stop issued via pause() can be overwritten when the pending play resolves").

**Fix:** make `HtmlAudioMechanism.stop()` always call `this._audio.pause()`, regardless of `_state`. `HTMLMediaElement.pause()` is a safe no-op when nothing is playing, and when called while a `play()` promise is still pending it causes that promise to reject with `AbortError` — a normal, spec-defined outcome of an intentional stop, so `play()`'s existing catch block must treat `AbortError` the same as it treats permission errors: swallow it instead of surfacing it as a hard error.

**Files:**
- Modify: `libs/web-media/src/lib/audio/html-audio-mechanism.ts` (`stop()` at line 639, `play()`'s catch block at line 528)
- Test: `libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts` (create if it doesn't already cover `stop()`; check first)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks. `stop(): Promise<void>` signature is unchanged.

- [ ] **Step 1: Check for an existing spec file and existing `stop()`/`play()` coverage**

```bash
ls libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts 2>/dev/null && grep -n "describe\|it(" libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts
```

The file already exists (73 lines, confirmed present) with 3 passing tests. **This lib uses Vitest, not Jest** — `vite.config.ts` configures the test runner, tests import `describe`/`expect`/`it`/`vi` from `'vitest'` (not globals), mocking uses `vi.fn()`/`vi.spyOn()` (not `jest.fn()`/`jest.spyOn()`), and `npm run test`/`nx test web-media` invokes `vitest run` under the hood. The existing file opens with a `// @vitest-environment jsdom` docblock (this lib's suite defaults to the `'node'` environment per `vite.config.ts`; this file overrides it because it touches `window`/DOM APIs) — add the new test into this same file, inside a new `describe` block, so it inherits that environment override. Do not create a second spec file.

- [ ] **Step 2: Write the failing test**

Add to `libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts`. First add `PlayBackStatus` to the existing `@tratt/media` import if not already present — check the top of the file; if there's no `@tratt/media` import yet, add `import { PlayBackStatus } from '@tratt/media';` alongside the existing `vitest`/`./html-audio-mechanism` imports. Then add:

```typescript
describe('HtmlAudioMechanism.stop cancels a pending play() before canplay fires', () => {
  it('pauses the underlying audio element even when stop() is called before canplay fires (pending-play race)', async () => {
    const audioEl = document.createElement('audio');
    const pauseSpy = vi.spyOn(audioEl, 'pause').mockImplementation(() => {});
    // Simulate play() still pending: never resolves canplay, mimic browser
    // returning a play() promise that stays pending until pause() is called.
    let rejectPlay: (err: any) => void;
    vi.spyOn(audioEl, 'play').mockReturnValue(
      new Promise((_resolve, reject) => (rejectPlay = reject)),
    );

    const mechanism = new HtmlAudioMechanism();
    (mechanism as any)._audio = audioEl;
    (mechanism as any)._state = PlayBackStatus.INITIALIZED;

    // stop() while _state is still INITIALIZED (play() promise unresolved).
    const stopPromise = mechanism.stop();
    rejectPlay!(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await stopPromise;
    expect(pauseSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts -t "pending-play race"`
Expected: FAIL — `pauseSpy` was not called, because `stop()`'s `else` branch (line 656-663 in the current code) resolves without calling `pause()`.

- [ ] **Step 4: Fix `stop()` to always pause**

In `libs/web-media/src/lib/audio/html-audio-mechanism.ts`, replace:

```typescript
  override stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._audio) {
        reject(new Error('Missing Audio instance.'));
        return;
      }
      // Remove canplay listener first to prevent initPlayback from re-arming after pause
      this._audio.removeEventListener('canplay', this.initPlayback);
      if (this._state === PlayBackStatus.PLAYING) {
        // Audio is actively playing: pause it and wait for the 'pause' DOM event
        // (fired by onPlayBackChanged) before resolving, so the audio element has
        // fully stopped before the caller proceeds.
        this._statusRequest = PlayBackStatus.STOPPED;
        this.callBacksAfterEnded.push(() => {
          resolve();
        });
        this._audio.pause();
      } else {
        // PREPARE / INITIALIZED / PAUSED / STOPPED / ENDED:
        // Audio element is not actively playing.  onPlayBackChanged is only
        // registered as a listener during play(), so calling _audio.pause() here
        // would never fire the 'pause' event (HTMLAudioElement.pause() is a no-op
        // when already paused) and the resolve callback would hang forever.
        // Nothing to stop — resolve immediately.
        resolve();
      }
    });
  }
```

with:

```typescript
  override stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._audio) {
        reject(new Error('Missing Audio instance.'));
        return;
      }
      // Remove canplay listener first to prevent initPlayback from re-arming after pause
      this._audio.removeEventListener('canplay', this.initPlayback);
      if (this._state === PlayBackStatus.PLAYING) {
        // Audio is actively playing: pause it and wait for the 'pause' DOM event
        // (fired by onPlayBackChanged) before resolving, so the audio element has
        // fully stopped before the caller proceeds.
        this._statusRequest = PlayBackStatus.STOPPED;
        this.callBacksAfterEnded.push(() => {
          resolve();
        });
        this._audio.pause();
      } else {
        // PREPARE / INITIALIZED / PAUSED / STOPPED / ENDED per our own _state — but
        // play() may still be mid-flight: _state only flips to PLAYING once the
        // 'canplay' event fires (see initPlayback), so a stop() issued between
        // calling _audio.play() and that event lands here. pause() cancels the
        // pending native play() (its promise rejects with AbortError, handled in
        // play()'s catch below) and is a harmless no-op if nothing was pending.
        this._audio.pause();
        resolve();
      }
    });
  }
```

- [ ] **Step 5: Treat the resulting `AbortError` as an expected stop, not a failure**

In the same file, find `play()`'s catch block (currently):

```typescript
      } catch (error: any) {
        this._playbackEndChecker?.unsubscribe();
        if (!this.playOnHover) {
          if (error.name && error.name === 'NotAllowedError') {
            // no permission
            this.missingPermission.next();
          }

          this.statechange.error(new Error(error));
          throw new Error(error);
        }
      }
```

Replace with:

```typescript
      } catch (error: any) {
        this._playbackEndChecker?.unsubscribe();
        if (error.name === 'AbortError') {
          // play() was cancelled by our own stop()/pause() call (see stop()) —
          // this is an expected outcome of an intentional stop, not a failure.
          return;
        }
        if (!this.playOnHover) {
          if (error.name && error.name === 'NotAllowedError') {
            // no permission
            this.missingPermission.next();
          }

          this.statechange.error(new Error(error));
          throw new Error(error);
        }
      }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts -t "pending-play race"`
Expected: PASS

- [ ] **Step 7: Run the full web-media test suite to check for regressions**

Run: `npx nx test web-media`
Expected: all PASS (baseline before this task: 2 test files, 6 tests, all passing). If any existing test asserted the old "resolve without pausing when not PLAYING" behavior, update that assertion to expect `pause()` to have been called — that assertion was pinning the bug.

- [ ] **Step 8: Manual verification**

Run `npm start`, load a longer clip (e.g. 30-60s), click Play, then click Stop within ~50-100ms (fast double-click or keyboard shortcut) repeated several times. Confirm no audio continues after Stop in any attempt. This reproduces the "rapid play/stop race" scenario the eval report couldn't trigger with local instant-decode files but flagged as the likely real-world trigger (slow source / cold autoplay-policy unlock).

- [ ] **Step 9: Commit**

```bash
git add libs/web-media/src/lib/audio/html-audio-mechanism.ts libs/web-media/src/lib/audio/html-audio-mechanism.spec.ts
git commit -m "fix(web-media): pause pending playback on stop() before canplay fires

Stop issued while a native play() promise was still pending never reached
the <audio> element, so playback continued audibly despite the app
reporting a stopped state. pause() is now always called; the resulting
AbortError is treated as an expected outcome of an intentional stop."
```

---

### Task 3: Reproduce the `Cannot read properties of undefined (reading 'length')` console errors

**Why this is a reproduce-first task, not a blind fix:** the report doesn't include a stack trace, only "×3 during a session, plus one trusted audio error event," and guesses "mic probe or a state race." The two most likely suspects were checked and are already defensive:
- `apps/tratt/src/app/core/shared/service/recording-devices.service.ts` guards every `mediaDevices()` call with `if (!md || typeof md.xxx !== 'function')` before use, and `enumerateDevices()`'s result is filtered, never `.length`-accessed unguarded.
- `apps/tratt/src/app/core/component/recording-panel/device-picker.component.ts`/`.html` don't reference `.length` at all.

Guessing at a fix without a stack trace risks masking the real bug with an unrelated null check. Reproduce it with an instrumented browser first.

**Files:**
- No source changes in this task — output is a stack trace that determines Task 4 (not yet planned; add once the trace is captured).

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a captured stack trace / repro steps that a follow-up task will use. Do not write a speculative fix.

- [ ] **Step 1: Start the dev server**

```bash
npm start
```
Wait for it to report the app is serving on port 5321.

- [ ] **Step 2: Drive the app with the `browse` skill, capturing console output**

Invoke the `browse` skill (see `Skill` tool, skill name `browse`) to open `http://localhost:5321`, then replay the exact sequence from the eval report that surfaced the errors: open the demo clip, switch between 2D / Dictaphone / Linear editors, open the Record tab (no mic granted), switch language EN→SV, and return to the landing page. Capture the browser console log for each step — the `browse` skill's console-capture feature reports the message text; request the full stack trace (not just the message) for any `Cannot read properties of undefined` entry.

- [ ] **Step 3: Narrow down the source file/line from the stack trace**

Once a stack trace is captured (it will point at a compiled/sourcemapped location), map it back to the TS source with:
```bash
grep -rn "<method name from stack trace>" apps/tratt/src libs --include="*.ts"
```

- [ ] **Step 4: Report findings before fixing**

Do not write a fix in this task. Summarize the captured stack trace(s) and the exact source location(s) found in Step 3. This becomes the input for a follow-up task (add it to this plan as Task 4 once the real location is known, following the same file/step-by-step structure as Tasks 1-2 — do not guess at code changes without the trace).

---

## Self-Review Notes

- **Spec coverage:** report's bug #1 (i18n) → Task 1. Report's playback-leak issue (the primary ask) → Task 2, root-caused with exact line numbers, not guessed. Report's bug #2 (console errors) → Task 3 (reproduce-first, since no stack trace was provided and the obvious suspects are already clean). Report's "bug #3" (Dockerfile/`npm ci`) → confirmed not applicable to this repo (no Dockerfile exists here; this repo's own CI already runs `npm ci` and would catch lockfile drift) — documented in the plan header, no task needed.
- **Placeholder scan:** Task 3 intentionally stops at "reproduce and report" rather than fabricating a fix for an unconfirmed root cause — this is a deliberate scope boundary, not a placeholder step (every step in it is concrete and actionable on its own).
- **Type/signature consistency:** `stop(): Promise<void>` signature unchanged in Task 2; no other task defines interfaces consumed elsewhere.

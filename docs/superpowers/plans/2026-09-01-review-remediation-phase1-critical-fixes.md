# Review Remediation Phase 1: Critical Silent-Corruption Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four Tier-1 (highest impact, score 4/4 — "silent corruption /
permanent save failure") findings from the code review, each independently
re-derived and confirmed against current code before this plan was written
(not transcribed from the review doc's line numbers uninspected).

**Architecture:** Four independent, single-concern bugfixes across two
libraries (`@tratt/annotation`, the app's NgRx annotation reducer/effects).
No shared files between tasks except that Tasks 3 and 4 both touch the
`login-mode/annotation` store folder (different files, no overlap). Each
task is fix + regression test, following the review's own "Definition of
done": reproduce first, minimal fix, verify step passes, build clean.

**Tech Stack:** Angular 19, NgRx, Jest (`nx test tratt` for the app), Vitest
(`npx vitest run` from `libs/annotation` for the lib).

**Spec:** `REVIEW-FINDINGS 1.md` (repo root) — findings B6, C4, C1, C2 in the
"Still open (33)" table (§4), cross-referenced against
`docs/superpowers/plans/2026-09-01-review-remediation-roadmap.md` for why
this is Phase 1's exact scope.

## Global Constraints

- Every fix must be the minimal change that closes the reproduced bug — no
  refactoring beyond what's needed, no touching adjacent code even if it
  looks similar (e.g. Task 3 fixes exactly the 10 mutation sites listed, not
  every reducer in the file).
- Lib tests (`libs/annotation`): Vitest, run with `npx vitest run` from
  `libs/annotation`. Import `describe`/`expect`/`it` from `'vitest'`.
- App tests (`apps/tratt`): Jest, run with `nx test tratt` or
  `npx jest apps/tratt/<path>`. Import `describe`/`expect`/`it` from
  `'@jest/globals'` (repo convention in this store folder — see
  `annotation.reducer.spec.ts:1`).
- After all four tasks: `npm run build:dev` must be clean.
- Do not touch `docs/manual/` or any i18n files — out of scope for this plan.

---

### Task 1: Fix `TrattAnnotation.serialize()` crash on an empty SEGMENT level (B6)

**Files:**
- Modify: `libs/annotation/src/lib/annotation.ts:670-691` (the `serialize()` method)
- Test: `libs/annotation/src/lib/annotation.spec.ts` (append to the existing file)

**Interfaces:**
- Consumes: nothing new — uses `TrattAnnotationSegmentLevel`,
  `TrattAnnotation`, `SampleUnit`, `OLabel` already imported in
  `annotation.spec.ts`.
- Produces: nothing new — `serialize()`'s signature and return type
  (`OAnnotJSON`) are unchanged; this only fixes a crash on one input shape.

**The bug (confirmed by direct read of the current file):** `serialize()`
maps every `TrattAnnotationSegmentLevel` through `a.serialize()` to get
`result`, then unconditionally does:

```typescript
const lastItem = result.items[result.items.length - 1];
if (
  lastItem.sampleStart + lastItem.sampleDur <
  lastSegmentTime.samples
) {
```

When `result.items` is empty (a SEGMENT level with zero items — a
routine state, e.g. right after creating a new level, or after removing all
its segments), `result.items.length - 1` is `-1`, so
`result.items[-1]` is `undefined`, and `lastItem.sampleStart` throws
`TypeError: Cannot read properties of undefined (reading 'sampleStart')`.
Because `serialize()` is called on every save, this bricks every subsequent
save for that session once a SEGMENT level goes empty.

- [ ] **Step 1: Write the failing test**

Append to `libs/annotation/src/lib/annotation.spec.ts` (it already has a
`describe('TrattAnnotation.serialize() padding of the final segment', ...)`
block around line 84 — add a new sibling `describe` block after it, using
the same `TrattAnnotation`/`SampleUnit`/`ISegmentLevel` imports already at
the top of the file):

```typescript
describe('TrattAnnotation.serialize() on an empty SEGMENT level', () => {
  it('does not throw and serializes the level with an empty items array', () => {
    const annotation = new TrattAnnotation<TrattAnnotationSegment>();
    const level = annotation.createSegmentLevel('tier', []);
    annotation.addLevel(level);
    annotation.updateIDCounters();

    expect(() =>
      annotation.serialize('audio.wav', 48000, new SampleUnit(2000, 48000)),
    ).not.toThrow();

    const json = annotation.serialize(
      'audio.wav',
      48000,
      new SampleUnit(2000, 48000),
    );
    const segmentLevel = json.levels[0] as ISegmentLevel;
    expect(segmentLevel.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run libs/annotation/src/lib/annotation.spec.ts` (from repo root, or `cd libs/annotation && npx vitest run` per the review doc's documented test command — either works since vitest resolves relative to the config)
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading 'sampleStart')`

- [ ] **Step 3: Write minimal implementation**

In `libs/annotation/src/lib/annotation.ts`, guard the padding block with an
items-length check so it's skipped entirely when there's nothing to pad
relative to:

```typescript
        if (a instanceof TrattAnnotationSegmentLevel) {
          const result = a.serialize();

          if (result.items.length > 0) {
            const lastItem = result.items[result.items.length - 1];
            if (
              lastItem.sampleStart + lastItem.sampleDur <
              lastSegmentTime.samples
            ) {
              const paddingStart = lastItem.sampleStart + lastItem.sampleDur;
              result.items.push(
                new OSegment(
                  this.idCounters.item++,
                  paddingStart,
                  lastSegmentTime.samples - paddingStart,
                  [new OLabel(a.name, '')],
                ),
              );
            }
          }
```

(Only the added `if (result.items.length > 0) {` wrapper and its matching
closing `}` are new — the body inside is unchanged from the current file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run libs/annotation/src/lib/annotation.spec.ts`
Expected: PASS. Also run the full lib suite (`npx vitest run` from
`libs/annotation`) to confirm the existing padding tests
(`describe('TrattAnnotation.serialize() padding of the final segment', ...)`)
still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add libs/annotation/src/lib/annotation.ts libs/annotation/src/lib/annotation.spec.ts
git commit -m "fix(annotation): don't crash serializing an empty SEGMENT level

serialize() dereferenced result.items[-1] when a SEGMENT level has zero
items, throwing on every save until the level gets an item again. Guard
the trailing-padding logic behind an items.length check."
```

---

### Task 2: Fix `getFirstLabelWithoutName('Spealer')` typo writing speaker names into transcripts (C4)

**Files:**
- Modify: `libs/annotation/src/lib/functions.ts:126`
- Test (new file): `libs/annotation/src/lib/functions.spec.ts`

**Interfaces:**
- Consumes: `TrattAnnotationSegment` (constructor `(id: number, time:
  SampleUnit, labels?: OLabel[])`), `OLabel` (constructor `(name: string,
  value: string)`) — both already exported from `@tratt/annotation`.
- Produces: nothing new — `removeSegmentByIndex`'s signature and behavior
  for every other input are unchanged; this only fixes which label it reads
  as "the transcript".

**The bug (confirmed by direct read of the current file, both the typo site
and the correctly-spelled sibling implementation of the same idea at
`annotation.ts:552`):** `removeSegmentByIndex` reads the transcript label of
the segment being removed via:

```typescript
const transcription =
  entries[index].getFirstLabelWithoutName('Spealer')?.value;
```

`getFirstLabelWithoutName(notName)` is `this.labels?.find((a) => a.name !==
notName)` — "first label NOT named `notName`". Because no label is ever
named `'Spealer'` (it's a typo for `'Speaker'`), the exclusion never
matches anything, so this always returns `this.labels[0]` — the segment's
*first* label array entry, whatever it is named. If that first label
happens to be the `'Speaker'` label rather than the transcript label, the
merge below writes the departing segment's speaker name into the next
segment's transcript text instead of its transcript.

- [ ] **Step 1: Write the failing test**

Create `libs/annotation/src/lib/functions.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { OLabel } from './annotjson';
import { removeSegmentByIndex } from './functions';
import { TrattAnnotationSegment } from './trattAnnotationSegment';
import { SampleUnit } from '@tratt/media';

describe('removeSegmentByIndex', () => {
  it('merges the removed segment transcript into the next segment, not its speaker name', () => {
    // Speaker label listed before the transcript label, so the old
    // 'Spealer' typo (which falls back to labels[0]) would pick this up.
    const entries: TrattAnnotationSegment[] = [
      new TrattAnnotationSegment(1, new SampleUnit(48000, 48000), [
        new OLabel('Speaker', 'Speaker 1'),
        new OLabel('OCTRA_1', 'hello'),
      ]),
      new TrattAnnotationSegment(2, new SampleUnit(96000, 48000), [
        new OLabel('Speaker', 'Speaker 1'),
        new OLabel('OCTRA_1', 'world'),
      ]),
    ];

    removeSegmentByIndex(entries, 0, '<p>', true);

    const survivor = entries[0];
    expect(survivor.getFirstLabelWithoutName('Speaker')?.value).toBe(
      'hello world',
    );
    expect(survivor.getFirstLabelWithoutName('Speaker')?.value).not.toContain(
      'Speaker 1',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run libs/annotation/src/lib/functions.spec.ts` (from `libs/annotation`)
Expected: FAIL — `survivor`'s transcript label is `'Speaker 1 world'` (or
similar, with the speaker name merged in) instead of `'hello world'`.

- [ ] **Step 3: Write minimal implementation**

In `libs/annotation/src/lib/functions.ts:126`, fix the typo:

```typescript
      const transcription =
        entries[index].getFirstLabelWithoutName('Speaker')?.value;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run libs/annotation/src/lib/functions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/annotation/src/lib/functions.ts libs/annotation/src/lib/functions.spec.ts
git commit -m "fix(annotation): correct 'Spealer' typo in removeSegmentByIndex

getFirstLabelWithoutName('Spealer') never excluded anything (no label is
named 'Spealer'), so it always returned the segment's first label
regardless of name — sometimes the Speaker label instead of the
transcript, writing a speaker name into the merged transcript text."
```

---

### Task 3: Stop in-place mutation of NgRx reducer state (C1)

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.ts` — 10 sites: lines 148, 160, 374-388 (loop), 401 (loop), 420-428 (loop), 437-445 (loop, shares the block with 420), 626, 639, 651
- Test: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.spec.ts` (append)

**Interfaces:**
- Consumes: `AnnotationStateReducers`, `initialState` (already exported from
  `annotation.reducer.ts`, already imported in the spec file).
- Produces: nothing new — every handler's action type and payload are
  unchanged; only whether the returned object is a *new* reference changes.

**The bug (confirmed by direct read of the current file — 10 sites, all
follow the same anti-pattern):** these `on(...)` handlers mutate the `state`
parameter in place (`state.transcript = ...` or `state.currentSession =
{...}`) and then `return state` — the *same* object reference NgRx was
handed. `Object.is(newState, oldState)` is `true`, so any memoized selector
using reference equality (the NgRx default) does not recompute, and
`OnPush`-based components relying on that selector don't re-render even
though the store's data changed underneath them — edits appear to "vanish."
The fix already exists elsewhere in the same file (e.g. line 120-123:
`return { ...state, transcript: ... }`) — these 10 sites just don't follow
it yet.

**Fix for the 6 single-assignment sites** (148, 160, 626, 639, 651, plus
the shared block at 420/437): replace the `state.X = Y; ... return state;`
shape with `return { ...state, X: Y };`, keeping every conditional exactly
as-is.

**Fix for the 3 loop sites** (`changeCurrentLevelItems.do` at 363,
`addCurrentLevelItems.do` at 394, `removeCurrentLevelItems.do` at 412):
accumulate into a local `transcript` variable across loop iterations instead
of mutating `state.transcript`, then return one new state object at the end.

- [ ] **Step 1: Write the failing tests**

Append to `apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.spec.ts`
(reusing the file's existing `buildState()` helper and
`new AnnotationStateReducers(LoginMode.LOCAL).create()` /
`createReducer(initialState, ...reducers)` harness — see the existing
`describe('applyTranslationToLinkedLevel reducer', ...)` block for the
pattern; `buildState()` returns `{ ...initialState, transcript }` where
`transcript` has two SEGMENT levels — index 0 has two items with ids `1`
and `2`, added via `addLevel` but with no level selected as current by
default):

```typescript
describe('reducers return new state objects instead of mutating in place', () => {
  const reducers = new AnnotationStateReducers(LoginMode.LOCAL).create();
  const reducer = createReducer(initialState, ...reducers);

  it('combinePhrases.success returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.combinePhrases.success({
        mode: LoginMode.LOCAL,
        transcript: state.transcript.clone(),
      }),
    );
    expect(next).not.toBe(state);
  });

  it('changeLevelName.do returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.changeLevelName.do({
        mode: LoginMode.LOCAL,
        index: 0,
        name: 'renamed',
      }),
    );
    expect(next).not.toBe(state);
  });

  it('changeCurrentLevelItems.do returns a new state object', () => {
    const state = buildState();
    state.transcript.changeCurrentLevelIndex(0);
    const existingItem = state.transcript.currentLevel!.items[0];
    const next = reducer(
      state,
      AnnotationActions.changeCurrentLevelItems.do({
        mode: LoginMode.LOCAL,
        items: [existingItem as any],
      }),
    );
    expect(next).not.toBe(state);
  });

  it('addCurrentLevelItems.do returns a new state object', () => {
    const state = buildState();
    state.transcript.changeCurrentLevelIndex(0);
    const newItem = new TrattAnnotationSegment(
      99,
      new SampleUnit(144000, 48000),
      [new OLabel('OCTRA_1', 'new')],
    );
    const next = reducer(
      state,
      AnnotationActions.addCurrentLevelItems.do({
        mode: LoginMode.LOCAL,
        items: [newItem as any],
      }),
    );
    expect(next).not.toBe(state);
  });

  it('removeCurrentLevelItems.do returns a new state object', () => {
    const state = buildState();
    state.transcript.changeCurrentLevelIndex(0);
    const next = reducer(
      state,
      AnnotationActions.removeCurrentLevelItems.do({
        mode: LoginMode.LOCAL,
        items: [{ id: 1 }],
      }),
    );
    expect(next).not.toBe(state);
  });

  it('sendOnlineAnnotation.do returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.sendOnlineAnnotation.do({ mode: LoginMode.LOCAL }),
    );
    expect(next).not.toBe(state);
  });

  it('sendOnlineAnnotation.fail returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.sendOnlineAnnotation.fail({
        mode: LoginMode.LOCAL,
        error: 'network error',
      }),
    );
    expect(next).not.toBe(state);
  });

  it('duplicateLevel.do returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.duplicateLevel.do({ mode: LoginMode.LOCAL, index: 0 }),
    );
    expect(next).not.toBe(state);
  });
});
```

Add `TrattAnnotationSegment`, `OLabel`, and `SampleUnit` to the file's
existing imports if any are missing (check the top of the file first —
`SampleUnit` and `TrattAnnotationSegment` are likely already imported for
`buildState()`; `OLabel` likely too).

`AnnotationActions.sendOnlineAnnotation.fail`'s payload is `{ mode:
LoginMode; error: string }` (confirmed at `annotation.actions.ts:358-361`),
matching the test above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.spec.ts`
Expected: all 8 new tests FAIL with `expect(received).not.toBe(expected)` —
`next` and `state` are the same reference.

- [ ] **Step 3: Write minimal implementation**

In `apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.ts`:

Site 1 (line ~144-153, `combinePhrases.success`):

```typescript
      on(
        AnnotationActions.combinePhrases.success,
        (state: AnnotationState, { transcript, mode }) => {
          if (this.mode === mode) {
            return { ...state, transcript };
          }

          return state;
        },
      ),
```

Site 2 (line ~154-165, `changeLevelName.do`):

```typescript
      on(
        AnnotationActions.changeLevelName.do,
        (state: AnnotationState, { index, mode, name }) => {
          if (mode === this.mode) {
            const transcript = state.transcript.clone();
            transcript.changeLevelNameByIndex(index, name);
            return { ...state, transcript };
          }

          return state;
        },
      ),
```

Site 3 (`changeCurrentLevelItems.do`, the loop starting ~line 362):

```typescript
      on(
        AnnotationActions.changeCurrentLevelItems.do,
        (state: AnnotationState, { items, mode }) => {
          if (this.mode === mode) {
            const currentLevel = state.transcript.currentLevel;

            if (currentLevel) {
              let transcript = state.transcript;
              for (const item of items) {
                const index = transcript.currentLevel?.items.findIndex(
                  (a) => a.id === item.id,
                );
                if (index !== undefined && index > -1) {
                  transcript = transcript
                    .clone()
                    .changeCurrentItemByIndex(index, item);
                } else {
                  // add item
                  transcript = transcript
                    .clone()
                    .addItemToCurrentLevel((item as any).time, item.labels);
                }
              }
              return { ...state, transcript };
            }
          }

          return state;
        },
      ),
```

Site 4 (`addCurrentLevelItems.do`):

```typescript
      on(
        AnnotationActions.addCurrentLevelItems.do,
        (state: AnnotationState, { items, mode }) => {
          if (this.mode === mode) {
            const currentLevel = state.transcript.currentLevel;

            if (currentLevel) {
              let transcript = state.transcript;
              for (const item of items) {
                transcript = transcript
                  .clone()
                  .addItemToCurrentLevel((item as any).time, item.labels);
              }
              return { ...state, transcript };
            }
          }

          return state;
        },
      ),
```

Site 5 (`removeCurrentLevelItems.do`) — same accumulator shape, keep every
existing branch of the `if (item.id ...) / else if (item.index ...) / else`
body, just read/write the local `transcript` variable instead of
`state.transcript`:

```typescript
      on(
        AnnotationActions.removeCurrentLevelItems.do,
        (state: AnnotationState, { items, mode, removeOptions }) => {
          if (this.mode === mode) {
            const currentLevel = state.transcript.currentLevel;

            if (currentLevel) {
              let transcript = state.transcript;
              for (const item of items) {
                if (item.id !== undefined && item.id !== null) {
                  transcript = transcript
                    .clone()
                    .removeItemById(
                      item.id,
                      removeOptions?.silenceCode,
                      removeOptions?.mergeTranscripts,
                      (transcriptText: string) => {
                        if (!state.guidelines?.selected?.json) {
                          return transcriptText;
                        }
                        return tidyUpAnnotation(
                          transcriptText,
                          state.guidelines.selected.json,
                        );
                      },
                    );
                } else if (item.index !== undefined && item.index !== null) {
                  transcript = transcript
                    .clone()
                    .removeItemByIndex(
                      item.index,
                      removeOptions?.silenceCode,
                      removeOptions?.mergeTranscripts,
                      (transcriptText: string) => {
                        if (!state.guidelines?.selected?.json) {
                          return transcriptText;
                        }
                        return tidyUpAnnotation(
                          transcriptText,
                          state.guidelines.selected.json,
                        );
                      },
                    );
                } else {
                  console.error(
                    `removeCurrentLevelItems: Can't remove item, missing index or ID.`,
                  );
                }
              }
              return { ...state, transcript };
            }
          }

          return state;
        },
      ),
```

(Renamed the inner callback param from `transcript` to `transcriptText` in
this site only, since the outer accumulator is now also named `transcript`
— avoids shadowing. Sites 3/4 have no such inner callback so no rename
needed there.)

Site 6 (`sendOnlineAnnotation.do`, line ~624-634):

```typescript
      on(
        AnnotationActions.sendOnlineAnnotation.do,
        (state: AnnotationState, { mode }) => {
          if (mode === this.mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                status: 'sending',
              },
            };
          }
          return state;
        },
      ),
```

Site 7 (`sendOnlineAnnotation.fail`/`.success`, line ~636-646):

```typescript
      on(
        AnnotationActions.sendOnlineAnnotation.fail,
        AnnotationActions.sendOnlineAnnotation.success,
        (state: AnnotationState, { mode }) => {
          if (mode === this.mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                status: 'processing',
              },
            };
          }
          return state;
        },
      ),
```

Site 8 (`duplicateLevel.do`, line ~648-654):

```typescript
      on(
        AnnotationActions.duplicateLevel.do,
        (state: AnnotationState, { mode, index }) => {
          if (mode === this.mode) {
            return {
              ...state,
              transcript: state.transcript.clone().duplicateLevel(index),
            };
          }
          return state;
        },
      ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.spec.ts`
Expected: all 8 new tests PASS, and every pre-existing test in the file
still passes (the `applyTranslationToLinkedLevel` describe block is
untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation.reducer.spec.ts
git commit -m "fix(annotation): return new state objects instead of mutating in place

10 reducer handlers mutated the state parameter (state.transcript = ...,
state.currentSession = {...}) and returned the same reference, so
Object.is(next, prev) was always true — memoized selectors and OnPush
components never saw the change. Return { ...state, ... } like every
other handler in the file already does."
```

---

### Task 4: Track the `loadAudio` subscription so a stale in-flight load can't land in a new session (C2)

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.ts:329-345` (the `onAudioLoad$` effect's `this.audio.loadAudio(src, a.audioFile).subscribe({...})` call — the exact line number moved slightly during the plan-writing read; search for `this.audio.loadAudio(src, a.audioFile).subscribe(` in the file if the number below doesn't match)
- Test: create `apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.spec.ts` if it doesn't already exist, or append to it if it does — **check first**, don't assume.

**Interfaces:**
- Consumes: `this.subscrManager` — already a `SubscriptionManager` instance
  on this exact class (`annotation-load.effects.ts:67`), already used with
  the tag pattern this fix reuses (`this.subscrManager.removeByTag('uiService');
  this.subscrManager.add(obs.subscribe({...}), 'uiService');` at
  `annotation-load.effects.ts:264-276`).
- Produces: nothing new — the effect's action flow and dispatched actions
  are unchanged; only the subscription's lifecycle changes.

**The bug (confirmed by direct read of the current file):** `onAudioLoad$`
is a `{ dispatch: false }` effect. Inside its `tap()` callback, for
ONLINE/URL/DEMO modes, it calls:

```typescript
this.audio.loadAudio(src, a.audioFile).subscribe({
  next: (progress) => { /* dispatches loadAudio.progress / .success */ },
  error: (err) => { /* dispatches loadAudio.fail */ },
});
```

This subscription is never stored anywhere and never torn down. If
`loadAudio.do` fires again (a new load starts) while an earlier load's
`Observable` is still in flight, the earlier subscription's `next`/`error`
callbacks can still fire later and dispatch `loadAudio.success` /
`.progress` carrying the *old* action's captured `state` and `a.task` —
landing a stale success into whatever session is current by the time it
resolves.

**Fix:** tag the subscription and clear any previous one with the same tag
before starting a new one — the exact pattern this file already uses at
line 264-276 for a different subscription.

- [ ] **Step 1: Write the failing test**

No `.spec.ts` exists yet for `AnnotationLoadEffects` or any other file in
this `annotation/` effects folder — but `apps/tratt/src/app/core/store/authentication/authentication.effects.spec.ts`
already establishes the exact pattern to follow for testing a `{ dispatch:
false }` NgRx effect in this repo: `provideMockActions(() => actions$)` +
`provideMockStore({ initialState })`, a `useValue` stub for every
constructor dependency, `TestBed.inject(...)` the effects class, manually
`.subscribe()` the target effect stream (plain `TestBed` doesn't auto-run
`EffectsModule`), push an action into `actions$`, then assert on a
`jest.spyOn(store, 'dispatch')` spy. `AnnotationLoadEffects`'s constructor
(`annotation-load.effects.ts:1168-1180`) takes 12 dependencies — stub every
one with the smallest `useValue` that satisfies the code path this test
exercises. Create `annotation-load.effects.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { HttpClient } from '@angular/common/http';
import { TranslocoService } from '@jsverse/transloco';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { ReplaySubject, Subject } from 'rxjs';
import { AlertService, AudioService, UserInteractionsService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { RoutingService } from '../../../shared/service/routing.service';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { LoginMode, RootState } from '../index';
import { AnnotationActions } from './annotation.actions';
import { AnnotationLoadEffects } from './annotation-load.effects';
import { AnnotationMaintenanceService } from './annotation-maintenance.service';

describe('AnnotationLoadEffects.onAudioLoad$', () => {
  let effects: AnnotationLoadEffects;
  let store: MockStore<RootState>;
  let actions$: ReplaySubject<unknown>;
  let audioStub: { loadAudio: jest.Mock };

  const initialState = {
    application: { mode: LoginMode.URL },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);
    audioStub = { loadAudio: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        AnnotationLoadEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: OctraAPIService, useValue: {} },
        { provide: HttpClient, useValue: {} },
        { provide: AlertService, useValue: { showAlert: () => undefined } },
        { provide: RoutingService, useValue: { navigate: () => undefined } },
        { provide: TrattModalService, useValue: { openModal: () => undefined } },
        { provide: AudioService, useValue: audioStub },
        { provide: UserInteractionsService, useValue: { afteradd: new Subject() } },
        { provide: AppStorageService, useValue: {} },
        { provide: TranslocoService, useValue: {} },
        { provide: AnnotationMaintenanceService, useValue: {} },
      ],
    });

    effects = TestBed.inject(AnnotationLoadEffects);
    store = TestBed.inject(MockStore);
  });

  it('cancels a still-in-flight loadAudio subscription when a new loadAudio.do arrives', () => {
    const firstLoad$ = new Subject<number>();
    const secondLoad$ = new Subject<number>();
    audioStub.loadAudio
      .mockReturnValueOnce(firstLoad$)
      .mockReturnValueOnce(secondLoad$);

    const subscription = effects.onAudioLoad$.subscribe();

    const doAction = (url: string) =>
      AnnotationActions.loadAudio.do({
        mode: LoginMode.URL,
        audioFile: { filename: 'a.wav', url } as any,
        task: {} as any,
        currentProject: {} as any,
        guidelines: [],
      });

    actions$.next(doAction('first.wav'));
    actions$.next(doAction('second.wav'));

    expect(firstLoad$.observed).toBe(false);

    subscription.unsubscribe();
  });
});
```

If any provided stub is missing a property the code under test actually
reads for the ONLINE/URL/DEMO branch (run the test and let the first
`TypeError` point at it), add just that property to the relevant
`useValue` — don't stub more than the exercised path needs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.spec.ts`
Expected: FAIL — the first subscription is still active/observed after the
second load starts.

- [ ] **Step 3: Write minimal implementation**

In `annotation-load.effects.ts`, find `this.audio.loadAudio(src,
a.audioFile).subscribe({` inside `onAudioLoad$`'s `tap()` callback (ONLINE/
URL/DEMO branch) and wrap it with the same tag-based cancel-then-add pattern
already used at line 264-276:

```typescript
              this.subscrManager.removeByTag('loadAudio');
              this.subscrManager.add(
                this.audio.loadAudio(src, a.audioFile).subscribe({
                  next: (progress) => {
                    if (progress < 1) {
                      this.store.dispatch(
                        AnnotationActions.loadAudio.progress({
                          value: progress,
                          mode: state.application.mode!,
                        }),
                      );
                    } else {
                      this.store.dispatch(
                        AnnotationActions.loadAudio.success({
                          mode: state.application.mode!,
                          task: a.task,
                          // ...keep every other existing property in this success payload unchanged...
                        }),
                      );
                    }
                  },
                  error: (err) => {
                    this.store.dispatch(
                      AnnotationActions.loadAudio.fail({
                        error: 'Loading audio file failed',
                      }),
                    );
                    console.error(err);
                  },
                }),
                'loadAudio',
              );
```

Keep every property inside the existing `next`/`error` callbacks exactly as
they are today — the only change is wrapping the `.subscribe({...})` call
itself in `this.subscrManager.removeByTag('loadAudio')` +
`this.subscrManager.add(..., 'loadAudio')`, matching the existing
`'uiService'`-tagged pattern in the same file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.spec.ts`
Expected: PASS. Also run the full annotation store test directory to catch
regressions: `npx jest apps/tratt/src/app/core/store/login-mode/annotation`.

- [ ] **Step 5: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.ts apps/tratt/src/app/core/store/login-mode/annotation/annotation-load.effects.spec.ts
git commit -m "fix(annotation): cancel in-flight loadAudio subscription on a new load

onAudioLoad\$ subscribed to this.audio.loadAudio(...) without tracking the
subscription. A loadAudio.do that fires again before an earlier load
resolves left the earlier subscription alive, able to dispatch a stale
loadAudio.success/.progress into whatever session is current by the time
it completes. Tag and cancel via the subscrManager, matching the pattern
already used for the uiService subscription in this file."
```

---

## Final Verification

After all four tasks:

- [ ] `npx vitest run` from `libs/annotation` — full lib suite green
- [ ] `nx test tratt` (or `npx jest apps/tratt`) — full app suite green,
  modulo the 2 pre-existing unrelated failures already known on `main`
  (`AutoTranscribeOptionsComponent` locale-default test,
  `TranscriptionFeedbackComponent` DI test — confirm these are still the
  *only* 2 failures, not that count in isolation)
- [ ] `npm run build:dev` — clean
- [ ] Use `superpowers:finishing-a-development-branch` to integrate

# Overview Boundary Adjust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overview table gets Start/End columns with ▲▼ nudges and a hover waveform popover for dragging a boundary.

**Architecture:** Pure `moveBoundary` + `formatTime` helpers; one shared `BoundaryPopoverComponent` (canvas) owned by `TranscrOverviewComponent`; commits go through `annotationStoreService.changeCurrentItemById`. `syncShownSegments` patches timing-only changes in place.

**Tech Stack:** Angular (standalone, OnPush, Transloco), Jest (`npx nx test tratt`), `@tratt/annotation`, `@tratt/media` `SampleUnit`.

**Spec:** `docs/superpowers/specs/2026-11-24-overview-boundary-adjust-design.md`

## Global Constraints

- Dir: `apps/tratt/src/app/core/component/transcr-overview/`.
- Time format `mm:ss.mmm`; `h:mm:ss.mmm` from 1 h.
- Nudge: click ±10 ms, Shift ±100 ms. Min segment length 10 ms. Popover window ±1.5 s, open delay 400 ms.
- A segment stores only its end `time`; Start of #n+1 ≡ End of #n. Row 1 Start and last End are fixed.
- Linked level (`linkedToLevelId !== undefined`): all boundary edits disabled.
- `verified` untouched. No undo. No typed time, no hold-repeat, no popover playback.
- i18n keys in `apps/tratt/src/assets/i18n/en.json` and `sv.json`; manual `docs/manual/checking-your-work.md` + `docs/manual/sv/checking-your-work.md`.

## Review Focus

- Last-row End / first-row Start nudge or drag: no-op, disabled.
- Nudge past neighbour or below 0 / above duration: clamped, never crosses.
- Linked tier: no edit reaches the store.
- `audioManager.channel` undefined (still decoding): popover shows no wave, no crash, no drag.
- Rapid repeated nudges on 701 rows: no full rebuild / spinner.

---

### Task 1: Pure helpers

**Files:**
- Create: `boundary-time.ts`, `boundary-time.spec.ts`

**Interfaces:**
- Produces:
  - `formatTime(samples: number, sampleRate: number): string`
  - `moveBoundary(endsSamples: readonly number[], i: number, target: number, sampleRate: number, duration: number): number` — `endsSamples` = every segment's end sample; returns clamped new end of segment `i` in `[prevEnd + minLen, nextEnd − minLen]` (prevEnd = 0 for i = 0 not applicable; i = last returns unchanged `endsSamples[i]`). `minLen = round(0.01 * sampleRate)`.

- [ ] **Step 1: Write failing tests** (sampleRate 1000, so 1 sample = 1 ms): `formatTime(75_020,1000) === '01:15.020'`; `formatTime(3_725_005,1000) === '1:02:05.005'`; `moveBoundary([1000,2000,3000],0,1500,1000,3000) === 1500`; target 2500 → 1990; target −5 → 10; `moveBoundary([1000,2000,3000],2,2500,1000,3000) === 3000`; i=1 target 3500 → 2990.
- [ ] **Step 2:** `npx nx test tratt --testFile=boundary-time.spec.ts` → FAIL (module missing).
- [ ] **Step 3: Implement both in `boundary-time.ts`.** `duration` is unused by clamping except as upper bound for non-last rows is already nextEnd; drop the param if unused.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5: Commit** `feat(overview): boundary time helpers`.

### Task 2: Columns, nudges, in-place sync

**Files:**
- Modify: `transcr-overview.component.html` (thead + row cells), `.ts`, `.css`; en/sv `i18n`.
- Test: `transcr-overview.component.spec.ts` (create) — only if component test harness is cheap; otherwise cover via Task 1 + manual check below.

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces on `TranscrOverviewComponent`:
  - `nudgeBoundary(i: number, deltaMs: number): void` — `i` = index of the segment whose END moves (a Start cell of row n calls `i = n − 1`).
  - `commitBoundary(i: number, newSamples: number): void` — clamps via `moveBoundary`, clones segment `i` with new `time` (`new SampleUnit(samples, rate)`), calls `annotationStoreService.changeCurrentItemById(segment.id, updated)`.
  - `boundaryEditable(i: number): boolean` — false if linked level, `i < 0`, or `i` = last.
  - `formatTime` exposed to template.

- [ ] **Step 1:** Add i18n keys `g.start` ("Start"/"Start"), `g.end` ("End"/"Slut"), `overview.boundary shared` tooltip (note that neighbour moves too), `overview.boundary locked` (linked tier).
- [ ] **Step 2:** Template: two `<td class="time-cell">` after segment-number and two `<th>`; width via CSS (~120px, `#table-*` pattern). Cell = time text + stacked buttons ▲ (`fa-chevron-up`) ▼ (`fa-chevron-down`), `(click)="nudgeBoundary(i-1 | i, ±($event.shiftKey ? 100 : 10))"`; Start cell uses `i-1`, End cell `i`; `[disabled]="!boundaryEditable(...)"`; `aria-label` + `title`. Same status colour classes as sibling cells. Times derive from `segment.start/end` of `shownSegments`.
- [ ] **Step 3:** Fix `syncShownSegments`: when same length and only `end` values differ (text/labels equal — compare via `verified` + existing rows unchanged; timing-only), build new `shownSegments` array mapping `start`/`end` from items (`start` = previous end) and `markForCheck`; keep full `updateView()` only when length differs. Update `playStateSegments` untouched.
- [ ] **Step 4: Verify manually** (`npx nx serve tratt`, open Overview on a long file): nudge ▲ on End of #2 → End of #2 and Start of #3 both +10 ms, no spinner, play button plays new range; Shift = 100 ms; row 1 Start and last End disabled; linked tier disabled. Run `npx nx test tratt` (no regressions).
- [ ] **Step 5: Commit** `feat(overview): start/end columns with nudge`.

### Task 3: Waveform popover

**Files:**
- Create: `boundary-popover/boundary-popover.component.ts` (+ `.html` inline OK), spec for the pure `peaks` function.
- Modify: `transcr-overview.component.{ts,html}`.

**Interfaces:**
- Produces:
  - `computePeaks(channel: Float32Array, factor: number, startSample: number, endSample: number, width: number): {min: number; max: number}[]` — one entry per pixel column, indices `floor(sample/factor)`; out-of-range → 0/0. Unit-tested: 4-sample ramp over width 2 gives expected min/max; empty/out-of-range gives zeros.
  - `BoundaryPopoverComponent` inputs: `channel?: Float32Array`, `factor: number`, `sampleRate: number`, `boundary: number` (samples), `leftStart: number`, `rightEnd: number`, `editable: boolean`; output `boundaryChange: EventEmitter<number>` (on pointer release), `closed`.
- Consumes: `commitBoundary` from Task 2.

- [ ] **Step 1: Failing tests for `computePeaks`** as above; run → FAIL; implement; run → PASS.
- [ ] **Step 2:** Component: canvas ~360×100, window `boundary ± 1.5 s`; draw peaks; tint left neighbour (`leftStart`→boundary) and right (boundary→`rightEnd`) with theme-variable colours; vertical line + time label at boundary. Pointer events with `setPointerCapture`; dragging updates a local preview position (clamped by `moveBoundary`), emits `boundaryChange` on release; Esc cancels. When `!editable` or `channel` undefined: no drag, no wave.
- [ ] **Step 3:** Overview owns one popover: `popover = {open, x, y, boundaryIndex}`. Time cells `(mouseenter)`/`(focusin)` start a 400 ms timer, `(mouseleave)` cancels unless pointer enters popover; popover `(mouseleave)` closes after 150 ms grace; hold open while dragging. Render once, `position: fixed` from the cell's `getBoundingClientRect()`, flip above when near viewport bottom. Wire `boundaryChange` → `commitBoundary`. Pass `audio.current.channel` and `.channelDataFactor`.
- [ ] **Step 4: Verify manually:** hover a cell → popover after ~400 ms, line at boundary, both neighbours tinted; drag → both table cells update on release; moving mouse cell→popover keeps it open; leaving closes; opens on a long file only after decode (no crash before).
- [ ] **Step 5: Commit** `feat(overview): waveform popover for boundary drag`.

### Task 4: Docs and final check

**Files:** `docs/manual/checking-your-work.md`, `docs/manual/sv/checking-your-work.md`.

- [ ] **Step 1:** Add short section "Adjust boundaries from the Overview" (en) and Swedish equivalent: Start/End columns, ▲▼ (Shift = 100 ms), hover popover and drag, start of one row = end of previous, disabled on linked tiers and first/last.
- [ ] **Step 2:** `npx nx test tratt` and `npx nx lint tratt` → pass.
- [ ] **Step 3: Commit** `docs(manual): overview boundary adjustment`.

---

## Self-review
Spec coverage: columns/format/nudges (T1–2), shared boundary + fixed ends + linked (T1–2), in-place sync (T2), popover with tinted neighbours/delay/drag/Esc/shared instance (T3), i18n + manual (T2, T4). Names consistent: `moveBoundary`, `commitBoundary`, `nudgeBoundary`, `computePeaks`.

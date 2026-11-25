# Merge Adjacent Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marking 2+ adjacent units in Dictaphone, Linear, 2D editor or Overview shows a discreet popup that merges them.

**Architecture:** One pure merge function in `libs/annotation`, one store method, one shared popup component. Each surface only detects the marked unit range, shows the popup at the pointer, and calls the store.

**Tech Stack:** Angular (standalone, OnPush), Transloco, Jest/Vitest specs next to sources, Konva audio viewer, Jodit text editor.

**Spec:** `docs/superpowers/specs/2026-11-25-merge-adjacent-units-design.md`

## Global Constraints

- A unit stores only its END time; start = previous unit's end. Merged unit: first start, last end.
- Texts joined by one space; empty or silence-only unit absorbed; surviving unit keeps first unit's id and Speaker label; `verified` = all merged units verified.
- Merge disabled when current level has `linkedToLevelId`; source level mirrors merge to linked levels.
- i18n: Transloco (sv + en keys), not `@angular/localize`.
- Commits: Commitizen conventional (`feat(merge): ...`).
- `delete_boundaries` shortcut unchanged.

## Review Focus

- Selection covering exactly one unit (no boundary strictly inside): no popup.
- Selection edge exactly on a boundary: that boundary is not "inside"; neighbouring unit is not pulled in.
- Merge range includes first or last unit of file: last end = file duration, still valid.
- Both/all texts empty, or one is silence marker: no stray spaces, no marker left in merged text.
- Linked or read-only level: popup never offered.

---

### Task 1: Pure merge + range helpers

**Files:**
- Modify: `libs/annotation/src/lib/functions.ts`
- Test: `libs/annotation/src/lib/functions.spec.ts` (create if absent)

**Interfaces:**
- Produces:
  - `mergeUnits(items: TrattAnnotationSegment[], from: number, to: number, silence?: string): TrattAnnotationSegment[]` — returns new array; units `from..to` (inclusive) replaced by clone of `items[from]` with `time = items[to].time.clone()`, text label (first label not named `Speaker`) = non-empty/non-silence texts joined by `' '`, `verified = every verified`. Input untouched; `from >= to` or out of range returns input copy unchanged.
  - `unitsCoveredBy(endTimes: number[], startSamples: number, endSamples: number): { from: number; to: number } | undefined` — `endTimes[i]` = end of unit i. Returns range when at least one `endTimes[k]` with `startSamples < endTimes[k] < endSamples` and `k < endTimes.length - 1`; `from` = first unit whose end > startSamples, `to` = first unit whose end >= endSamples.

- [ ] **Step 1: Failing tests** — `mergeUnits`: joins "a","b","c" over 0..2 → one unit text `"a b c"`, time of last; empty middle text gives `"a c"`; silence `"<p:>"` + `"x"` → `"x"`; Speaker of first kept; verified false if any false; out-of-range unchanged. `unitsCoveredBy([100,200,300], 50, 250)` → `{from:0,to:2}`; `(…, 50, 150)` → `{0,1}`; `(…, 10, 90)` → undefined; `(…, 100, 250)` → `{from:1,to:2}` (boundary 100 is the edge, not inside); `(…, 120, 180)` → undefined; selection past last boundary `(…, 250, 400)` → undefined.
- [ ] **Step 2: Run** `npx nx test annotation` — expect FAIL (not defined).
- [ ] **Step 3: Implement both in `functions.ts`**; export via lib index if functions are exported there.
- [ ] **Step 4: Run** same command — expect PASS.
- [ ] **Step 5: Commit** `feat(merge): add mergeUnits and unitsCoveredBy`

### Task 2: Annotation + store method

**Files:**
- Modify: `libs/annotation/src/lib/annotation.ts` (near `removeItemByIndex`, ~l.400)
- Modify: `apps/tratt/src/app/core/store/login-mode/annotation/annotation.store.service.ts`
- Test: `libs/annotation/src/lib/annotation.spec.ts` (add case)

**Interfaces:**
- Consumes: `mergeUnits` (Task 1).
- Produces:
  - `TrattAnnotation.mergeItemsInCurrentLevel(from: number, to: number, silence?: string): this` — no-op with `console.warn` if current level linked; otherwise merges in current level and in every `getLinkedLevelsOf(level.id)` level (same indices).
  - `AnnotationStoreService.mergeCurrentLevelItems(from: number, to: number): void` — clones `transcript`, calls the method with `silencePlaceholder`, `overwriteTranscript(clone)`.
  - `AnnotationStoreService.canMergeCurrentLevel(): boolean` — true if current level is a segment level, not linked.

- [ ] **Step 1: Failing test** — 4-unit level with a linked level: merge 1..2 → both levels have 3 items; linked-current-level call leaves items unchanged.
- [ ] **Step 2: Run** `npx nx test annotation` — FAIL.
- [ ] **Step 3: Implement** the three members as specified.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(merge): store method for merging units`

### Task 3: Shared popup component

**Files:**
- Create: `apps/tratt/src/app/core/component/merge-popover/merge-popover.component.ts` (+ `index.ts`)
- Test: `merge-popover.component.spec.ts`
- Modify: `apps/tratt/src/assets/i18n/sv.json`, `en.json` — key `merge.popover` = sv `"Slå ihop {{count}} enheter"`, en `"Merge {{count}} units"`.

**Interfaces:**
- Produces: `<tratt-merge-popover [x]="number" [y]="number" [count]="number" (merge)="…" (dismiss)="…">`. Standalone, OnPush, `position: fixed`, clamped to viewport, low-contrast small pill, `mousedown.preventDefault()`, emits `dismiss` on Esc keydown (document), `pointerdown` outside host, and ~8 s after init (CSS fade for last second). Click on pill emits `merge` once.

- [ ] **Step 1: Failing tests** — click emits `merge`; Esc emits `dismiss`; outside pointerdown emits `dismiss`; fake timers 8 s emit `dismiss`; mousedown default prevented.
- [ ] **Step 2: Run** `npx nx test tratt --testFile=merge-popover` — FAIL.
- [ ] **Step 3: Implement** per interface.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(merge): shared merge popover`

### Task 4: Linear + 2D editors

**Files:**
- Modify: `apps/tratt/src/app/editors/linear-editor/linear-editor.component.{ts,html}`
- Modify: `apps/tratt/src/app/editors/2D-editor/2D-editor.component.{ts,html}`

**Interfaces:**
- Consumes: `unitsCoveredBy`, `AnnotationStoreService.mergeCurrentLevelItems/canMergeCurrentLevel`, `tratt-merge-popover`.
- Produces in each editor: `mergeOffer: { x: number; y: number; from: number; to: number } | null`; `onViewerMouseUp(e: MouseEvent, viewer: AudioViewerComponent)`: after `setTimeout(0)`, read `viewer.av.drawnSelection`; if `canMergeCurrentLevel()` and `unitsCoveredBy(items.map(i => i.time.samples), sel.start.samples, sel.end.samples)` → set `mergeOffer` at `e.clientX/clientY`, else null. `confirmMerge()` calls store merge with `from/to`, clears offer and the viewer selection (`drawnSelection` start=end=0 as `handleDeleteBoundaries` does). Linear: wire both `signalDisplayTop` and `signalDisplayDown`; 2D: `viewer`. Add popover to template with `[count]="to - from + 1"`.

- [ ] **Step 1:** Add handler, template wiring, popover.
- [ ] **Step 2: Verify manually** (`npx nx serve tratt`, load a file with several units): drag across 3 units → popup at pointer, click merges to one unit with joined text; drag inside one unit → no popup; Esc dismisses; undo restores. Check selection tint is faint (adjust `applyThemeColors` `selection.color` alpha only if too strong).
- [ ] **Step 3: Commit** `feat(merge): offer merge after drag selection in linear and 2D editors`

### Task 5: Dictaphone

**Files:**
- Modify: `apps/tratt/src/app/editors/dictaphone-editor/dictaphone-editor.component.{ts,html}`
- Create: `apps/tratt/src/app/editors/dictaphone-editor/selected-boundaries.ts` + `.spec.ts`

**Interfaces:**
- Produces: `selectedBoundarySamples(rawText: string, sel: { start: number; end: number }): number[]` — samples N of every `{N}` token fully inside `[start,end)` of `rawText`, in order.
- Component: `mergeOffer` as Task 4; `onEditorMouseUp(e: MouseEvent)` (bound `(mouseup)` on `<tratt-transcr-editor>`): after `setTimeout(0)` take `editor.textSelection`; if collapsed/undefined or `selectedBoundarySamples` empty → null; else offer with `from/to` unresolved. `confirmMerge()`: `saveTranscript()` first; resolve indices from store items (`from` = index of item with `time.samples === first`, `to` = index of item with `time.samples === last` + 1); `mergeCurrentLevelItems`; `loadEditor()`; `cdr.markForCheck()`. Count shown = tokens + 1.

- [ ] **Step 1: Failing spec** for `selectedBoundarySamples`: `"a {10} b {20} c"` selecting whole → `[10,20]`; selection cutting through a token → excluded; collapsed → `[]`.
- [ ] **Step 2: Run** `npx nx test tratt --testFile=selected-boundaries` — FAIL.
- [ ] **Step 3: Implement** helper, then component wiring.
- [ ] **Step 4: Run** — PASS. Verify `editor.rawText` is current at mouseup (if stale, call the editor's raw-text refresh before reading); manual check: mark text over 2 boundaries → popup → merge → editor shows one unit, no `{N}` between, single space.
- [ ] **Step 5: Commit** `feat(merge): offer merge for marked text in dictaphone`

### Task 6: Overview

**Files:**
- Modify: `apps/tratt/src/app/core/component/transcr-overview/transcr-overview.component.{ts,html,css}`

**Interfaces:**
- Consumes: store merge methods, `tratt-merge-popover`.
- Produces: `marked: { anchor: number; head: number } | null`; `markedRange(): {from:number;to:number} | null` (sorted); `onNumberPointerDown(i, e)` (shift → extend from `anchor`, else start new at `i`), `onNumberPointerEnter(i)` (extends `head` while pointer held), `onNumberPointerUp(e)` (if range length ≥ 2 and `boundaryEditable`-style linked check passes → `mergeOffer` at pointer); `clearMarked()` on Esc/outside click/after merge. Rows in range get class `row-marked` (css: faint `background-color` ~12% alpha). Existing `#` button click still calls `onSegmentClicked(i)` when range is a single row. `confirmMerge()` → `mergeCurrentLevelItems(from, to)`, clear, `closePopover()`; `syncShownSegments` rebuilds rows.

- [ ] **Step 1:** Implement state, handlers, template classes/events, popover.
- [ ] **Step 2: Verify manually**: drag over `#` cells of 3 rows → tinted, popup at pointer → merge → 1 row with joined text; single click still opens segment; linked level → no popup.
- [ ] **Step 3: Commit** `feat(merge): mark rows in overview and offer merge`

### Task 7: Final check

- [ ] `npx nx lint tratt && npx nx test tratt && npx nx test annotation` — all pass.
- [ ] Confirm `delete_boundaries` shortcut still works (manual).

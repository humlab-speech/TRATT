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

No interactive browser or app-launch tooling was available in the
execution environment for this task (no `run`/`browse` skill tooling,
no click/screenshot capability) — live, in-browser verification of
TRN-Editor was **not performed**. This is a human-verification item,
not a fabricated observation.

What was verified statically instead:
- `npx nx build tratt` succeeds with the registry change in place
  (production build, AOT template compilation included). This
  confirms `TrnEditorComponent`'s template/component wiring is
  structurally valid — a broken template binding would have failed
  AOT compilation.
- `apps/tratt/src/app/core/pages/intern/intern.module.ts` already
  declares/exports both `TrnEditorComponent` (via the `EDITORS` array,
  lines 46-51/92/116) and `PermutationsReplaceModalComponent` (lines
  22/100/124) — no module changes were needed, confirming the brief's
  assumption.
- Traced the selection path: `apps/tratt/src/app/core/component/navbar/navbar.component.ts`
  reads `editorComponents` to populate the switcher UI →
  `apps/tratt/src/app/core/pages/intern/transcription/transcription.component.ts`'s
  `changeEditor(name)` (~line 612) matches the selected name against
  `editorComponents`, then does
  `viewContainerRef.createComponent<TRATTEditor>(comp)` — a standard
  Angular dynamic-component instantiation with no editor-specific
  branching. Nothing in this path inspects TRN-Editor's internals, so
  selecting it from the switcher should create the component without
  throwing, consistent with the brief's expectation.
- Confirmed the four stub methods (`enableAllShortcuts`,
  `disableAllShortcuts`, `afterFirstInitialization`, `openSegment`) are
  still empty/comment-only, matching this doc's inventory above. Since
  `afterFirstInitialization()` is a no-op, selecting TRN-Editor and
  loading a task will not error there, but will also visibly do
  nothing where the working editors would size/prepare the view.

**Side-effect found and resolved**: `changeEditor()` has a fallback —
when called with an empty/undefined interface name, it defaults to
`editorComponents[editorComponents.length - 1]` (~line 620), i.e. "the
last registered editor." Before this task, that was
`TwoDEditorComponent` (fully functional). Appending TRN-Editor to the
end of the array had made it the new empty-name fallback, silently
downgrading that edge case from a working editor to a broken one.

Fixed: `apps/tratt/src/app/editors/components.ts`'s `editorComponents`
array was reordered so `TrnEditorComponent`'s entry now comes before
`TwoDEditorComponent`'s (Dictaphone, Linear, TrnEditor, TwoD), keeping
`TwoDEditorComponent` as the last entry. This closes the regression —
the empty-name fallback still resolves to the working 2D editor,
unchanged from before this task. TRN-Editor remains fully selectable
by name from the switcher UI regardless of its position in the array,
since selection there is name-based, not position-based.

## Suggested next step
Dedicated plan, one task per commented block, each task: read the block,
check whether `TrattEditor`/`transcrService`'s current API still matches
what the block calls, restore-or-rewrite-or-delete, add a test.

Additionally: a human should do the live-browser walkthrough this task
could not (open a short, <35s task, select TRN-Editor from the
switcher, confirm it loads and note what's visibly broken/missing),
and separately decide whether the `changeEditor()` empty-name fallback
ordering above needs a fix before or alongside the restoration plan.

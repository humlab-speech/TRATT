# Merge adjacent units — design

## Intent
Let users fix over-segmentation: mark 2+ adjacent units and accept a discreet popup to merge them. Works in Dictaphone, Linear, 2D editor and Overview.

## Goals
- Marking 2+ units shows a small, ignorable popup at the pointer; clicking it merges them.
- Merged unit: first start, last end (units store only END; start = previous end), texts joined by one space.

## Non-goals
- Keyboard-selection popup in Dictaphone. Changing `delete_boundaries` shortcut. Merging on linked levels.

## Approach (chosen; one sensible way)
Single pure merge function + single shared popup, used by all four surfaces.

1. `libs/annotation`: pure `mergeUnits(items, from, to, silence?)` + spec; `TrattAnnotation.mergeItemsInCurrentLevel(from, to)` mirrored onto linked levels; store method cloning transcript + `overwriteTranscript` (keeps undo/autosave). Pure `unitsCoveredBy(boundaries, startSamples, endSamples)` → `{from,to}` when >=1 boundary strictly inside.
2. `MergePopoverComponent` (`core/component/merge-popover/`): inputs x,y,count; outputs merge,dismiss; low-contrast pill; `mousedown.preventDefault`; dismiss on Esc/outside click/new selection/~8 s fade. Transloco sv+en.
3. Dictaphone: `(mouseup)` on transcr-editor; count `{N}` tokens in `textSelection`; on click `saveTranscript()` → map samples to indices → store merge → `loadEditor()`.
4. Linear / 2D: `(mouseup)` on viewers; read `av.drawnSelection`; `unitsCoveredBy`; popup.
5. Overview: drag/shift-click on `#` cells marks rows (faint tint); pointer-up with >=2 rows shows popup; click elsewhere/Esc clears; reuse `syncShownSegments` rebuild.

## Decisions
- Surviving unit keeps first unit's id and Speaker; empty/silence-only unit absorbed; `verified` = all verified.
- Disabled when current level is linked.

## Left to builder
Popup styling, exact fade timing, tint alpha.

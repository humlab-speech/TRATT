# Overview: adjustable Start/End columns + waveform popover

Approved by user 2026-11-24 (start/end move together confirmed).

## Intent
Fine-tune utterance boundaries from the Overview modal without opening an editor.

## Goals
- Start and End columns in the Overview transcript table (`transcr-overview`), between `#` and Transcription.
- Each cell: time as `mm:ss.mmm` (`h:mm:ss.mmm` from 1 h) plus small ▲▼ nudge.
- Hover/focus on a time cell, 400 ms delay, opens a waveform popover around that boundary; drag the line to adjust.

## Non-goals
- Typed exact times, hold-to-repeat, popover playback, undo, changing `verified`.

## Constraints (from code)
- A segment stores only its end `time`; start = previous segment's end. End of #n and Start of #n+1 are one boundary; moving either moves both cells. Preceding interval (transcribed or pause) end shifts with a Start edit.
- Row 1 Start and last End fixed (arrows disabled).
- Linked tiers (`linkedToLevelId`) reject boundary edits: arrows and drag disabled, tooltip.
- `syncShownSegments` (`transcr-overview.component.ts`) full-rebuilds when any `end` differs. Must patch timing-only changes in place (same count, text/labels unchanged).
- Audio: `audioManager.channel` (Float32Array, downsampled by `channelDataFactor`); may be undefined until decoded, then popover shows nothing/disabled.

## Approaches
1. Reuse `AudioViewerComponent` in popover: has boundary drag already, but Konva + 4 services per instance, built for full display. Rejected.
2. **Chosen:** small own canvas component, min/max per pixel from `channel`, ±1.5 s window, pointer-drag line, both neighbour segments tinted.
3. `ngbPopover` per cell: 1400 directives, closes on leaving host so drag inside popover fails. Rejected; one shared `position: fixed` popover instead (modal scroll container clips absolute).

## Design
- Pure helper `moveBoundary(level, i, newSamples)`: clamps to (prev end + 10 ms, next end − 10 ms), returns clamped samples; rejects i = last. Unit-tested.
- Commit: clone segment i with new `time`, `annotationStoreService.changeCurrentItemById` (autosave + linked mirroring).
- Click ±10 ms, Shift ±100 ms. Drag commits on release; Esc cancels drag.
- Overview patches `shownSegments` start/end in place on timing-only change.
- i18n keys en + sv; manual `checking-your-work.md` en + sv updated.

## Builder's calls
Min segment 10 ms, window ±1.5 s, hover delay 400 ms, format, step sizes.

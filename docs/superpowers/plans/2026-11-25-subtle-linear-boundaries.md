# Subtle Unit Boundaries in the Linear Editor

**Goal:** Unit boundaries in the Linear Editor stop dominating the waveform, yet stay findable, grabbable and unambiguous.

## Findings (current state)

- Every boundary is a full-height Konva `Line`, `strokeWidth: 3`, solid `--tratt-boundary` (`#1E989F`), no opacity (`audio-viewer-renderer.service.ts` ~l.1696, config default `boundaries.width: 3` in `audio-viewer.config.ts`).
- The Linear Editor top display squeezes the whole file into ~1400 px: a 1:45 file with 32 units is already a wall of thick teal bars (see `docs/assets/visp_tratt_linear_editor.png`); longer files are worse.
- The same 3 px stroke is also the hit target, so dense clusters already needed `MIN_BOUNDARY_GRAB_SPACING_PX` (renderer, l.~231).
- Lower (loupe) display shows few boundaries; it is where precise placement happens and needs clarity, not suppression.
- 2D editor and Dictaphone share the viewer; their look must not change.

## Design

1. **Per-viewer styling, linear editor only.** Extend `AudioviewerConfig.boundaries` with optional `opacity` and `style: 'line' | 'tick'` (defaults keep today's look). Linear editor sets them in `ngOnInit` on `signalDisplayTop.settings` / `magnifierSettings` (`linear-editor.component.ts` ~l.495, ~l.518).
2. **Overview (top) display: ticks, not lines.** Draw the boundary as a 1 px line at ~50 % opacity, or a short tick over the text strip only, instead of a full-height bar. Waveform stays unobstructed.
3. **Loupe (bottom) display: thin but clear.** 2 px, ~75 % opacity.
4. **Emphasis on demand.** Boundaries of the selected/entered unit, the hovered boundary and a boundary being dragged render at today's 3 px, 100 %. This keeps "where does this unit start/end" instantly answerable.
5. **Hit area decoupled from the look.** Set Konva `hitStrokeWidth` (≈8 px) so a 1 px line is as grabbable as before; keep the dense-cluster rule.
6. **Colour via token.** Prefer one new token `--tratt-boundary-subtle` (light/dark values, alpha baked in) over per-site alpha math; add to `tratt-colors.ts` and the theme CSS next to `--tratt-boundary`. Check ≥3:1 non-text contrast for the emphasised state; the subtle state is decorative because the unit text strip also marks the unit.
7. **Docs.** Update `the-editors.md` wording/screenshot if the screenshot shows bars.

## Tasks (one commit each)

1. **Config + renderer:** `opacity`, `style`, `hitStrokeWidth`; defaults unchanged. Renderer spec asserts Line props for default vs subtle; existing viewer specs stay green.
2. **Token + linear editor wiring:** add token, set subtle config for both displays.
3. **Emphasis:** selected unit / hover / drag restyle (re-render only the affected boundary ids, not the whole stage).
4. **Visual check in Chrome** on the demo file and a synthetic 300-unit transcript (dense case), light and dark theme; refresh screenshot and manual.

## Risks / open questions

- Does the user want ticks (shape change) or just thinner/translucent lines? Default plan: thinner + translucent first, ticks only if still too heavy.
- Accessibility: faint boundaries are harder for low-vision users. Mitigation is the emphasis state plus the unit text strip; consider a settings toggle ("Prominent boundaries") if feedback says so.
- Shared renderer: keep all new options opt-in so the 2D editor is untouched.

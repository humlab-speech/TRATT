# /workbench — compact pipeline panel — 2026-10-06

Amendment to the workbench rail. The pipeline settings (auto-transcribe,
language, model, speaker separation, translation) are always fully open and
dominate the left panel. The rail should only show *that* a pipeline is set
up and what it does; the details open from an icon and stay editable there.

**Status: done.** Implemented as planned (option C), plus one change found
in the browser: the dialog is anchored near the top (`margin: 8vh auto
auto`) instead of centred, because its height changes from 175 to 732 px as
options are ticked and a centred dialog jumped each time. Pipeline section
in the rail: 701 → 158 px.

## Measured today (Chrome, 1268×1069 window, two files listed)

| Rail part | Height |
|---|---|
| File list | 149 px |
| Upload / Record tabs + dropzone | 199 px |
| **Pipeline settings** (transcribe 372 + translate 257 + run button) | **701 px** (55 % of the rail) |
| Browser storage / memory | 159 px |
| Whole rail (scrolls) | 1271 px |

The "Transcribe N file(s)" button and the storage readout are below the fold.

## Options evaluated (live prototypes in the running app)

All three share the same collapsed state: a summary card in place of the
settings — status dot, "Auto-transcribe on/off", chips for model, language,
speakers and translation target, and a settings icon. Collapsed, the
pipeline section is **166 px** and the whole rail fits the window.

| | A. Reveal inline | B. Popover beside the rail | C. Dialog |
|---|---|---|---|
| Open state | Settings expand under the summary | Floating panel next to the summary, over the editor | Centred modal dialog, 440 px wide |
| Fits at 1069 px height | No — rail grows to 1374 px (taller than today), Translate needs scrolling | No — panel needs its own scrollbar | **Yes — everything visible, labels on one line** |
| Context while editing | Summary visible | Summary visible | Summary visible behind the backdrop |
| Covers the editor | No | Partly | Yes (modal) |
| Dismiss | Icon again | Outside click / × | Done, ×, Esc, backdrop |
| Small laptop screens (~800 px) | Long scroll | Cramped | Dialog scrolls internally, still one surface |

**Choice: C, a dialog.** The settings are changed rarely and the summary is
the everyday view; when they are changed, the dialog shows them all at once
with room for the long labels. A recreates the original problem whenever it
is open; B is cramped at normal laptop heights. (Comparison image:
`pipeline-panel-options.png` from the session.)

## Constraint that shapes the implementation

The settings components restore the remembered choices (`persistKey`) and
emit them in their own `ngOnInit`; the queue gets its options only from those
emissions. A dialog that creates its content on open (`NgbModal`) would leave
the queue with no options — auto-transcription silently off — until the user
opened it. So the components must stay mounted while closed.

→ Use a native `<dialog>` in the workbench template that always contains the
two components. Closed, it is `display: none` but its content exists;
`showModal()` gives the top layer, backdrop, focus containment and Esc for
free. No state moves, `/local` is untouched.

## Changes

1. **`describePipeline()`** (pure, new `pipeline-summary.ts` next to the
   workbench): from `TranscriptionOptions | null` and
   `TranslationOptions | null` → `{ on, model, language, speakers, translateTo }`:
   - model: the radio label's short form (`Whisper Tiny`, `Whisper
     Large-v3-turbo`) looked up across all model lists by `modelId`;
   - language names via `Intl.DisplayNames` in the UI language (fallback:
     the code), first letter capitalised;
   - speakers: a number, `'auto'`, or absent when separation is off;
   - translation target only when translation is on.
2. **Workbench template**: in `.workbench__queue`, replace the two option
   components with a summary card and the icon button (`bi-sliders`,
   `aria-haspopup="dialog"`, accessible name "Pipeline settings"); move the
   components into `<dialog class="workbench__pipeline-dialog"
   aria-labelledby>` with a title, × and Done. The run button stays in the
   rail under the summary.
3. **Workbench class**: `openPipelineSettings()` (`showModal()`, falls back to
   the `open` attribute where unsupported, e.g. jsdom), close on Done / × /
   backdrop click, focus back on the icon button.
4. **Styles**: summary card (border, status dot, wrapping chips); dialog
   `width: min(440px, 100vw - 32px)`, `max-height: 86vh`, scrolling body,
   `::backdrop` dim.
5. **i18n** (all 7 locales): `workbench.pipeline.on`, `.off`,
   `.off_detail`, `.speakers_one`, `.speakers_other`, `.speakers_auto`,
   `.translate_to`, `.edit`, `.dialog_title`, `.done`, `.close`.

## Tests

- `pipeline-summary.spec.ts`: off; on with model, language, speakers and
  translation; automatic speaker count; one speaker; no translation; unknown
  model id falls back to the id.
- Workbench spec: the settings components are rendered while the dialog is
  closed (options still reach the queue); the summary shows the chips for
  given options and "off" for `null`; the icon opens the dialog; Done closes
  it and returns focus to the icon.

## Verification

Jest (full suite), `tsc`, ESLint on changed files. Chrome on `127.0.0.1`:
collapsed rail height; open with the icon, change model/speakers/translation
and see the summary follow; Esc, ×, Done and backdrop close it; focus
returns to the icon; reload keeps the settings and the summary shows them
without opening the dialog; a dropped file is still auto-transcribed.

Done on `127.0.0.1:5321` (Chrome): rail fits the window (pipeline 158 px);
summary after reload shows the remembered settings without opening the
dialog; changing model and speakers inside the dialog updates the summary
live; off state reads "Auto-transcribe off"; Esc, backdrop and Done close
it and focus returns to the icon; with a 320 px dialog the body scrolls and
Done stays visible; a file dropped after a fresh load (dialog never opened)
is auto-transcribed; no console errors. Jest 68 suites / 730 tests, tsc
clean, ESLint 0 errors on changed files.

## Known edge

While the dialog is open the rest of the page is inert. A dialog the app
opens meanwhile (e.g. the "replace transcript?" question for a file that
finished decoding) appears once the pipeline dialog is closed.

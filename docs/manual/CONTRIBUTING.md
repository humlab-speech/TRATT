# Maintaining this manual

Notes for whoever edits these files or wires them into the app. Not part of the
user-facing manual.

---

## Who the manual is written for

Two audiences, in this order:

1. **The walk-in user.** Someone who found TRATT, has a recording, and has never
   used an annotation tool. They get [`quick-start.md`](quick-start.md): one linear
   path, no branching, no jargon before it is defined, and a result on disk at the
   end. Everything else is optional to them.
2. **The working transcriber.** Someone who spends hours in the tool.
   [`transcribing.md`](transcribing.md) explains the model once;
   [`shortcuts.md`](shortcuts.md) is the page they keep open.

Administrators and developers are deliberately *not* an audience here. Configuration
and deployment belong in the repository README and the upstream OCTRA manual;
mixing them in is what makes the OCTRA manual hard for a first-time user.

## Conventions

- **Every page opens with a bold `**For:**` line.** If you cannot name the reader,
  the page does not have a job.
- **Task titles, not feature titles.** "Checking your work", not "The Overview
  modal".
- **Quote the interface exactly.** Labels in the manual must match the English
  strings in `apps/tratt/src/assets/i18n/en.json`. When you change a label there,
  grep this directory for the old text.
- **Reference material is tables.** Shortcuts, formats and options are looked up,
  not read.
- **No em dashes in the prose.** Use a comma, a colon or a full stop. The only
  exception is text quoted from the application, which keeps whatever the
  interface says.
- **The sidebar sections mean something.** "One recording at a time" and "Many
  recordings" are the two ways of working, and a new page belongs in whichever
  one its reader is in. `NAV` in `scripts/build-manual.mjs` is the source of
  truth for the order.
- **Say when something does not work.** This version of TRATT has an unfinished
  TRN-Editor and an unreachable Tools dialog. Documenting them as working costs
  more trust than the features are worth. When one is fixed, delete the caveat.
- **Screenshots** live in `docs/assets/` and are referenced as `../assets/…`, so the
  pages render correctly on GitHub as well as in a generated site. Re-shoot them
  when the interface changes; a stale screenshot is worse than none.

## The anchor contract

The application deep-links into the manual. These targets must keep working:

| Linked from | Target |
| --- | --- |
| `modals/tools-modal/tools-modal.component.html:62` | `using-tools.html#tratt-combine-units` |
| `modals/tools-modal/tools-modal.component.html:187` | `using-tools.html#cutting-audio-files` |

Both anchors are declared explicitly as `<a id="…">` in
[`using-tools.md`](using-tools.md) so that they survive a heading rewrite. Do not
delete them. If you add a new deep link from the app, add its explicit anchor here
in the same commit.

## How the manual reaches readers

The Markdown files in this directory are the source of truth. Nothing is written
by hand twice.

```
docs/manual/*.md        English      docs/manual/sv/*.md     Swedish
  → scripts/build-manual.mjs   (markdown-it + scripts/manual-assets/)
  → dist/manual/*.html    (en)   dist/manual/sv/*.html  (sv)
  → gh-pages:/manual           published by .github/workflows/main.yml on push to main
  → https://humlab-speech.github.io/TRATT/manual/  and  …/manual/sv/
```

Locally:

```bash
npm run validate:manual   # links, anchors and in-app deep links
npm run build:manual      # renders to dist/manual, then re-checks the output
```

The application finds the published site through `tratt.manual.url` and
`tratt.manual.pageExtension` in `apps/tratt/src/config/appconfig.json`
(`AppInfo.applyManualSettings`). `AppInfo.manualLink(page, anchor?)` builds every
deep link from those two values, so moving the manual is a configuration change,
not a code change.

Adding a page: create the Markdown file, then add it to the `NAV` array in
`scripts/build-manual.mjs`. The build fails if a published page is missing from
`NAV`, or if `NAV` names a page that does not exist. A new page cannot be
silently left out of the navigation. `CONTRIBUTING.md` is listed in `UNPUBLISHED`
and stays in the repository.

Both CI checks run before the deploy, and the generator re-validates the HTML it
produced, so a broken link fails the build rather than reaching readers.

## Languages

English is the default and lives at the root of the site; every other language
lives in a subdirectory named after its code. Adding one means adding an entry to
`LOCALES`, `UI` and `NAV_LABELS` in `scripts/build-manual.mjs`, the same entry to
`LOCALES` in `scripts/check-manual-links.mjs`, and to `tratt.manual.locales` in
`appconfig.json`. The app then links to it whenever the interface is set to that
language.

Four rules keep the translations honest:

- **A page that has not been translated is not a hole.** The build falls back to
  the English text and prints a notice in the reader's language at the top of the
  page, so navigation stays complete and nobody hits a dead link. `npm run
  build:manual` lists every page that fell back.
- **Explicit anchors must be carried over verbatim.** A translated page has
  translated headings, so heading-derived anchors change, but every `<a id="…">`
  in the English page must exist with the same id in the translation, because the
  app deep-links into the manual *in the interface language*. The link checker
  verifies each `manualLink()` call against every language and fails if an anchor
  is missing from one of them.
- **A translated page with no English counterpart fails the build.** It is a typo,
  not a new page.
- **Quote the interface in the reader's language.** Swedish pages use the Swedish
  strings from `apps/tratt/src/assets/i18n/sv.json`. Where the interface is *not*
  translated (the marker toolbar, since `guidelines_sv.json` is still English; *Add
  empty level*; *Add translated tier…*; *Speaker separation*; the Finnish and
  Norwegian model descriptions), the Swedish manual gives the English label and
  says why, rather than inventing a translation the reader will never see on
  screen. When one of those is translated in the app, update the manual with it.

Swedish also documents two app bugs as facts of life: several Whisper model labels
in `sv.json` read "Liten" regardless of size, so the manual tells readers to go by
the MB figure. Remove that note when the strings are fixed.

## Verification status

Checked against TRATT running at `localhost:5321` on 2026-10-08, after the
Workbench landed: the start page and its state-dependent submit button, the
Workbench (file list, drop area, pipeline settings and summary, capacity meters,
restored-session state with "Attach file…", remove-with-confirmation), the editor
toolbar in both places, and the export dialog. The Workbench chapter's statuses,
stages and error wordings come from `en.json` and `sv.json` rather than from a
forced failure of each kind.

Not exercised live, and therefore still source-derived only:

- a real queue run: model download, the stage sequence, cancel and retry;
- writing and re-loading an export archive;
- browser recording (microphone permissions, level meter, crash recovery);
- the Linear Editor's two-display shortcuts;
- boundary refusal messages;
- the Cut-audio and Combine-units tools, which have no UI entry point to reach.

The Workbench has no screenshot yet. `docs/assets/` is where one belongs, and the
page is written so that adding one is a one-line change.

## Caveats to delete when the app changes

Each of these is documented as a limitation. When the underlying issue is
resolved, remove the caveat in the same commit:

| Issue | Where the manual says so |
| --- | --- |
| Workbench gated to development builds (`environment.*.ts: workbenchEnabled`) and reachable by URL only | `workbench.md`, `index.md`, `troubleshooting.md` |
| Workbench has no name of its own in the interface, so the manual supplies one | `workbench.md` (Swedish: "Arbetsbänken") |
| TRN-Editor unfinished and not offered | `the-editors.md`, `shortcuts.md`, `coming-from-octra.md` |
| Tools dialog has no UI entry point (`openToolsModal()` has no caller) | `using-tools.md`, `coming-from-octra.md` |
| Guidelines window absent from the Workbench toolbar | `workbench.md`, `shortcuts.md` |
| `/help-tools` not linked from anywhere | `troubleshooting.md`, `privacy.md` |
| Swedish marker labels still English (`guidelines_sv.json`) | `sv/transcribing.md`, `sv/shortcuts.md` |
| Swedish Whisper model labels mis-sized in `sv.json` ("Liten" regardless of size) | `sv/automatic-transcription.md` |

Fixed since the manual was first written, and no longer mentioned: the cloud
ASR/MAUS feature (removed from the app), the raw `modal.shortcuts.cycle_speaker`
key in the Shortcuts window, and the navbar GitHub link.

## Facts that will go out of date

Check these against the source when TRATT is updated:

| Fact in the manual | Source of truth |
| --- | --- |
| Model names, sizes, WebGPU requirements | `component/tratt-dropzone/auto-transcribe-options.component.ts` |
| Diarization model | `shared/service/local-diarization-runtime.service.ts` |
| Supported media formats and size limits | `libs/web-media/src/lib/audio/AudioFormats/*.ts` and `AppInfo.maxAudioFileSize` |
| Export/import formats and their options | `libs/annotation/src/lib/converters/` and `app.info.ts` |
| Keyboard shortcuts | `editors/*/*.component.ts`, `libs/ngx-components/.../audio-viewer.config.ts`, `pages/intern/transcription/transcription.component.ts` |
| Markers | `apps/tratt/src/config/localmode/guidelines/guidelines_*.json` |
| Which editors and tools are enabled | `apps/tratt/src/config/localmode/projectconfig.json`, `editors/components.ts` |
| Workbench statuses, stages, errors and capacity wording | `workbench.*` in `apps/tratt/src/assets/i18n/en.json` |
| Whether the Workbench is reachable | `workbenchEnabled` in `apps/tratt/src/environments/*.ts`, `shared/guard/workbench-enabled.guard.ts` |
| Pipeline summary line | `core/pages/workbench/pipeline-summary.ts` |
| Archive name and contents | `core/shared/service/catalogue-export.service.ts`, `catalogue-import.ts` |
| Start-page submit button wording | `core/pages/login/offline-submit-label.helper.ts` |

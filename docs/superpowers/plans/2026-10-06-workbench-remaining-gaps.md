# /workbench — revision plan for the remaining P1 gaps — 2026-10-06

Follow-up to `2026-10-03-workbench-stability-assessment.md` (rows 1–35,
committed as `75c8f6b` on `fix/workbench-stability`). Four gaps were left
open; this plan fixes them, plus one bug found while planning.

**Status: done** — G1, G2, G4, G5 in `de29ec1`; G3 and the follow-ups in the
next commit. Recorded as rows 36–43 of the assessment. Deviations from the
plan, found while verifying in the browser:

- A restored file (audio not attached) *can* take a dropped transcript: its
  timing comes from the stored transcript, as for export (row 41), instead
  of "Attach …'s audio first", which now shows only when neither exists.
- Restored files' rows became selectable and the "Welcome back" pane shows
  the selected file's header, so G2's export is reachable after a reload.
- Two bugs fixed on the way: dropzone rows not re-rendering (row 42) and
  imported transcripts of restored files not persisted (row 43).

| Gap | User-visible problem | Section |
|---|---|---|
| G1 | Dropping a file that is already in the list (with its audio) adds an identical row. | [G1](#g1-duplicate-drops) |
| G2 | "Export this transcription" is disabled until the file's audio is attached — after a reload, nothing can be exported per file. | [G2](#g2-export-without-audio) |
| G3 | A transcript dropped after the first batch is ignored; in a multi-file drop the transcript is paired with whichever audio decoded last. | [G3](#g3-pair-transcripts-by-basename) |
| G4 | Closing or reloading the tab while files are transcribing, decoding or saving (or with an un-exported recording) loses work silently. | [G4](#g4-leaving-with-work-in-flight) |
| G5 | (found while planning) Dismissing any modal by clicking outside it / Esc logs an unhandled "ERROR 0". | [G5](#g5-modal-dismissal) |

Decisions taken without asking (stated here so they are easy to revisit):

- A **duplicate** is a dropped file whose name, size and type equal a file
  already in the list that has its audio this session (or an earlier file in
  the same drop). It is skipped with a notice, never added. Files that are in
  the list but *waiting* for audio are re-attached instead (row 30).
- A **dropped transcript replaces** an existing transcript only after a
  yes/no confirmation when that transcript has content; an empty one (fresh
  file, blank seed) is replaced directly.
- **Export without audio** uses the same media resolution as the catalogue
  export: registration-time media info, else the transcript's own timing.
- **Leave warning** uses the browser's standard "Leave site?" dialog — custom
  text is not supported by browsers.

## G1. Duplicate drops

**Where:** `WorkbenchComponent.onFilesChanged()` already splits a drop into
`reattach` (waiting bundles) and `fresh` (new bundles) via
`matchAwaitingBundles()`.

**Change:** extend the split to three groups:

1. `reattach` — unchanged.
2. `duplicates` — the fingerprint (name + size + normalized MIME type)
   matches a bundle whose audio is available (`AudioService.canRestore`),
   or an entry earlier in the same drop.
3. `fresh` — the rest.

Duplicates are consumed from the dropzone and their decoded `AudioManager` is
destroyed (it was never registered — otherwise it leaks). One `info` alert
names the skipped files. When a drop consisted only of duplicates, the first
matching file is selected (flush pending edits first), so dropping a file
again "opens" it.

**Tests (workbench spec):** duplicate of a loaded file → no `createBundle`,
manager destroyed, entry consumed, alert shown; two identical files in one
drop → one bundle; duplicate-only drop selects the existing bundle; a file
with the same name but different size is still added.

## G2. Export without audio

**Today:** the header button is disabled while `editorPlaceholder !==
'none'`; `ExportFilesModalComponent` reads `AudioService.current` for the
serialisation (file name, sample rate, duration), `getOAudioFile()` for the
converters, `playPosition` for logging and `info.name` for the protocol file.
Restored files show no header at all (no media info → no header → no button).

**Change:**

- `CatalogueExportService.resolveBundleMedia(bundleId)` — the existing
  private `resolveMedia()` made public (media info → resident manager →
  transcript timing). Returns `{ oAudioFile, sampleRate, duration }`.
- `ExportFilesModalComponent` accepts optional `media` modal data. All audio
  reads go through one `exportMedia` getter: the passed `media`, else
  `AudioService.current` (unchanged for /local and the navbar). `playPosition`
  logging tolerates no audio (`playpos` is optional).
- `WorkbenchComponent.exportSelected()` resolves the selected bundle's media
  and opens the modal with it (no more `navbarServ.doclick('export')` from the
  header). If nothing can be resolved (no audio, empty transcript) it shows a
  warning alert instead of a broken dialog.
- The header renders for restored files too (name from the bundle's
  `sessionFile`, meta "audio not attached"), so the button is reachable; it is
  no longer disabled while audio is missing.

**Tests:** `catalogue-export.service` (public resolver: media info,
transcript-derived); export modal unit test (serialises with passed media and
no `AudioService.current`); workbench (button enabled without audio, opens
the modal with resolved media; warning when unresolvable; header for a
restored file).

## G3. Pair transcripts by basename

**Today:** `TrattDropzoneService` keeps one transcript (`_oannotation`),
imported against the *last decoded* audio (`_oaudiofile`); a new transcript
evicts the previous one. The workbench passes it to `loginLocal()` for the
first bundle of the first drop only. Later drops never read it.

**Change — dropzone (opt-in, /local unchanged):**

- New flag `pairTranscriptsByBasename` (the workbench sets it together with
  `allowMultipleAudio`). In this mode:
  - a new transcript does not evict earlier ones;
  - each transcript is imported against the audio with the same basename
    (`transcriptBasename()` strips the longest known converter extension,
    e.g. `_annot.json`, `.TextGrid`; audio basename = name without extension):
    first a valid audio entry in the dropzone, else
    `externalAudioFor(basename)` — a resolver the workbench provides for
    files already in the list (an `OAudiofile` built from registration-time
    media info);
  - the result is stored on the entry (`FileProgress.annotation`,
    `FileProgress.pairedBasename`); `_oannotation` stays unset;
  - while the matching audio is still decoding the transcript stays
    `waiting`; with no match it becomes `invalid` with an explanation
    ("No recording named …"; "Attach …'s audio first"); a second transcript
    for the same recording in one drop is `invalid` ("already used").
- The converter loop and the segment padding move into one
  `importTranscript(entry, audio)` helper used by both modes.

**Change — workbench:**

- An audio entry is ingested only when no transcript with its basename is
  still pending (`progress`/`waiting`) — so a recording and its transcript
  are created together, in every wave (generalises the first-wave deferral).
- Pairing → bundle:
  - first bundle of the first drop: passed to `loginLocal()` as today;
  - other first-drop files (created by `onLoginLocal$`) and later waves: the
    transcript is applied with `setBundleTranscript` once the bundle exists
    (a `pendingTranscripts` map drained by the existing store effect), which
    also persists it via `saveBundleTranscript$`;
  - files already in the list (transcript-only drop): applied directly, after
    a yes/no confirmation when the bundle's transcript has content; the
    editor is remounted if it shows that file.
- Bundles that receive a transcript are not auto-enqueued for ASR.
- Applied transcripts are consumed from the dropzone; a success alert names
  the file.

**Tests:** dropzone service (pair mode: two audio + two transcripts pair
correctly regardless of decode order; transcript before its audio waits;
no match → invalid with message; external resolver used; legacy mode
unchanged); workbench (later-wave audio + transcript → bundle created with
transcript and not enqueued; transcript-only drop → applied to the existing
bundle; confirmation when it has content; declining keeps the old
transcript; first wave passes the *matching* transcript to `loginLocal`).

## G4. Leaving with work in flight

**Change:** `WorkbenchComponent` listens to `window:beforeunload` and
`window:pagehide`:

- Always flush pending typing first (`PendingEditsService.flush()`).
- Ask the browser to confirm leaving when any of these holds:
  - the queue is running (a transcription/translation would be lost);
  - the dropzone is still decoding or importing files;
  - a recording made this session hasn't been exported (media is never
    stored — after a reload it can't be re-attached);
  - transcript saves to IndexedDB are still in flight — counted by a small
    root `AnnotationSaveTracker` (+1 on the actions `IDBEffects.saveAnnotation`
    reacts to, −1 on `IDBActions.saveAnnotation.success/fail`; the trigger
    list is exported from the effects file so the two can't drift).

**Tests:** tracker counts up/down; workbench `onBeforeUnload` prevents the
unload for each condition and not when idle; flush is called.

## G5. Modal dismissal

`TrattModalService.openModalRef()` attaches `.then()` without a rejection
handler, so every backdrop/Esc dismissal is an unhandled rejection
("ERROR 0"). Handle the rejection (emit the same `close` action with no
result). Test in a new `tratt-modal.service.spec.ts`.

## Verification

- Jest (full suite), `tsc -p apps/tratt/tsconfig.app.json`, ESLint on the
  changed files.
- Chrome on `127.0.0.1:5321` (separate IndexedDB from the user's
  `localhost` profile):
  1. drop `example.wav` twice → one row, notice; drop it alone again → it is
     selected;
  2. reload → select a waiting file → "Export this transcription" exports
     TextGrid/SRT without attaching audio;
  3. drop `example2.wav` + a TextGrid exported from it (renamed
     `example2.TextGrid`) after the first batch → bundle has that transcript,
     not transcribed; drop a TextGrid alone for `example.wav` → confirmation,
     then replaced; mismatched name → invalid row with message;
  4. start a transcription and reload → browser asks to confirm; idle →
     no prompt;
  5. click outside a modal → no console error.
- Update the assessment doc (rows 36+), apply to the working tree, commit on
  `fix/workbench-stability`.

## Out of scope (stays in the assessment doc)

Remaining P2/P3 items (diarization warnings, capacity attribution,
provenance, cancelled state, multi-tab coordination, long-list tools,
envelope painting, /local feature parity).

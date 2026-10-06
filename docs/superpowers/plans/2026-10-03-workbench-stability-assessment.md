# /workbench stability & completeness assessment — 2026-10-03

Hands-on pass over `/workbench` in a real Chrome session against the dev server
(`localhost:5321`), driving ingest → tiny-model transcription → editing →
switching → removal → export → reload with `example*.wav`, derived test files
(3×/6× concatenations, a stereo copy) and `media/Bahnauskunft.mp3`. Model:
`onnx-community/kb-whisper-tiny-ONNX` (sv, WebGPU, q4).

Everything in "Fixed" below is in the working tree (uncommitted) and was
re-verified in the browser after the fix; unit tests were added for each.

A second round (2026-10-05, items 24–35) followed a report that transcripts
visible in the 2D editor were missing from the other editors and the
overview. Destructive flows (remove all, re-drop) were tested on
`127.0.0.1:5321`, which has its own IndexedDB, so the `localhost` profile's
files were left alone.

A third round (2026-10-06, items 36–43) closed the remaining P1 gaps per
`2026-10-06-workbench-remaining-gaps.md` (G1–G5); rows 42–43 were found while
verifying it in the browser.

## Fixed in this pass

| # | What the user saw | Root cause | Fix |
|---|---|---|---|
| 1 | **Switching files kept the previous file's waveform/audio in the editor** while the header and every edit went to the newly selected file (silent cross-file corruption). | Editors capture `AudioService.current` once in `ngOnInit`; nothing remounted them on `selectBundle`. | `WorkbenchComponent` syncs the mounted editor to the selection (effect over `selectedBundleId` + the AudioService registry); shows "Loading audio…" while an evicted file re-decodes and an "attach the file" placeholder when audio is missing. |
| 2 | (latent, part of 1) Typing within the ~1 s debounce, then clicking another file, would have written the old file's text into the new one. | Text editors' `flushPendingEdits()` re-saves the whole raw text into whichever bundle is selected *at flush time*. | New `PendingEditsService`: the bundle list flushes **before** it changes the selection (select / remove / re-attach); a remount after a selection change never flushes. |
| 3 | **Dropping a file after a reload (or after re-attaching a restored file) overwrote the restored `bundle-1`** — its transcript re-bound to the new recording; with a paired transcript, replaced outright. | First wave always used `DEFAULT_BUNDLE_ID`; `loginLocal.prepare` writes into the *selected* bundle; re-attach already ran the login chain but `visitBootstrapped` stayed false. | First wave uses a fresh id (created and selected up front) when bundle-1 is occupied; a visit with a ready session goes straight to the later-wave path. |
| 4 | **The file being edited flipped to "Attach file…" and its audio was destroyed** when more files were dropped or the queue moved on; evicted files that the app still held asked for a re-attach. | LRU eviction (cap 3) didn't protect the selected bundle or the bundle being transcribed; the list treated "not resident" as "needs re-attach". | Eviction skips the selected and pinned (running) bundles; new `canRestore()` (resident or re-decodable) drives the list, the ready count and the queue; concurrent `ensureResident()` calls share one decode (the queue used to fail a bundle with a *decode* error if the user had just clicked it); removed bundles are `forget()`-ed (PCM + retained `File` released). |
| 5 | **Reloading `/workbench` dumped the user on the legacy `/intern/transcr/reload-file` page.** | `ALoginGuard` sends any logged-in session to `/intern/transcr`; boot-time route checks read `router.url` before the first navigation; the app could also be parked on `/load`. | `WORKBENCH_SESSION_GUARD` lets LOCAL sessions through; `isOnWorkbench()` understands in-flight navigation, pre-navigation location and `/load` + `last_page_path`, and returns to `/workbench` from `/load`. |
| 6 | Catalogue export stuck at "Exporting 1 of N…"; console `Cannot assign to read only property 'item'`; IDB annotation saves failing in dev. | `TrattAnnotation.serialize()` incremented `this.idCounters.item` for the end padding — mutating (dev-frozen) store state. In prod it silently mutated the store. | Local padding-id counter; serialize no longer mutates. |
| 7 | Catalogue export: hung on any error, re-decoded every file's audio, skipped every restored file. | Errors rejected the whole run with no UI; only `ensureResident()` provided duration. | Per-bundle try/catch → warnings; modal shows a real error; media info captured at registration (no decode), restored files derive timing from their transcript. 11/11 files exported in the test, including never-re-attached ones. |
| 8 | **The first file of a session was never auto-transcribed** and not counted in "Transcribe N file(s)". | Bootstrap seeds a new bundle with one empty full-length segment; `hasAnnotationContent` counted any item. | `transcriptHasContent()`: text in any label, or >1 item (hand-placed boundaries). |
| 9 | After auto-transcription the open editor stayed empty (2D editor: blank canvas). | No remount on result; `TrattAnnotation.deserialize()` selects no level (same for restored bundles). | Queue announces `transcriptReplaced$` → editor remounts (inside NgZone); level 0 selected for pipeline results and restored transcripts. |
| 10 | (latent) A result arriving after the user started typing in a queued/running file replaced their work. | Unconditional `setBundleTranscript`. | Flush, re-check content, discard the machine result with an explanatory error instead of overwriting. |
| 11 | "Translate transcript locally" was offered in the settings panel but did nothing. | Value captured, never forwarded. | Forwarded to the queue → `PipelineRunnerService.run({translateOptions})`; manifest lists `translation`. |
| 12 | A running row just said "Running" (minutes on a first model download), with no way to stop it. | Stage/progress existed in the store but weren't rendered; `cancelActive()` had no UI. | "Loading model 40%" / "Transcribing 63%" pill, progress strip, stop button. |
| 13 | Removing bundles: a quick second removal resurrected on reload; removed files kept transcribing. | `removeBundles$` used `exhaustMap`; queue kept removed ids. | `mergeMap`; reducer drops queued ids; active run cancelled first. |
| 14 | Workbench used ~half the viewport; editor height jumped when settings opened. | Routed host was `display:block` in the shell's flex column. | Host/grid fill the viewport; rail and editor scroll independently. |
| 15 | Fresh profile: no editor mounted at all. | No stored editor preference + interface list not loaded → `mountDefaultEditor()` mounted nothing. | Always falls back to the default editor. |
| 16 | "Quit" logged out and sent the user to `/local`. | Shared bottom bar. | Hidden in LOCAL workbench; export button full width. |
| 17 | "Export transcriptions" crashed (`playPosition` of undefined) for a file without audio. | `ExportFilesModalComponent.ngOnInit` needs decoded audio. | Disabled while the editor shows the no-audio placeholder (catalogue export covers that case). |
| 18 | Pipeline result could be lost on reload if the file had been evicted when it finished. | `saveBundleTranscript$` required a resident manager. | Uses registration-time media info. |
| 20 | **Second and later files opened half-initialised**: the 2D editor's segment popup showed no text and only the "Crop mark" marker, and the overview listed no transcription units (reported from manual testing). | Project config, task and guidelines are written by the login chain into the bundle selected at that moment only. Every other bundle had none, and the popup throws on `guidelines!.selected!` (`transcr-window.component.ts`). | The collection reducer shares the session-scoped fields (guidelines, project config, task/project) with every bundle, and with bundles created later. |
| 21 | With auto-transcribe off, every file after the first had no transcription level, so there was nothing to type into or segment. | Only the bootstrap bundle gets `loadSegments()`'s seed level. | The workbench seeds the same blank level (one empty segment over the whole file) before mounting an editor on a level-less bundle. `AnnotationStoreService`'s `transcript` / `currentLevel` / `currentLevelIndex` / `task` / `guidelines` getters now read the store signals directly: they were copies kept up to date by subscriptions that lagged a dispatch behind, so an editor mounted right after the seed saw no level. |
| 22 | Files that were added but never clicked vanished from the list after a reload, even when transcript work for them was saved. | `savemodeOptions$` persisted the *selected* bundle on `createBundle`, so background-created bundles never got the options row that holds the `sessionfile` restore needs. | The effect persists the bundle that was created. |
| 23 | (introduced and fixed in this pass) The first file's ASR result was discarded as "edited while transcribing". | Guidelines normalise the empty seed segment to the break marker (`<P>`), which counted as content. | Content check ignores segments that hold only the break marker. |
| 24 | **After "Select all → Remove", every file dropped next was half-initialised again**: Dictaphone editor empty with only a "Crop mark" button, overview without transcript table or validation, an extra TRN-Editor tab (the reported symptom). | Removing every bundle reset the collection to a placeholder bundle *without* the session scope; files dropped next (the session was still running, so no login chain) copied the placeholder's missing scope. | The placeholder keeps the scope; new bundles take it from wherever it lives (selected bundle, else any bundle); selecting a bundle that lacks it heals it. |
| 25 | **Viewing a diarized file in the Dictaphone editor deleted its speaker labels** (and renumbered segments) on the next file/editor switch — without any typing. Your `localhost` example.wav lost its English-level `Speaker` labels this way. | The Dictaphone save rebuilt the level from the plain text, keeping only the text label, and ran unconditionally on every flush. | `mergeEditedSegments()`: unchanged text → no write; segments keep id and non-text labels; a new boundary inherits the labels of the segment it splits. Linear editor's flush also skips no-op writes. |
| 26 | The Linear editor showed no transcript text at all. | Its signal views never enabled `showTranscripts` (only 2D did). | Segment text is drawn under the signal in the overview and magnifier, as in 2D. |
| 27 | Picking another level in the navbar left the Dictaphone editor on the old level; text typed just before the switch was saved into the *new* level. | Text editors read the current level only when they mount; the navbar switched level without committing the editor's typing debounce. | Navbar flushes pending edits before `setLevelIndex`; the workbench remounts the editor when the shown file's level changes. |
| 28 | After a drop, the navbar's level, speaker, info and export items disappeared on every file except the first. | They are gated on `audio.loaded`, which only `loadAudio.success` (the login-chain file) ever set. | `createBundle({audioLoaded: true})` for dropped files (both waves and the loginLocal batch). |
| 29 | After "Remove all", dropping files left the pane saying "This file's audio isn't loaded… Attach file…" for a file that doesn't exist, with the new files unselected. | The empty placeholder stayed selected; the pane only checked `sessionReady`. | "No files yet" state when the list is empty; the first dropped file is selected when the placeholder was (only once the session is ready, never mid-login). |
| 30 | **Dropping the same files after a reload added a second row per file** next to each waiting one. | Drops always created bundles. | A dropped file matching a waiting bundle by name, size and type is attached to it (first match only); with no session yet, the first one starts it like "Attach file…" does. |
| 31 | The pipeline settings (auto-transcribe, language, model, speakers, translation) reset on every reload, so a reload silently switched auto-transcription off. | Not persisted. | Remembered per browser (`localStorage`, guarded) via a `persistKey` on both panels; `/local` unchanged. |
| 32 | The bottom bar's "Export transcriptions" read as exporting the list; a second unlabelled "Export" sat in the top bar. | Shared /local layout. | **"Export this transcription"** in the file header (disabled with a reason while audio is missing); bottom bar dropped in LOCAL; top-bar Export hidden in LOCAL; export dialog title names the file. |
| 33 | The re-attach dialog showed two identical lines ("example.wav (216488 bytes)") when only the modification time differed. | It didn't show what differed. | Shows both dates and says that name and size match. |
| 34 | Clicking outside that dialog logged an unhandled "ERROR 0". | Modal dismissal rejected the awaited promise. | Treated as "Abort". |
| 35 | Intermittently, the editor pane stayed empty after a file was opened. | An editor destroyed before its `ngOnInit` ran threw in `ngOnDestroy` (undefined audio manager), aborting the remount. | Editors' teardown tolerates that; a failing teardown no longer aborts the mount. |
| 36 | **Dropping a file that was already loaded added an identical row.** | Only files *waiting* for audio were matched (row 30). | A drop whose name, size and type match a file that has its audio (or an earlier file in the same drop) is skipped with a notice ("Already in the list, not added again"); its decoded audio is released. A drop of only such files selects the existing file. |
| 37 | **"Export this transcription" was unavailable until the file's audio was attached**; after a reload, restored files could not even be selected (their rows were only "Attach file…" pickers). | The export dialog read the decoded audio; waiting rows had no select action. | The export resolves media like the catalogue export (registration-time media info, else the transcript's own timing) and passes it to the dialog. Waiting rows are selectable (name) with a separate "Attach file…" link; the "Welcome back" pane shows the selected file's header ("audio not attached") with the export button. Supersedes the "disabled while audio is missing" part of rows 17/32. |
| 38 | **A transcript dropped after the first batch was ignored**; in a multi-file drop it paired with whichever recording decoded last; a transcript dropped with a re-attached file was not applied. | The dropzone kept one transcript, imported against the last-decoded audio; only the first file of the first drop read it. | Workbench-only pairing by basename (`pairTranscriptsByBasename`): each transcript is imported against the recording of its name — in the same drop, else a listed file (`externalAudioFor`). Applies in every wave and on re-attach; a recording waits for its transcript; files given a transcript are not auto-transcribed. A transcript for a listed file replaces its transcript after a yes/no question when it has content. No match → the row explains ("No recording named …", "already used"). |
| 39 | Closing or reloading the tab while transcribing, decoding, saving or with an un-exported recording lost that work silently. | No `beforeunload` handling. | Pending typing is always flushed; the browser's "Leave site?" prompt appears only while work is in flight (queue running, dropzone busy, un-exported recording, IndexedDB transcript saves pending — counted by `AnnotationSaveTracker`). |
| 40 | Dismissing *any* dialog by clicking outside it or pressing Esc logged "ERROR 0" (row 34 fixed one dialog). | `TrattModalService.openModalRef()` didn't handle the dismissal rejection. | Dismissal emits the normal close with no result. |
| 41 | A transcript can now be dropped for a file restored from an earlier visit (audio not attached). | Pairing needed the recording's sample rate and duration. | Resolved from the stored transcript's timing, as the export does. |
| 42 | (found verifying 38) A dropzone row could stay a spinner after it had become invalid. | The workbench (OnPush) subscribes to the dropzone in code, so a status change that touched no store state never re-rendered it. | Every dropzone update marks the view for check. |
| 43 | (found verifying 41) A transcript imported into a restored file was back to the old one after a reload. | `saveBundleTranscript$` skipped bundles without media info. | Falls back to the transcript's own end (shared `transcriptEnd()` helper, also used by the catalogue export). |
| 44 | (reported) **"Export this transcription" was missing whenever an editor was shown**, while it appeared in "Welcome back" without audio. | The session pane also required `exportEnabled`, read once when the session became ready — before the project config had loaded, so it stayed `false`. | Shown for every LOCAL file header, the same rule as welcome back; regression test loads the config after the session starts. |
| 45 | (requested) "Export catalogue…" in the file list didn't say what it exports. | — | Renamed "Export all" ("Exportera alla"). |
| 46 | (requested) "Export this transcription" was offered for a file with audio only (fresh file, transcription still running). | — | Offered only when the selected file's transcript has content (`transcriptHasContent`: text, or boundaries placed by hand); "Export recording" stays available for a fresh recording. |
| 47 | (requested) "Export all" started with only AnnotJSON ticked. | — | DOCX, SRT and ELAN are ticked by default. |
| 48 | (found for 47) **ELAN export dropped the speaker labels**, and importing an EAF with any dependent (reference) tier crashed. | Each annotation's value was its first non-speaker label; the speaker was never written. The importer read every annotation as time-aligned. | Speakers go into a dependent tier per level (`<tier> - Speaker`, Symbolic Association, one value per parent annotation); every level, including translations, stays its own tier. Import maps those tiers back to Speaker labels and skips other reference tiers. |
| 19 | Visual: unpadded rail, link-style bulk actions, "one audio file" dropzone copy overflowing its box, blank right pane, unlabeled checkboxes. | — | Padded rail, header row (title + count + Export), compact bulk buttons (Remove disabled at 0 / shows count), multi-file copy, empty/"welcome back" state, aria labels, i18n in all 7 locales (sv translated, others English as elsewhere). |

### Verification

- `npx jest -c apps/tratt/jest.config.ts`: 62 suites / 669 tests, all passing
  (new tests for the behaviours above in `audio.service`, `workbench.component`,
  `bundle-list`, `pipeline-queue.service`, `catalogue-export.service`,
  `pipeline-queue-persistence.effects`, `annotation.selectors`,
  `login-mode.reducer`, `idb-effects.service`, `authentication.effects`,
  `merge-edited-segments`, `auto-transcribe-options`, `auto-translate-options`,
  `bundle-reattach-mismatch-modal`).
- `libs/annotation` (vitest): `annotation.spec.ts` passes incl. the frozen-state
  serialize test. `roundtrip.spec.ts` / `verify-imports.spec.ts` fail on this
  machine only because their local fixture files (e.g. `Intervju med Stig
  Bergling.TextGrid`) are not in the repo — pre-existing.
- `tsc -p apps/tratt/tsconfig.app.json`: clean. ESLint on changed files: 0 errors.
- Browser: re-attach, multi-drop, auto-transcribe, progress, stop, editor
  follow (2D / Linear / Dictaphone), pending-edit flush on switch, eviction
  under load, removal + IDB consistency, catalogue export, reload with a
  logged-in LOCAL session; two-file drop with auto-transcribe (segment popup
  shows text + full marker set on the second file, overview lists its units,
  both survive a reload) and the same with auto-transcribe off (second file
  gets a typeable level). Round 2: remove all → re-drop (scope, selection,
  navbar, empty state), Dictaphone/Linear/2D/overview on both files and both
  levels, typing + switching files/levels inside the debounce (speaker labels
  and ids preserved), drop-to-reattach after reload, settings surviving a
  reload, "Export this transcription". Round 3 (`127.0.0.1`): duplicate drop
  → notice, no row, file selected; reload → select a restored file →
  "Export this transcription" builds `example2.TextGrid` without audio;
  TextGrid dropped alone for a restored file → confirm → replaced, survives a
  reload; mismatched name → invalid row with explanation; audio + TextGrid
  re-attach and later-wave drops → transcript applied (Dictaphone and 2D),
  not transcribed; synthetic `beforeunload` → prompt only with a save in
  flight; backdrop click on a dialog → no console error.
- Round 3: full suite 67 suites / 718 tests passing; tsc clean; ESLint 0
  errors on changed files. New tests: `tratt-modal.service`, `annotation-save-tracker`,
  `export-files-modal`, `transcript-pairing`, `transcript-timing`, plus new
  cases in `tratt-dropzone.service`, `workbench.component`, `bundle-list` and
  `pipeline-queue-persistence.effects`.

## Remaining gaps, prioritized

### P1 — friction users will hit daily

1. ~~Bulk re-attach by dropping files~~ — done (row 30); a transcript dropped
   with it is applied too (row 38).
2. ~~Duplicate detection on ingest~~ — done (row 36).
3. ~~Re-attach mismatch modal~~ — now explains an mtime-only difference
   (row 33). Open question: accept name+size+type matches without asking
   (drops already do).
4. ~~Persist pipeline settings~~ — done (row 31).
5. ~~Single-file export without audio~~ — done (row 37).
6. ~~Transcript pairing~~ — done, by basename in every wave (rows 38, 41).
7. ~~Leaving with work in flight~~ — done (row 39).

### P2 — correctness/clarity

8. **Diarization warnings are dropped** by the queue (`result.diarizationWarning`
   is ignored); surface them on the row like /local does.
9. **Capacity indicator misattributes storage** when more than one model is
   cached: "annotations 82 MB" in the test was a second cached model. Measure
   model caches via the Cache Storage API instead of "configured model size".
10. **Per-bundle provenance** (`ranWith`: model/language/stages) — the manifest
    still reports the *current* config for every file.
11. **Zero-length trailing segment** (~ms) at the end of ASR results (SRT ms
    rounding vs. exact duration). Cosmetic, shared with /local.
12. User-cancelled runs show a red "Failed" pill (+ "Cancelled"); show a neutral
    "Cancelled" state.
13. ~~Editor tab row sometimes shows TRN-Editor~~ — it appeared only on
    bundles missing the project config (row 24); the local project config
    lists 2D, Dictaphone and Linear.
14. Two tabs on the same profile share IndexedDB with no coordination.
15. Default transcription language follows the UI language (`en` here); the
    workbench now remembers the last choice (row 31).

### P3 — scale and the path to retiring /local

16. Long lists: filter/search, "hide done", sort, keyboard next/previous file
    (e.g. Alt+↑/↓), "transcribe selected".
17. Paint the cached envelope while an evicted file re-decodes (currently a
    "Loading audio…" placeholder — fine for short files, noticeable for long).
18. /local still has richer run feedback (ETA/elapsed, WebGPU→WASM fallback
    hint on errors, per-segment translation progress). Fold those into the row
    (tooltip/expandable detail) before removing /local.
19. /local's Dictaphone editor still keeps showing the previous level after a
    level switch (the workbench remounts it; the speaker-label loss and the
    pre-switch flush from rows 25/27 are fixed in shared code for both).
20. The Linear editor opens a segment only via "select a part of the signal,
    then Enter"; a click (as in 2D) would be friendlier, now that it shows
    the text (row 26).

## Notes for whoever continues

- `AudioService` registry reads are now reactive (`_registryVersion` signal):
  `hasResident()` / `getManager()` / `current` / `canRestore()` /
  `getMediaInfo()` can be used inside `computed()`/`effect()`.
- Never call an editor's `flushPendingEdits()` after the selection has moved;
  use `PendingEditsService.flush()` *before* dispatching anything that changes
  `selectedBundleId` — or the current level (the navbar does).
- Session-scoped fields (guidelines, project config, methods, project, task)
  live on every bundle; `sessionScopeSource()` in `login-mode.reducer.ts` is
  the one place that decides where to copy them from.
- `audio.loaded` on a bundle means "this session has its audio": set by
  `loadAudio.success`, `createBundle({audioLoaded})` and `bundleAudioAttached`.
- Test data from this session (example*.wav bundles) is in the dev profile's
  IndexedDB; "Select all → Remove" clears it. The derived test WAVs live in
  `apps/tratt/src/media/tmp/` (gitignored).

# TRATT workbench conversion — design

Source: `reference/TRATT Conversion Plan.dc.html` (full prose plan, authoritative) and
`reference/TRATT Workbench.dc.html` (interactive mockup). This file is the working index/summary;
the `.dc.html` is the canonical spec text — read it for full rationale.

## Goal

Convert TRATT from a two-page workflow (landing page → transcription page) into a single-page
workbench: a bundle collection dropzone/list on the left, the existing editors on the right, one
pipeline (ASR / diarization / translation) applied as a queue across all loaded media, and a
capacity indicator (storage quota + estimated working memory) telling the user how much media the
machine can hold.

## Decisions locked in

- **Scope**: local mode only. Server-backed sessions show the editor pane alone (no left rail, no pipeline).
- **Bundle**: one media file + its annotations. Flat list, no grouping.
- **Pipeline**: one global config, run as a queue over all loaded media, one language for the set, existing stage order preserved (ASR → diarization → translation).
- **Failure**: failed item marked in the list; queue continues; retry is per-row.
- **Reload**: bundles whose annotation survived but media didn't are shown "awaiting media" for re-attach.
- **Landing page**: dropped from the shell; content (funder/model-developer logos, intro, demo link) moves to an About modal.
- **Framework**: Angular 19, unchanged. Zoneless migration explicitly deferred to after this conversion.

## Architecture (see plan §2 for full detail)

- `TrattBundle` entity — id, createdAt, source, media metadata (incl. fingerprint), `residency`
  (resident/evicted/decoding/unresolved/decode-failed) kept **separate** from `run` (idle/queued/
  running/done/failed/interrupted + stage/progress/error/ranWith), `annotation` slice, per-bundle
  `history` (wieder), `ui` (editorId/caret/selectedLevel).
- `LoginModeState` → `@ngrx/entity` collection of bundles + `selectedBundleId` + `pipeline` (config/
  queue/activeId/warmModelId/mode) + `capacity`. `currentSession` removed.
- Per-bundle undo: `undoable()` applied at the per-bundle annotation reducer, routed by `bundleId`
  through a higher-order bundles reducer — not a single shared wieder stack. Needs its own
  before/after equivalence test (edit A, edit B, switch, undo, assert A untouched).
- Audio residency policy: full PCM for the selected bundle + 2 most recent; source blob retained
  for the rest; re-decode on selection. A min/max envelope computed once at decode time (persisted)
  lets list rows / 2D editor paint immediately on selection while PCM re-decodes.
- New services: `BundleService`, `AudioResidencyService`, `PipelineRunnerService` (one bundle, all
  stages — extracted from `login.component.ts`), `PipelineQueueService` (FIFO, one in flight, warm
  worker), `CapacityService`, `CatalogueExportService`; `WorkbenchComponent` shell (local/server
  configs of one component).

## Correction (found 2026-09-11, during 2.1 planning): store shape

The conversion plan's §2.2 describes state migration as "the single `currentSession` in
`login-mode.reducer.ts` becomes an `@ngrx/entity` collection" and implies one
`LoginModeState`. **This doesn't match the codebase.** There is no `LoginModeState` type.
Instead there are **four parallel `AnnotationState` feature slices** — `onlineMode`,
`demoMode`, `localMode`, `urlMode` — each built by `new LoginModeReducers(mode).create()`
and registered separately (`apps/tratt/src/app/core/store/index.ts`,
`apps/tratt/src/app/core/pages/intern/intern.module.ts`). Each carries its own
`currentSession: AnnotationSessionState` field inside `AnnotationState`
(`login-mode/annotation/index.ts`). `@ngrx/entity` (`~19.0.0`) is an installed dependency
but has zero existing usage anywhere in this codebase (`createEntityAdapter`/`EntityState`:
0 hits) — 2.1 is the first usage, not a pattern to copy.

**This actually simplifies 2.1**, given the plan's own §1 scope decision ("Local mode
only. Server-backed sessions open the editor pane alone — no left rail, no pipeline."):
bundles only ever need to exist for the `localMode` slice. `onlineMode`/`demoMode`/`urlMode`
stay exactly as they are today — single `AnnotationState`, no entity collection, untouched.
2.1's real deliverable: turn `localMode`'s `AnnotationState` into an entity collection of
`TrattBundle` (starting with exactly one hardcoded entity), re-point the ~36 selector/
reducer/service call sites inside `login-mode/annotation/*` that touch `currentSession`
today, and leave the ~24 call sites in `application/`, `authentication/`, `idb/`,
`shared/service/`, `component/`, `modals/` (which read `currentSession` via raw state-shape
access, bypassing selectors) for the later 2.4 sweep — they're smaller and more concentrated
than "200 sites" suggests, but they don't get fixed by re-pointing selectors alone.

## Correction (found 2026-09-11, during 2.2 planning): per-bundle undo is already structurally correct

The conversion plan's §2.3 frames per-bundle undo as "the subtlest change in the plan and the one
that corrupts data silently if wrong," requiring `undoable()` applied per-bundle with a
higher-order routing reducer. **Step 2.1 already built exactly that higher-order router**
(`wrapAsLocalBundleCollectionReducer`), and it turns out to already give correct, fully-isolated
per-bundle undo — verified by reading `ngrx-wieder@14.0.0`'s actual source
(`node_modules/ngrx-wieder/fesm2022/ngrx-wieder.mjs`): the wrapped reducer is **100%
state-object-pure**. Every piece of undo/redo bookkeeping (`Step[]` patches, `undone` stack,
`mergeBroken`) lives in `state.histories[key]` — part of `AnnotationState` itself, per-bundle by
construction — never in a closure-captured or module-level variable inside the library. Calling
the same wrapped reducer with two different `AnnotationState` objects (two different bundles) is
therefore automatically, correctly isolated: no cross-contamination is possible, because there is
nothing external to contaminate with.

**What's actually still missing** is not undo-isolation logic — it's that
`localBundleAdapter`'s `selectId: () => DEFAULT_BUNDLE_ID` (step 2.1's deliberate one-entity seam)
makes it *structurally impossible* to store more than one entity today: every `setOne(...)`
overwrites the same slot regardless of what's passed in. So "prove per-bundle undo" cannot be
tested without first giving bundles real, distinct ids — a small prerequisite, not the full
multi-file ingest UX (dropzone changes, per-file list state, sequential decode) the plan's §2.7
separately scopes.

**Revised step 2.2 scope**: (a) give bundles real generated ids (replacing the constant closure)
and an internal (not yet UI-exposed) way to add a second entity to the collection, (b) write the
regression test the plan's risk register demanded — edit bundle A, edit bundle B, switch
selection, undo, assert A untouched — now genuinely exercisable against two real entities, (c)
no production routing/wrapping logic changes needed beyond (a), since 2.1's wrapper already routes
every action (including `ngrx-wieder`'s own UNDO/REDO action types) through `selectedBundleId` to
the correct entity, which is exactly what "the global keyboard shortcut resolves against the
selection" (§2.3) requires — it falls out of the existing routing for free. Full multi-file
ingest UX stays scoped to step 2.7.

## Notes carried forward into step 2.4 ("the sweep")

Step 2.3's final review found three **defensive** `AudioService.audioManager` consumers
(`bug-report.service.ts:179`, `navbar.service.ts:19`, `navbar.component.html:454`) that now
throw in dev builds instead of silently returning `undefined`, with a real, traced reachable
path (`AnnotationStoreService.endTranscription()` empties the registry without dispatching
`endTranscription.do`, so `navbar`'s guard throws on the next change-detection pass in dev).
This is provably absent in production (`isDevMode()` constant-folds to `false`) and is the
intended "surface stale assumptions loudly" behaviour — not a step-2.3 defect — but these three
should be converted to `.current` **first**, before 2.4's bulk `audiomanagers[0]` sweep of the
remaining ~7 files. Also: `selectSelectedBundleId` is hard-wired to `selectLocalMode` even
though `ONLINE`/`DEMO`/`URL` sessions register through the same service — harmless while the
key is constant, but worth a comment (or mode-aware resolution) before step 2.7 makes
`selectedBundleId` variable. And: `nx lint tratt` has been red since step 2.2 on a pre-existing
selector-naming violation (`workbench-spec-fake-editor` in `workbench.component.spec.ts:58` —
needs a `tratt-` prefix) — cheap to fix, worth doing so the lint gate is meaningful again.

**Update (final whole-branch review, post-2.4):** step 2.4's Task 6 fixed the
`component-selector` violation above — confirmed gone via a severity-anchored check of the
lint output, not a naive `grep -c "error"` (which is noisy: it also matches unrelated filename
and warning-text substrings). However, fixing that one violation does **not** make `nx lint
tratt` exit zero: 3 other pre-existing lint errors remain, unrelated to anything in this whole
conversion effort and in files it has never touched — `apps/tratt/src/app/core/shared/tratt-database.ts:374`
(`@typescript-eslint/no-empty-function`) and two in
`apps/tratt/src/app/editors/2D-editor/transcr-window/transcr-window.component.html:74`
(`click-events-have-key-events`, `interactive-supports-focus`). These are tracked separately
and are not this project's responsibility to fix.

## Finding (2026-09-11, during 2.5 planning): non-WAV playback is already permanently degraded to 16kHz mono

Investigating step 2.5 ("audio residency — the keystone") surfaced a pre-existing product
defect, unrelated to this conversion but directly relevant to residency policy design.
The plan's memory model assumes each `AudioManager` holds "the source buffer, the
native-rate channel data, and the 16kHz mono copy" simultaneously. **This is only true for
WAV files.** For every other format (mp3/ogg/m4a/etc, `html-audio-mechanism.ts`'s
`decodeAudioWithWebAPIDecoder`/`decodeAudioWithLibavDecoder` paths), `normalizeAudio()`
(`html-audio-mechanism.ts:343-387`) **overwrites `_resource.arraybuffer` with a freshly
re-encoded 16kHz mono WAV** (line 368) and discards the original file bytes entirely —
`_channel` becomes that same 16kHz mono array. Since playback (`prepare()`,
`html-audio-mechanism.ts:80-86`) builds its blob URL from `_resource.arraybuffer` *after*
this overwrite, **playback for non-WAV files is already, today, from the degraded 16kHz
mono re-encode — never the original file.** This has nothing to do with bundles or
multi-file support; it happens on every single non-WAV file this app has ever decoded.

Two consequences for planning:

1. **This is a real, standalone product defect** (audible quality loss on the common case —
   most user-supplied audio is not WAV) that predates and is independent of this conversion.
   Fixing it (retaining native-rate data and original bytes for non-WAV formats, matching
   the WAV decoder's behaviour) is a substantial piece of work in its own right — touching
   the web-audio/libav decode paths, not the bundle/store work this conversion is scoped to.
   **Not fixed as part of this conversion** — flagged here for a separate, dedicated fix,
   not silently absorbed or silently ignored.
2. **Step 2.5's residency/eviction design must not assume the plan's "native-rate + 16kHz
   copy, simultaneously" memory model**, since it doesn't hold today. In practice: at most
   ONE PCM array (`AudioManager.channel`) is ever resident per manager, at whatever rate the
   active decode path produced (16kHz mono for non-WAV, a rendering-decimated near-native
   rate for WAV, per `calculateChannelDataFactor` — see `audio-decoder.ts:54-56`). Eviction
   for 2.5 means freeing whatever's actually resident (`AudioManager.destroy()`, which nulls
   `_channel` and revokes the blob URL) and re-decoding on reselection — not managing two
   separate PCM copies per bundle. `prepareMonoAudioForMlModel()` already makes a fresh,
   uncached 16kHz-mono copy per pipeline run regardless (`audio-resampler.ts:34-53`), so ML
   consumption is unaffected either way.

Also confirmed while investigating: no persisted min/max envelope artifact exists anywhere
today. The rendering algorithm to adapt exists (`audio-viewer-time-utils.ts`'s
`computeDisplayData`, ~60-207), but it currently always computes live, per-viewport, from
whatever full-resolution `channel` happens to be resident — never a whole-file summary
computed once at decode time and persisted. Building that is genuinely new work, not
wiring. Audio is confirmed never written to IndexedDB today (`tratt-database.ts`'s schema
has no binary/blob object store) — an envelope persisted only in-memory (surviving bundle
switches within a session, not page reload) can be built without touching IndexedDB;
surviving reload would need a new object store, which is more naturally step 2.6's
concern (Dexie 0.6 migration) than 2.5's.

**Decision (2026-09-11, user):** log the non-WAV playback degradation as a separate tracked
issue, do not fix it as part of this conversion. Step 2.5 proceeds with residency/eviction
policy designed around the current single-PCM-copy reality documented above.

**Step 2.5 implementation outcome (2026-09-11):** `AudioService` now caps PCM residency at
`MAX_RESIDENT_BUNDLES = 3` — the selected bundle plus the 2 most-recently-selected others,
tracked via the existing `selectedBundleId` store signal (no new UI/store plumbing).
Selecting a 4th distinct bundle evicts the least-recently-selected one (LRU by *selection*
order, not by registration/decode order) by calling `AudioManager.destroy()`, which frees
its PCM and revokes its blob URL. The per-bundle envelope computed at decode time
(`computeAudioEnvelope`, Task 1) is cached separately from the `AudioManager` and is never
itself evicted by this policy — it survives eviction of its owning bundle so the signal
display can keep rendering a summary view after the full-resolution PCM is gone. There is
currently no cap on the envelope cache's own size; at Task 1's default 4000 columns each
envelope is ~32KB, so this is not a near-term memory concern, but it should be revisited in
step 2.6+ if the number of bundles a session accumulates envelopes for grows large. This is
pure infrastructure — eviction is exercised today only by directly-constructed
multi-manager tests, since nothing in the UI yet selects between multiple bundles; wiring
real bundle selection to trigger it is step 2.7's concern. Re-selecting an evicted
bundle today leaves `AudioService.current` as `undefined` with no re-decode triggered and
no envelope-based fallback rendering — step 2.7 must land re-decode-on-reselection and
actual envelope consumption together with whatever UI first makes bundle re-selection
reachable past the eviction cap.

## Finding (2026-09-11, during 2.6 planning): IndexedDB open failures are silently swallowed

Investigating step 2.6 ("Dexie 0.6" — migrating `local_data` from a flat, single-session
shape into a bundle-keyed table) surfaced a second pre-existing defect, this one directly
relevant to the migration's own safety. `TrattDatabase.init()` (`tratt-database.ts:100-109`)
catches a failed `this.open()` (the exact "Safari private-browsing quota" case the original
conversion plan cites as "already anticipated") and calls `this.onReady.error(...)` — but
**nothing anywhere in the codebase subscribes to `onReady`**. Because `init()` is `async` and
`return`s normally after the catch (never `throw`s), the promise it returns resolves
successfully regardless. `IDBService.initialize()` (`idb.service.ts:33-43`) then
unconditionally sets `this._isOpened = true`. Net effect: **a failed IndexedDB open is
completely invisible today** — the app proceeds as though persistence is working.

This matters for 2.6 specifically because the plan's own risk register calls for
"export-before-upgrade as a safety net" — but a safety net whose own failure path is
silently swallowed isn't one. If the export (or the open itself) fails during a real user's
migration, today's code would give no signal at all, which is a materially worse outcome
than "the migration didn't run" — it looks identical to success. Minimal fix scope: make
`init()`/`initialize()` actually propagate the failure (reject the returned promise /
observable, or at minimum not set `_isOpened = true` on the caught-error path) so calling
code has something to react to. This is small, contained, and load-bearing for 2.6's own
safety net to mean anything — not a tangential quality issue the way the audio-playback
finding was for step 2.5.

## Step 2.6 shipped shape (2026-09-12)

`TrattDatabase` version 0.6 adds a `bundles` table keyed by the compound index
`[bundleId+name]` (`tratt-database.ts`), not a synthetic auto-incrementing id. This
is deliberate: LOCAL mode's existing granular save/load functions
(`saveModeData`/`loadDataOfMode`/`clearDataOfMode` et al.) already address entries
by `name` (`'options'`, `'annotation'`, `'logs'`, ...) against a `&name` table; giving
`bundles` a `[bundleId, name]` compound key lets every one of those call sites keep
its existing `name`-keyed shape and simply gain a `bundleId` parameter, rather than
requiring a schema (and call-site) redesign around a single-row-per-bundle document.
`upgradeToDatabaseV6()` copies (not moves) every existing `local_data` row into
`bundles` under `DEFAULT_BUNDLE_ID` — the original `local_data` rows are left in
place as an extra safety margin on top of the pre-upgrade export backup, even though
LOCAL-mode reads/writes now route through `bundles` going forward. The pre-upgrade
`backupCurrentDatabase()` export safety net (`init()`, `tratt-database.ts:44-46`)
already covered `currentVersion < 0.4`; its condition now also matches
`currentVersion === 0.5`, so the 0.5→0.6 transition itself gets an export backup
before the upgrade runs, not just earlier version jumps.

Two things fell out of this work worth flagging separately. First, wiring LOCAL
mode's `options` reads onto `bundles` surfaced a latent bug in
`checkAndFillPopulation()` (`tratt-database.ts:436-473`, fixed as part of Task 3):
it originally re-checked `local_data` for LOCAL's `'options'` entry on every
`init()`, which — once writes moved to `bundles` — would never see them there and
would re-populate (silently overwriting) `bundle-1`'s saved options on every app
start. It now checks `bundles.get([DEFAULT_BUNDLE_ID, 'options'])` instead. Second,
the `clearDataOfMode`/`clearAnnotationData`/`clearLogs`/`clearAllOptions` family
(`tratt-database.ts:590-609`, `idb.service.ts`) still resolves LOCAL mode's table
via `getTableFromString()`, which still points at `local_data` — these were not
repointed at `bundles`. This is currently inert, but for two different reasons of
different fragility: `clearAnnotation$` (`idb-effects.service.ts:427-462`) gates on
a `clearSession` property that `AnnotationActions.clearAnnotation.do`'s payload
doesn't have, so it's dead by construction, for reasons unrelated to LOCAL-mode
gating. `clearLogs$` (`idb-effects.service.ts:379-391`) has no LOCAL-specific guard
at all — its inertness rests entirely on today's dispatchers of
`AnnotationActions.clearLogs.do` happening to be DEMO-only or admin-gated, making it
one new dispatcher away from being live in LOCAL mode. It's tracked here as a real
gap to close before any LOCAL-mode "clear" UI is wired up, or before whatever gate
currently keeps `clearLogs$`'s dispatchers from being LOCAL-reachable is loosened —
at that point a LOCAL "clear" would wipe the now-unused `local_data` row and leave
the actual `bundles` data untouched.

Finally, this migration is the first real beneficiary of Task 1's IndexedDB
open-failure fix: because `init()` now propagates a failed `this.open()` (rejecting
instead of silently resolving), a real Safari private-browsing failure hit during
this 0.5→0.6 upgrade — or during the pre-upgrade backup export itself — now surfaces
to the user through the existing `ApplicationActions.addError` → `LoadingComponent`
Retry/Back UI, instead of the app silently hanging (or worse, silently proceeding as
if persistence were working) as it would have before Task 1.

## Finding (2026-09-12, during 2.7 Task 1): transcript pairing stays singular, deliberately

Step 2.7's Task 1 made `TrattDropzoneService` retain every dropped audio file's decoded
`AudioManager`/`OAudiofile` independently (on the `FileProgress` itself, via the new
`validAudioEntries` getter), decode them sequentially rather than concurrently, and stop
`dropFiles('audio')` from wiping out previously-dropped audio rows. Transcript-file-to-audio
pairing was deliberately **not** generalized to the multi-file case in this step: the
`_oaudiofile`/`_oannotation` singular fields and the `checkForValidFiles()`/`setAnnotation()`
pairing logic they drive are untouched, and still only ever look at "whichever audio file
decoded most recently." A transcript file dropped alongside multiple audio files will pair
with the last-decoded audio file only, exactly as before this task — there is no per-audio-file
transcript association yet. This is a real, tracked gap, not something silently absorbed by
Task 1: whenever multi-file transcript import needs to associate a specific transcript with a
specific audio file (rather than "whatever decoded last"), `checkForValidFiles()`/
`setAnnotation()` need their own multi-file redesign, generalizing from `_oaudiofile`/
`_oannotation` to per-`FileProgress` pairing the same way audio decoding just was.

## Finding (2026-09-12, during 2.7 Task 1): `TrattDropzoneService.audioManager`/`.oaudiofile` have more production consumers than expected

Task 1's brief expected the singular `TrattDropzoneService.audioManager`/`.oaudiofile` getters
to have exactly one production consumer — `WorkbenchComponent.startSession()` — to be rewritten
against `validAudioEntries` in Task 5, with the getters removed in Task 1. A repo-wide grep
before removing them found more production call sites *outside* `WorkbenchComponent`, all reached
through `TrattDropzoneComponent`'s own pass-through `audioManager`/`oaudiofile` getters
(`tratt-dropzone.component.ts:108-113`), which themselves delegate to the two service getters:
`ReloadFileComponent.newTranscription()`/`.onOfflineSubmit()` (`reload-file.component.ts:49,61`),
and three call sites in `LoginComponent` (`login.component.ts:305,370,553`, covering
transcription, diarization, and `LoginComponent`'s own `proceedWithLogin()`). (Task 1's own report
initially mislabeled the already-expected `startSession()` line as a second, separate
`WorkbenchComponent.proceedWithLogin()` consumer — corrected here during task review:
`workbench.component.ts` has exactly one `.audioManager` use, inside `startSession()`, which is
not a new finding.) Per the brief's explicit instruction to stop rather than guess when this
happened, Task 1 left both getters in place (not removed) and did not touch any of these five
call sites — they are out of scope for Task 1 and not addressed by this step. Whoever picks up
Task 5 (or a follow-up task) needs to either migrate all of these onto `validAudioEntries`-based
access before removing the two getters, or explicitly decide some of them should keep reading a
"most recently decoded" singular manager even after multi-file ingest ships.

## Finding (2026-09-15, during 2.8 planning): almost none of step 2.8's assumed infrastructure exists yet

Investigating step 2.8 ("unresolved bundles") surfaced that its one-line spec — "post-reload rows
awaiting media, with per-row re-attach, match on fingerprint" — assumes several things that turned
out not to exist, continuing this project's established pattern of the original conversion-plan
prose being wrong about premises at every step so far:

1. **Boot only ever restores `bundle-1`.** The four LOCAL-mode load effects in
   `idb-effects.service.ts` (`loadOptions$`, `afterOptionsSuccess$`, `loadAnnotation$`,
   `loadImportOptions$`) all still use the literal `DEFAULT_BUNDLE_ID`, exactly as step 2.6/2.7 left
   them (deliberately deferred here, per those steps' own Global Constraints). No boot-time code
   enumerates or restores any bundle 2.7's multi-file ingest created in a prior session.
2. **The `bundles` Dexie table cannot list distinct bundle ids today.** Its only index is the
   compound `[bundleId+name]` primary key — no secondary index on `bundleId` alone, so
   `.where('bundleId')` isn't usable. Enumeration needs a new full-table-scan helper
   (`toCollection().primaryKeys()` + client-side dedupe) — cheap at expected row counts, but nothing
   like it exists yet.
3. **No fingerprint mechanism exists.** `SessionFile.toAny()` serializes only `{name, type, size}` —
   `timestamp`/`lastModified` is silently dropped on persist despite `SessionFile`'s constructor
   accepting it, so a restored `SessionFile` never round-trips it. `FileInfo`/`DataInfo` (`libs/web-media`)
   carry a dormant `hash?: string` field that nothing ever computes or sets. There is no hash/checksum
   utility anywhere in this codebase.
4. **The "recovery banner" referenced by step 2.9's own plan text is unrelated and not reusable.**
   `recording-recovery-banner.component.ts` resumes interrupted *microphone recordings* (a completely
   different, chunked-storage feature) — no file-picker/re-attach UX exists anywhere in this codebase
   to model step 2.8's UI on.
5. **The workbench has no "ready with metadata but no audio" state at all.** `sessionReady` is
   strictly gated behind `LoadingStatus.FINISHED`, which for LOCAL mode only ever gets set via
   `AnnotationActions.loadAudio.success` — itself only reachable through the drop-then-`startSession()`
   flow. A reload with no fresh drop today never reaches a rendered workbench state, regardless of
   what's sitting in IndexedDB.

**Decision:** proceed with the same plan → SDD → review rigor as every prior step, no schema changes
needed (the existing `bundles` table shape from 2.6 already carries everything required), so this
doesn't carry 2.6's production-migration risk category — it's new application logic on an existing,
already-correct schema. Design, recorded here for the implementation plan to argue from:

- **Boot-time restore**: a new `TrattDatabase.listLocalBundleIds()` helper enumerates every distinct
  bundle id via the full-table-scan primaryKeys() query above. A new boot effect loads each bundle's
  `options`+`annotation` rows directly (bypassing the existing "write into whichever bundle is
  selected" write-through machinery entirely) and dispatches one `LoginModeActions.createBundle` per
  restored bundle, with `createBundle`'s payload extended to optionally carry the restored
  `transcript`/`importOptions`/`currentEditor` fields (merged onto `initialInner` when creating the
  entity) — so each dispatch fully seeds its bundle in one shot, no dependency on bundle-selection
  ordering. Every restored bundle's `audio.loaded` stays `false` (`AnnotationState.audio.loaded`,
  already an existing field) — this is the exact, already-present signal for "awaiting media," no new
  status enum needed.
- **Fingerprint**: extend `SessionFile.toAny()`/`fromAny()` to round-trip `lastModified` (a one-line
  gap fix, prerequisite for this step). Fingerprint comparison is `{name, size, type, lastModified}`
  against a candidate re-attached `File`'s own same fields — a well-precedented "did you pick the
  same file" heuristic, not a cryptographic hash. Computing a real content hash (e.g.
  `crypto.subtle.digest` over up to a 1.9GB file) is explicitly out of scope — disproportionate cost
  for a mismatch-warning UX that already has a working, cheap alternative and an explicit user
  override per the original spec's own words ("warn and let the user override").
- **UI**: extend the existing bundle-list (step 2.7's `BundleListComponent`) rather than building a
  parallel surface — an unresolved row (bundle with `audio.loaded === false`) renders a per-row
  `<input type="file">` re-attach affordance instead of the normal click-to-select row content.
  Selecting a file decodes it (reusing the existing `AudioManager.create` completion-detection
  pattern already established in `tratt-dropzone.service.ts`/`audio.service.ts`), compares its
  fingerprint against the bundle's persisted `sessionFile`, and either registers it with
  `AudioService`/marks the bundle resolved (match) or shows a warning-with-override modal (mismatch).

## Phases (plan §3–§8, full estimates and step-by-step notes there)

0. **Clear the ground** (1wk) — delete stale `multi-threading` copies (use lib versions), guard
   unguarded `audiomanagers[0]`/config reads, consolidate the 16kHz constant + dedupe mono/16kHz
   downsample helper, delete unrouted `new-editor` stub, characterisation tests for reducer +
   Dexie 0.5 migration fixture.
1. **Shell** (1-2wk) — `WorkbenchComponent` two-pane grid at `/workbench` behind a flag, alongside
   untouched `/local`. One bundle, no state change. Server-mode variant suppresses left rail /
   pipeline providers.
2. **Collection** (3-4wk) — entity state (2.1), per-bundle undo (2.2), audio registry (2.3), the
   ~200-call-site sweep (2.4), residency+envelope (2.5), Dexie 0.6 migration (2.6), multi-file
   ingest (2.7), unresolved-bundle re-attach (2.8), recording-as-bundle (2.9).
3. **Pipeline & capacity** (2-3wk) — 3a extract `PipelineRunnerService` (critical task, ship
   alone first), 3b the queue (one in flight, warm worker refcounted, failure isolation,
   interruption handling, skip rules), 3c capacity indicator (storage + working-memory estimate,
   warn not block at ~80%).
4. **Catalogue export** (1-2wk) — `CatalogueExportService`, streamed zip, manifest.json +
   manifest.csv, bulk list actions.
5. **Finish** (1wk) — keyboard model, focus management, empty/single/fifty-bundle states, rehomed
   funder content, manual rewrite.

## Risk register

See plan §10 — memory exhaustion (mitigate: eviction policy first, 6-long-file test gate,
autosave-before-decode), undo leaking across bundles (tests before the change), the 200-site sweep
(tranche commits, throwing dev accessor), runner extraction regressing ASR (extract with zero
behaviour change, compare against fixed reference recording), warm worker holding GPU memory
(idle timeout + fallback), IndexedDB migration (test against seeded 0.5 db, export-before-upgrade
safety net), scope creep from the landing page (settle content in phase 1).

## This session's scope

Full conversion is 9-13 weeks of work. Each phase is independently shippable per the plan; `/local`
stays alive and flagged until the workbench has carried real transcription work.

**Phase 0 status: already done on `main`, verified 2026-09-10.** All five defect items the plan
called out were fixed in commits `20243079c`, `96c8360d5`, `bbe24e3b8`, `5e8b98cc3`, `c2444659a`
(2026-08-25 to 2026-08-29), all ancestors of the `5d2d8e6e9` HEAD this worktree branched from:
stale `core/shared/multi-threading/` copies deleted and re-pointed to `@tratt/utilities` /
`@tratt/ngx-components`, the lib `run()` no-worker hang fixed in the same commit, the 16kHz
constant hoisted to one `ML_MODEL_SAMPLE_RATE` export in `libs/web-media/src/lib/audio/audio-resampler.ts`,
the mono/16kHz downsample block deduped into `prepareMonoAudioForMlModel()` (same file), the unrouted
`new-editor` stub deleted entirely, and `idb-effects.service.ts`'s `audioManager` reads already
guarded. The only open item from that phase: no test pins single-session semantics in
`annotation.reducer.spec.ts`, and no Dexie migration-fixture pattern exists yet in the repo — both
deferred to phase 2 (2.1 entity state, 2.6 Dexie 0.6) where they're actually exercised, rather than
built speculatively now against nothing.

This worktree starts implementation at **Phase 1 (the shell)**.

## Finding (2026-09-15, during 2.7 Task 7): re-decode-on-reselection lands correctness, not the instant-envelope UX

Task 6 made bundle selection genuinely reachable through the UI for the first time, so `AudioService`'s existing LRU eviction (`MAX_RESIDENT_BUNDLES = 3`) now fires for real: selecting a 4th distinct bundle in a session evicts the 1st bundle's `AudioManager`. Task 7 closes the resulting gap — `registerAudioManager()` now optionally retains the source `File` alongside the `AudioManager`, and the selection effect calls a new `ensureResident()` that re-decodes from that retained `File` (via `AudioManager.create()`, same "wait for `progress === 1 && audioManager` truthy" pattern as `TrattDropzoneService.decodeArrayBuffer()`) and re-registers the result whenever the newly-selected bundle has no resident manager. Re-selecting an evicted bundle is therefore correctness-safe and fully automatic: no user-visible error, no stuck "no audio" state, no data loss — `AudioManager.destroy()` on eviction only frees decoded PCM/blob memory, never the original file bytes.

**Deliberately not built in this task**: `.current` still briefly reads `undefined` for the ~1-2s the re-decode takes before it resolves, and during that window the signal display shows its normal no-audio/loading state rather than instantly painting from `getEnvelope(bundleId)` (already cached, unaffected by eviction, per step 2.5). Wiring the signal-viewer components in `libs/ngx-components/` to consume the cached envelope as a placeholder during this window is a separate, sizeable piece of work (tracing every consumer of `AudioService.current` across the 2D/Linear/Dictaphone editors) — tracked as a follow-up UX polish item, not a defect blocking this step.

## Step 2.8 shipped shape (2026-09-15)

Restoring every bundle beyond `bundle-1` after a page reload, and letting the user re-attach media to
one, turned out to need almost no new infrastructure beyond what steps 2.6-2.7 already built — see the
"Finding (2026-09-15, during 2.8 planning)" section above for the corrected premises this step actually
shipped against. Five pieces, each landed as its own task:

**Enumeration and the fingerprint gap.** `TrattDatabase.listLocalBundleIds()` does a full-table-scan of
the `bundles` table's `[bundleId+name]` primary keys (`toCollection().primaryKeys()`, deduped by the
first tuple element) — the table's only index is that compound key, so nothing indexed on `bundleId`
alone was available. `SessionFile.toAny()` was silently dropping `timestamp` on every persist despite
`fromAny()` already reading it back; fixed to round-trip it (backward compatible — `fromAny()`'s
validity guard was deliberately left NOT requiring `timestamp`, so bundles persisted before this fix
still restore, just without a usable timestamp for their fingerprint).

**Boot-time restore reuses `createBundle`, not a new action.** `LoginModeActions.createBundle` (from
step 2.7) gained two optional fields, `restoredOptions`/`restoredAnnotation`, merged onto a fresh entity
via the SAME `writeOptionToStore` field-mapping the pre-existing `loadOptions.success` handler already
used (hoisted from a `LoginModeReducers` method to a module-level pure function so the reducer's
free-standing `wrapAsLocalBundleCollectionReducer` could call it too — it never referenced `this`). A
new `BundleRestoreEffects` (`bundle-restore.effects.ts`) fires once at boot, sequenced strictly *after*
`IDBActions.loadOptions.success` rather than on the same trigger in parallel — not a style choice: that
action is what `IDBService.initialize()` completing actually gates, and firing earlier would race the
private `database` field not being set yet. It deliberately skips `DEFAULT_BUNDLE_ID` (the pre-existing,
unmodified `loadOptions$`/`loadAnnotation$` boot effects already restore that one — restoring it twice
would conflict) and any bundle whose persisted `sessionfile` is null (the ever-present empty default
seed every fresh install gets via `checkAndFillPopulation()`, never a real bundle to show as "awaiting
media"). Fires unconditionally, with no active-mode check — verified inert for non-LOCAL sessions since
`wrapAsLocalBundleCollectionReducer` (the only consumer of `createBundle`/`selectBundle`) is installed
for LOCAL mode only; the same "always load all four modes' data regardless of active mode" pattern the
pre-existing `loadOptions$`/`afterOptionsSuccess$` effects already use.

**The permanent-sentinel trap.** `LocalBundleCollectionState`'s default reducer state always seeds one
entity at `DEFAULT_BUNDLE_ID` — for every user, including one who has never dropped a file, before any
restore or session-start logic runs. A first attempt at gating the bundle-list's visibility on "does any
bundle exist" (`bundleSummaries().length > 0`) was unconditionally true because of this sentinel, and
would have rendered a blank list row for every first-time user on every load — caught by task review,
not by the task's own tests (which stubbed the store directly with an already-empty array, a state the
real reducer's default never actually produces). Fixed by gating on "does any bundle have a defined
name" (`b.sessionFile?.name`, already `undefined` for the untouched sentinel) instead of raw entity
count — which correctly also reveals a genuinely-restored `bundle-1` for a returning single-bundle user,
since that bundle's `sessionFile` **is** restored via the pre-existing boot effects (not this step's new
ones) and does carry a real name.

**Re-attach and the fingerprint check.** `BundleListComponent` renders a file-input re-attach control
only for rows with `awaitingMedia: true` (`!bundle.audio.loaded`, added to `selectAllBundleSummaries`).
Comparison is `{name, size, type}` always required to match, `lastModified` compared only when both the
persisted `sessionFile.timestamp` and the candidate `File.lastModified` are present (a bundle restored
from data written before the timestamp fix above has no basis for that one check — treated as
inconclusive for that field alone, not an automatic pass, since name/size/type still gate). No path
registers the decoded manager with `AudioService` without going through this comparison first: a match
resolves immediately, a mismatch opens `BundleReattachMismatchModalComponent` (the only two exits are an
explicit "use anyway" override or cancel-and-destroy-the-decoded-manager) — matching the original
spec's own words, "never silently bind an annotation to the wrong audio." One logged, not-yet-fixed gap:
the mismatch modal's dismissal promise has no `.catch()` (every other modal call site in this codebase
does), so a backdrop-click dismissal leaks the decoded manager instead of destroying it — a cleanup
issue, not a wrong-binding risk, since no bypass of the fingerprint check exists on any path.

**How a resolved bundle actually reaches the editor.** This took real investigation beyond what 2.8's
own planning had traced. `annotation-load.effects.ts`'s `onAudioLoad$` already had a LOCAL-mode branch
that dispatches `AnnotationActions.loadAudio.success` whenever `AudioService.current` is defined for the
selected bundle — genuinely already correct, not a dead end needing a fix, contrary to what planning
assumed from an adjacent sibling branch's "Normal page-refresh restore path... user must re-upload"
comment (that sibling branch, reached only when `audio.current` is still `undefined`, is correctly
untouched — real page-refreshes with no re-attach yet still need it). What was actually missing:
nothing re-enters that effect chain for a bundle resolved *mid-session* (after boot), since
`selectBundle` alone has no listening effect. Fixed by dispatching the same
`LoginModeActions.loadProjectAndTaskInformation.do` the normal fresh-login flow already uses to kick off
this chain — independently confirmed LOCAL-mode-safe (no server calls; builds a synthetic `TaskDto` from
local config + the bundle's own `sessionFile`) and safe to re-fire for an already-restored bundle (every
write it triggers is scoped to `state.selectedBundleId` only, and its transcript-seeding logic only
fabricates a fresh empty transcript when none already exists, so a restored bundle's real transcript is
reused, not clobbered).

**Deliberately out of scope, per this plan's Global Constraints**: no cryptographic content hashing (the
fingerprint is a well-precedented but non-guaranteeing name/size/type/lastModified heuristic, backed by
the spec's own explicit "warn and let the user override" design); logs and import-converter state are
not restored for bundles beyond `bundle-1` (only `sessionfile`+`transcript` are — a small, additive gap
to close later if it turns out to matter, not required for "see your bundles and re-attach media").

**Update (final whole-branch review): the feature above shipped as an end-to-end no-op until a
foundational, pre-existing bug was found and fixed.** `TrattDatabase.saveModeData()`'s LOCAL
`overwrite=false` branch — used by `saveModeOptions`, the highest-traffic LOCAL write path — has used
Dexie's `Table.update()` since step 2.6, which silently no-ops instead of creating a row when the key
doesn't already exist. Only `checkAndFillPopulation()` ever `put()`s an options row, and only for
`DEFAULT_BUNDLE_ID`/URL mode — so **no bundle beyond `bundle-1` has ever actually persisted an options
row**, since step 2.6 shipped. This went undetected through step 2.6's own review, step 2.7's, and five
of this step's six task reviews (55+ passing tests) because every one of them either seeded Dexie
directly or mocked `IDBService` rather than driving a real save through the actual persistence code —
the final review caught it only by writing throwaway `fake-indexeddb` probes against the real
`TrattDatabase` class, then proved the fix mattered with a counterfactual re-run against the pre-fix
commit that reproduced the exact failure. Fixed with a fallback to `put()` when `update()` reports zero
rows changed (`saveModeData()`, one added `mergeMap`). Two more real bugs shipped alongside it and were
fixed in the same pass: `SessionFile.timestamp` silently became a string instead of a `Date` after a
real IndexedDB round-trip (the JSON serialization step in `saveModeData()` stringifies it;
`SessionFile.fromAny()` didn't rehydrate it back), making the re-attach fingerprint check throw instead
of comparing; and the re-attach flow's `loadProjectAndTaskInformation.do` redispatch tripped
`ApplicationSessionEffects.afterInitApplication$`'s `loggedIn` check (built for ONLINE-mode
authentication, which LOCAL mode has no equivalent of), redirecting the user away from `/workbench`
instead of letting the editor mount — fixed with a scoped bypass (LOCAL mode + a resident `AudioManager`
for the selected bundle counts as "effectively logged in" for this one check only; the user was
consulted on this approach over two broader alternatives before it was implemented). All three,
plus two smaller knock-on findings, were independently re-verified via real `fake-indexeddb`
probes and mutation testing (revert each fix, confirm the tests that are supposed to catch it actually
fail) rather than trusted from the diff alone.

Two residuals were found and deliberately left unfixed, both consistent with this step's own scope
cuts: a restored bundle's `currentEditor`/`logging`/`feedback`/`additionalSpeakerIds` fields (which
`writeOptionToStore` has no mapping case for) get nulled on the *first* post-restore edit of that
bundle, not on boot itself — a narrower version of the already-accepted "logs and import-options aren't
restored" gap, not a new one; and `BundleListComponent`'s `awaitingMedia` computation reads
`AudioService`'s manager registry (a plain `Map`, not a signal) inside an Angular `computed()`, which is
safe today only because both real call sites (`startSession()`, `completeReattach()`) happen to change
store state immediately after changing residency — a future code path that changes audio residency
without a subsequent store write would render stale until something else the `computed()` actually
depends on changes. Worth revisiting if that assumption is ever violated.

## Step 2.9 shipped shape (2026-09-16) — the final step of Phase 2

This step turned out much smaller than the original conversion plan's one-line "second ingest path...
through the same BundleService" wording implied — there is no `BundleService` anywhere in this codebase
(false at every prior step of this conversion effort too), and no new bundle-creation logic was needed
at all. `TrattDropzoneComponent` already had a `public addFile(file: File): void` method whose doc
comment literally anticipated this exact integration ("Stage a programmatically supplied file (e.g.
from the recording panel)"), unused until now. The whole step was: mount the existing
`RecordingPanelComponent` (its recovery banner for interrupted recordings comes along for free, nested
in its own template) inside `WorkbenchComponent`'s left rail, behind an `ngbNav` upload/record tab pair
— reusing `login.component.html`'s own existing tab pattern byte-for-byte, including
`[destroyOnHide]="false"`, which was necessary and independently verified (against actual
`@ng-bootstrap` source, not just asserted) to keep `<tratt-dropzone>` structurally present in the DOM
regardless of which tab is active — `WorkbenchComponent`'s existing `@ViewChild(TrattDropzoneComponent)`
would otherwise silently go `undefined` while the record tab is active, breaking `startSession()` and
everything else that depends on it. `onUseRecording(file)` mirrors `login.component.ts`'s existing
handler exactly: `recordedFileService.recordedFile = file; dropzone?.addFile(file);`, switching back to
the upload tab afterward so the user immediately sees the recording land in the pending-file list. From
that point on, a recorded file is indistinguishable from a dropped one — it flows through step 2.7's
existing sequential-decode pipeline and gets a real per-entry bundle id from `startSession()`'s existing
loop, with zero new code needed for any of that.

`RecordingService`/`RecordingPersistenceService`/the separate `tratt-recordings` Dexie database (chunk
persistence during an in-progress recording, crash/interruption recovery) were not touched and remain
exactly as they were — this step only connects their existing output to the bundle system, matching the
plan's own scope boundary.

**Deliberately inherited limitation, not new**: recording remains a pre-session ingest path only,
exactly like dropping a file — `startSession()` is still a single-shot gesture (step 2.7's own explicit
scope boundary), so a recording made *after* a session has already started stages into the dropzone the
same way a mid-session file drop would (reachable on the next full session start, not immediately live).

**Navigation-guard investigation (Task 2), no change needed**: neither `/workbench` nor the legacy
`/local` has ever had real router-level `canDeactivate` protection against navigating away with an
unsaved recording — `login.deactivateguard.ts`/`ComponentCanDeactivate` exist in the codebase but are
dead code with zero consumers anywhere — provided in `main.ts`'s DI array but never even injected into
a component, let alone wired into any route's `canDeactivate` array (confirmed zero hits across
`app.routes.ts`) — and even if it were, `LoginComponent.canDeactivate()` checks login-form validity, not
recording state, so it was never the right mechanism for this concern anyway. The only real protection
anywhere in the app is explicit in-app calls to `RecordedFileService.checkUnsaved()` — from
`WorkbenchComponent.abortTranscription()` (pre-existing) and the shared navbar's `logout()` (mounted
app-wide via the root shell, `app.component.html`) — both already reachable from `/workbench`, so no
disparity with the legacy page existed to begin with. (The navbar's `logout()` exit is additionally
gated on `useMode === 'online' || useMode === 'demo'`, so it never actually renders for LOCAL mode at
all — one fewer applicable exit path, not a gap.)

One real, but explicitly out-of-scope-for-this-step, gap surfaced during that investigation and worth
tracking separately: during the pre-session window specifically (a recording is staged via the record
tab, but `startSession()` hasn't run yet), NEITHER guarded exit is even rendered —
`abortTranscription()`'s button lives behind `@if (sessionReady)`, and the navbar's profile
dropdown containing `logout()` lives behind `@if (appStorage.loggedIn && ...)` (moot for LOCAL mode
regardless, per above), and `loggedIn` only flips true once `startSession()` completes. In that specific
window, browser back/forward or a direct
URL edit is genuinely uncaught — but this is confirmed identical on `/local` today (which mounts the
same recording panel, the same pre-session way, via `login.component.html`), so it is not a
`/workbench`-specific regression this step introduced; it is a pre-existing, universal gap, unrelated to
routing, that a future step could close (e.g. a `beforeunload` handler, or making the guard checks
apply during the pre-session window too) if it ever turns out to matter in practice.

**Phase 2 ("Collection") is now complete** — steps 2.1 through 2.9 have all landed, reviewed, and (where
findings warranted it) fixed and re-reviewed. Phase 3 ("pipeline and capacity," per the master plan's
own phase breakdown) is next.

## Step 3a shipped shape (2026-09-16) — extract the pipeline runner

The master plan calls this "the critical task" of Phase 3. It was, and remained so throughout: two of
its four substantive tasks needed real fix rounds for genuine, user-visible bugs — a higher hit rate
than any other single step in this conversion effort, matching the stakes correctly (real, working
ASR/diarization/translation orchestration, a hard zero-behavior-change bar, and — before this step's own
first task — zero pre-existing test coverage for any of it).

**Corrected premises, found during planning.** The original conversion plan's prose describes "the 30-
second download and 60-second initialisation stall timers" as if pipeline-wide; they are, and remain,
**translation-only** — transcription and diarization have no equivalent watchdog. `login.component.ts`
already had ASR/diarization/translation *worker-wrapping* extracted into services
(`LocalTranscriptionService`, `LocalDiarizationRuntimeService`, `LocalTranslationService`) before this
step began — what this step actually extracted was the *orchestration* (sequencing, timers, elapsed-time
counters, cancel) still living as plain component fields and methods, not the worker plumbing itself.

**Task 1 — characterization first, and it found two real pre-existing bugs.** `login.component.spec.ts`
did not exist before this step; 21 tests now pin the exact pre-extraction behavior (one added by Task
4's fix round 2, for the reordering-bug regression), including two bugs
deliberately preserved (not fixed, per this step's own zero-behavior-change mandate, though either would
be a reasonable, separately-scoped fix later): `onOfflineSubmit(removeData)`'s argument is discarded —
every finalization path hardcodes `false`; and dismissing an error while a stage is still active routes
through cancel, which never clears `.error`, so the stale message survives the dismiss. Getting this
suite to compile at all required a narrowly-scoped Jest transformer (`login.component.ts`'s `@Component`
providers array constructs a Worker inline via `new URL(path, import.meta.url)`, unparseable by ts-jest
outside a real module context) — confirmed inert for test purposes and confirmed to touch nothing in the
real webpack build.

**Task 2 — `PipelineRunnerService`, and the diarization DI-scoping question resolved for real.**
`LocalDiarizationRuntimeService` was component-scoped (not `providedIn: 'root'`) with its worker-factory
token provided inside `login.component.ts`'s own `@Component` decorator — traced via git blame to a
specific prior commit and confirmed to be an accidental side effect of an unrelated bugfix, not
load-bearing (the service builds a fresh Worker on every `diarize()` call regardless of its own DI
scope, so no cross-invocation state exists to leak). Now `providedIn: 'root'`, token provided at the app
root. **Fix round 1** (of this task): the extraction initially delayed delivering the
`diarizationWarning` to the component until the pipeline's terminal event — on the chained
transcribe→diarization-fails→translate path, this moved the *store-write timing* for the warning to
land an instant before the page navigated away instead of matching the pre-extraction code's timing
(right when transcription finalizes, before translation starts). Fixed by carrying it on an earlier
event instead, restoring the original write timing. This is a genuinely correct, behavior-preserving
fix: the write timing is observable state independent of whether the warning currently renders, and
some future template change could make the banner reachable again. A later whole-branch review checked
the actual template gate and found the warning banner (`@if (diarizationWarning())` in
`login.component.html`) is nested inside the transcription-progress panel, whose own visibility
condition (`(transcription().active || transcription().error || transcription().phase === 'finalizing')
&& !translation().active && !translation().error`) is already `false` by the time this write happens —
so on this exact chained path, the banner was never actually renderable in *either* the pre-extraction
or the final code. That's a real, pre-existing UI bug (the warning has nowhere to render once
translation starts), separate from and not fixed by this fix round; left as a separately-scoped fix for
later.
`PipelineRunnerService.cancel()` also became one state-derived, symmetric method (replacing the old
`cancelTranscription()`/`cancelTranslation()` two-method asymmetry, which cancelled different numbers of
underlying services depending on which was called) — `login.component.ts` still exposes two named
methods for its two UI buttons, both now calling the same underlying symmetric `cancel()`.

**Task 3 — a brand-new NgRx "pipeline" slice; this app had zero pipeline state in the store before this
step.** Progress throttled to ~4Hz (`throttleTime(250, {leading:true, trailing:true})`) specifically so
a real-time worker event stream doesn't flood the reducer. No new effect — the triggering component
already calls the service directly and imperatively (matching its own existing pattern), so it throttles
and dispatches inline rather than introducing effect machinery for a single, component-initiated,
one-shot operation.

**Task 4 — the thin-consumer rewire, and where the throttling actually got dangerous.** `login.component.ts`
dropped its own `transcription`/`translation` fields (about 110 lines of direct field mutation collapsed
to two ~8-line raw-event handlers plus a declarative dispatch pipe) and now reads the template from
store selectors — except elapsed-time display, which by deliberate design stays a local, unthrottled UI
concern fed from the raw (pre-throttle) event stream, never dispatched into the store (a ticking clock
in NgRx every second forever is exactly the flooding problem the throttle exists to prevent).

Two real bugs surfaced here, both in how "throttle most things, but never drop state transitions" was
implemented — genuinely the hardest part of this whole step:

- **Fix round 1**: the first attempt split the mapped-action stream with `filter()` + `merge()` — a
  "bypass" branch for state-transition/terminal actions and a throttled branch for pure progress ticks.
  This fixed the original dropping bug (verified: on the transcribe→diarization-skipped→translate path,
  `transcriptionFinalized` used to land inside the same throttle window as later events and get silently
  eaten by `throttleTime`'s trailing-only-keeps-the-last semantics, leaving `transcription.active` stuck
  `true` — which then caused a later translation error to be checked against the wrong slice in the
  reducer and misrouted into `transcription.error`, never shown to the user). But splitting into two
  independently-subscribed-then-merged branches introduced a *second*, different bug: a throttled,
  trailing progress tick could now be delivered *after* a later bypass action that had already arrived
  and been processed — resetting `phase` back to `'downloading'` even though the stage had already
  moved on, on the ordinary download-then-stage-start transition, in both the transcription and
  translation slices.
- **Fix round 2**: replaced the split-and-merge with a single-subscription, hand-rolled operator
  (`dispatchPipelineActions()`) implementing a small flush state machine — one pending progress-tick
  slot with a cooldown timer; any bypass action flushes the pending slot *first*, then emits itself,
  guaranteeing output order matches input order by construction rather than by timing. This is the
  design lesson of this whole step: **composing `filter()`+`merge()` over a throttle cannot preserve
  order when only one branch is throttled** — a single-subscription flush-on-bypass design is what
  actually closes both the dropping and the reordering failure modes at once. Verified via 9+ scenario
  probes (back-to-back bypass actions, progress-then-bypass collapsing correctly, timer-fires-with-
  nothing-pending, completion/error-with-pending-flushes-first, sustained-stream still capped at ~4Hz,
  clean teardown on external unsubscribe) in addition to the two committed regression tests, each
  independently confirmed to fail against the pre-fix code and pass against the fix.

**`/workbench` remains completely untouched by this step**, confirmed by the final review (below) — this
was a pure `/local`-only internal refactor, exactly matching the master plan's own "ship 3a alone" framing.
Wiring pipeline UI into `/workbench` is separate, future work.

**Final whole-branch review, one more real bug.** A full end-to-end trace of the final architecture (not
the superseded intermediate versions) found one more genuine, live defect neither task-scoped review
could see: `PipelineRunnerService._handleTranscriptionResult` holds a `subscriber` reference across an
`await` on the diarization result — if the user clicks Cancel while diarization is genuinely in flight
(a real, reachable UI state; the Cancel button is visible then), `cancel()` runs synchronously and closes
the subscriber, but the pending `await` resolves anyway afterward (diarization's own `cancel()` causes
its Observable to complete without a value, which `applyOptionalSpeakerSegmentation`'s existing try/catch
already treats as a diarization failure — that part was always correct), and execution used to continue
past the cancellation point, still starting a real translation worker and arming a 30-second stall timer
that nothing could ever reach again. Fixed with a `subscriber.closed` guard right after the await
resolves. Verified by empirically reverting just the guard and confirming the regression test fails for
exactly this reason (a ghost `translate()` call after cancel) — the same "prove it against the actual
pre-fix code, not just read the diff" standard held throughout this step.

The same pass also caught a factually inaccurate claim in this very doc section (already corrected
above): the diarization-warning banner was never actually *visible* to the user on the chained path in
either the old or new code — its own template gate independently unmounts it the moment transcription
finishes — a separate, pre-existing UI bug this step didn't introduce and isn't fixing, only correctly
preserving the underlying store-write *timing* of (not the on-screen visibility of, which never existed).

## Step 3b design (2026-09-17) — the queue

**Grounding facts, found during planning.** Three things the original conversion plan's prose assumes
that don't hold in this codebase as it stands after phases 2 and 3a:

1. **The bundle entity has no `residency` or `run` field.** The master plan's `TrattBundle` interface
   (this doc's own "Architecture" section above, copied from the plan) describes `residency` and `run`
   as fields on the bundle entity. They were never built that way. `residency` ended up living entirely
   in `AudioService` (an LRU eviction policy over `MAX_RESIDENT_BUNDLES = 3`, keyed by selection order,
   per the Step 2.5 shipped-shape note above) — not a reducer field. `run` (pipeline progress/outcome)
   was never built at all, per-bundle or otherwise: the only pipeline state that exists today is the
   `pipeline` NgRx slice from step 3a, which is a **singleton**, has no `bundleId` field anywhere, and
   is wired exclusively to `login.component.ts` (the old `/local` page). This step is where per-bundle
   run state gets built for the first time — there is no existing thing to extend, only new work.
2. **`/workbench` has no pipeline wiring at all yet**, confirmed by the 3a final review above. There is
   no "run" button, no per-row status, nothing. This step is the first time any pipeline trigger reaches
   the new UI, not an addition to something already wired there.
3. **The three worker-wrapper services (`LocalTranscriptionService`, `LocalDiarizationRuntimeService`,
   `LocalTranslationService`) all call `this.cancel()` as the first statement of every public entry
   method**, and `cancel()` unconditionally `terminate()`s the worker. There is no acquire/release
   concept anywhere in them. This is exactly the behavior `PipelineRunnerService.cancel()` (step 3a)
   already depends on — it assumes calling cancel on the currently-active stage's service(s) fully tears
   the worker down. Warm-worker reuse (master plan §6.3b) requires changing this invariant in code that
   3a's extraction and its whole-branch review just finished proving correct under the
   terminate-per-run model.

**Ruling: split 3b into two independently-shippable sub-steps, 3b-i (queue mechanics) and 3b-ii (warm
worker).** The master plan's own risk register already frames warm worker as a tunable trade ("a
fallback to the current terminate-per-run behaviour if the trade proves bad" — §10), and 3a's whole
value came from shipping the highest-risk piece alone and proving it before building on it. Warm-worker
refcounting changes a currently-correct, just-proven invariant (terminate-per-run) in all three worker
services simultaneously — doing that in the same step as building the queue's FIFO/persistence/failure
machinery from nothing would make a task review unable to isolate which change caused a regression.
3b-i ships the queue with the existing terminate-per-run `PipelineRunnerService` unchanged — every
queued bundle still reloads its model from scratch, which is correct, just slow. 3b-ii (separate plan,
after 3b-i ships and is reviewed) adds acquire/release refcounting on top of a queue that's already
proven correct. This plan (and the SDD workspace it drives) covers **3b-i only**.

**State shape.** A new store slice, `pipeline-queue` (`apps/tratt/src/app/core/store/pipeline-queue/`),
deliberately separate from the existing `pipeline` slice (which stays exactly as 3a shipped it, still
serving `login.component.ts` alone — untouched):

```ts
export interface PipelineQueueState {
  queue: string[]; // FIFO of pending bundle ids, oldest first
  activeId: string | null; // bundle id currently running, or null when idle
  mode: 'idle' | 'running' | 'pausing'; // 'pausing' = finish activeId, then stop, don't drain queue
  runs: Dictionary<BundleRunStatus>; // keyed by bundleId; absent entry ⇒ treat as {state:'idle'}
}

export type BundleRunErrorKind =
  | 'decode'
  | 'model-load'
  | 'oom'
  | 'cancelled'
  | 'unknown';

export interface BundleRunStatus {
  state: 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'interrupted';
  stage?: 'decode' | 'asr' | 'diarization' | 'translation';
  progress?: number; // 0-1, mirrors the active pipeline slice's own progress while running
  error?: { kind: BundleRunErrorKind; message: string };
}
```

`runs` is a plain `Dictionary`, not an `@ngrx/entity` collection keyed identically to `localBundleAdapter`
— there is no independent lifecycle for a `BundleRunStatus` (it's always 1:1 with a bundle, created
lazily on first enqueue, never created standalone) so entity machinery buys nothing. A bundle with no
`runs[bundleId]` entry reads as `{state:'idle'}` via the selector, not via an eagerly-populated
dictionary entry for every bundle on creation.

**Ready-bundle / skip rules.** A bundle is eligible for `enqueue()` when `!bundle.awaitingMedia` (per
`selectAllBundleSummaries`, i.e. audio is resident or re-attachable — not literally "unresolved" per
the master plan's word, since this codebase's actual awaiting-media state already captures that) AND
its current `runs[bundleId]?.state` is not one of `'queued' | 'running' | 'done'`. This makes "already
transcribed" and "already in the queue" the same check as "has a terminal/active run state" rather than
inventing a second, separate "already-transcribed" heuristic over transcript content — once a bundle
finishes once, its `done` state is exactly what excludes it from a subsequent "run all" by default; an
explicit per-row retry (state `'failed'` or `'interrupted'` → re-enqueue) is the only way back into the
queue for a bundle that isn't `'idle'`.

**Failure isolation.** `BundleRunErrorKind` mirrors the master plan's five classes. `'decode'` covers
`AudioService`'s re-decode-on-selection failing when the queue ensures a bundle is resident before
running it (see below) — not a case `PipelineRunnerService` itself can produce, since audio is already
decoded before `run()` is called. `'model-load'` and `'oom'` are derived from the existing
`classifyTranscriptionWorkerError()` (`local-transcription-errors.ts`) for transcription/diarization
worker failures — reused, not reimplemented. `'cancelled'` covers the `{stage:'pipeline',
type:'cancelled'}` `PipelineEvent` arriving for a queue-initiated (not user-initiated) cancel — see
interruption below. `'unknown'` is the fallback for anything `PipelineRunnerService`'s `run()` Observable
errors with that doesn't classify. A failed bundle's `runs[bundleId]` becomes `{state:'failed', error}`;
the queue advances to the next id — one failure never stops the run, matching "Failure: a failed item is
marked in the list; the queue continues; retry is per-row" (this doc's own "Decisions locked in").

**Residency before running.** Before calling `pipelineRunnerService.run()` for a queued bundle, the
queue service must ensure that bundle's audio is resident (the step 2.7 Task 7 `ensureResident()` path
noted in the "Finding (2026-09-15...)" section above) — a bundle evicted by `AudioService`'s LRU policy
is exactly as re-decodable as a freshly-selected one, and the queue must not silently skip or crash on a
bundle that simply isn't the most-recently-selected 3. A residency failure here is the `'decode'` error
class above.

**Interruption.** No pipeline run state is persisted anywhere today (`IIDBModeOptions` has no such
field, confirmed during exploration — only annotation content, session/task linkage, editor prefs, and
comment/feedback are persisted). This step adds one: `IIDBModeOptions` gains an optional
`runState?: BundleRunStatus['state']`, written through the existing `saveModeOptions(mode, options,
bundleId)` per-bundle path whenever `pipeline-queue`'s reducer transitions a bundle's state (a new effect
listening on the queue slice's actions, following the existing `savemodeOptions$` trigger-list
convention). On restore (`BundleRestoreEffects`, the same place that already restores bundles beyond
`bundle-1`), any bundle whose persisted `runState` is `'queued'` or `'running'` is rehydrated as
`'interrupted'`, never silently resumed — matching "say plainly in the UI that closing the tab ends the
run" (master plan §6.3b). This step does **not** attempt to persist or restore FIFO queue *position*
(the `queue: string[]` array itself) — only the per-bundle terminal/non-terminal state. Restoring exact
queue order across a reload is not what "interrupted, not running" asks for, and inventing that
machinery for a case the plan doesn't actually require would be scope the plan didn't ask for.

**`PipelineQueueService` (`apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts`,
`providedIn: 'root'`).** Public API:

```ts
enqueue(bundleIds: string[]): void; // appends eligible ids to the FIFO tail (skip-rule filtered), starts draining if mode is 'idle'
stop(): void; // mode -> 'pausing'; finishes activeId, then goes idle; queue contents beyond activeId are NOT run, and are reset to 'idle' (not 'queued') so a later "run" recomputes ready bundles fresh
cancelActive(): void; // cancels just the in-flight bundle (via PipelineRunnerService.cancel()); its runs[] entry becomes {state:'failed', error:{kind:'cancelled', ...}}; the queue then continues draining
retry(bundleId: string): void; // re-enqueue a single non-idle bundle regardless of its current state (bypasses the eligibility filter enqueue() applies, since retry is an explicit per-row user action)
```

One subscription at a time to `pipelineRunnerService.run()`, sequenced with `concatMap`-equivalent
manual chaining (matching `PipelineRunnerService`'s own single-subscriber assumption from 3a — never two
concurrent `run()` calls). Per-bundle progress while `activeId` is set reuses the existing
`mapPipelineEventToAction`/`isThrottleSafeProgressAction` classification from
`pipeline-event-mapping.ts` (step 3a), but dispatches into the **new** `pipeline-queue` actions (a
bundle-scoped `stage`/`progress` update on `runs[activeId]`), not the old singleton `pipeline` actions —
that mapping module's pure functions are reused, its wiring into `login.component.ts`'s specific action
types is not.

**UI wiring (`/workbench` only, first time any pipeline UI reaches it).** `bundle-list.component.ts`'s
existing `bundles` computed (which already merges `selectAllBundleSummaries()` with a live
`AudioService.hasResident()` check, per its own doc comment) gains one more merge: each row's
`runs[bundleId]` (default `{state:'idle'}`) from a new `selectBundleRunStatus(bundleId)` selector,
driving a status label and accent color per row (mirroring the mockup's `done`/`running`/`queued`/`error`
states in `reference/TRATT Workbench.dc.html`), plus a retry action for `failed`/`interrupted` rows. A
"run pipeline on N ready bundles" button (count from the skip-rule-filtered selector above) calls
`pipelineQueueService.enqueue(readyIds)`; while `mode === 'running'`, the same control becomes "pause
queue" and calls `stop()`. Pipeline configuration (model, language, diarization/translation toggles) —
already collected today via `AutoTranscribeOptionsComponent`/`TranscriptionOptions` on `/local` — needs a
home on `/workbench` too; this plan reuses that existing component rather than building a second
configuration UI, mounted once in the workbench shell rather than per-bundle.

## Step 3b-i shipped shape (2026-09-17) — the queue

Shipped as its own 7-task plan, deliberately split from warm-worker refcounting (3b-ii,
still unstarted — see this doc's own "Ruling: split 3b into two independently-shippable
sub-steps" above). `PipelineRunnerService` and the three worker-wrapper services from step
3a are completely untouched by 3b-i; every queued bundle still reloads its model from
scratch, correct but slow, exactly as scoped.

**New territory, not an extension of anything.** Confirmed during planning: the bundle
entity has no `residency`/`run` field (contrary to this doc's own "Architecture" section,
copied from the master plan's `TrattBundle` sketch — `residency` actually lives in
`AudioService`'s LRU policy, and per-bundle `run` state never existed before this step),
and `/workbench` had zero pipeline wiring before this step — no run button, no per-row
status, nothing. A new `pipeline-queue` NgRx slice, a new `PipelineQueueService`, and the
first-ever pipeline UI on `/workbench` were all built from nothing, deliberately kept
separate from the existing singleton `pipeline` slice (which still serves `login.component.ts`/
`/local` unchanged).

**Task 4 (`PipelineQueueService`, the FIFO drain loop) had the plan's one real bug** —
matching 3a's own pattern of its riskiest async-orchestration task being where defects
actually hide. A shared `finalized` boolean was reset too late in `runBundle()` (after both
early-exit failure paths), so from the *second* finalized bundle onward, a decode failure or
missing-options failure silently no-op'd: no `bundleFailed`, no `advance()`, and the queue
permanently deadlocked with no UI recovery path short of a reload. This exact defect was
present in the plan's own code listing — the implementer transcribed it faithfully; the plan
was wrong. Fixed by replacing the shared boolean with per-run tokens threaded through a
`claimFinalize()` guard at every finalization site, verified by re-deriving the token
threading by hand and by running the new regression tests against the pre-fix commit in a
throwaway worktree to confirm they genuinely fail there.

**The final whole-branch review — the same review type that caught 3a's ghost-translation-run
bug — found 9 more findings**, none individually blocking, across the boundaries between
tasks (exactly where a task-scoped review structurally cannot look): the `/workbench` run
button didn't check whether pipeline options were actually configured, so a first-time user
could drain an entire queue straight to failure with an untranslated tooltip; `ensureResident()`
(made `public` specifically so the queue could call it for non-selected bundles) bypassed
`AudioService`'s only LRU-accounting call site, so a drain of restored bundles grew resident
memory without bound; a transcript that failed to deserialize still marked its bundle `done`
(excluded from both "run all" and per-row retry) rather than `failed`, stranding it
permanently; a restored `interrupted` bundle's status badge lived entirely inside the
bundle-list row's non-`awaitingMedia` template branch, but every restored bundle *is*
`awaitingMedia` immediately post-reload — so the interrupted state was invisible exactly when
"closing the tab ends the run" was supposed to be communicated; and `pause`'s in-memory
`stopNow()` reset wasn't in the persistence effect's trigger list. All five were fixed in one
scoped wave and each closed with a mutation-verified regression test (revert the fix, confirm
the new test fails with exactly the described defect, revert back clean).

**One accepted trade-off, logged rather than chased further.** Fixing the `ensureResident()`
LRU-accounting bug removed an accidental guarantee: before the fix, the selection effect was
`trackSelection()`'s only caller, so the selected bundle was always most-recently-used and
could never be evicted. Now the queue's own residency calls also participate in the same
`MAX_RESIDENT_BUNDLES` cap, so draining 4+ bundles can evict the AudioManager of the bundle
the user is actively viewing — recoverable (reselecting it re-decodes; the envelope survives
eviction, so the signal display never goes blank, just needs a moment) and strictly better
than the unbounded growth it replaced, but a real, user-visible trade nobody had named. Not
fixed in this step's one allowed fix wave; logged as a 2-line follow-up (pin the selected
bundle in the eviction loop) that also happens to be the natural seam 3b-ii's warm-worker
refcounting already owns.

**Two open QA items, unclosable without a real browser** (this environment had none
throughout): a live pointer-event click on `AutoTranscribeOptionsComponent`'s labels, now
bound via `[attr.for]` instead of a static `for`, to confirm the browser's label/control
association still works (very low risk — the rendered attribute is unchanged for `/local`'s
default `idPrefix=''`, and a throwaway dual-mount DOM test found zero id collisions); and an
actual end-to-end queue drain with real audio and a real model download, which no session on
this branch has ever observed — Tasks 1/4/5's logic is unit- and integration-tested in
isolation (the `pipeline-queue.service.spec.ts` suite does wire a real `provideStore` with
the real reducer), but no test spans the queue service, the login-mode reducer, and the
persistence effects together in one process, so the exact ordering `setBundleTranscript` →
persist → `bundleDone` → persist has never executed end-to-end anywhere but production.
Both carried forward for whoever runs human QA on this step before it reaches real users.

**A machine-level tooling gap surfaced during the final fix wave and its re-review**: this
worktree's `rtk`-wrapped `npx prettier`/`npx jest` invocations are unreliable here — `rtk`
reported a real prettier diff as clean, and separately produced zero output at all for
jest's summary lines (not wrong numbers — no numbers). Every verification claim in this
step that matters was independently re-confirmed using `node_modules/.bin/<tool>` directly,
bypassing the wrapper, but this is a standing gap outside this plan's scope to fix.

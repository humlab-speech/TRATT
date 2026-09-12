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

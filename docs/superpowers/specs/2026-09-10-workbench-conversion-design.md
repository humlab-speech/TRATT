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

# Review Remediation Roadmap

**Not an SDD plan itself** — this is the triage/scoping document that the phase
plans (`2026-09-01-review-remediation-phase*.md`) execute against. Read this
first to understand *why* the phases are scoped the way they are; read a phase
plan when you're ready to execute that phase.

**Source document:** `REVIEW-FINDINGS 1.md` (repo root, untracked — a
32+33-finding external code review dated 2026-08-25 through 2026-08-31).

## Critical assessment of the source review

I independently re-verified a sample of findings against the code at
`ba07efd5e` (current `main` HEAD) before trusting the document enough to plan
against it. Two different outcomes emerged depending on which section of the
document a finding came from.

**The N/B/C series (§4, dated 2026-08-31, "re-verified against `d857d3ff7`")
held up on every claim I checked.** I independently re-derived the exact bug
mechanism — not just the line number — for all four Tier-1 findings (B6, C4,
C1, C2) by reading the current source, and every one matched the document's
description exactly: same trigger, same code path, same impact. This section
is trustworthy as the basis for a plan without re-verifying the remaining 29
items one by one — the ones I sampled were precise down to the line number.

**The original Errors/Smells/Duplication section (§1-3, dated 2026-08-25,
partially annotated "✅ Closed" on 2026-08-27) is substantially stale beyond
what its own closure notes admit.** I checked 8 items from this section that
were *not* marked ✅ Closed, expecting them to still be open. **6 of the 8
were already fully fixed in current code:**

| ID | Doc says | Actual current code |
|----|----------|---------------------|
| D1 | Stale app `multi-threading/` copies still imported (HIGH) | `apps/tratt/.../multi-threading/` directory no longer exists; `main.ts`/`app.component.ts` import `MultiThreadingService` from `@tratt/ngx-components` |
| E2 | `run()` never settles on no-worker branch (HIGH) | `libs/ngx-components/src/lib/multi-threading.service.ts:106` — `reject(new Error(...))` on the no-worker branch, plus a 1500ms `workerTimeoutMs` timeout with `runInlineFallback` (this is the lib version D1's fix now routes through) |
| E6 | Matomo `host`/`siteID` interpolated raw into `innerHTML` (MED, script injection) | `application-session.effects.ts:419` — a `toInlineScriptLiteral` helper (`JSON.stringify(value).replace(/</g, '\\u003C')`) now wraps both values before interpolation — a correct, standard inline-script-literal escape |
| S6 | Navbar has duplicated condition `useMode !== undefined && useMode !== undefined` (MED) | `navbar.component.html:20` — condition is now `appStorage.useMode !== undefined && !localOnly`; no duplication |
| D5 | `contains()` byte-identical in both libs (MED) | `libs/annotation/src/lib/functions.ts:2,26` — now `import { contains } from '@tratt/utilities'; export { contains };`, a re-export shim, not a duplicate. (This is exactly what N5, in the *fresh* section, correctly describes as a dead shim to delete — the two findings describe the same code at two different points in time, and N5 is the accurate one.) |
| D6 | 16kHz sample rate constant redeclared 4× (MED) | `libs/web-media/src/lib/audio/audio-resampler.ts:6` — single `ML_MODEL_SAMPLE_RATE` export, imported by `pyannote-diarization.worker.ts`, `local-diarization-runtime.service.ts`, and `html-audio-mechanism.ts`. `local-transcription.service.ts` no longer does its own resampling at all (consistent with D7 also having been folded into this consolidation — not independently re-checked, but the resampling logic this finding pointed at is simply gone from that file) |

Only **E9** (recording.service.ts pcm flush-then-await ordering) confirmed
still live on direct inspection.

**Conclusion:** treat the original section's "still open" list as unverified
until re-checked, not as a backlog. The likely explanation is that a broader
refactor (consolidating multi-threading and audio-resampling into the shared
libs) landed after the 2026-08-27 closure pass and this document was never
updated to reflect it — the same commit series that closed the items marked
✅ probably closed these too, just without the marker.

**What this changes:**
- Do **not** spend effort on D1, E2, E6, S6, D5, D6 (and D7, provisionally) —
  they're done.
- Do **not** treat E1/E10 as blocking anything else — the document already
  correctly flags both as needing a product decision before any code change
  (E1: how to deliver server-pushed tool functions safely; E10: whether the
  backend can issue an httpOnly cookie). Escalate those separately from this
  roadmap; nothing here depends on them.
- **Do** build the remediation plan from the N/B/C series (§4) and its
  existing impact tiering (§4, "Impact ranking" table) — it's the reliable
  part of the document.
- **Before spending effort on any remaining original-section item** (S11,
  S12, D7, D9's schemata-generator gap, E9), re-run this same spot-check —
  it costs a few minutes with `grep`/`Read` and the hit rate above (6/8
  stale) says it's worth doing before writing a task for any of them.

## Phasing

The N/B/C series' own "Impact ranking" table (§4, 3 independent 1-5
assessments) is a sound prioritization — I'm reusing it rather than
re-deriving one. Phasing follows tier boundaries, cheapest-and-most-dangerous
first, matching the source document's own suggested ordering principle.

### Phase 1 — Tier 1, silent corruption (4 findings): **plan ready**

`2026-09-01-review-remediation-phase1-critical-fixes.md` — B6, C4, C1, C2.
All four are silent-corruption or permanent-failure bugs (a save that starts
throwing forever, a speaker name silently written into transcript text, edits
that vanish from the UI, wrong audio bound to a session) with mechanical,
low-risk fixes already identified by direct code inspection (not just the
review doc's line numbers — I read the actual current implementation for all
four and derived the fix from it). Ready to execute now via
`superpowers:subagent-driven-development`.

### Phase 2 — Tier 2, silent loss / broken feature (9 findings): **plan ready**

`2026-09-01-review-remediation-phase2-silent-loss-fixes.md` — N3, B3, B2, B1,
C12, C26, B7, C3, C14 — recording data loss, multi-line SRT truncation,
WebGPU transcription fallback breakage, AudioContext leak, undo/redo
silently no-oping, a reproducible crash in `validate()`, paused time baked
into recordings, premature playback end, and shortcuts dying on editor
switch. Each fix was independently re-derived from current source (not
transcribed from the review doc's line numbers uninspected); six of the
nine were actually reproduced (in Node or Jest) before the plan was written.
One correction found during verification: C12's review location cites 3
unguarded sites, but the third (idb-effects.service.ts:828-829) is already
guarded — only 2 remain, and the plan fixes those. One task (B2, the WebGPU
buffer-transfer fix) ships without an automated test — its trigger needs a
real WebGPU-capable browser Worker, unavailable in this environment, matching
the review document's own runtime-repro caveat. Ready to execute via
`superpowers:subagent-driven-development`.

### Phase 3 — Tier 3, wrong output / recoverable edge cases (15 findings): **plan ready (scoped to 7)**

`2026-09-01-review-remediation-phase3-recoverable-edge-cases.md`. All 15
findings independently re-verified live against current source before
scoping. **7 included** — genuine bugs with a clean, well-defined fix:

- **N12** (`recording.service.ts:342,350`) — `pcmIndex` read pre-await,
  incremented post-await; confirmed via the Dexie schema
  (`tratt-recording-database.ts:40`, `[sessionId+index]` is a non-unique
  compound index, not the primary key — `++autoId` is) that collided chunks
  are stored, not lost, but a stable sort on a duplicate index can reorder
  them. Fix: increment at queue time (single-threaded JS makes this
  race-free without needing the review's suggested in-flight
  flag/chained-promise machinery).
- **B8** (`SRTConverter.ts` same-speaker merge) — `label.value +=
  nextItem...value` with no separator, confirmed producing `"Helloworld"`.
- **B9** (`audio-decoder.ts` 8-bit WAV decode) — confirmed the unsigned
  branch does `entry/2` plus a per-sample alternating `sign` toggle instead
  of `(entry-128)/128`; silence (byte 128) decodes to an alternating
  `[-0.5, 0.5, ...]` full-scale square wave.
- **C7** (`annotation-save.effects.ts:123`) — `transcrSendingModal.timeout
  = timer(2000).subscribe(...)` reassigns without unsubscribing a prior
  pending timer first; same class of bug as Phase 2's C3, same fix idiom.
- **C8** (`audio.service.ts:100-102`) — `missingPermission.complete()`
  called right after the first `.emit()`; confirmed `EventEmitter` extends
  RxJS `Subject`, so `.complete()` permanently silences all future
  emissions and any late subscriber. **No automated test** — the trigger is
  deep inside a real `AudioManager.create()`/browser-permission flow;
  same class of exception as Phase 2's B2 (WebGPU fallback), justified the
  same way.
- **C10** (`linear-editor.component.ts:1048`) — `selectSegment()`'s Promise
  only calls `resolve()` inside an `if (currentLevel instanceof
  TrattAnnotationSegmentLevel)` branch; confirmed no `else`, so on a
  non-segment level the Promise hangs forever.
- **C11** (`linear-editor.component.ts:1021`) — `update()` dereferences
  `this.audioChunkDown!` with no guard; confirmed no null-check anywhere in
  the method.

**8 deferred** — real findings, but each needs a decision beyond "apply the
fix" before a plan can specify one:
- **N2** (`idb-effects.service.ts` — `loadOptions.fail` has no reducer
  handler) — confirmed live; deferred because the fix is a genuine UX
  decision (how to surface a config-load failure to the user), not a
  mechanical code change — no existing generic error-banner mechanism to
  hook into cheaply.
- **N6** (`WebVTTConverter.ts` duplicates `srtTimestamp`) — confirmed live;
  pure code duplication, not a functional bug (both converters work
  correctly today) — fits Phase 4's "cosmetic, no user-visible impact"
  framing better than Phase 3's bug-fix scope despite the source doc's
  placement.
- **N9** (`idb-effects.service.ts` DB name unvalidated) — confirmed live;
  defensive hardening only, no live trigger or reported failure mode.
- **N10** (`tratt-dropzone.service.ts` modal-cancel leaves stale import
  options) — confirmed live; the fix needs a new store action (no
  clear/reset action exists today) — a small design decision, not just a
  missing line.
- **C9** (`audio.service.ts:43-78` untracked outer `downloadFile`
  subscribe) — confirmed live; this is the same root object as the Phase
  1-final-review follow-up already on this list (`AudioService.loadAudio`'s
  non-cancellable subscription) — better fixed together in one pass than
  split across two.
- **C15** (`annotation.store.service.ts:629-641`
  `overwriteTidyUpAnnotation()` re-wraps `window.tidyUpAnnotation` on every
  call) — confirmed live, chain provably grows; fix needs an idempotency
  guard whose exact shape (a marker flag? checking function identity?)
  is a small design call, not a one-liner.
- **C23** (`annotation-load.effects.ts:784` URL-mode `http.get` on a
  user-supplied URL, no host allowlist) — confirmed live and is a real
  same-origin-credential-leak vector; deferred because the actual fix (a
  host allowlist) needs a product decision on what hosts are legitimate —
  same category as E1/E10's "needs a product decision" from Tier 1, not a
  pure code fix.
- **B5** (`recording.service.ts:154,270` hardcoded 48kHz,
  `assembleSessionToFile`) — confirmed the restore path still hardcodes
  `const sampleRate = 48000;` and `createSession` never persists the real
  rate (audioCtx doesn't exist yet at that call site) — the fix needs a new
  `updateSessionSampleRate`-style persistence method plus a call-site
  reorder, a real 3-file design task, not a one-liner. Deferred to keep
  Phase 3 to genuinely mechanical fixes; picking this up alongside N10 in a
  future small-design-fixes batch is reasonable.

Ready to execute the 7-item scope via `superpowers:subagent-driven-development`.

### Phase 4 — Tier 4, theoretical / dead code / cosmetic (10 findings): defer indefinitely

N5, N8, C6, C17, C18, C19, C20, C21, C22, C24. No user-visible impact today.
Fine to leave parked; revisit only if touching the same file for something
else, or via a dedicated cleanup pass.

### Not part of this roadmap (escalate separately)

- **E1** (server-pushed tool functions via unpinned `innerHTML`) — needs a
  product decision on hash-pin vs. static-asset vs. sandbox delivery.
- **E10** (session token in `sessionStorage`) — needs a product decision on
  whether the backend can issue an httpOnly cookie.

## Regression-test debt called out by the source doc

Still applicable, folded into the relevant phase plan rather than tracked
separately: C1 gets its reducer-reference-equality tests in Phase 1. B3+B8
need a new `SRTConverter.spec.ts` (doesn't exist yet) — Phase 2. B6 needs an
empty-SEGMENT-level case added to `annotation.spec.ts` — Phase 1. C4 needs a
new `functions.spec.ts` for `libs/annotation` (doesn't exist yet) — Phase 1.

## Follow-ups surfaced by Phase 1's final review

- `AudioService.loadAudio`
  (`apps/tratt/src/app/core/shared/service/audio.service.ts:43-88`) returns
  a hot, non-cancellable `Subject` — the download and `AudioManager`
  creation it kicks off keep running even after a consumer unsubscribes.
  Not a correctness bug today (nothing consumes the stale result), but a
  resource leak. Make it a cold, properly-cancellable observable.
- `apps/tratt/jest.config.ts`'s `transformIgnorePatterns` doesn't exempt
  the `mime` package (ESM-only as of a recent version), which is why
  `annotation-load.effects.spec.ts` needs a local `jest.mock('mime', ...)`
  workaround. Add `mime` to the pattern (e.g.
  `node_modules/(?!.*\.mjs$|jodit|ngx-jodit|konva|mime)`) and delete the
  local mock.
- `TrattAnnotation.duplicateLevel(index)`
  (`libs/annotation/src/lib/annotation.ts:174-189`) returns `undefined` for
  an out-of-range `index` instead of `this` — pre-existing, but Phase 1's
  Task 3 fix means the `duplicateLevel.do` reducer handler now actually
  returns this `undefined` as `state.transcript` (previously masked by the
  same-reference-return bug Task 3 fixed). Guard the out-of-range case.

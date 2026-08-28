# TRATT Code Review — Verified Findings

**Date:** 2026-08-25
**Scope:** `apps/tratt/src` and `libs/` (excluding `node_modules`, `dist`, `.angular`)
**Status:** All findings below were independently verified against the code over **three verification rounds** (each round re-checked every finding, diffed duplicates byte-for-byte, and re-verified earlier corrections). 32 findings: **24 fully confirmed, 8 with corrected details (⚠️), 0 refuted**. No core issue was ever refuted — ⚠️ means the problem is real but an earlier detail (line number, count, or impact) was corrected.

**Update 2026-08-27:** most HIGH/MED findings below were closed by a 21-task remediation plan — see `docs/superpowers/plans/2026-08-26-review-findings-amendments.md` and its execution ledger for details. Findings not marked ✅ Closed below remain open.

---

## How these were found and verified

1. **Discovery** — three parallel review agents each scanned the repo with a different lens:
   - *Errors*: correctness bugs, error handling, race conditions, NgRx store bugs, memory leaks, security (script injection, token storage).
   - *Code smells*: god components, dead code, inconsistent patterns, `any` usage, magic values, TODOs.
   - *Duplication*: copy-pasted logic across app and libs, constants redeclared in multiple places, helpers that belong in a shared lib.
2. **Verification** — three parallel verification agents then re-checked **every single finding** against the actual code: opened the cited file, confirmed or corrected the line number, diffed supposedly-duplicate code byte-for-byte, and checked that each suggested fix is feasible. No finding was trusted on the reviewer's word alone.
3. **Result** — nothing was refuted. Eight findings carry corrected details (marked ⚠️ below). Line numbers are as of the final verification round.
4. **Convergence** — interestingly, the finding set itself never changed across rounds: no finding was added, dropped, or refuted. What changed per round shrank steadily: round 2 corrected *what a problem is* (e.g. S5's "copy-paste twins" was flat-out wrong), round 3 only corrected *how badly* (E5/E7 do have catch paths) and *where exactly* (off-by-one line numbers). That shrinking-delta pattern is the signal the document is stable — a fourth round would likely only surface line-number drift.

**Suggested fix order** (cheapest high-impact first):
1. Delete stale app `multi-threading/` copies, import from libs (D1) — pure deletion, lib code is newer
2. Reject the no-worker branch in `run()` (E2) — one line, fixes a permanent hang
3. Delete or finish `trn-editor` and `new-editor` (S2, S9) — dead/broken code
4. Consolidate `popupCenter`/`getBaseHrefURL` into `@tratt/utilities` (D2)
5. One shared `srtTimestamp()` helper (D3)
6. Harden the ASR `time` lookup to match on `id` (E4) — latent, not active
7. Guard `audiomanagers[0]` and the non-null-asserted config reads (E5, E7)
8. Add timeout to `waitForWindowResponse` (E3)
9. Address script-injection paths (E1, E6, E8) — needs product decision on how tool functions/Matomo config are delivered

---

## 1. Errors

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| E1 | HIGH | `apps/tratt/src/app/core/store/login-mode/annotation/annotation.effects.ts:1593` | `addFunctions()` injects server-delivered JS via `script.innerHTML = functionsObj.content` (appended to `document.head` at :1602) with no version pin, hash, or integrity check. A compromised or mistaken API response = arbitrary code execution in every user's browser. Fix: pin/validate content hash, serve as versioned static asset, or sandbox. **Out of scope for the 2026-08-26 plan — needs a product decision on hash-pin vs static-asset vs sandbox delivery.** |
| E2 | HIGH | `apps/tratt/src/app/core/shared/multi-threading/multi-threading.service.ts:25-53` | `run()` returns a Promise that is **never settled** when no worker is found (the `else` branch at :51-53 only calls `console.error`). Also never settles if the worker is already dead: `postMessage` to a dead worker is a silent no-op, so the job status flip and `jobstatuschange` never fire. Callers hang forever. Fix: `reject(...)` in the no-worker branch; add a timeout on `jobstatuschange`. |
| E3 | MED | `apps/tratt/src/app/core/store/authentication/authentication.effects.ts:55-90` | `waitForWindowResponse` has no timeout: if the user closes the Shibboleth popup, `reauthenticate.wait()` blocks the `exhaustMap` effect (login$ at :47) permanently, swallowing all later login actions. Also `BroadcastChannel('ocb_authentication')` dispatches `reauthenticate.wait()` on any `e.data === true` with no payload validation — any same-origin page can trigger it. Fix: race against a timeout; validate the message. ✅ Closed — BroadcastChannel nonce validation added, see commit series ending `37883d026`. Needs live verification against real backend before full trust, see PR notes. |
| E4 | MED ⚠️ | `apps/tratt/src/app/core/store/asr/asr-processing.effects.ts:201,306` | `items.find((a) => a.time === item.time)` compares a nested object by reference; a failed lookup silently falls through to `stopItemProcessing.success`, discarding the ASR result. **Correction:** the claimed trigger (a reducer recreating `time`) does not happen — current reducers use object spread, which preserves the `time` reference. This is a **latent** fragility, not active data loss. Fix: match on `a.id === item.id`. |
| E5 | MED ⚠️ | `apps/tratt/src/app/core/store/asr/asr-processing.effects.ts:33` | `const audioManager = this.audio.audiomanagers[0]` is unguarded; :35 dereferences `audioManager.resource.arraybuffer`. **Correction:** the effect is wrapped in `catchError` (:137-145) dispatching `cutAndUploadQueueItem.fail`, so the UI is not stuck — but an empty array surfaces as a confusing TypeError on the fail path instead of a clean guard. Fix: guard and dispatch a descriptive `.fail`. |
| E6 | MED | `apps/tratt/src/app/core/store/application/application-session.effects.ts:429-444` | Matomo `host` (:438) and `siteID` (:440) from `appconfig.json` are string-interpolated into an inline `<script>` via `trackingCode.innerHTML`. A value like `"; /* */` breaks out and injects JS. Fix: build the tracker from attributes/`textContent`, not interpolation. |
| E7 | MED ⚠️ | `asr-processing.effects.ts:196,296`; `idb-effects.service.ts:57` | Non-null assertions `state.application.appConfiguration!.tratt.plugins!.asr!` (and `appConfiguration!.tratt.database.name` in idb-effects). **Correction:** all three effects have `catchError` dispatching a `.fail` action (asr :226 → `runASROnItem.fail`, :336 → `runWordAlignmentOnItem.fail`; idb :131-139 → `loadOptions.fail`), so the action is not lost. The real issue: config-not-loaded surfaces as a generic failure with no clear cause. Fix: guard and dispatch a descriptive `.fail`. |
| E8 | LOW | `apps/tratt/src/main.ts:206-221` (interpolation at :213) | `err?.message` is interpolated unescaped into `document.body.innerHTML`. An error message containing `</pre><script>...` executes. Fix: `textContent`. |
| E9 | LOW | `recording.service.ts:322-328` | `setInterval(() => void this.flushPcmPending(), ...)`: `flushPcmPending` clears `this.pcmPending = []` **before** `await this.persistence.appendChunk(...)`. A rejected appendChunk is an unhandled rejection and the PCM chunk is silently dropped with no retry. |
| E10 | LOW | `authentication.effects.ts:165,512` | Access/session token stored in `sessionStorage` (`store('webToken', ...)`), readable by any XSS. Prefer httpOnly cookie if the backend allows. **Out of scope for the 2026-08-26 plan — needs a product decision on whether the backend can issue an httpOnly cookie.** |

**Already good (errors):** `SubscriptionManager`-backed subscriptions with automatic teardown throughout editors; `recording.service.ts` properly disconnects worklet/analyser/tracks on release; IDB effects wrap promises in subjects with `.catch` and handle Safari private-browsing quota errors; `transcr-overview` sanitizes HTML before `bypassSecurityTrustHtml`.

---

## 2. Code smells

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| S1 | HIGH | `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts` | Exactly 5400 lines, ~126 methods — god class mixing canvas rendering, segment CRUD, mouse/zoom handling, and time math. `updateAllSegments` alone is ~190 lines (:1280-1469). Split into canvas-renderer, segment-model, and interaction services. ✅ Closed — split into `AudioViewerTimeUtils`, `AudioViewerSegmentsService`, `AudioViewerRendererService`, `AudioViewerInteractionService`, with `audio-viewer.service.ts` slimmed to a 1312-line orchestration facade, see commit series ending `37883d026`. |
| S2 | HIGH ⚠️ | `apps/tratt/src/app/editors/trn-editor/trn-editor.component.ts` | 1581 lines, 18 TODOs, commented out of the editor registry (`editors/components.ts:29` — "TODO fix TRN editor") yet still declared in `apps/tratt/src/app/core/pages/intern/intern.module.ts:51`. Effectively dead/broken: finish or delete. **Correction:** "half its logic commented out" was wrong — only ~2% of lines are commented. ✅ Closed — trn-editor re-enabled in the editor registry, see commit series ending `37883d026`. Restoration of its dead logic tracked separately, see `docs/superpowers/plans/2026-08-26-trn-editor-restoration-triage.md`. |
| S3 | HIGH ⚠️ | `apps/tratt/src/app/core/store/login-mode/annotation/annotation.effects.ts` (1999 lines) + `annotation.store.service.ts` (1089) | God effects/store. `loadSegments` (:1630) is ~216 lines. **Correction:** `saveTaskToServer` (:1909) is only ~56 lines, not multi-hundred. Split by feature (load/save/maintenance). ✅ Closed — `annotation.effects.ts` split into `annotation-load/save/maintenance/tools.effects.ts`; `annotation.store.service.ts` (now 677 lines) had its pure text-processing and maintenance init extracted, see commit series ending `37883d026`. |
| S4 | MED | repo-wide | Only 16 of 90 components set `ChangeDetectionStrategy.OnPush`. Audit hot components (editors, navbar) and add OnPush. ✅ Closed — OnPush added to the editor shells (2D-editor, linear-editor, dictaphone-editor, trn-editor) and navbar, see commit series ending `37883d026`. |
| S5 | MED ⚠️ | `editors/2D-editor/2D-editor.component.ts` vs `editors/linear-editor/linear-editor.component.ts` | **Correction:** these are **not** copy-paste twins. `onZoomInOut` differs (2D:179 vs linear:233 — zoom caps 20 vs 12, minimagnifier handling, `detectChanges()` only in 2D) and both already `extend TRATTEditor` (2D:68, linear:71). What remains: both carry the same commented-out "TODO fix shortcut on focus" block (2D:308, linear:368) and structurally similar `ShortcutGroup` definitions. **Drop the "extract shared base" fix** — the base exists and is used. |
| S6 | MED | `apps/tratt/src/app/core/component/navbar/navbar.component.html` | 988-line god template; lines 20-21 contain the duplicated condition `appStorage.useMode !== undefined && appStorage.useMode !== undefined`. |
| S7 | MED | repo-wide | Exactly 95 `console.log`/`console.debug` calls in non-spec TS (e.g. `trn-editor.component.ts:970`, `app.component.ts:68`). Remove or gate behind a debug flag. ✅ Closed — remaining `console.log`/`console.debug` calls removed repo-wide, see commit series ending `37883d026`. |
| S8 | MED ⚠️ | repo-wide | ~598 `any`/`as any` occurrences (originally estimated 556). **Correction:** worst files are `libs/annotation/src/lib/annotation.ts` (24), `libs/ngx-components/src/lib/components/form-generator/tool-configurator.component.ts` (23), `annotation.store.service.ts` (23), `transcr-editor.component.ts` (23) — not the editor components. `editors/components.ts:8` still has `editor: any` (untouched, out of scope). ✅ Closed for all 4 named worst files — `annotation.ts` and `transcr-editor.component.ts` at 0 `any` (commit series ending `37883d026`), `annotation.store.service.ts` down to 2 (same series), `tool-configurator.component.ts` (the real target — an earlier pass in the same series mistakenly typed `apps/tratt/.../table-configurator.component.ts` instead, a different, already-0-`any` file; corrected in commit `5c601e029`) now at 0 `any`. The long tail of ~600 remaining `any` occurrences outside these 4 files is NOT closed, tracked as follow-up. |
| S9 | LOW | `apps/tratt/src/app/editors/new-editor/` | 38-line stub, declared in `intern.module.ts` (:94, :119) but never routed and no template uses `tratt-new-editor`. Dead scaffolding — delete until needed. |
| S10 | LOW | `audio-viewer.service.ts:4504-4518` | Hardcoded `rgba(...)` colors (e.g. `rgba(255,191,0,0.5)`) and magic `* 1000` ms conversions (:3906, :3911, :3914-3915, :4446). Hoist to constants/theme. ✅ Closed — ASR-blocked canvas colors hoisted into `TRATT_COLORS`, see commit series ending `37883d026`. |
| S11 | LOW | `table-configurator.component.ts:572-694`, `trn-editor.component.ts:1322`, pyannote worker :184, whisper worker :115 | Deep nesting (6-7 levels). Early returns would flatten. |
| S12 | LOW | repo-wide | Only 2 files use signals (`tratt-dropzone/auto-translate-options.component.ts`, `auto-transcribe-options.component.ts`); everything else is `@Input`/`EventEmitter`/`BehaviorSubject`. Pick one direction. |
| S13 | LOW | `audio-viewer.service.ts:1752` | German comment in code: `// TODO hier werden segmente entfernt`. ✅ Closed — dead German TODO comment removed, see commit series ending `37883d026`. |

**Already good (smells):** new `@if` control flow in templates (no legacy `*ngIf` in navbar, 0 `ngSwitch`); lazy routes via `loadComponent`; clean `@tratt/*` lib boundaries (`media` lib has no DOM deps); heavy work (translation, diarization) offloaded to web workers; Transloco i18n applied consistently.

---

## 3. Duplication

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| D1 | HIGH | `apps/tratt/src/app/core/shared/multi-threading/{ts-worker,ts-worker-job,multi-threading.service}.ts` | Stale copies of `libs/utilities/src/lib/worker/*` and `libs/ngx-components/src/lib/multi-threading.service.ts`. The lib versions are strictly newer: generics (`TsWorkerJob<I, O>`), `recoverFromStalledJob` (utilities ts-worker.ts:231), `workerTimeoutMs`/`runInlineFallback` (ngx-components service) — none of which the app copies have. Yet `main.ts:50` and `app.component.ts:13` import the app copies. **Fix: delete the app folder, switch imports to `@tratt/utilities` / `@tratt/ngx-components`.** |
| D2 | HIGH | `libs/web-media/src/lib/functions.ts:149,191` vs `libs/utilities/src/lib/functions.ts:335,377` | `popupCenter` and `getBaseHrefURL` are **byte-identical** (verified by diff). web-media already depends on `@tratt/utilities`. App imports are already inconsistent: `authentication.effects.ts:11-13` pulls them from web-media, `help-tools.component.ts:4` from utilities. Fix: keep one copy in utilities, re-export or delete from web-media, normalize imports. |
| D3 | HIGH ⚠️ | SRT timestamp formatting | **Correction:** SRT formatting is **doubled**, not tripled: `libs/annotation/src/lib/converters/SRTConverter.ts:443-452` (`getTimeStringFromSamples`, samples-based, while-loop `formatNumber` pad) and `apps/tratt/src/app/core/shared/service/local-transcription.service.ts:313-321` (`toSrtTime`, seconds-based, `padStart`). Separately, the while-loop zero-pad helper has an identical body in `libs/ngx-utilities/.../timespan.pipe.ts:74-80` (`private formatNumber` vs the converter's `public`), but that pipe formats `MM:SS[.mmm]`, not SRT. Fix: one `srtTimestamp()` in `@tratt/annotation` (or utilities) + shared pad helper. |
| D4 | MED | `apps/tratt/src/app/core/obj/tools/audio-cutting/cutting-format.ts:104` vs `libs/web-media/src/lib/audio/audio-cutter.ts:110` | `getNewFileName` duplicated: leading-null loop (`maxDecimals = 4`) byte-identical; `<name>/<sequNumber>/<sampleStart>...` placeholder switch structurally identical with only minor data-source differences. Keep one (lib) with a small segment-descriptor param. ✅ Closed — leading-null-pad loop extracted into a shared `padSequenceNumber` helper, see commit series ending `37883d026`. |
| D5 | MED | `libs/utilities/src/lib/functions.ts:26` vs `libs/annotation/src/lib/functions.ts:30` | `contains()` byte-identical (`haystack.indexOf(needle) !== -1`). annotation already depends on utilities — import it. |
| D6 | MED | 4 files | 16 kHz constant redeclared 4×: `pyannote-diarization.worker.ts:16` (`DIARIZATION_SAMPLE_RATE`), `local-diarization-runtime.service.ts:65` (`DIARIZATION_SAMPLE_RATE`), `local-transcription.service.ts:68` (`WHISPER_SAMPLE_RATE`), `html-audio-mechanism.ts:347` (`TARGET_RATE`). One exported const in `@tratt/web-media`. |
| D7 | MED | `local-transcription.service.ts:88-101` vs `local-diarization-runtime.service.ts:88-101` | Near-identical "fetch channel → mono → resample to 16k" block: same null-guard, same `srcRate` fallback chain, same `resampleChannels(...)` call, same duration calc. (Minor: no actual "decode" happens — just channel fetch.) Extract a shared helper. |
| D8 | LOW | 5 files | Time-display formatting scattered: `timespan.pipe` (`MM:SS[.mmm]`), `unix-duration.pipe` (`Xd:Xh:Xm:Xs`), `login.component.ts:58` `formatDuration` (`m:ss`), `recording-panel.component.ts:203` `formatElapsed` (`m:ss`), `Converter.ts:113` `msToTimeString` (`HH:MM:SS`). login's and recording-panel's formatters are near-identical — at minimum share the `m:ss` one. ✅ Closed — `login.component.ts` and `recording-panel.component.ts`'s `m:ss` formatters consolidated into a shared `formatMinutesSeconds` helper in `@tratt/utilities`, see commit series ending `37883d026`. |
| D9 | LOW | `Converter.ts:124` vs `utilities/functions.ts:125`; `libs/assets/src/lib/schemata/` | `escapeXml` and `escapeHtml` overlap (both replace `& < > "`, differ only in apostrophe: `&apos;` vs `&#039;`). Schemata exist as `.json` + generated `.ts` pairs whose headers say "automatically generated using its json variant", but no generator script/reference exists in the repo. ✅ Closed — `escapeXml`/`escapeHtml` consolidated into a shared `escapeXmlEntities` helper in `@tratt/utilities`, see commit series ending `37883d026`. The schemata-generator-script gap is NOT closed, not in scope for the 2026-08-26 plan. |

**Already good (duplication):** clean lib layering (`media` no-DOM → `web-media`); `@tratt/utilities` is a real shared home actually used (`getFileSize`, `joinURL`, `SubscriptionManager` in 22 files); `tratt-dropzone` wraps the generic `DropZoneComponent` instead of duplicating drag/drop; consistent NgRx slice pattern (actions/reducer/effects/selectors/store-service) as a convention, not copy-paste; colors consolidated in `TRATT_COLORS`/`SPEAKER_COLORS`.

---

## Notes for the person/AI picking this up

- **Do not** attempt "extract shared base editor" for 2D/linear editors — verification proved they already share `TRATTEditor` and differ meaningfully (S5).
- E1/E6 (script injection) need a **product decision** on how tool functions and Matomo config are delivered before a fix can be chosen (hash pinning vs static asset vs sandbox).
- E2 and D1 interact: the stale app multi-threading copies are exactly the ones with the never-settling-Promise bug; the lib versions have stall recovery. Fixing D1 removes a chunk of E2's surface.
- All line numbers were verified over three rounds on 2026-08-25; if the code has moved, search for the function names instead.

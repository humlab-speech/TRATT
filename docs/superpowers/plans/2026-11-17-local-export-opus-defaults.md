# Local-mode Export: Fixed Defaults + Opus Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In local mode (media loaded from the user's computer), the export dialog behaves the same for one or many recordings, always writes `_annot.json`, includes audio by default, and writes audio as 32 kbps mono Opus (video as mp4). Also silence the `@huggingface/transformers` dev-server warning.

**Architecture:** Defaults move from the modal into `CatalogueExportService.run()` (native format forced in) and the modal's preview mirrors it. A new `media-transcode.ts` re-encodes the attached `File` with the libav.js assets already shipped (default variant: libopus + Ogg; fat variant: also mp4 muxer — probed in Node, see Review Focus). Any transcode failure falls back to the original file plus a warning, never to a lost recording.

**Tech Stack:** Angular 21.2 (signals), Jest via Nx, fflate, libav.js (`apps/tratt/src/assets/libav`), Transloco.

**Spec:** the user's request of 2026-11-17 (this conversation); its four requirements are copied under Global Constraints.

## Global Constraints

- Scope is list/local mode only (`listMode()` true). Navbar export (online, demo, URL modes → `exportTranscript`) is unchanged.
- R1: export option settings identical for one recording and several.
- R2: `AnnotJSON` (`NATIVE_FORMAT`) always checked, shown dimmed (disabled), cannot be unticked.
- R3: "Include the audio" ticked by default (when some audio is attached).
- R4: audio exported as Opus, 32 kbps, mono; videos exported (back) to `.mp4`.
- No new npm dependency; reuse `apps/tratt/src/assets/libav`.
- Conventional commits (Commitizen).
- Test command: `npx nx test tratt --testFile=<name>.spec.ts`.

## Review Focus

- Stereo 44.1 kHz source → mono 48 kHz Opus: after re-import, segment times must still line up (Opus always decodes at 48 kHz; `_annot.json` stores sample positions at the source rate).
- Video with a codec the mp4 muxer rejects (e.g. VP8 from WebM): original file kept + warning, export continues.
- File too large for the wasm heap, or libav throws mid-encode: original kept + warning, other recordings unaffected.
- Video with no audio stream, or zero-length audio: original kept + warning.
- `a.wav` and `a.mp3` in one export both map to `a.opus`: second becomes `a-2.opus` (existing `uniquePath`), and each folder still re-imports.

---

## File Structure

- Modify `apps/tratt/project.json` — dev-server prebundle setting (Task 1).
- Create `apps/tratt/src/app/core/shared/service/exported-media.ts` — pure name/type helpers, no libav import (modal preview uses it).
- Create `apps/tratt/src/app/core/shared/service/media-transcode.ts` — libav encode.
- Modify `libs/web-media/src/lib/audio/libav-decoder.ts` + `index.ts` — export `getLibAV`, `getLibAVFat` so one instance and the `global` polyfill are shared.
- Modify `apps/tratt/src/app/core/shared/service/catalogue-export.service.ts` — force native, transcode.
- Modify `apps/tratt/src/app/core/modals/export-files-modal/export-files-modal.component.{ts,html,scss}` — defaults, dimmed native, preview names.
- Modify `docs/manual/exporting.md`, `docs/manual/sv/exporting.md`, `apps/tratt/src/assets/i18n/{en,sv}.json`.

---

### Task 1: Silence the Vite dynamic-import warning

**Files:** Modify `apps/tratt/project.json` (`targets.serve.options`).

**Assessment (no code needed to understand it):** dev-only and harmless. ONNX Runtime inside `@huggingface/transformers` imports its wasm loader from a runtime URL on purpose (`assets/ort/*.mjs` is copied for exactly this); the bundle carries `/*webpackIgnore:true*/`, which is webpack's hint, and Vite wants `/* @vite-ignore */`. Vite 7.3.7 skips the warning for importers inside `node_modules`, but Angular's prebundled copy lives in `.angular/cache/.../vite/deps`, so it is not exempt. The other pasted lines (watch mode, ports, "Raw file sizes") are normal output. Production builds do not use Vite.

- [ ] **Step 1: Add `"prebundle": { "exclude": ["@huggingface/transformers"] }` to `targets.serve.options`.**
- [ ] **Step 2: Clear the cache and run:** `rm -rf .angular/cache && npx nx serve tratt`, open `http://localhost:5321/`, load a short audio file, start a local transcription.
  Expected: no "cannot be analyzed by Vite" block; Whisper model loads and transcribes.
- [ ] **Step 3: Decision gate.** Excluding makes esbuild bundle the package into app chunks, so the warning may reappear with an app-chunk importer. If it does, or startup/rebuild is visibly slower, revert Step 1 and add one line under Gotchas in `CLAUDE.md`: "Dev-server warning about `@huggingface_transformers.js` dynamic import is expected (ONNX Runtime wasm loader); ignore."
- [ ] **Step 4: Commit** `chore(dev): silence Vite dynamic-import warning from transformers` (or `docs:` for the CLAUDE.md fallback).

---

### Task 2: Fixed defaults — native always on, audio on by default

**Files:**
- Modify: `catalogue-export.service.ts` (`run`, `ExportOptions`)
- Modify: `export-files-modal.component.{ts,html,scss}`
- Test: `catalogue-export.service.spec.ts`, `export-files-modal.component.spec.ts`

**Interfaces:**
- Produces: `run()` always converts with `NATIVE_FORMAT` in the converter set; `natives` bookkeeping is deleted. Modal: `isChecked(NATIVE_FORMAT)` is true in list mode; `toggleFormat(NATIVE_FORMAT)` is a no-op in list mode; `includeAudio()` defaults to `audioAvailable()`.

- [ ] **Step 1: Write failing service tests** (follow the file's existing fixtures):
  - `exportBundles(['b1'], ['DOCX'])` for one bundle without audio → zip containing `b1.docx` and `b1_annot.json` (not a lone `.docx`).
  - `exportBundles(['b1'], [])` → one file, `b1_annot.json`, `archive: false`.
  - Same two cases with two bundles produce the same per-bundle file sets.
- [ ] **Step 2: Run, expect FAIL** (`npx nx test tratt --testFile=catalogue-export.service.spec.ts`).
- [ ] **Step 3: In `run()`, derive `const names = [...new Set([...converterNames, NATIVE_FORMAT])]`, use it for `converters`, delete `nativeTicked` and the `natives` array/branch and its use in the zip loop.** `exportTranscript` (navbar path) keeps its own native-in-zip logic untouched.
- [ ] **Step 4: Run service spec, expect PASS** (fix any old assertion that encoded the previous "only in a .zip" rule).
- [ ] **Step 5: Write failing modal tests:**
  - `includeAudio()` is true with one bundle that has audio, and with two (same default); `setIncludeAudio(false)` still wins.
  - In list mode `isChecked('AnnotJSON')` is true; `toggleFormat('AnnotJSON')` leaves it true; `onExport()` calls `exportBundles` with names containing `'AnnotJSON'`.
  - `contents()` for one recording with only DOCX ticked lists `x.docx` + `x_annot.json` (kind `'native'`) and `single` is undefined; with nothing ticked and no audio, `single.name === 'x_annot.json'`.
  - Navbar mode (`bundles` unset): `isChecked('AnnotJSON')` follows the user's ticks as today.
- [ ] **Step 6: Implement in the modal:** `includeAudio` = `audioAvailable() && (chosenAudio() ?? true)`; in `contents()` treat `NATIVE_FORMAT` as an always-present format in list mode (entry `kind: 'native'`, drop the old "push native if not ticked" block and the `kind !== 'native'` filter in `single`); `toggleFormat` ignores `NATIVE_FORMAT` in list mode; `lastFormats` never stores it. Template: for the native row add `[checked]="isChecked(...)"`, `[disabled]="listMode()"`, class `export__format--locked`; SCSS: `.export__format--locked { opacity: .6; }` (dimmed, still readable).
- [ ] **Step 7: Run both specs, expect PASS.**
- [ ] **Step 8: Commit** `feat(export): always write Tratt's own format; include audio by default`.

---

### Task 3: Transcoder

**Files:**
- Create: `exported-media.ts`, `media-transcode.ts`, `media-transcode.spec.ts`, `exported-media.spec.ts`
- Modify: `libs/web-media/src/lib/audio/libav-decoder.ts`, `libs/web-media/src/lib/audio/index.ts`

**Interfaces:**
- Produces (`exported-media.ts`): `OPUS_BITRATE = 32_000`; `isVideoName(name: string): boolean` (mp4, m4v, mov, mkv, webm, avi, 3gp); `exportedMediaName(name: string): string` → same basename with `.opus` (audio) or `.mp4` (video); `exportedMediaType(name: string): string` → `'audio/ogg'` or `'video/mp4'`.
- Produces (`media-transcode.ts`): `transcodeForExport(source: File): Promise<File>` — resolves to a `File` named `exportedMediaName(source.name)`; rejects with an `Error` whose message says why (no audio stream, muxer refused, out of memory).
- Consumes: `getLibAV()`, `getLibAVFat()` exported from `@tratt/web-media`.

- [ ] **Step 1: Failing pure tests** (`exported-media.spec.ts`): `exportedMediaName('Intervju 1.WAV') === 'Intervju 1.opus'`, `'clip.mkv' → 'clip.mp4'`, `'a.opus' → 'a.opus'`, `exportedMediaType('x.mov') === 'video/mp4'`.
- [ ] **Step 2: Implement `exported-media.ts`; run, expect PASS.**
- [ ] **Step 3: Export `getLibAV` and `getLibAVFat` from `libav-decoder.ts` and re-export from `index.ts`.** No behaviour change.
- [ ] **Step 4: Failing transcode test** (`media-transcode.spec.ts`, libav mocked with a fake object exposing the calls below): audio file → resolves to `.opus` file, encoder created with `bit_rate: 32000` and mono layout, uses `getLibAV` (never the fat build); video file → uses `getLibAVFat`, video packets passed to the muxer unchanged; file without audio stream → rejects `/no audio stream/i`.
- [ ] **Step 5: Implement `transcodeForExport`.** Algorithm (the signature does not determine it): `writeFile` the source → `ff_init_demuxer_file` → decode the first audio stream (`ff_init_decoder`, same as `decodeWithLibAV`) → filter graph `aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=mono,asetnsamples=n=960:p=0` (libopus needs fixed 20 ms frames; the filter also downmixes stereo) → `ff_init_encoder('libopus', { ctx: { bit_rate: 32000, sample_fmt: AV_SAMPLE_FMT_FLT, sample_rate: 48000, channel_layout: 4 }, time_base: [1, 48000] })` → `ff_encode_multi` → `ff_init_muxer` with `format_name: 'ogg'` (audio) or `'mp4'` (video) → `ff_write_multi`, `readFile`, `unlink` temp files. For video: also copy the video stream's packets through to the mp4 muxer (stream copy, no video re-encode) and drop other streams. Always `unlink` temp files and free contexts in `finally`. Guard: sources over `MAX_TRANSCODE_BYTES = 1.5 * 2**30` reject up front (`// ponytail: whole file sits in the wasm heap; stream via mkreadaheadfile if bigger files matter`).
- [ ] **Step 6: Run specs, expect PASS.**
- [ ] **Step 7: Commit** `feat(export): transcode audio to 32 kbps mono Opus, video to mp4`.

---

### Task 4: Wire into export, keep round-trip intact

**Files:**
- Modify: `catalogue-export.service.ts` (`audioFor`, zip store rule, manifest), `export-files-modal.component.ts` (`contents()` audio entry name)
- Test: `catalogue-export.service.spec.ts`, `export-files-modal.component.spec.ts`, `catalogue-import.spec.ts`

**Interfaces:**
- Consumes: `transcodeForExport`, `exportedMediaName` from Task 3.
- Produces: `audioFor()` returns the transcoded file; on rejection returns the original `File` and a warning `"<label>: could not re-encode (<reason>); the original file is exported."` pushed to `warnings`.

- [ ] **Step 1: Failing service tests** (mock `transcodeForExport`): resolves → zip holds `bundles/x/x.opus`, manifest `audioPath`/`audioType` are `…x.opus` / `audio/ogg`; rejects → zip holds the original name, `warnings` contains the fallback text, export still completes and other bundles are exported.
- [ ] **Step 2: Failing modal test:** preview audio entry for bundle `Intervju 1.wav` is named `Intervju 1.opus`; for `clip.mkv`, `clip.mp4`.
- [ ] **Step 3: Failing import test** (`catalogue-import.spec.ts`): `filesFromExportZip` on a zip with `bundles/x/x.opus` + `x_annot.json` returns both, paired; same for `x.mp4`. If it returns no audio, add `opus` / `mp4` to `AppInfo.audioformats` (check `app.info.ts` first).
- [ ] **Step 4: Implement:** in `audioFor`, `try { file = await transcodeForExport(source) } catch (e) { warn; file = source }`; the zip's "store, don't deflate" rule already matches `audio/` and `video/` types, keep it.
- [ ] **Step 5: Sample-rate consistency.** Write a failing test that serializes a transcript at 44 100 Hz, exports with the transcoded file (48 000 Hz), and asserts the exported `_annot.json` `sampleRate === 48000` with every item `sampleStart`/`sampleDur` scaled by 48000/44100 (rounded) and `duration` likewise. Implement by passing `48000` and the rescaled duration to `transcript.serialize(...)` when the transcode succeeded (read `OctraAnnotation.serialize` first: if it already rescales positions, only the rate argument changes; if not, rescale the items in a small helper next to `run`). When the transcode fell back to the original, keep the source rate.
- [ ] **Step 6: Run the three specs, expect PASS.**
- [ ] **Step 7: Commit** `feat(export): export transcoded media, keep _annot.json aligned`.

---

### Task 5: Verify in the real app

**Files:** none (verification only; use `superpowers:verification-before-completion`).

- [ ] **Step 1:** `npx nx serve tratt`; load one stereo 44.1 kHz `.wav` (~1 min) and one `.mp4` video; transcribe or paste a transcript; open Export with one recording selected.
  Expected: Include the audio ticked, AnnotJSON ticked and dimmed (click does nothing), preview shows `<name>.opus` + `<name>_annot.json`.
- [ ] **Step 2:** Download the zip, unzip, run `ffprobe` on the outputs.
  Expected: `.opus` is `opus`, 1 channel, ≈32 kb/s (≈240 KB/min); mp4 keeps the original video codec and has an `opus` audio stream.
- [ ] **Step 3:** Select two recordings, export again. Expected: identical dialog defaults and per-folder contents.
- [ ] **Step 4:** Drop the zip back on Tratt. Expected: both recordings load, segment boundaries land on the same words (spot check three).
- [ ] **Step 5:** Load a WebM/VP8 video, export. Expected: original `.webm` in the zip + the fallback warning, other recording still exported.

---

### Task 6: Docs and copy

**Files:** `docs/manual/exporting.md`, `docs/manual/sv/exporting.md`, `apps/tratt/src/assets/i18n/en.json`, `sv.json`.

- [ ] **Step 1:** In both manuals: item 3 becomes "ticked to begin with whenever audio is attached"; Tratt's own format is always included and cannot be unticked; audio is saved as 32 kbps mono Opus (`.opus`), video as `.mp4` with the video untouched; the "One file or a .zip" paragraph no longer uses a single DOCX as its example. Remove the "with a single DOCX, tick Tratt's own format as well" advice.
- [ ] **Step 2:** `en.json` / `sv.json`: extend `workbench.export.include_audio` hint (new key `include_audio_hint`: "Saved as 32 kbps mono Opus; video as mp4") and show it as a muted line under the checkbox; add `workbench.export.native_locked` for the dimmed row's tooltip. Check Transloco's fallback for the other locale files before deciding whether they need the keys.
- [ ] **Step 3: Run** `npx nx test tratt --testFile=export-files-modal.component.spec.ts` and `npx nx lint tratt`; expect PASS.
- [ ] **Step 4: Commit** `docs(export): describe fixed defaults and Opus audio`.

---

## Self-review

- Spec coverage: R1/R2/R3 → Task 2; R4 → Tasks 3–4; dev-server noise → Task 1; round trip and failure fallbacks → Tasks 4–5.
- Type consistency: `exportedMediaName`, `transcodeForExport`, `NATIVE_FORMAT` used identically across tasks.
- Open assumptions (change if wrong): `.opus` (Ogg) is the audio container; video stream is copied, only its audio track is re-encoded; native forcing is local-mode only; a failed transcode exports the original instead of aborting.

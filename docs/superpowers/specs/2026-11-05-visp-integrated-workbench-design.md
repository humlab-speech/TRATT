# TRATT in VISP: assigned bundles in the workbench — design

Status: TRATT side implemented 2026-11-05 (see "Implementation status"); VISP side not started. Decisions in "Decisions locked in" were made by the project owner;
everything else is a proposal open to review.

## Goal

Launch TRATT from VISP the way Artic is launched: no bundle picker in VISP. TRATT opens on the
workbench and its left panel lists exactly the bundles assigned to the current user through VISP's
**Assign annotation tasks** dialog. The user moves between them, transcribes, and saves straight back
to the project's EMU database.

The stand-alone (offline) TRATT stays as it is: the workbench at `/` with files from the user's own
computer, stored only in the browser.

## How it works today (verified 2026-11-05)

**Artic.** The VISP webclient sets a `projectId` cookie on the VISP host domain and iframes
`artic.<host>/?autoConnect=true&serverUrl=wss://artic.<host>`. Artic talks the EMU-webApp websocket
protocol to `emu-webapp-server` (`external/emu-webapp-server/src/main.js`):

| Request | What the server does |
| --- | --- |
| `GETGLOBALDBCONFIG` | Returns the project's `VISP_DBconfig.json`. |
| `GETBUNDLELIST` | Returns `bundlelists.findOne({projectId, owner: user}).bundles`, the list the assignment dialog writes: `{session, name, fileName?, comment, finishedEditing}`. |
| `GETBUNDLE {name, session}` | Returns `{annotation: <_annot.json>, mediaFile: {encoding: "GETURL", data: MEDIA_FILE_BASE_URL + "/file/project/…/session/…/file/<bundle>.wav"}, ssffFiles}`. |
| `SAVEBUNDLE {annotation, session, finishedEditing, comment, ssffFiles}` | Writes `_annot.json` (whole file) and the declared SSFF tracks; updates `finishedEditing` and `comment` in the user's bundle list. Never creates bundles. |

The server authenticates every message: it resolves `PHPSESSID` to a user, checks the user is a
member of `projectId` (both from cookies), and rejects websocket origins outside `ALLOWED_ORIGINS`
(default: the `MEDIA_FILE_BASE_URL` origin, that is, Artic only). `/file/...` checks the same
cookies.

**TRATT.** The **Launch Tratt with bundle** dialog calls session-manager's `createOctraTask`. That
creates a virtual task and, if needed, adds an `OCTRA_1` level to the annotation file. The webclient
then iframes `tratt.<host>/?embedded=true&audio_url=…&transcript=…` (URL mode). TRATT posts the
annotation to the parent page, which calls `saveOctraTask`. That flow still works on
`feat/workbench-at-root`, with the problems listed below.

### Problems this design has to solve or avoid

Each was reproduced against the dev server with a VISP-shaped harness. Scripts and fixtures were in
the session scratchpad (`visp-launch.mjs`, `roundtrip.sh`).

1. **Tier pile-up.** TRATT renames `OCTRA_1` to the UI-language "Default tier" when it loads a
   transcript, and saves it under that name. On the next open `createOctraTask` finds no `OCTRA_1`
   and adds an empty one. After two save/reopen cycles the file had two levels named `Default tier`
   plus a new empty `OCTRA_1`. EMU requires unique level names.
2. **ITEM levels crash TRATT.** `TrattAnnotation.deserialize` passes the raw JSON items of an ITEM
   level to `createItemLevel` instead of `OItem` instances
   (`libs/annotation/src/lib/annotation.ts`, around line 764). `TrattAnnotationItemLevel.clone()`
   then throws `a.clone is not a function`, and Save never fires. Any bundle Artic has annotated
   hierarchically (`Word` ITEM dominating `Phonetic` SEGMENT) hits this.
3. **Segment boundaries shift.** EMU segments are inclusive: the next segment starts at
   `sampleStart + sampleDur + 1`. TRATT treats `sampleStart + sampleDur` as the end. A Phonetic
   level `[(0,15999), (16000,15999), (32000,31999)]` came back as
   `[(0,15999), (15999,16000), (31999,32000), (63999,1,"")]`: every later boundary moved one sample
   earlier and an empty 1-sample segment was appended. TRATT also does this to levels it was never
   asked to edit.
4. **Undeclared level.** `OCTRA_1` is not in `VISP_DBconfig.json` (projects declare their own
   levels, for example `Word`/ITEM and `Phonetic`/SEGMENT). TRATT opens on the first SEGMENT level,
   so users of the current flow transcribe into `Phonetic`.
5. **Workbench detour (`feat/workbench-at-root`).** While booting, `keepOnWorkbench()` treats the
   saved launch page `/?embedded=…` as the workbench and navigates to `/`. Only
   `WORKBENCH_SESSION_GUARD` sends the user on to `/intern/transcr`.

## Decisions locked in

- **Protocol: reuse the EMU websocket protocol** against the existing `emu-webapp-server`. No new
  backend endpoints. The bundle list, assignment, auth and save semantics are Artic's by
  construction.
- **Tier: a level declared in `VISP_DBconfig.json`.** TRATT writes only to the project's
  transcription level, never renames it, and leaves every other level, item and link as it found
  them.
- **Offline and integrated use separate workspaces.** The launch decides the workspace. VISP
  bundles live in their own browser database per server and project, never next to the user's own
  files. In the VISP workspace the list is exactly the assignment: no adding, recording, zip import
  or removing.
- **Retire the VISP-specific paths, keep URL mode.** Remove the bundle dialog, `createOctraTask`,
  `saveOctraTask`, the `OctraVirtualTask` model, the PHP task-file download, and TRATT's dead
  `/visp-task/...` route. URL mode (`?audio_url=…&embedded=true`) stays as a generic embed.

## Design

### 1. Workspaces, not a new login mode

The workbench machinery (bundle entity collection, per-bundle undo, residency, pipeline queue,
capacity) is all keyed on `LoginMode.LOCAL`, and `mode === LOCAL` is checked throughout. Adding
`LoginMode.VISP` would mean touching every one of those checks. Instead, LOCAL mode gains a
**workspace**:

```ts
type Workspace =
  | { kind: 'local' }                                   // today's behaviour
  | { kind: 'visp'; serverUrl: string; projectId: string; mediaOrigin: string;
      transcriptionLevel: string };
```

- The workspace is resolved once at boot, before `IDBActions.loadAnnotation`, and is immutable for
  the page's lifetime. Switching workspace means a new page load.
- **Persistence is per workspace.** `TrattDatabase` already takes its database name in its
  constructor. The local workspace keeps today's name, so existing users' data is untouched. A VISP
  workspace uses `tratt-visp:<serverUrl>:<projectId>`. Isolation therefore costs no schema
  migration, and clearing one workspace cannot touch another.
- The UI reads `workspace.kind` to decide which controls exist (section 4).

### 2. `BundleSource`: where bundles, audio and saves come from

A small interface, injected per workspace, separates "where bundles come from" from the workbench:

```ts
interface BundleSource {
  readonly canAddBundles: boolean;          // drop zone, record, zip import, remove
  listBundles(): Observable<BundleRef[]>;   // local: from IDB; visp: GETBUNDLELIST
  loadBundle(ref): Promise<{ annotation; audio: () => Promise<Blob> }>;
  save(ref, annotation, meta?: { finishedEditing?: boolean; comment?: string }): Promise<void>;
}
```

- `LocalBundleSource` wraps today's behaviour. Its `save` is a no-op beyond the IDB autosave, and
  `audio` is "the user attaches it". Introducing it must be behaviour-neutral: every existing
  workbench spec passes unchanged. That is the acceptance test of the refactoring phase.
- `VispBundleSource` is built on an `EmuWebsocketClient`: one connection, `callbackID`
  request/response pairing, reconnect with backoff, and a clear failure when the server answers
  with an auth error.

### 3. The VISP bundle lifecycle

**Listing.** On boot, `GETBUNDLELIST` becomes the entity collection. Bundles are keyed by
`session + name`, so the same name in two sessions is two bundles. A **Refresh** action re-reads
the list. Bundles unassigned since the last visit disappear (with their local draft, after a
warning if the draft has unsaved changes), and newly assigned ones appear.

**Opening.** `GETBUNDLE` fetches the annotation and the audio URL.

- **Audio** is fetched on selection, or when the pipeline queue needs it, so the existing residency
  policy applies unchanged. In the VISP workspace "Attach" never appears, because the audio can
  always be fetched again.
- **Annotation: pass-through plus one owned level.** TRATT keeps the server's annotation JSON
  verbatim and loads only `transcriptionLevel` into the editor. On save it splices the edited level
  back into the stored original and sends the whole file. Everything else is sent back
  byte-for-byte: other levels, ITEM hierarchies, links, ids, and top-level fields. That makes
  problems 2 and 3 impossible for data TRATT does not own, without relying on TRATT's annotation
  model understanding every EMU construct.
- **Boundary convention.** Converting the owned level between EMU's inclusive `sampleDur` and
  TRATT's exclusive end happens in one place, at the splice, with round-trip tests:
  `load → save` without edits must produce identical bytes.
- **Ids.** New segments in the owned level get ids above the bundle's current maximum item id
  across all levels. EMU ids are unique per bundle.
- **Missing level.** If the DBconfig (from `GETGLOBALDBCONFIG`) does not declare
  `transcriptionLevel` as a SEGMENT level, the workspace opens read-only and says so in plain
  terms. If the level is declared but this bundle has no items in it (a level added after the
  bundle was created), TRATT starts it with one empty segment covering the recording, written on
  first save.
- **Links.** If any `linkDefinition` involves the transcription level, TRATT refuses to edit it.
  Splicing a linked level would orphan links. VISP must keep this level unlinked.

**Saving.**

- Edits autosave to the workspace's IDB as today, so a crash or reload loses nothing.
- Saving to VISP is explicit, as in Artic. There is a per-bundle **Save** in the editor bar and a
  **Save** in the list. TRATT also saves when the user switches bundles with unsaved changes, if a
  setting allows it (default on).
- **Mark as finished** sends `finishedEditing: true`. The list shows each bundle's
  `finishedEditing` and `comment` as the server has them. The comment is editable and saved with
  the bundle.
- **Stale check.** Just before `SAVEBUNDLE`, TRATT re-reads the bundle with `GETBUNDLE`. If the
  annotation differs from the one this draft started from (someone saved in Artic or another tab),
  TRATT shows both and does not overwrite silently. The EMU protocol has no versioning, so this
  narrows the window but cannot close it. That is documented, not hidden.
- The list shows a per-bundle sync state: saved, unsaved changes, saving, failed (with the
  server's message and a retry).

**Automatic transcription.** In the VISP workspace the queue only offers bundles whose
transcription level is empty, and **Transcribe new files automatically** is off by default. An
assigned bundle with existing work is never transcribed over without an explicit per-bundle
action.

### 4. Workbench UI in the VISP workspace

- **Hidden:** drop zone, **Record now**, zip import, **Remove**, **Clear finished**. The list is
  the assignment.
- **Shown:** the project name and the user (from the launch and the server), **Refresh**,
  per-bundle sync state, finished and comment, **Save**, **Mark as finished**.
- **Export** and **Download transcript** stay: they produce files on the user's computer and do not
  change VISP data.
- **Errors** in user terms, each with its next step: "You are no longer signed in to VISP" (session
  expired), "You are not a member of this project", "This project has no transcription level", and
  "VISP cannot be reached; your changes are kept in this browser".

### 5. Launch and configuration

- **VISP webclient:** the Tratt app button uses the existing `launchTrattSession()` path (sets the
  `projectId` cookie, routes to `/tratt`), as Artic does. `setupTratt` iframes
  `tratt.<host>/?workspace=visp&projectId=<id>`.
- **TRATT `appconfig.json`** (deployment-mounted) gets
  `visp: { serverUrl, mediaOrigin, transcriptionLevel }`. The server URL comes from configuration,
  never from the query string, so a crafted link cannot point TRATT at another server.
  `?workspace=visp` without a `visp` config block shows an error rather than falling back to
  offline.
- **Project mismatch guard:** the `projectId` cookie is shared by every VISP tab. TRATT compares
  the cookie with its launch `projectId` before each (re)connect and stops with a message if
  another tab has switched project. Otherwise a reconnect would silently authenticate against a
  different project.
- **Visiting `tratt.<host>` directly**, without `?workspace=visp`, is the offline workbench, exactly
  as today.

### 6. Deployment changes (visible-speech-deployment)

- `tratt.vhost.conf`: proxy `/emu-ws` (websocket) and `/file` to `emu-webapp-server:17890`, so
  TRATT's audio and protocol traffic is same-origin. TRATT runs with
  `Cross-Origin-Embedder-Policy: credentialless`, which strips cookies from cross-origin no-CORS
  fetches, so audio fetched from `artic.<host>` would arrive unauthenticated. The vhost's existing
  catch-all websocket rule (to `ws://tratt/`) must come after the new `/emu-ws` rule.
- `emu-webapp-server`: add `https://tratt.<host>` to `ALLOWED_ORIGINS`.
- Media URLs: `GETBUNDLE` returns absolute URLs on `artic.<host>`. TRATT accepts them only when
  their origin equals `visp.mediaOrigin`, and fetches the same path from its own origin. The
  alternative is having the server emit root-relative `/file/...` URLs, which Artic would also
  resolve, but that is an Artic-visible change and needs its own test.
- **Transcription level in projects:** new projects get a `Transcription` SEGMENT level in their
  default `annotLevels`. Existing projects need a one-off migration that adds the level through the
  same `emudb-create-annotlevel` path. **Caution:** `saveProject` deletes DBconfig levels that are
  missing from the project form, so removing the level in the form deletes its transcriptions. The
  form should protect this level, or at least warn.

### 7. Retirement

When the VISP workspace ships, remove:

- In the webclient: the TRATT bundle dialog and `setupTratt`'s URL-mode construction.
- In session-manager: `createOctraTask`, `saveOctraTask`, `ensureValidAnnotationDataStruct` and
  `OctraVirtualTask`.
- In `api.php`: task file download.
- In TRATT: `/visp-task/...` and `VispTaskComponent`.

URL mode stays in TRATT.

## Phases

Each phase is shippable and reviewable on its own.

| Phase | Repo | Content | Done when |
| --- | --- | --- | --- |
| 0 | TRATT | Stand-alone fixes: ITEM-level deserialize crash (problem 2); `keepOnWorkbench()` only in LOCAL mode (problem 5); decide and test the AnnotJSON segment convention against emuR (problem 3 also affects offline `_annot.json` import/export). | Harness round-trips an Artic-style hierarchy; unit tests for each. |
| 1 | VISP | Transcription level for new and existing projects; level protection in the project form; vhost proxy; `ALLOWED_ORIGINS`. | From a TRATT origin, the dev stack answers `GETBUNDLELIST` and serves audio same-origin. |
| 2 | TRATT | `Workspace` + per-workspace database + `BundleSource` with `LocalBundleSource`. | No behaviour change: all existing specs pass; offline smoke test unchanged. |
| 3 | TRATT | `EmuWebsocketClient`, `VispBundleSource`: list, open, pass-through splice, save, stale check. | Byte-identical `load → save` round trip; e2e against a mock EMU server (Node `ws`, in-repo). |
| 4 | TRATT | VISP workspace UI (section 4), errors, sync state, manual chapter. | E2E: launch → list = assignment → edit → save → server file has only the owned level changed. |
| 5 | both | Launch switch-over in the webclient; retirement (section 7). | Dev-stack smoke test with Artic and TRATT on the same bundle. |

## Implementation status (2026-11-05)

TRATT side (Phases 0, 2, 3, 4) is implemented and checked end to end in a browser
against a mock of `emu-webapp-server` (scenario scripts kept outside the repo for
now). VISP side (Phases 1 and 5) is not started.

Where the implementation differs from the design above:

- **Local mode does not go through `BundleSource`.** `LocalBundleSource` exists
  only to satisfy the interface; the offline workbench keeps its own machinery
  unchanged. `VispBundleSource` is the only real source.
- **Workspace state is module-level.** `WorkspaceService` is a facade over one
  resolution per page, so effects constructed with `new` in specs see the same
  workspace. The launch query is recorded in `main.ts` before the unknown-param
  strip and before `/load` drops it (`rememberLaunchSearch` / `launchQuery`).
- **Drafts live in their own small database**
  (`tratt-visp-drafts:<serverUrl>:<projectId>`, `VispDraftStore`), keyed by
  session and bundle name, holding the edited owned level and the server
  annotation it started from (`base`). A reload restores the draft and keeps
  checking saves against that base, so an old draft never silently overwrites a
  newer save.
- **Every assigned bundle's annotation is read when the list loads** (audio
  only when needed), so bundles with text in VISP count as transcribed and the
  Transcribe queue never offers them.
- **Bundle ids are stable** (`visp:<session>/<name>`), except the first bundle,
  which starts the session as `bundle-1` through the login chain.
- **What is written** (`toPlainOwnedLevel`): id, boundaries and labels only;
  TRATT's break marker alone is written as an empty label; only labels declared
  for the level in the DBconfig are kept, the text label always named after
  the level.
- **Unsaved changes** compare ids, boundaries and label values of the cleaned
  level (`ownedLevelKey`); any level without content equals an empty one.
- **Stale saves** offer **Keep my version** (force: the owned level replaces
  VISP's, other levels as VISP has them now) and **Use the VISP version**.
- **Unassigned bundles with unsaved changes** stay listed, cannot be saved, and
  are removed by the user.
- **Read-only projects** (no transcription level, or a linked one) list the
  assignment by name and open no editor session.
- **Transcription runs** name their result after `visp.transcriptionLevel`.

## Segment boundary convention (decision, 2026-11-05)

EMU `_annot.json` segments are inclusive: a segment covers `[sampleStart, sampleStart + sampleDur]`
and the next one starts at `sampleStart + sampleDur + 1`. TRATT treats `sampleStart + sampleDur` as
an exclusive end (problem 3).

**Does it matter?** Acoustically, no. One sample is about 62 µs at 16 kHz and far below the accuracy
of any manual or automatic boundary, and TRATT never modifies audio. What matters are the side
effects: the spurious empty 1-sample segment TRATT appends (visible in Artic and in `emuR` queries),
adjacent segments overlapping by one sample under the inclusive reading (not yet checked against
`emuR`/EMU-webApp validation), and a possible drift over repeated saves (one shift was observed;
repeated cycles were not tested).

**Decision.** Follow the EMU/`emuR` convention in general, but do not make a project of it.

- **VISP workspace (implemented, Phase 3).** The conversion happens in one place, the splice in
  `emu-annotation-splice.ts`: TRATT-side `sampleDur` = EMU `sampleDur` + 1 on load, and − 1 on save.
  Levels TRATT does not own are passed through untouched, so they are unaffected. A round-trip test
  (`load → save` without edits is byte-identical) guards the conversion.
- **Offline `_annot.json` import/export (deferred).** Apply the same conversion only if it is a
  one-line change in the converter. Existing offline users hold data written under the current
  behaviour, and changing it would shift their boundaries on the next load.

**Still open.** Confirm the inclusive convention against real emuR/Artic files (the spec's evidence
is a single reproduced round trip), and test whether the shift accumulates across repeated
save/reopen cycles.

## Open questions

- **Level name.** Is a deployment-wide `Transcription` enough, or do projects need to choose their
  own transcription level? A per-project choice needs a carrier: the EMU protocol has none, so it
  would be a DBconfig extension or a session-manager lookup.
- **Other levels in the editor.** Phase 4 shows only the owned level. Showing other SEGMENT levels
  read-only (for orientation) is a follow-up. It needs problem 3 fixed for display, not just for
  pass-through.
- **Concurrent editing with Artic.** Last write wins in the protocol. The stale check catches the
  common case. Real locking would be a server change to both apps' protocol.

Settled: TRATT never sends `ssffFiles`. `saveBundle` iterates `Object.values(reqData.ssffFiles || {})`,
so a save without them writes no track files and leaves existing tracks alone.

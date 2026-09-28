# Phase 4 — Catalogue Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `/workbench` user select any subset of their loaded bundles and export all of them — annotations only, in whichever converter formats they pick — as one streamed-download zip archive carrying a `manifest.json`/`manifest.csv` alongside the per-bundle files, plus give `BundleListComponent` the bulk select-all / clear-finished / remove actions the list needs to manage more than a handful of bundles at once.

**Architecture:** A new `CatalogueExportService` (root-provided) is the only new piece of business logic: given a list of bundle ids and converter names, it walks bundles sequentially — reading each bundle's already-resident `transcript` straight from the store, `ensureResident()`-ing its audio only for the duration of that one bundle's export — runs the existing per-converter `.export()` calls unchanged, and hands the results to `fflate.zipSync()` for one archive. Two small UI pieces sit on top: bulk-selection checkboxes and actions added to the existing `BundleListComponent`, and a new `CatalogueExportModalComponent` (opened from a new button next to those bulk actions, not from the existing single-bundle export button) that lets the user pick converters and bundles and triggers the download. `ExportFilesModalComponent` (today's single-bundle export, opened via the app-shell navbar) is untouched.

**Tech Stack:** Angular 19 standalone components, NgRx (`@ngrx/store`, `@ngrx/entity`), `fflate` (already a dependency, `^0.8.3`), Jest.

**Spec:** `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md` — "Step 4 design (2026-09-28) — catalogue export" section (the grounding facts numbered 1-5 there are load-bearing for every task below; read them before Task 2).

## Global Constraints

- Local mode only — `CatalogueExportService`/`CatalogueExportModalComponent` are `/workbench`-only, same as the rest of Phase 2-3. Do not touch ONLINE/DEMO/URL code paths.
- `ExportFilesModalComponent` and its `navbarServ.doclick('export')` wiring in the app-shell `NavbarComponent` (`tratt-navigation`, mounted in `app.component.html`) are **not modified** by this plan — see spec finding under "UI." in the Step 4 design section for why.
- No new store field for per-bundle `ranWith`/provenance — manifest model/language/stages come from `PipelineQueueService`'s already-held, global `TranscriptionOptions` (spec finding #2). `stagesRun` never includes `'translation'` — the workbench queue cannot produce it today.
- Bundles are processed **sequentially** in `exportBundles()`, never in parallel (`ensureResident()` per bundle, not `forkJoin`) — this is the actual memory bound the spec's plan §7 wanted (spec finding #5); do not "optimize" this into parallel Promise.all later without re-reading that finding.
- Use `fflate.zipSync()` (whole-archive-in-memory), not the streaming `Zip`/`ZipPassThrough` classes — a deliberate, spec-documented simplification (see the Step 4 design section's "Simplification, deliberate" note). Annotation exports are text-sized; there is no bulk-audio path here to stream.
- i18n: add real English copy to `en.json`, real Swedish copy to `sv.json` (the two locales this repo actually maintains by hand — `de`/`it`/`ko`/`nl`/`zh` get the English string copied verbatim, matching the existing `workbench.bundle_list.*` keys' precedent in all seven files).
- `IFile.content` is typed `string` but binary-format converters (DOCX/ODT) actually put a `Uint8Array` there via `as unknown as string` (see `DocxConverter.ts:179`) — matches `ExportFilesModalComponent.updateParentFormat()`'s own `result.file.encoding === 'binary'` branch. `CatalogueExportService` must branch on `encoding` the same way when turning a converter's `IFile` into zip-able bytes.

## Review Focus

- **A checked bundle disappears mid-export (removed via the new bulk "remove" action, or its media never re-attaches).** `exportBundles()` reads each bundle from the store at the moment it processes it, not from a snapshot taken when the modal opened — a bundle removed after the modal opened but before its turn comes up must be skipped, not thrown on. Test in Task 2.
- **`ensureResident()` returns `false`** (a bundle whose audio can't be re-decoded, e.g. `awaitingMedia` with no re-attached file yet). Must produce a per-bundle error entry in the export progress, not abort the whole archive. Test in Task 2.
- **A converter's `.export()` returns `{error}` instead of `{file}`** for one bundle/format combination (e.g. an ELAN export on an annotation with zero segments). Must skip just that one file and continue, not abort. Test in Task 2.
- **Two bundles share a basename** (e.g. `interview.wav` imported twice under different bundle ids, or a re-recorded take). The zip's `bundles/<slug>/` layout must not silently overwrite one bundle's files with another's. Test in Task 2 (reuses the dedup precedent from step 2.7's dropzone basename handling — do not invent a second, different scheme).
- **"Remove" is clicked with zero bundles checked, or with every bundle checked including the last one.** The bulk actions must no-op on an empty selection (Task 3) and the reducer must never leave the collection with zero entities — `hasAnyBundles()` and the rest of the shell assume the `DEFAULT_BUNDLE_ID` sentinel always exists (Task 1).

---

## File Structure

- **Modify** `apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts` — add `removeBundles` action.
- **Modify** `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts` — handle it in `wrapAsLocalBundleCollectionReducer`.
- **Modify** `apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts` — add a `getTranscribeOptions()` getter (the field already exists, private, with no reader).
- **Create** `apps/tratt/src/app/core/shared/service/catalogue-export.service.ts` — the export/manifest/zip logic.
- **Modify** `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts` / `.html` / `.scss` — selection state + bulk actions + "Export catalogue" button.
- **Create** `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.ts` / `.html` / `.scss` — the new modal.
- **Modify** `apps/tratt/src/assets/i18n/{en,sv,de,it,ko,nl,zh}.json` — new `workbench.bundle_list.select_all`/`clear_finished`/`remove`/`export_catalogue` and `workbench.catalogue_export.*` keys.

---

### Task 1: `removeBundles` action and reducer case

**Files:**
- Modify: `apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts`
- Modify: `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts:162-182` (insert after the `setBundleTranscript` branch, before the generic fallback)
- Test: `apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts`

**Interfaces:**
- Produces: `LoginModeActions.removeBundles({ mode: LoginMode; bundleIds: string[] })` — dispatched by `BundleListComponent` in Task 3.

- [ ] **Step 1: Write the failing reducer tests**

Add to `login-mode.reducer.spec.ts`, inside a new `describe` block placed after the existing `'LoginModeReducers — createBundle / selectBundle'` block:

```typescript
describe('LoginModeReducers — removeBundles', () => {
  const sessionFile = new SessionFile('b2.wav', 123, new Date(), 'audio/wav');

  it('removes the given bundles and leaves the rest untouched', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const withB2 = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      withB2 as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: [DEFAULT_BUNDLE_ID],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBeUndefined();
    expect(next.bundles.entities['b2']).toBe(withB2.bundles.entities['b2']);
  });

  it('reselects a remaining bundle when the selected one is removed', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const withB2 = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;
    // createBundle selects the new bundle — confirm the starting point.
    expect(withB2.selectedBundleId).toBe('b2');

    const next = reducer(
      withB2 as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: ['b2'],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
  });

  it('never leaves the collection empty — removing every bundle restores the default sentinel', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const next = reducer(
      initial as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: [DEFAULT_BUNDLE_ID],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.ids.length).toBe(1);
    expect(next.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]?.sessionFile).toBeUndefined();
  });

  it('removing a non-selected bundle leaves selectedBundleId untouched', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const withB2 = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;
    const reselected = reducer(
      withB2 as any,
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: DEFAULT_BUNDLE_ID,
      }),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      reselected as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: ['b2'],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(next.bundles.entities['b2']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts`
Expected: FAIL — `LoginModeActions.removeBundles` is not a function.

- [ ] **Step 3: Add the action**

In `login-mode.actions.ts`, add after `setBundleTranscript` (after line 61):

```typescript
  /**
   * Bulk-removes bundles from the local collection (BundleListComponent's
   * "remove" bulk action). The reducer guarantees the collection never ends
   * up empty — see its own comment.
   */
  static removeBundles = createAction(
    'annotation Remove bundles',
    props<{ mode: LoginMode; bundleIds: string[] }>(),
  );
```

- [ ] **Step 4: Handle it in the reducer**

In `login-mode.reducer.ts`, insert this block immediately after the `setBundleTranscript` branch closes (after line 182, before `const currentInner = ...` on line 183):

```typescript
    if (action.type === LoginModeActions.removeBundles.type) {
      const { bundleIds } = action as ReturnType<
        typeof LoginModeActions.removeBundles
      >;
      const removed = new Set(bundleIds);
      const remainingIds = (state.bundles.ids as string[]).filter(
        (id) => !removed.has(id),
      );
      if (remainingIds.length === 0) {
        // Never leave the collection empty — hasAnyBundles() and the rest
        // of the shell assume at least one entity always exists (the
        // DEFAULT_BUNDLE_ID sentinel this same function seeds on init).
        return {
          ...state,
          bundles: localBundleAdapter.setOne(
            { ...initialInner, bundleId: DEFAULT_BUNDLE_ID },
            localBundleAdapter.removeMany(bundleIds, state.bundles),
          ),
          selectedBundleId: DEFAULT_BUNDLE_ID,
        };
      }
      return {
        ...state,
        bundles: localBundleAdapter.removeMany(bundleIds, state.bundles),
        selectedBundleId: removed.has(state.selectedBundleId)
          ? remainingIds[0]
          : state.selectedBundleId,
      };
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/tratt/src/app/core/store/login-mode/login-mode.actions.ts apps/tratt/src/app/core/store/login-mode/login-mode.reducer.ts apps/tratt/src/app/core/store/login-mode/login-mode.reducer.spec.ts
git commit -m "feat(store): add removeBundles action for bulk bundle-list removal"
```

---

### Task 2: `CatalogueExportService`

**Files:**
- Modify: `apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts:100-102` (add getter after `setTranscribeOptions`)
- Create: `apps/tratt/src/app/core/shared/service/catalogue-export.service.ts`
- Test: `apps/tratt/src/app/core/shared/service/catalogue-export.service.spec.ts`

**Interfaces:**
- Consumes: `AudioService.ensureResident(bundleId: string): Promise<boolean>`, `AudioService.getManager(bundleId: string): AudioManager | undefined` (both existing, unchanged). `PipelineQueueService.getTranscribeOptions(): TranscriptionOptions | null` (new, this task). `Store<RootState>.selectSignal(selectLocalMode)` → `LocalBundleCollectionState` (`bundles.entities[id]: IdentifiedAnnotationState | undefined`). `AppInfo.converters: Converter[]`. `Converter.export(annotation: OAnnotJSON, audiofile: OAudiofile, levelnum?, levelnums?): ExportResult`. `TrattAnnotation.serialize(mediaFileName: string, sampleRate: number, lastSegmentTime: SampleUnit): OAnnotJSON`.
- Produces: `CatalogueExportService.exportBundles(bundleIds: string[], converterNames: string[]): Observable<CatalogueExportProgress>`, where:
  ```typescript
  export interface CatalogueExportProgress {
    completedBundles: number;
    totalBundles: number;
    currentBundleName: string | null;
    /** Set only on the final emission. */
    archive?: Uint8Array;
    /** Per-bundle problems that didn't abort the export — skipped files/bundles. */
    warnings: string[];
  }
  ```
  Consumed by `CatalogueExportModalComponent` in Task 4.

- [ ] **Step 1: Write the failing service tests**

Create `apps/tratt/src/app/core/shared/service/catalogue-export.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, jest } from '@jest/globals';
import { provideMockStore } from '@ngrx/store/testing';
import { unzipSync } from 'fflate';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';
import { AudioService } from './audio.service';
import { CatalogueExportService } from './catalogue-export.service';
import { PipelineQueueService } from './pipeline-queue.service';
import { RootState } from '../../store/index';
import { localBundleAdapter } from '../../store/login-mode/annotation/local-bundle-collection';
import { TrattAnnotation } from '@tratt/annotation';
import { SessionFile } from '../../obj/SessionFile';

function makeBundle(bundleId: string, fileName: string) {
  return {
    bundleId,
    sessionFile: new SessionFile(fileName, 10, new Date(), 'audio/wav'),
    audio: { loaded: true, fileName, sampleRate: 16000 },
    transcript: new TrattAnnotation(),
  } as any;
}

function makeManager(durationSamples: number, sampleRate: number) {
  return {
    sampleRate,
    resource: {
      info: { duration: { samples: durationSamples } },
      getOAudioFile: () => ({ name: 'x.wav', sampleRate, duration: durationSamples }),
    },
  } as any;
}

describe('CatalogueExportService', () => {
  function setup(bundles: ReturnType<typeof makeBundle>[]) {
    let bundleCollection = localBundleAdapter.getInitialState();
    for (const b of bundles) {
      bundleCollection = localBundleAdapter.setOne(b, bundleCollection);
    }
    const initialState = {
      login: {
        local: { bundles: bundleCollection, selectedBundleId: bundles[0].bundleId },
      },
    } as unknown as RootState;

    const audioService = {
      ensureResident: jest.fn(async () => true),
      getManager: jest.fn(() => makeManager(16000, 16000)),
    };
    const pipelineQueueService = {
      getTranscribeOptions: jest.fn(() => ({ modelId: 'm1', language: 'en' })),
    };

    TestBed.configureTestingModule({
      providers: [
        CatalogueExportService,
        provideMockStore({ initialState }),
        { provide: AudioService, useValue: audioService },
        { provide: PipelineQueueService, useValue: pipelineQueueService },
      ],
    });

    return {
      service: TestBed.inject(CatalogueExportService),
      audioService,
    };
  }

  it('produces one archive entry per bundle per requested converter, plus both manifests', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    expect(last.archive).toBeDefined();
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('manifest.csv');
    expect(entries.some((e) => e.startsWith('bundles/a/') && e.endsWith('.json'))).toBe(true);
    expect(entries.some((e) => e.startsWith('bundles/b/') && e.endsWith('.json'))).toBe(true);
  });

  it('emits progress once per bundle, ending at completedBundles === totalBundles', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);

    const events = await firstValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']).pipe(toArray()),
    );

    expect(events.length).toBe(2);
    expect(events[0].completedBundles).toBe(1);
    expect(events[1].completedBundles).toBe(2);
    expect(events[1].totalBundles).toBe(2);
    expect(events[1].archive).toBeDefined();
  });

  it('skips a bundle removed from the store before its turn, with a warning, and continues', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);
    // 'bundle-ghost' was never added to the store.
    const last = await lastValueFrom(
      service.exportBundles(['bundle-ghost', 'bundle-1'], ['AnnotJSON']),
    );

    expect(last.warnings.some((w) => w.includes('bundle-ghost'))).toBe(true);
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries.some((e) => e.startsWith('bundles/a/'))).toBe(true);
  });

  it('records a warning and continues when ensureResident() fails for a bundle', async () => {
    const { service, audioService } = setup([
      makeBundle('bundle-1', 'a.wav'),
      makeBundle('bundle-2', 'b.wav'),
    ]);
    audioService.ensureResident.mockImplementationOnce(async () => false);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    expect(last.warnings.some((w) => w.includes('bundle-1'))).toBe(true);
    const entries = Object.keys(unzipSync(last.archive!));
    expect(entries.some((e) => e.startsWith('bundles/b/'))).toBe(true);
    expect(entries.some((e) => e.startsWith('bundles/a/'))).toBe(false);
  });

  it('deduplicates two bundles that share a basename', async () => {
    const { service } = setup([
      makeBundle('bundle-1', 'interview.wav'),
      makeBundle('bundle-2', 'interview.wav'),
    ]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1', 'bundle-2'], ['AnnotJSON']),
    );

    const entries = Object.keys(unzipSync(last.archive!));
    const interviewDirs = new Set(
      entries
        .filter((e) => e.startsWith('bundles/interview'))
        .map((e) => e.split('/')[1]),
    );
    expect(interviewDirs.size).toBe(2);
  });

  it('builds a manifest.json entry with model/language from the queue config and no translation stage', async () => {
    const { service } = setup([makeBundle('bundle-1', 'a.wav')]);

    const last = await lastValueFrom(
      service.exportBundles(['bundle-1'], ['AnnotJSON']),
    );

    const manifest = JSON.parse(
      new TextDecoder().decode(unzipSync(last.archive!)['manifest.json']),
    );
    expect(manifest[0].model).toBe('m1');
    expect(manifest[0].language).toBe('en');
    expect(manifest[0].stagesRun).toEqual(['asr']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest apps/tratt/src/app/core/shared/service/catalogue-export.service.spec.ts`
Expected: FAIL — `catalogue-export.service.ts` does not exist yet.

- [ ] **Step 3: Add the `getTranscribeOptions()` getter to `PipelineQueueService`**

In `pipeline-queue.service.ts`, immediately after `setTranscribeOptions()` (after line 102):

```typescript
  /** Read access for CatalogueExportService's manifest — see its own doc comment. */
  getTranscribeOptions(): TranscriptionOptions | null {
    return this.transcribeOptions;
  }
```

- [ ] **Step 4: Write `CatalogueExportService`**

Create `apps/tratt/src/app/core/shared/service/catalogue-export.service.ts`:

```typescript
import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppInfo } from '../../../app.info';
import { Observable } from 'rxjs';
import { strToU8, zipSync } from 'fflate';
import { RootState } from '../../store/index';
import { selectLocalMode } from '../../store/login-mode/annotation/annotation.selectors';
import { IdentifiedAnnotationState } from '../../store/login-mode/annotation/local-bundle-collection';
import { AudioService } from './audio.service';
import { PipelineQueueService } from './pipeline-queue.service';
import { BUILD_INFO } from '../../../build-info';

export interface CatalogueExportProgress {
  completedBundles: number;
  totalBundles: number;
  currentBundleName: string | null;
  /** Set only on the final emission. */
  archive?: Uint8Array;
  /** Per-bundle/per-file problems that didn't abort the export. */
  warnings: string[];
}

interface ManifestRow {
  bundleId: string;
  sourceFilename: string;
  durationSamples: number;
  sampleRate: number;
  model: string | null;
  language: string | null;
  stagesRun: string[];
  unitCounts: number;
  appVersion: string;
}

/**
 * Turns N bundles into one downloadable zip: `bundles/<slug>/<name>.<ext>`
 * per requested converter format, plus `manifest.json`/`manifest.csv`.
 *
 * Deliberately sequential (one bundle `ensureResident()`d at a time, never
 * `forkJoin`'d) — see the spec's Step 4 design, finding #5: this is the
 * actual memory bound the master plan's "stream, don't buffer" language was
 * written for. Uses `fflate.zipSync()` (whole archive in memory) rather than
 * the streaming `Zip` API on purpose — annotation exports are text-sized;
 * see the same spec section's "Simplification, deliberate" note.
 */
@Injectable({ providedIn: 'root' })
export class CatalogueExportService {
  // Bound once, matching AudioService/BundleListComponent's own
  // `selectSignal` convention — read fresh inside run()'s loop via
  // `this.localMode()`, not re-bound per bundle.
  private localMode = this.store.selectSignal(selectLocalMode);

  constructor(
    private store: Store<RootState>,
    private audioService: AudioService,
    private pipelineQueueService: PipelineQueueService,
  ) {}

  exportBundles(
    bundleIds: string[],
    converterNames: string[],
  ): Observable<CatalogueExportProgress> {
    return new Observable<CatalogueExportProgress>((subscriber) => {
      void this.run(bundleIds, converterNames, subscriber);
    });
  }

  private async run(
    bundleIds: string[],
    converterNames: string[],
    subscriber: {
      next: (v: CatalogueExportProgress) => void;
      complete: () => void;
      error: (e: unknown) => void;
    },
  ): Promise<void> {
    const converters = AppInfo.converters.filter((c) =>
      converterNames.includes(c.name),
    );
    const files: Record<string, Uint8Array> = {};
    const manifestRows: ManifestRow[] = [];
    const warnings: string[] = [];
    const usedSlugs = new Set<string>();

    for (let i = 0; i < bundleIds.length; i++) {
      const bundleId = bundleIds[i];
      const entity = this.localMode().bundles.entities[bundleId];
      if (!entity) {
        warnings.push(`Skipped ${bundleId}: bundle no longer exists.`);
        subscriber.next({
          completedBundles: i + 1,
          totalBundles: bundleIds.length,
          currentBundleName: null,
          warnings: [...warnings],
        });
        continue;
      }

      const resident = await this.audioService.ensureResident(bundleId);
      const manager = resident
        ? this.audioService.getManager(bundleId)
        : undefined;
      if (!manager) {
        warnings.push(
          `Skipped ${entity.sessionFile?.name ?? bundleId}: audio could not be made resident.`,
        );
        subscriber.next({
          completedBundles: i + 1,
          totalBundles: bundleIds.length,
          currentBundleName: entity.sessionFile?.name ?? null,
          warnings: [...warnings],
        });
        continue;
      }

      const slug = this.uniqueSlug(
        entity.sessionFile?.name ?? bundleId,
        usedSlugs,
      );
      const oAudioFile = manager.resource.getOAudioFile();
      const oannotjson = entity.transcript.serialize(
        entity.audio.fileName,
        manager.sampleRate,
        manager.resource.info.duration,
      );

      let unitCounts = 0;
      for (const level of oannotjson.levels) {
        unitCounts += (level as { items?: unknown[] }).items?.length ?? 0;
      }

      for (const converter of converters) {
        const result = converter.export(oannotjson, oAudioFile);
        if (result.error || !result.file) {
          warnings.push(
            `${entity.sessionFile?.name ?? bundleId}: ${converter.name} export failed — ${result.error ?? 'no file produced'}.`,
          );
          continue;
        }
        const bytes =
          result.file.encoding === 'binary'
            ? (result.file.content as unknown as Uint8Array)
            : strToU8(result.file.content);
        files[`bundles/${slug}/${result.file.name}`] = bytes;
      }

      const options = this.pipelineQueueService.getTranscribeOptions();
      const stagesRun: string[] = [];
      if (options) {
        stagesRun.push('asr');
        if (options.diarization) {
          stagesRun.push('diarization');
        }
      }
      manifestRows.push({
        bundleId,
        sourceFilename: entity.sessionFile?.name ?? '',
        durationSamples: manager.resource.info.duration.samples,
        sampleRate: manager.sampleRate,
        model: options?.modelId ?? null,
        language: options?.language ?? null,
        stagesRun,
        unitCounts,
        appVersion: BUILD_INFO.version,
      });

      subscriber.next({
        completedBundles: i + 1,
        totalBundles: bundleIds.length,
        currentBundleName: entity.sessionFile?.name ?? null,
        warnings: [...warnings],
      });
    }

    files['manifest.json'] = strToU8(JSON.stringify(manifestRows, null, 2));
    files['manifest.csv'] = strToU8(this.toCsv(manifestRows));

    const archive = zipSync(files);
    subscriber.next({
      completedBundles: bundleIds.length,
      totalBundles: bundleIds.length,
      currentBundleName: null,
      archive,
      warnings: [...warnings],
    });
    subscriber.complete();
  }

  /** Matches step 2.7's basename-collision handling: first writer keeps the
   * bare slug, later same-name bundles get a `-2`, `-3`, ... suffix. */
  private uniqueSlug(fileName: string, used: Set<string>): string {
    const base = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n++}`;
    }
    used.add(slug);
    return slug;
  }

  private toCsv(rows: ManifestRow[]): string {
    const headers: (keyof ManifestRow)[] = [
      'bundleId',
      'sourceFilename',
      'durationSamples',
      'sampleRate',
      'model',
      'language',
      'stagesRun',
      'unitCounts',
      'appVersion',
    ];
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(
        headers
          .map((h) => {
            const v = row[h];
            const s = Array.isArray(v) ? v.join('|') : String(v ?? '');
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(','),
      );
    }
    return lines.join('\n');
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/shared/service/catalogue-export.service.spec.ts`
Expected: PASS. If a test fails on `entity.sessionFile?.name` slugging (e.g. `'a.wav'` → `'a'`), double check `uniqueSlug()`'s extension-stripping regex against the fixture filenames used in the test — adjust the test's expected path prefix, not the slugger, if there's a mismatch (the slugger's behavior — strip extension, sanitize — is the one this plan intends).

- [ ] **Step 6: Run the full existing pipeline-queue suite to confirm the new getter didn't regress anything**

Run: `npx jest apps/tratt/src/app/core/shared/service/pipeline-queue.service.spec.ts`
Expected: PASS (unchanged — the getter is additive).

- [ ] **Step 7: Commit**

```bash
git add apps/tratt/src/app/core/shared/service/catalogue-export.service.ts apps/tratt/src/app/core/shared/service/catalogue-export.service.spec.ts apps/tratt/src/app/core/shared/service/pipeline-queue.service.ts
git commit -m "feat(workbench): add CatalogueExportService for multi-bundle zip export"
```

---

### Task 3: Bulk selection and actions in `BundleListComponent`

**Files:**
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts`
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.html`
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss`
- Test: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.spec.ts`

**Interfaces:**
- Consumes: `LoginModeActions.removeBundles` (Task 1).
- Produces: `BundleListComponent.selectedForBulk: Signal<Set<string>>` (or equivalent readable selection state) and `(exportSelected)` output emitting `string[]` (the checked bundle ids, or all bundle ids if none are checked) — consumed by `WorkbenchComponent`/wherever `CatalogueExportModalComponent` is opened in Task 4.

- [ ] **Step 1: Write the failing component tests**

Add to `bundle-list.component.spec.ts` (mirrors the file's existing `describe`/fixture-setup style — reuse the file's existing `store`/`bundleA`/`bundleB` fixtures already defined near the top):

```typescript
describe('BundleListComponent — bulk actions', () => {
  // (uses the same beforeEach/fixture setup as the rest of this file)

  it('select-all checks every row, and unchecking it clears the selection', () => {
    const selectAll = fixture.debugElement.query(
      By.css('.bundle-list__select-all'),
    );
    selectAll.nativeElement.click();
    fixture.detectChanges();

    const rowCheckboxes = fixture.debugElement.queryAll(
      By.css('.bundle-list__item-checkbox'),
    );
    expect(rowCheckboxes.every((el) => el.nativeElement.checked)).toBe(true);

    selectAll.nativeElement.click();
    fixture.detectChanges();
    expect(
      fixture.debugElement
        .queryAll(By.css('.bundle-list__item-checkbox'))
        .every((el) => !el.nativeElement.checked),
    ).toBe(true);
  });

  it('remove dispatches removeBundles for the checked ids and clears the selection', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const rowCheckboxes = fixture.debugElement.queryAll(
      By.css('.bundle-list__item-checkbox'),
    );
    rowCheckboxes[0].nativeElement.click();
    fixture.detectChanges();

    fixture.debugElement
      .query(By.css('.bundle-list__remove'))
      .nativeElement.click();

    expect(dispatchSpy).toHaveBeenCalledWith(
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: [bundleA.bundleId],
      }),
    );
  });

  it('remove is a no-op when nothing is checked', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    fixture.debugElement
      .query(By.css('.bundle-list__remove'))
      .nativeElement.click();
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: LoginModeActions.removeBundles.type }),
    );
  });

  it('clear finished removes only bundles whose run.state is done', () => {
    // bundleA/bundleB fixtures at the top of this file don't carry a run
    // status; override the mock store's runs feature so bundleA reads as
    // 'done' for this one test.
    store.setState({
      ...store.state,
      pipelineQueue: {
        ...(store.state as any).pipelineQueue,
        runs: { [bundleA.bundleId]: { state: 'done' } },
      },
    } as any);
    fixture.detectChanges();

    const dispatchSpy = jest.spyOn(store, 'dispatch');
    fixture.debugElement
      .query(By.css('.bundle-list__clear-finished'))
      .nativeElement.click();

    expect(dispatchSpy).toHaveBeenCalledWith(
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: [bundleA.bundleId],
      }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest apps/tratt/src/app/core/component/bundle-list/bundle-list.component.spec.ts`
Expected: FAIL — no `.bundle-list__select-all`/`.bundle-list__item-checkbox`/`.bundle-list__remove`/`.bundle-list__clear-finished` elements exist yet.

- [ ] **Step 3: Add selection state and bulk-action methods to the component**

In `bundle-list.component.ts`, add imports for `signal` and `LoginModeActions` is already imported; add after the existing `bundles` computed signal:

```typescript
  private _selected = signal<Set<string>>(new Set());

  isSelected(bundleId: string): boolean {
    return this._selected().has(bundleId);
  }

  allSelected = computed(
    () =>
      this.bundles().length > 0 &&
      this.bundles().every((b) => this._selected().has(b.bundleId)),
  );

  toggleSelected(bundleId: string): void {
    const next = new Set(this._selected());
    if (next.has(bundleId)) {
      next.delete(bundleId);
    } else {
      next.add(bundleId);
    }
    this._selected.set(next);
  }

  toggleSelectAll(): void {
    this._selected.set(
      this.allSelected()
        ? new Set()
        : new Set(this.bundles().map((b) => b.bundleId)),
    );
  }

  onRemoveSelected(): void {
    const ids = [...this._selected()];
    if (ids.length === 0) {
      return;
    }
    this.store.dispatch(
      LoginModeActions.removeBundles({ mode: LoginMode.LOCAL, bundleIds: ids }),
    );
    this._selected.set(new Set());
  }

  onClearFinished(): void {
    const ids = this.bundles()
      .filter((b) => b.run.state === 'done')
      .map((b) => b.bundleId);
    if (ids.length === 0) {
      return;
    }
    this.store.dispatch(
      LoginModeActions.removeBundles({ mode: LoginMode.LOCAL, bundleIds: ids }),
    );
  }
```

Add `Signal, computed, signal` to the `@angular/core` import if `signal`/`computed` aren't already imported (`computed` already is; add `signal`).

- [ ] **Step 4: Add the markup**

In `bundle-list.component.html`, replace the opening `@if (bundles().length > 0) { <h6 ...` block with:

```html
@if (bundles().length > 0) {
  <div class="bundle-list__bulk-bar">
    <label class="bundle-list__select-all-label">
      <input
        type="checkbox"
        class="bundle-list__select-all"
        [checked]="allSelected()"
        (change)="toggleSelectAll()"
      />
      {{ 'workbench.bundle_list.select_all' | transloco }}
    </label>
    <button
      type="button"
      class="bundle-list__clear-finished"
      (click)="onClearFinished()"
    >
      {{ 'workbench.bundle_list.clear_finished' | transloco }}
    </button>
    <button
      type="button"
      class="bundle-list__remove"
      (click)="onRemoveSelected()"
    >
      {{ 'workbench.bundle_list.remove' | transloco }}
    </button>
  </div>
  <h6 class="bundle-list__title">
    {{ 'workbench.bundle_list.title' | transloco }}
  </h6>
}
```

And inside the `@for` loop, immediately after the opening `<li ...>` tag (before the `@if (bundle.awaitingMedia)` block), add:

```html
      <input
        type="checkbox"
        class="bundle-list__item-checkbox"
        [checked]="isSelected(bundle.bundleId)"
        (change)="toggleSelected(bundle.bundleId)"
      />
```

- [ ] **Step 5: Add matching styles**

In `bundle-list.component.scss`, append:

```scss
.bundle-list__bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
  font-size: 0.8rem;
}

.bundle-list__select-all-label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
}

.bundle-list__clear-finished,
.bundle-list__remove {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
  color: inherit;
}

.bundle-list__item-checkbox {
  margin-right: 0.375rem;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest apps/tratt/src/app/core/component/bundle-list/bundle-list.component.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts apps/tratt/src/app/core/component/bundle-list/bundle-list.component.html apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss apps/tratt/src/app/core/component/bundle-list/bundle-list.component.spec.ts
git commit -m "feat(bundle-list): add select-all, clear-finished, and remove bulk actions"
```

---

### Task 4: `CatalogueExportModalComponent` and wiring

**Files:**
- Create: `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.ts`
- Create: `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.html`
- Create: `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.scss`
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts` / `.html` (add the "Export catalogue" button next to the other bulk actions)
- Modify: `apps/tratt/src/assets/i18n/{en,sv,de,it,ko,nl,zh}.json`
- Test: `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.spec.ts`

**Interfaces:**
- Consumes: `CatalogueExportService.exportBundles()` (Task 2), `AppInfo.converters` (existing).
- Produces: nothing further downstream — this is the terminal UI piece.

- [ ] **Step 1: Add i18n keys**

In `apps/tratt/src/assets/i18n/en.json`, inside the existing `workbench.bundle_list` object, add:

```json
"select_all": "Select all",
"clear_finished": "Clear finished",
"remove": "Remove",
"export_catalogue": "Export catalogue…"
```

And a new top-level key under `workbench`:

```json
"catalogue_export": {
  "title": "Export catalogue",
  "formats_label": "Formats",
  "bundles_label": "{{count}} file(s) selected",
  "all_bundles_hint": "No files checked — exporting all {{count}}.",
  "export": "Export",
  "cancel": "Cancel",
  "progress": "Exporting {{current}} of {{total}}…",
  "warnings_title": "Completed with warnings",
  "done": "Done — {{count}} file(s) archived."
}
```

In `apps/tratt/src/assets/i18n/sv.json`, the same keys with real Swedish text:

```json
"select_all": "Markera alla",
"clear_finished": "Rensa klara",
"remove": "Ta bort",
"export_catalogue": "Exportera katalog…"
```

```json
"catalogue_export": {
  "title": "Exportera katalog",
  "formats_label": "Format",
  "bundles_label": "{{count}} fil(er) markerade",
  "all_bundles_hint": "Inga filer markerade — exporterar alla {{count}}.",
  "export": "Exportera",
  "cancel": "Avbryt",
  "progress": "Exporterar {{current}} av {{total}}…",
  "warnings_title": "Klar med varningar",
  "done": "Klar — {{count}} fil(er) arkiverade."
}
```

In `de.json`, `it.json`, `ko.json`, `nl.json`, `zh.json`: copy the exact English strings from `en.json` above verbatim into the same two locations — matching the existing precedent for every other `workbench.bundle_list.*` key already in those five files (confirmed identical to `en.json`'s English text today).

- [ ] **Step 2: Write the failing modal test**

Create `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, jest } from '@jest/globals';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { CatalogueExportService } from '../../shared/service/catalogue-export.service';
import { CatalogueExportModalComponent } from './catalogue-export-modal.component';

describe('CatalogueExportModalComponent', () => {
  let fixture: ComponentFixture<CatalogueExportModalComponent>;
  let exportService: { exportBundles: jest.Mock };

  beforeEach(async () => {
    exportService = {
      exportBundles: jest.fn(() =>
        of({
          completedBundles: 1,
          totalBundles: 1,
          currentBundleName: 'a.wav',
          archive: new Uint8Array([1, 2, 3]),
          warnings: [],
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [CatalogueExportModalComponent],
      providers: [
        { provide: CatalogueExportService, useValue: exportService },
        { provide: NgbActiveModal, useValue: { close: jest.fn(), dismiss: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CatalogueExportModalComponent);
    fixture.componentInstance.bundleIds = ['bundle-1'];
    fixture.detectChanges();
  });

  it('calls exportBundles with the given bundle ids and checked converters on Export click', () => {
    fixture.debugElement
      .query(By.css('.catalogue-export__export'))
      .nativeElement.click();

    expect(exportService.exportBundles).toHaveBeenCalledWith(
      ['bundle-1'],
      expect.arrayContaining(['AnnotJSON']),
    );
  });

  it('triggers a download once the archive is produced', () => {
    const createObjectURLSpy = jest
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    fixture.debugElement
      .query(By.css('.catalogue-export__export'))
      .nativeElement.click();
    fixture.detectChanges();

    expect(createObjectURLSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.spec.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 4: Write the modal component**

Create `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.ts`:

```typescript
import { Component, Input, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { AppInfo } from '../../../app.info';
import { CatalogueExportService } from '../../shared/service/catalogue-export.service';

@Component({
  selector: 'tratt-catalogue-export-modal',
  standalone: true,
  templateUrl: './catalogue-export-modal.component.html',
  styleUrls: ['./catalogue-export-modal.component.scss'],
  imports: [FormsModule, TranslocoPipe],
})
export class CatalogueExportModalComponent implements OnDestroy {
  public static options: NgbModalOptions = {
    size: 'lg',
    keyboard: true,
    backdrop: true,
  };

  @Input() bundleIds: string[] = [];

  readonly exportableConverters = AppInfo.converters.filter(
    (c) => c.conversion.export,
  );
  checkedConverters = signal<Set<string>>(new Set(['AnnotJSON']));

  progress = signal<{ completed: number; total: number } | null>(null);
  warnings = signal<string[]>([]);
  downloadUrl = signal<string | null>(null);

  constructor(
    private exportService: CatalogueExportService,
    private activeModal: NgbActiveModal,
  ) {}

  toggleConverter(name: string): void {
    const next = new Set(this.checkedConverters());
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this.checkedConverters.set(next);
  }

  isChecked(name: string): boolean {
    return this.checkedConverters().has(name);
  }

  onExport(): void {
    const names = [...this.checkedConverters()];
    this.warnings.set([]);
    this.exportService
      .exportBundles(this.bundleIds, names)
      .subscribe((event) => {
        this.progress.set({
          completed: event.completedBundles,
          total: event.totalBundles,
        });
        this.warnings.set(event.warnings);
        if (event.archive) {
          const blob = new Blob([event.archive], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          this.downloadUrl.set(url);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'catalogue-export.zip';
          a.click();
        }
      });
  }

  close(): void {
    this.activeModal.close();
  }

  ngOnDestroy(): void {
    const url = this.downloadUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}
```

- [ ] **Step 5: Write the modal template**

Create `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.html`:

```html
<div class="modal-header">
  <h5 class="modal-title">{{ 'workbench.catalogue_export.title' | transloco }}</h5>
  <button type="button" class="btn-close" (click)="close()"></button>
</div>
<div class="modal-body">
  <p>
    {{
      'workbench.catalogue_export.bundles_label'
        | transloco: { count: bundleIds.length }
    }}
  </p>

  <fieldset class="catalogue-export__formats">
    <legend>{{ 'workbench.catalogue_export.formats_label' | transloco }}</legend>
    @for (converter of exportableConverters; track converter.name) {
      <label class="catalogue-export__format-option">
        <input
          type="checkbox"
          [checked]="isChecked(converter.name)"
          (change)="toggleConverter(converter.name)"
        />
        {{ converter.name }}
      </label>
    }
  </fieldset>

  @if (progress()) {
    <p class="catalogue-export__progress">
      {{
        'workbench.catalogue_export.progress'
          | transloco
            : { current: progress()!.completed, total: progress()!.total }
      }}
    </p>
  }

  @if (warnings().length > 0) {
    <div class="catalogue-export__warnings">
      <strong>{{ 'workbench.catalogue_export.warnings_title' | transloco }}</strong>
      <ul>
        @for (warning of warnings(); track warning) {
          <li>{{ warning }}</li>
        }
      </ul>
    </div>
  }
</div>
<div class="modal-footer">
  <button type="button" class="btn btn-secondary" (click)="close()">
    {{ 'workbench.catalogue_export.cancel' | transloco }}
  </button>
  <button
    type="button"
    class="btn btn-primary catalogue-export__export"
    (click)="onExport()"
  >
    {{ 'workbench.catalogue_export.export' | transloco }}
  </button>
</div>
```

- [ ] **Step 6: Add minimal styles**

Create `apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.scss`:

```scss
.catalogue-export__formats {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 1rem 0;
}

.catalogue-export__format-option {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
}

.catalogue-export__warnings {
  margin-top: 1rem;
  color: var(--tratt-accent-warning);
  font-size: 0.85rem;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest apps/tratt/src/app/core/modals/catalogue-export-modal/catalogue-export-modal.component.spec.ts`
Expected: PASS

- [ ] **Step 8: Wire the "Export catalogue" button into `BundleListComponent`**

In `bundle-list.component.ts`, add to the constructor's existing injections: `private modService: TrattModalService` (import from `'../../modals/tratt-modal.service'`, matching the existing import in this same file's constructor). Add a method:

```typescript
  onExportCatalogue(): void {
    const ids =
      this._selected().size > 0
        ? [...this._selected()]
        : this.bundles().map((b) => b.bundleId);
    this.modService.openModal(CatalogueExportModalComponent, CatalogueExportModalComponent.options, {
      bundleIds: ids,
    });
  }
```

Import `CatalogueExportModalComponent` from `'../../modals/catalogue-export-modal/catalogue-export-modal.component'`.

In `bundle-list.component.html`'s `.bundle-list__bulk-bar` div (added in Task 3), add one more button after `.bundle-list__remove`:

```html
    <button
      type="button"
      class="bundle-list__export-catalogue"
      (click)="onExportCatalogue()"
    >
      {{ 'workbench.bundle_list.export_catalogue' | transloco }}
    </button>
```

Add the matching style to `bundle-list.component.scss` (same rule block as `.bundle-list__clear-finished`/`.bundle-list__remove`):

```scss
.bundle-list__export-catalogue {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
  color: inherit;
}
```

- [ ] **Step 9: Run the full bundle-list and catalogue-export-modal suites**

Run: `npx jest apps/tratt/src/app/core/component/bundle-list apps/tratt/src/app/core/modals/catalogue-export-modal`
Expected: PASS

- [ ] **Step 10: `tsc --noEmit` and a dev build to catch template/type errors across the whole app**

Run: `npx tsc -p apps/tratt/tsconfig.app.json --noEmit`
Expected: No errors.

Run: `npx nx build tratt --configuration=development`
Expected: Build succeeds.

- [ ] **Step 11: Commit**

```bash
git add apps/tratt/src/app/core/modals/catalogue-export-modal apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts apps/tratt/src/app/core/component/bundle-list/bundle-list.component.html apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss apps/tratt/src/assets/i18n/en.json apps/tratt/src/assets/i18n/sv.json apps/tratt/src/assets/i18n/de.json apps/tratt/src/assets/i18n/it.json apps/tratt/src/assets/i18n/ko.json apps/tratt/src/assets/i18n/nl.json apps/tratt/src/assets/i18n/zh.json
git commit -m "feat(workbench): add catalogue export modal and wire it into the bundle list"
```

---

## Manual verification (once a real browser is available — see the spec's 2026-09-28 finding)

1. Drop `example.wav` and `example2.wav`, start the session.
2. Check both bundles in the bundle list, click "Export catalogue…", tick two converter formats, click Export.
3. Unzip the downloaded archive: confirm `bundles/example/` and `bundles/example2/` each contain the requested formats, and `manifest.json`/`manifest.csv` list both with the configured model/language.
4. Repeat with nothing checked — confirm it exports all loaded bundles (the "no selection = all" default).
5. Click "Clear finished" with no bundle in a `done` run state — confirm it's a no-op (no dispatch, list unchanged).
6. Click "Remove" with the last remaining bundle selected — confirm the list returns to its empty state rather than erroring.

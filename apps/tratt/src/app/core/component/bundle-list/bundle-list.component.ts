import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { AudioManager, normalizeMimeType } from '@tratt/web-media';
import { filter, firstValueFrom } from 'rxjs';
import {
  BundleReattachMismatchAnswer,
  BundleReattachMismatchModalComponent,
} from '../../modals/bundle-reattach-mismatch-modal/bundle-reattach-mismatch-modal.component';
import { CatalogueExportModalComponent } from '../../modals/catalogue-export-modal/catalogue-export-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { SessionFile } from '../../obj/SessionFile';
import { AudioService } from '../../shared/service/audio.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { LoginMode, RootState } from '../../store/index';
import {
  selectAllBundleSummaries,
  selectLocalMode,
} from '../../store/login-mode/annotation/annotation.selectors';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { runStatusOf } from '../../store/pipeline-queue';
import { selectAllRunStatuses } from '../../store/pipeline-queue/pipeline-queue.selectors';

/**
 * Lists the bundles created by the one `startSession()` call at the start of
 * a session (see `WorkbenchComponent.startSession()`), and lets the user
 * switch between them via `LoginModeActions.selectBundle`.
 *
 * Scope boundary: this does NOT let a user drop more files into an
 * already-active session — `startSession()` remains a single-shot ingest,
 * invoked exactly once at session start. This list only switches between
 * bundles that already exist from that one call; "drop more mid-session" is
 * out of scope for this component.
 *
 * Step 2.8, Task 5 adds one exception to that boundary: a bundle restored
 * from IndexedDB with no audio resident this session (`awaitingMedia`,
 * step 2.8 Task 4) renders a re-attach file input instead of a
 * click-to-select button, letting the user re-supply that bundle's audio
 * without starting a brand new session.
 */
@Component({
  selector: 'tratt-bundle-list',
  templateUrl: './bundle-list.component.html',
  styleUrls: ['./bundle-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
})
export class BundleListComponent {
  private bundleSummaries = this.store.selectSignal(selectAllBundleSummaries);
  private runStatuses = this.store.selectSignal(selectAllRunStatuses);

  // `selectAllBundleSummaries`'s `awaitingMedia` only reflects the store's
  // `audio.loaded` flag, which the reducer only ever sets for whichever
  // bundle happens to be currently selected (see AnnotationActions.loadAudio.success).
  // A bundle created via a live multi-file drop (step 2.7) has a REAL
  // resident AudioManager from the moment it's registered, even before it's
  // ever been selected — combine the selector with that live signal so
  // switching to an unselected-but-already-resident bundle doesn't show the
  // re-attach control.
  //
  // Step 3b adds one more merge: each row's pipeline run status (absent
  // entry ⇒ idle, via runStatusOf) so a row can show queued/running/done/
  // failed/interrupted and offer a retry.
  //
  // Final whole-branch review fix: filtered to exclude the nameless
  // DEFAULT_BUNDLE_ID sentinel the reducer re-seeds once every bundle has
  // been removed (`b.name !== undefined` — same predicate
  // WorkbenchComponent.hasAnyBundles() already uses for its own visibility
  // gate). Without this, removing every bundle left one phantom row here
  // with an empty name.
  bundles = computed(() => {
    const runs = this.runStatuses();
    return this.bundleSummaries()
      .filter((b) => b.name !== undefined)
      .map((b) => ({
        ...b,
        awaitingMedia:
          b.awaitingMedia && !this.audioService.hasResident(b.bundleId),
        run: runStatusOf(runs, b.bundleId),
      }));
  });

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
    // Final whole-branch review fix: unlike onRemoveSelected(), this used to
    // leave `_selected` holding ids that no longer exist — a stale id could
    // then leak into onExportCatalogue()'s "no selection = all" fallback
    // logic, silently exporting a dead bundle. Surgically drop just the
    // ids that were actually removed here (rather than clearing the whole
    // selection like onRemoveSelected() does) so a bundle the user still
    // has genuinely checked stays checked.
    const removed = new Set(ids);
    const next = new Set(this._selected());
    for (const id of removed) {
      next.delete(id);
    }
    this._selected.set(next);
  }

  onExportCatalogue(): void {
    // Final whole-branch review fix: intersect the selection with the live
    // bundle ids rather than trusting `_selected()` raw — belt-and-braces
    // alongside onClearFinished() now clearing it, so a dead id can never
    // leak into an export even if `_selected` goes stale again for some
    // other reason in the future.
    const liveIds = new Set(this.bundles().map((b) => b.bundleId));
    const selected = [...this._selected()].filter((id) => liveIds.has(id));
    const wasAllBundlesDefault = selected.length === 0;
    const ids = wasAllBundlesDefault
      ? this.bundles().map((b) => b.bundleId)
      : selected;
    this.modService.openModal(
      CatalogueExportModalComponent,
      CatalogueExportModalComponent.options,
      {
        bundleIds: ids,
        wasAllBundlesDefault,
      },
    );
  }

  // Only consulted from onReattachFileSelected() (not template-bound) to look
  // up a bundle's persisted SessionFile for the fingerprint comparison —
  // selectAllBundleSummaries only exposes `name`, not the full SessionFile.
  private localMode = this.store.selectSignal(selectLocalMode);

  constructor(
    private store: Store<RootState>,
    private audioService: AudioService,
    private modService: TrattModalService,
    private pipelineQueueService: PipelineQueueService,
  ) {}

  selectBundle(bundleId: string): void {
    this.store.dispatch(
      LoginModeActions.selectBundle({ mode: LoginMode.LOCAL, bundleId }),
    );
  }

  /**
   * Per-row retry for a failed or interrupted bundle. Goes through
   * `PipelineQueueService.retry()`, which deliberately bypasses the
   * eligibility filter `enqueue()` applies — retry is an explicit user
   * action on one specific row.
   */
  onRetry(bundleId: string): void {
    this.pipelineQueueService.retry(bundleId);
  }

  async onReattachFileSelected(bundleId: string, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so picking the exact same file again still fires a 'change'.
    input.value = '';
    if (!file) {
      return;
    }

    // Same "wait for progress === 1 && audioManager truthy" completion
    // pattern as AudioService.ensureResident() / TrattDropzoneService.
    const buffer = await file.arrayBuffer();
    const result = await firstValueFrom(
      AudioManager.create(file.name, file.type, buffer).pipe(
        filter((r) => r.progress === 1 && !!r.audioManager),
      ),
    );
    const manager = result.audioManager!;

    const sessionFile =
      this.localMode().bundles.entities[bundleId]?.sessionFile;
    if (this.fingerprintMatches(sessionFile, file)) {
      this.completeReattach(bundleId, manager, file);
      return;
    }

    // Any path out of this block that doesn't call completeReattach() — the
    // explicit "cancel" answer, or the modal promise rejecting (e.g. a
    // backdrop dismissal) — must still release the AudioManager created
    // above; otherwise it leaks as an un-registered resident.
    let completed = false;
    try {
      const answer = await this.modService.openModal<
        typeof BundleReattachMismatchModalComponent,
        BundleReattachMismatchAnswer
      >(
        BundleReattachMismatchModalComponent,
        BundleReattachMismatchModalComponent.options,
        {
          expectedName: sessionFile?.name,
          expectedSize: sessionFile?.size,
          actualName: file.name,
          actualSize: file.size,
        },
      );

      if (answer === BundleReattachMismatchAnswer.USE_ANYWAY) {
        this.completeReattach(bundleId, manager, file);
        completed = true;
      }
    } finally {
      if (!completed) {
        manager.destroy();
      }
    }
  }

  /**
   * name+size+type must always match. `timestamp`/`lastModified` only
   * contributes to the decision when both sides actually have a value —
   * bundles persisted before step 2.8 Task 1's SessionFile.timestamp
   * round-trip fix have no timestamp, and that alone must not force a
   * mismatch.
   */
  private fingerprintMatches(
    sessionFile: SessionFile | undefined,
    file: File,
  ): boolean {
    if (!sessionFile) {
      return false;
    }
    if (
      sessionFile.name !== file.name ||
      sessionFile.size !== file.size ||
      sessionFile.type !== normalizeMimeType(file.type)
    ) {
      return false;
    }
    const expected = sessionFile.timestamp?.getTime();
    if (expected !== undefined && file.lastModified !== undefined) {
      return expected === file.lastModified;
    }
    return true;
  }

  /**
   * Completes the "this bundle now has real audio" transition. Mirrors the
   * fresh-drop-session and reload-file flows (register the AudioManager,
   * then dispatch the mode's login/task-info chain) rather than the
   * annotation-load.effects.ts LOCAL branch's dead-end fail path — see
   * task-5-report.md's step-1 findings: `selectBundle` alone never re-enters
   * that chain, so `loadProjectAndTaskInformation.do` (the same action
   * `authentication.effects.ts`'s `loginSuccess$` dispatches for a fresh
   * LOCAL login) is what's needed to make `afterInitApplication$` dispatch
   * `prepareTaskDataForAnnotation.do`, which eventually reaches
   * `onAudioLoad$`'s already-working `this.audio.current !== undefined`
   * branch (since we just registered a manager for this bundle) and sets
   * `loading.status = FINISHED` — the flag `WorkbenchComponent.sessionReady`
   * is actually derived from.
   */
  private completeReattach(
    bundleId: string,
    manager: AudioManager,
    file: File,
  ): void {
    this.audioService.registerAudioManager(bundleId, manager, file);
    this.store.dispatch(
      LoginModeActions.selectBundle({ mode: LoginMode.LOCAL, bundleId }),
    );
    this.store.dispatch(
      LoginModeActions.loadProjectAndTaskInformation.do({
        projectID: '7234892',
        taskID: '73482',
        mode: LoginMode.LOCAL,
      }),
    );
  }
}

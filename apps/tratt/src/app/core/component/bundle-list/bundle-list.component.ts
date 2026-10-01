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
import { AuthenticationActions } from '../../store/authentication';
import { LoginMode, RootState } from '../../store/index';
import {
  selectAllBundleSummaries,
  selectLocalMode,
} from '../../store/login-mode/annotation/annotation.selectors';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { runStatusOf } from '../../store/pipeline-queue';
import { selectAllRunStatuses } from '../../store/pipeline-queue/pipeline-queue.selectors';

/**
 * Lists the bundles created over the course of a session — the first-wave
 * bootstrap and every later wave of dropped files (see
 * `WorkbenchComponent.runFirstWave`/`runLaterWave`), plus this component's
 * own `completeReattach()` for re-supplying a restored bundle's audio — and
 * lets the user switch between them via `LoginModeActions.selectBundle`.
 *
 * Step 6 lifted the old "single-shot ingest" scope boundary: bundles are now
 * created continuously as files are dropped mid-session, not just once at
 * session start. This list reflects that live, growing set of bundles.
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

  /**
   * Roving tabindex over each row's primary focusable control (the
   * click-to-select button, or the reattach file input for an
   * `awaitingMedia` row) — `.bundle-list__item-primary` in the template.
   * Arrow-key traversal is a pure focus move, deliberately never a
   * `selectBundle` dispatch: `selectBundle` triggers real work
   * (`AudioService.ensureResident()`/decode) per bundle, so auto-selecting
   * on every row arrowed past would be wasteful and surprising. Enter/Space
   * on the focused button already selects it via native button semantics —
   * no extra code needed for that half.
   *
   * Tracked by `bundleId`, not array position: `bundles()` is a positionally
   * unstable array (removing an earlier row shifts every later row's
   * index), so a raw index would silently drift onto the wrong bundle after
   * a removal. `null` is the "uninitialized" sentinel — until the user has
   * actually moved focus into the list (by any means, not just arrow keys;
   * see `onRowFocus()`), the roving tabindex tracks whichever row is
   * currently selected, so Tabbing into the list lands on the right row
   * first.
   */
  private focusedBundleId = signal<string | null>(null);

  private effectiveFocusedIndex = computed(() => {
    const rows = this.bundles();
    const id = this.focusedBundleId();
    const idx = id === null ? -1 : rows.findIndex((b) => b.bundleId === id);
    if (idx >= 0) {
      return idx;
    }
    const selectedIdx = rows.findIndex((b) => b.selected);
    return selectedIdx >= 0 ? selectedIdx : 0;
  });

  rowTabIndex(index: number): number {
    return this.effectiveFocusedIndex() === index ? 0 : -1;
  }

  /**
   * Keeps the roving tabindex in sync with real DOM focus regardless of how
   * it got there — a mouse click on a different row, or Tab/Shift+Tab —
   * not just arrow-key moves. Bound to each `.bundle-list__item-primary`
   * element's native `(focus)` event (not delegated via bubbling: `focus`
   * itself doesn't bubble, only `focusin` does, and a direct per-element
   * binding is simpler than a `focusin` delegate here).
   */
  onRowFocus(bundleId: string): void {
    this.focusedBundleId.set(bundleId);
  }

  onListKeydown(event: KeyboardEvent): void {
    // Only react to a key that actually originated from a row's primary
    // control — the checkbox and retry button are legitimately reachable
    // via normal Tab order, and an arrow key pressed there must not hijack
    // focus away to a different row.
    if (
      !(event.target as HTMLElement).classList.contains(
        'bundle-list__item-primary',
      )
    ) {
      return;
    }
    const rows = this.bundles();
    const count = rows.length;
    if (count === 0) {
      return;
    }
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(this.effectiveFocusedIndex() + 1, count - 1);
        break;
      case 'ArrowUp':
        next = Math.max(this.effectiveFocusedIndex() - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.focusedBundleId.set(rows[next].bundleId);
    const targets = (event.currentTarget as HTMLElement).querySelectorAll(
      '.bundle-list__item-primary',
    );
    (targets[next] as HTMLElement | undefined)?.focus();
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
   * that chain, so the login chain (the same one
   * `authentication.effects.ts`'s `onLoginLocal$` dispatches for a fresh
   * LOCAL login) is what's needed to make `afterInitApplication$` dispatch
   * `prepareTaskDataForAnnotation.do`, which eventually reaches
   * `onAudioLoad$`'s already-working `this.audio.current !== undefined`
   * branch (since we just registered a manager for this bundle) and sets
   * `loading.status = FINISHED` — the flag `WorkbenchComponent.sessionReady`
   * is actually derived from.
   *
   * Dispatches `AuthenticationActions.loginLocal.success` — not
   * `LoginModeActions.loadProjectAndTaskInformation.do` directly, as an
   * earlier version of this method did — because on a re-attach that is the
   * FIRST action of a fresh page load (no `startSession()` call this
   * session yet, e.g. reattaching straight into a bundle restored from
   * IndexedDB at boot), `state.application.mode` is still `undefined`:
   * nothing else this session ever sets it. `afterInitApplication$` checks
   * `!state.application.mode` BEFORE it ever reaches the "effectively
   * logged in" audio-resident bypass (step 2.8's fix for the *mid-session*
   * reattach case, which only helps once `mode` is already LOCAL from an
   * earlier login this session) and unconditionally redirects away —
   * silently, with no console error, leaving `sessionReady` false forever.
   * `loginLocal.success`'s reducer case is what actually sets
   * `application.mode = LOCAL` (and `loggedIn = true`, covering the
   * mid-session case too), and `authentication.effects.ts`'s `loginSuccess$`
   * already dispatches the same `loadProjectAndTaskInformation.do` this
   * method used to dispatch by hand — so this reuses that existing,
   * already-proven chain instead of re-deriving part of it here.
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
    const sessionFile = this.localMode().bundles.entities[bundleId]
      ?.sessionFile as SessionFile;
    this.store.dispatch(
      AuthenticationActions.loginLocal.success({
        mode: LoginMode.LOCAL,
        files: [file],
        sessionFile,
        removeData: false,
        audioAlreadyLoaded: true,
      }),
    );
  }
}

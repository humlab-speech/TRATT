import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ComponentRef,
  computed,
  OnDestroy,
  OnInit,
  signal,
  Type,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbModalRef, NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngrx/store';
import { AnnotJSONConverter, Converter } from '@tratt/annotation';
import { formatMinutesSeconds, getFileSize } from '@tratt/utilities';
import { timer } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { editorComponents } from '../../../editors/components';
import {
  TRATTEditor,
  TrattEditorRequirements,
} from '../../../editors/tratt-editor';
import { BundleListComponent } from '../../component/bundle-list/bundle-list.component';
import { CapacityIndicatorComponent } from '../../component/capacity-indicator/capacity-indicator.component';
import { DefaultComponent } from '../../component/default.component';
import { NavbarService } from '../../component/navbar/navbar.service';
import { RecordingPanelComponent } from '../../component/recording-panel/recording-panel.component';
import { FastbarComponent } from '../../component/taskbar/taskbar.component';
import { AutoTranscribeOptionsComponent } from '../../component/tratt-dropzone/auto-transcribe-options.component';
import { TrattDropzoneComponent } from '../../component/tratt-dropzone/tratt-dropzone.component';
import { OverviewModalComponent } from '../../modals/overview-modal/overview-modal.component';
import { ShortcutsModalComponent } from '../../modals/shortcuts-modal/shortcuts-modal.component';
import {
  ModalEndAnswer,
  TranscriptionDemoEndModalComponent,
} from '../../modals/transcription-demo-end/transcription-demo-end-modal.component';
import { TranscriptionSendingModalComponent } from '../../modals/transcription-sending-modal/transcription-sending-modal.component';
import {
  TranscriptionStopModalAnswer,
  TranscriptionStopModalComponent,
} from '../../modals/transcription-stop-modal/transcription-stop-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { ProjectSettings } from '../../obj/Settings';
import { LoadeditorDirective } from '../../shared/directive/loadeditor.directive';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { AudioService } from '../../shared/service/audio.service';
import { CapacityService } from '../../shared/service/capacity.service';
import { TranscriptionOptions } from '../../shared/service/local-transcription.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { RoutingService } from '../../shared/service/routing.service';
import { LoadingStatus, LoginMode, RootState } from '../../store';
import { ApplicationState } from '../../store/application';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import { selectAllBundleSummaries } from '../../store/login-mode/annotation/annotation.selectors';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import {
  DEFAULT_BUNDLE_ID,
  generateBundleId,
} from '../../store/login-mode/annotation/local-bundle-collection';
import { computeReadyBundleIds } from '../../store/pipeline-queue';
import {
  selectAllRunStatuses,
  selectQueueMode,
} from '../../store/pipeline-queue/pipeline-queue.selectors';

@Component({
  selector: 'tratt-workbench',
  templateUrl: './workbench.component.html',
  styleUrls: ['./workbench.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TrattDropzoneComponent,
    BundleListComponent,
    RecordingPanelComponent,
    TranslocoPipe,
    FastbarComponent,
    LoadeditorDirective,
    FormsModule,
    NgbNavModule,
    AutoTranscribeOptionsComponent,
    CapacityIndicatorComponent,
  ],
})
export class WorkbenchComponent
  extends DefaultComponent
  implements OnInit, OnDestroy
{
  @ViewChild(TrattDropzoneComponent) dropzone?: TrattDropzoneComponent;
  @ViewChild(LoadeditorDirective) showEditor?: LoadeditorDirective;

  // Toggles which left-rail pane (drop-zone file list vs. recording panel) is
  // emphasized. Both are template siblings rendered inside an ngbNav with
  // `[destroyOnHide]="false"` (same pattern as login.component.html's own
  // upload/record tabs) — the inactive pane is only hidden by ngb-nav's CSS,
  // never structurally removed via `@if`, so <tratt-dropzone> stays in the
  // DOM and `@ViewChild(TrattDropzoneComponent) dropzone` above stays
  // resolved no matter which tab is active. See workbench.component.spec.ts's
  // "keeps the dropzone ViewChild resolved regardless of which tab/pane is
  // active" test.
  activeTab: 'upload' | 'record' = 'upload';

  sessionStarting = false;
  sessionReady = false;

  // The currently-mounted editor's name, for the editor-switcher tab row's
  // highlight — set by changeEditor() on every call, whether that call came
  // from a manual tab click or from mountDefaultEditor()'s auto-mount at
  // session start.
  activeEditorName = signal<string | undefined>(undefined);

  // The currently-mounted editor's ComponentRef, so changeEditor() can (a)
  // flush its pending edits before disposing it and (b) tell whether
  // activeEditorName actually corresponds to something mounted right now
  // (undefined after a failed mount, even if activeEditorName itself still
  // names the last-attempted editor — see changeEditor()'s F6 handling).
  private currentEditorRef?: ComponentRef<TRATTEditor>;

  // The editor-switcher tab row's entries, filtered against the project's
  // configured interfaces (final whole-branch review, F3) — mirrors
  // mountDefaultEditor()'s own validation and the navbar's own
  // interfaceActive() filter (navbar.component.ts), so the tab row can't
  // offer an editor the project doesn't allow, which mountDefaultEditor()
  // would then silently revert away from on the next session start. Falls
  // back to every editor when no list is configured, matching
  // mountDefaultEditor()'s own `?? []` fallback (an empty list there means
  // "nothing configured yet," not "nothing allowed"). A getter, not a
  // `computed()` or a field snapshotted once — same F2 staleness reasoning
  // as `selectedBundleHeader`: `settingsService.projectsettings` is a plain
  // getter, not a signal.
  get editorComponentsList(): typeof editorComponents {
    const interfaces = this.settingsService.projectsettings?.interfaces;
    if (!interfaces || interfaces.length === 0) {
      return editorComponents;
    }
    return editorComponents.filter((entry) => interfaces.includes(entry.name));
  }

  showCommentSection = false;
  modalOverview?: NgbModalRef;
  modalShortcutsDialogue?: NgbModalRef;
  transcrSendingModal?: NgbModalRef;
  modalVisiblities = {
    overview: false,
    shortcuts: false,
  };

  private _useMode = '';
  private _selectedTheme = '';

  // Signal-based store read (same selectSignal convention as AudioService /
  // BundleListComponent) so the template can reveal the bundle list once any
  // bundle exists — including one restored from IndexedDB at boot (step 2.8,
  // Task 3), which never has decoded audio this session and so never makes
  // sessionReady true on its own.
  private bundleSummaries = this.store.selectSignal(selectAllBundleSummaries);

  // NOT `bundleSummaries().length > 0`: the store's LOCAL bundle collection
  // ALWAYS has exactly one entity — the permanent DEFAULT_BUNDLE_ID
  // ('bundle-1') sentinel seeded by login-mode.reducer.ts's
  // initialCollectionState — from app boot, before any session starts and
  // before ANY file has ever been dropped, for every user including
  // first-timers. So a plain length check is always true and this gate would
  // never actually hide the list. `name` (sessionFile?.name) is undefined
  // for that empty default and defined for any bundle — including bundle-1
  // itself, once a returning user's bundle-1 gets restored via the
  // pre-existing loadOptions$/loadAnnotation$ boot effects — that has really
  // had a file attached, so require at least one summary with a defined
  // `name` instead of just counting entities.
  hasAnyBundles = computed(() =>
    this.bundleSummaries().some((b) => b.name !== undefined),
  );

  private queueMode = this.store.selectSignal(selectQueueMode);
  private runStatuses = this.store.selectSignal(selectAllRunStatuses);

  /** True while a bundle is in flight — the run button becomes "pause". */
  queueRunning = computed(() => this.queueMode() !== 'idle');

  /**
   * The bundles a "run" would actually enqueue. Computed in the component
   * rather than in a selector because the skip rule needs a LIVE residency
   * check: `selectAllBundleSummaries`'s `awaitingMedia` is `!audio.loaded`,
   * which the reducer only ever sets for the SELECTED bundle, so every
   * other genuinely-resident bundle would be wrongly excluded. This mirrors
   * BundleListComponent's own long-standing merge of the same two sources.
   *
   * Known caveat (documented for step 2.8's identical pattern): the
   * AudioService manager registry is a plain Map, not a signal, so a code
   * path that changes residency WITHOUT a subsequent store write would
   * leave this stale until something else it depends on changes. Both real
   * residency-changing call sites (startSession, completeReattach) write to
   * the store immediately afterwards.
   */
  readyBundleIds = computed(() =>
    computeReadyBundleIds(
      this.bundleSummaries(),
      this.runStatuses(),
      (bundleId) => this.audioService.hasResident(bundleId),
    ),
  );

  /**
   * Tracks the last options emitted by the queue's AutoTranscribeOptionsComponent
   * mount, mirroring what `PipelineQueueService.setTranscribeOptions()` holds
   * (that service's own copy isn't readable from here). `null` means the run
   * button must be disabled — see F1 in the step 3b-i final-review fix wave:
   * previously the template only checked `readyBundleIds().length`, so
   * clicking "Transcribe N file(s)" before ever ticking "Auto-transcribe"
   * enqueued and then immediately failed every ready bundle.
   */
  queueOptions = signal<TranscriptionOptions | null>(null);

  /**
   * One global pipeline configuration for the whole queue (the spec's "one
   * global config, run as a queue over all loaded media"), fed from the
   * shell-mounted AutoTranscribeOptionsComponent rather than per bundle.
   *
   * Step 3c also forwards it to CapacityService, which needs to know which
   * models are configured to split the storage bar into "models" vs
   * "annotations" — browser storage cannot be attributed per item, so that
   * split is an estimate derived from the configuration, not a sum of real
   * per-row sizes. Applied here rather than on the 5s poll so a user picking
   * a bigger model sees the models segment move immediately.
   */
  onQueueOptionsChange(options: TranscriptionOptions | null): void {
    this.queueOptions.set(options);
    this.pipelineQueueService.setTranscribeOptions(options);
    this.capacityService.setConfiguredOptions(options);
  }

  /**
   * Static filename/duration/format header for the right pane, matching
   * the reference mockup's top line. A plain getter, not a `computed()`:
   * `audioService.current` reads a plain Map entry, not a signal, so a
   * `computed()` here would read no signal at all and Angular would never
   * re-run it after its first evaluation — it would cache that first
   * result forever (final whole-branch review, F2). `AudioService`'s
   * manager registry can change with no accompanying signal write (e.g.
   * `ensureResident()` re-registering an evicted bundle's manager), so that
   * staleness is genuinely reachable, not theoretical. A getter has no such
   * cache — it re-evaluates on every read, the same as any other
   * OnPush-rechecked template expression, which is the actual guarantee
   * this needs. Undefined for a bundle whose audio isn't resident this
   * session (e.g. a restored, not-yet-reattached bundle) rather than
   * throwing.
   */
  get selectedBundleHeader():
    | {
        name: string;
        durationText: string;
        sampleRateKhz: number;
        channels: number;
        sizeText: string;
      }
    | undefined {
    const manager = this.audioService.current;
    if (!manager) {
      return undefined;
    }
    const info = manager.resource.info;
    const fileSize = getFileSize(info.size);
    return {
      name: info.fullname,
      durationText: formatMinutesSeconds(info.duration.seconds),
      sampleRateKhz: Math.round(info.sampleRate / 1000),
      channels: info.channels,
      sizeText: `${fileSize.size} ${fileSize.label}`,
    };
  }

  onRunPauseClick(): void {
    if (this.queueRunning()) {
      this.pipelineQueueService.stop();
      return;
    }
    this.pipelineQueueService.enqueue(this.readyBundleIds());
  }

  get useMode(): string {
    return this._useMode;
  }

  get selectedTheme(): string {
    return this._selectedTheme;
  }

  get projectsettings(): ProjectSettings {
    return this.settingsService.projectsettings!;
  }

  get comment(): string {
    return this.annotationStoreService.comment;
  }

  constructor(
    private audioService: AudioService,
    private authStoreService: AuthenticationStoreService,
    public appStorage: AppStorageService,
    public routingService: RoutingService,
    public navbarServ: NavbarService,
    public recordedFileService: RecordedFileService,
    public annotationStoreService: AnnotationStoreService,
    private settingsService: SettingsService,
    private modService: TrattModalService,
    private appStoreService: ApplicationStoreService,
    private uiService: UserInteractionsService,
    private cd: ChangeDetectorRef,
    private store: Store<RootState>,
    private pipelineQueueService: PipelineQueueService,
    private capacityService: CapacityService,
  ) {
    super();
  }

  ngOnInit(): void {
    // navbarServ.showInterfaces is app-singleton state, only ever set true by
    // the old /intern/transcr page (transcription.component.ts) and never
    // reset there — so it stays true across an in-app navigation to
    // /workbench, making the navbar's own editor-switcher buttons render
    // here too. They're dead on this route (nothing subscribes to
    // navbarServ.interfacechange outside transcription.component.ts) and
    // their [ngClass] active state can silently diverge from this page's own
    // tab row. Force it off, same pattern as news.component.ts and
    // transcription-end.component.ts.
    this.navbarServ.showInterfaces = false;

    this.subscribe(
      this.appStoreService.loading$,
      (loading: ApplicationState['loading']) => {
        const wasReady = this.sessionReady;
        this.sessionReady = loading?.status === LoadingStatus.FINISHED;
        // Reset the Start button's disabled state whenever a session attempt
        // has actually concluded (successfully or not) — startSession() sets
        // sessionStarting = true but nothing else ever clears it, so a failed
        // or still-in-progress load must not leave the button permanently
        // disabled.
        if (
          loading?.status === LoadingStatus.FINISHED ||
          loading?.status === LoadingStatus.FAILED
        ) {
          this.sessionStarting = false;
        }
        if (!wasReady && this.sessionReady) {
          // `_useMode`/`_selectedTheme`/`showCommentSection` must reflect the
          // real session state, not whatever appStorage.useMode happened to
          // be at route activation (it's still undefined on a clean/logged-out
          // profile at that point — see ngOnInit in
          // pages/intern/transcription/transcription.component.ts for the
          // mirrored logic this is copied from). Compute them here, once a
          // session genuinely exists.
          this._useMode = this.appStorage.useMode;
          this._selectedTheme = !this.projectsettings?.tratt?.theme
            ? 'default'
            : this.projectsettings?.tratt.theme;
          this.showCommentSection =
            this.settingsService.isTheme('shortAudioFiles') &&
            (this._useMode === 'online' || this._useMode === 'demo');
          this.navbarServ.showExport =
            this.settingsService.projectsettings?.navigation?.export === true;

          // The right pane (and its `trattLoadeditor` ViewChild) only exists in
          // the DOM once `sessionReady` is true, and that's gated behind
          // `@if (sessionReady)` in the template. `markForCheck()` alone only
          // schedules a future check, so force a synchronous render here to
          // resolve `showEditor` before `mountDefaultEditor()` tries to use it.
          this.cd.detectChanges();
          this.mountDefaultEditor();
        }
        this.cd.markForCheck();
      },
    );
  }

  /**
   * F3 (step 3c final review): `setConfiguredOptions()` is root-singleton
   * state on `CapacityService` — nothing else ever clears it. Without this,
   * a configured-but-stale model estimate (e.g. the user ticked
   * Auto-transcribe, picked a large model, then left before the queue panel
   * remounted with fresh options on return) could survive leaving and
   * re-entering `/workbench`, misattributing storage to a configuration no
   * longer offered anywhere on screen. Bounded in practice (the readout
   * clamps to real usedBytes), but clearing on destroy closes the gap
   * cleanly rather than relying on that bound.
   */
  override ngOnDestroy(): void {
    this.capacityService.setConfiguredOptions(null);
    super.ngOnDestroy();
  }

  private mountDefaultEditor(): void {
    const interfaces = this.settingsService.projectsettings?.interfaces ?? [];
    const current = this.appStorage.interface;
    const valid = interfaces.find((x) => x === current);
    if (valid === undefined && interfaces.length > 0) {
      this.appStorage.interface = interfaces[0];
    }
    if (this.appStorage.interface) {
      this.changeEditor(this.appStorage.interface);
    }
  }

  startSession(removeData: boolean): void {
    const entries = this.dropzone?.validAudioEntries ?? [];
    if (entries.length === 0) {
      return;
    }
    this.sessionStarting = true;
    const annotation = this.dropzone!.hasAnnotation
      ? this.dropzone!.oannotation
      : undefined;

    const audioBundleIds: string[] = [];
    const files: File[] = [];
    entries.forEach((entry, i) => {
      const bundleId = i === 0 ? DEFAULT_BUNDLE_ID : generateBundleId();
      const nativeFile = entry.fileProgress.file.file!;
      this.audioService.registerAudioManager(
        bundleId,
        entry.audioManager,
        nativeFile,
      );
      audioBundleIds.push(bundleId);
      files.push(nativeFile);
    });

    this.authStoreService.loginLocal(
      files,
      annotation,
      removeData,
      audioBundleIds,
    );
    this.dropzone!.reset();
  }

  // Mirrors login.component.ts's onUseRecording() exactly (the only other
  // mount point for RecordingPanelComponent's (useRecording) output): stage
  // the finished recording as a plain File on the dropzone's pending-file
  // list via its existing addFile() method, and record it on
  // RecordedFileService so the rest of the app (e.g. the "export recording"
  // button) can find it later. Then switch back to the upload tab so the
  // user immediately sees the recording land in the dropzone's list.
  onUseRecording(file: File): void {
    this.recordedFileService.recordedFile = file;
    this.dropzone?.addFile(file);
    this.activeTab = 'upload';
  }

  changeEditor(name: string): void {
    if (name === undefined || name === '') {
      // fallback to last editor
      name = editorComponents[editorComponents.length - 1].name;
    }

    // F5 (final whole-branch review): clicking the already-mounted tab must
    // be a no-op, not a needless dispose/remount (loses playback position,
    // and — without this guard — would also needlessly race F1's flush).
    // Gated on `currentEditorRef` too, not just the name: after a failed
    // mount (F6, below), activeEditorName can still name an editor that
    // isn't actually on screen, and a retry of that same name must go
    // through, not be swallowed by this guard.
    if (name === this.activeEditorName() && this.currentEditorRef) {
      return;
    }

    let comp: Type<TRATTEditor> | undefined;
    for (const editorComponent of editorComponents) {
      if (name === editorComponent.name) {
        comp = editorComponent.editor;
        break;
      }
    }

    if (comp === undefined) {
      console.error('ERROR editor component is undefined');
      return;
    }

    if (this.showEditor === undefined) {
      console.error('ERROR showEditor is undefined');
      return;
    }

    // F1 (final whole-branch review): the text editors (Dictaphone, Linear)
    // only commit a typed edit to the store when their typing-debounce
    // timer fires, ~1s after the last keystroke. Disposing the view via
    // clear() below destroys that timer along with it — flush first so an
    // edit still inside the debounce window isn't silently lost on a live
    // switch.
    // `TRATTEditor` doesn't itself declare `TrattEditorRequirements`'s
    // members (each concrete editor implements both independently) — cast
    // narrows to call this one optional member, matching this codebase's
    // existing convention for dynamically-created editor instances (see
    // TranscriptionComponent.changeEditor()'s own `as any` for `openModal`).
    (
      this.currentEditorRef?.instance as TrattEditorRequirements | undefined
    )?.flushPendingEdits?.();

    const viewContainerRef = this.showEditor.viewContainerRef;
    viewContainerRef.clear();

    // F6 (final whole-branch review): a throw during mount must not leave
    // appStorage.interface/activeEditorName claiming a switch that didn't
    // actually happen — clear() has already emptied the pane, so the
    // honest state is "nothing is mounted", not "the new editor is active".
    // Left pointing at the previous editor's name rather than blanked, so
    // the tab row's highlight still matches the caller's last real
    // intent — a click on that same tab retries the mount (see the guard
    // above).
    try {
      this.currentEditorRef = viewContainerRef.createComponent<TRATTEditor>(
        comp,
      );
    } catch (error) {
      this.currentEditorRef = undefined;
      console.error('ERROR failed to mount editor component', error);
      return;
    }

    this.appStorage.interface = name;
    this.activeEditorName.set(name);
  }

  openOverview() {
    this.annotationStoreService.analyse();
    this.modalOverview = this.modService.openModalRef(
      OverviewModalComponent,
      OverviewModalComponent.options,
    );

    this.appStoreService.setShortcutsEnabled(false);
    this.subscriptionManager.removeByTag('overview modal transcr send');
    this.subscribe(
      this.modalOverview.componentInstance.transcriptionSend,
      () => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalOverview?.close();
        this.modalVisiblities.overview = false;
        timer(1000).subscribe({
          next: () => {
            this.onSendNowClick();
          },
        });
      },
      'overview modal transcr send',
    );

    this.modalOverview.result
      .then(() => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalVisiblities.overview = false;
      })
      .catch(() => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalVisiblities.overview = false;
      });
    this.modalVisiblities.overview = true;
  }

  openShortcutsModal() {
    this.modalShortcutsDialogue = this.modService.openModalRef(
      ShortcutsModalComponent,
      ShortcutsModalComponent.options,
    );
    this.appStoreService.setShortcutsEnabled(false);
    this.modalShortcutsDialogue.result
      .then(() => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalVisiblities.shortcuts = false;
      })
      .catch(() => {
        this.appStoreService.setShortcutsEnabled(true);
      });
    this.modalVisiblities.shortcuts = true;
  }

  abortTranscription = async () => {
    if (!(await this.recordedFileService.checkUnsaved(this.modService))) return;
    if ([LoginMode.ONLINE, LoginMode.URL].includes(this.appStorage.useMode)) {
      this.modService
        .openModal(
          TranscriptionStopModalComponent,
          TranscriptionStopModalComponent.options,
        )
        .then((answer: any) => {
          if (answer === TranscriptionStopModalAnswer.QUIT) {
            this.annotationStoreService.quit(false, false, false);
          } else if (answer === TranscriptionStopModalAnswer.QUITRELEASE) {
            this.annotationStoreService.quit(true, true, false);
          }
          // else do nothing
        })
        .catch((error) => {
          console.error(error);
        });
    } else {
      this.annotationStoreService.quit(false, false, false);
    }
  };

  public onSendNowClick() {
    if (this._useMode === LoginMode.ONLINE) {
      if (this._useMode === LoginMode.ONLINE) {
        this.annotationStoreService.sendOnlineAnnotation();
      }
    } else if (this._useMode === LoginMode.DEMO) {
      // only if opened
      if (this.modalVisiblities.overview) {
        this.modalOverview!.close();
      }

      this.modService
        .openModal(
          TranscriptionDemoEndModalComponent,
          TranscriptionDemoEndModalComponent.options,
        )
        .then((action: any) => {
          this.appStorage.savingNeeded = false;

          switch (action) {
            case ModalEndAnswer.CANCEL:
              break;
            case ModalEndAnswer.QUIT:
              this.abortTranscription();
              break;
            case ModalEndAnswer.CONTINUE:
              this.transcrSendingModal = this.modService.openModalRef(
                TranscriptionSendingModalComponent,
                TranscriptionSendingModalComponent.options,
              );
              this.subscribe(timer(1000), () => {
                // simulate nextTranscription
                this.transcrSendingModal!.close();
                this.reloadDemo();
              });
              break;
          }
        })
        .catch((error) => {
          console.error(error);
        });
    }
  }

  onSendButtonClick() {
    const showOverview =
      this.projectsettings.tratt?.showOverviewIfTranscriptNotValid === undefined
        ? true
        : this.projectsettings.tratt?.sendValidatedTranscriptionOnly;
    const validTranscriptOnly =
      this.projectsettings.tratt?.sendValidatedTranscriptionOnly === undefined
        ? false
        : this.projectsettings.tratt?.sendValidatedTranscriptionOnly;

    this.annotationStoreService.validateAll();
    const validTranscript = this.annotationStoreService.transcriptValid;

    if (
      (!validTranscript && showOverview) ||
      (validTranscriptOnly && !validTranscript)
    ) {
      this.modalOverview = this.modService.openModalRef(
        OverviewModalComponent,
        OverviewModalComponent.options,
      );
      this.subscriptionManager.removeByTag('overview modal transcr send');
      this.subscribe(
        this.modalOverview.componentInstance.transcriptionSend,
        () => {
          this.appStoreService.setShortcutsEnabled(true);
          this.modalOverview?.close();
          this.modalVisiblities.overview = false;
          timer(1000).subscribe({
            next: () => {
              this.onSendNowClick();
            },
          });
        },
        'overview modal transcr send',
      );
    } else {
      this.onSendNowClick();
    }
  }

  reloadDemo() {
    this.annotationStoreService.endTranscription(true);
    this.clearDataPermanently();
    this.authStoreService.loginDemo();
  }

  clearDataPermanently() {
    // replace with store method
    this.appStorage.clearAnnotationPermanently(); // ok
    this.appStorage.feedback = {}; // ok
    this.annotationStoreService.changeComment(''); // ok
    this.appStorage.clearLoggingDataPermanently(); // ok
    this.uiService.elements = [];
  }

  public onSaveTranscriptionButtonClicked() {
    const aType = this.routingService.staticQueryParams.annotationExportType;
    let converter: Converter | undefined = undefined;

    if (!aType || aType === 'AnnotJSON') {
      converter = new AnnotJSONConverter();
    } else {
      converter = AppInfo.converters.find((a) => a.name === aType);

      if (!converter) {
        window.parent.postMessage(
          {
            error: `Export Type ${aType} is not supported.`,
            status: 'error',
          },
          '*',
        );
        return;
      }
    }

    const manager = this.audioService.current!;
    const oannotjson = this.annotationStoreService.transcript!.serialize(
      manager.resource.info.fullname,
      manager.resource.info.sampleRate,
      manager.resource.info.duration,
    );
    const result = converter.export(
      oannotjson,
      manager.resource.getOAudioFile(),
      0,
    );

    if (!result.error && result.file) {
      // send result to iframe owner
      window.parent.postMessage(
        {
          data: {
            annotation: result.file,
          },
          status: 'success',
        },
        '*',
      );
    } else {
      console.error(`Annotation conversion failed: ${result.error}`);
      window.parent.postMessage(
        {
          error: `Annotation conversion failed: ${result.error}`,
          status: 'error',
        },
        '*',
      );
    }
  }

  public sendTranscriptionForShortAudioFiles(type: 'bad' | 'middle' | 'good') {
    switch (type) {
      case 'bad':
        this.appStorage.feedback = 'SEVERE';
        break;
      case 'middle':
        this.appStorage.feedback = 'SLIGHT';
        break;
      case 'good':
        this.appStorage.feedback = 'OK';
        break;
      default:
    }

    this.onSendButtonClick();
  }
}

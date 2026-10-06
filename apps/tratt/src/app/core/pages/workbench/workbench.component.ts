import { NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ComponentRef,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
  Type,
  untracked,
  ViewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgbModalRef, NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngrx/store';
import {
  AnnotJSONConverter,
  Converter,
  OAnnotJSON,
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { OAudiofile } from '@tratt/media';
import {
  formatMinutesSeconds,
  getFileSize,
  pickInitialLevelName,
} from '@tratt/utilities';
import { AudioManager, normalizeMimeType } from '@tratt/web-media';
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
import { AutoTranslateOptionsComponent } from '../../component/tratt-dropzone/auto-translate-options.component';
import {
  audioBasename,
  sameBasename,
  transcriptBasename,
} from '../../component/tratt-dropzone/transcript-pairing';
import { TrattDropzoneComponent } from '../../component/tratt-dropzone/tratt-dropzone.component';
import { DropzoneStatistics } from '../../component/tratt-dropzone/tratt-dropzone.service';
import { ExportFilesModalComponent } from '../../modals/export-files-modal/export-files-modal.component';
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
import { YesNoModalComponent } from '../../modals/yes-no-modal/yes-no-modal.component';
import { FileProgress } from '../../obj/objects';
import { SessionFile } from '../../obj/SessionFile';
import { ProjectSettings } from '../../obj/Settings';
import { LoadeditorDirective } from '../../shared/directive/loadeditor.directive';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { AlertService } from '../../shared/service/alert.service';
import { AnnotationSaveTracker } from '../../shared/service/annotation-save-tracker.service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { AudioService } from '../../shared/service/audio.service';
import { CapacityService } from '../../shared/service/capacity.service';
import { CatalogueExportService } from '../../shared/service/catalogue-export.service';
import { TranscriptionOptions } from '../../shared/service/local-transcription.service';
import { TranslationOptions } from '../../shared/service/local-translation.service';
import { PendingEditsService } from '../../shared/service/pending-edits.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { RoutingService } from '../../shared/service/routing.service';
import { LoadingStatus, LoginMode, RootState } from '../../store';
import { ApplicationState } from '../../store/application';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import { AuthenticationActions } from '../../store/authentication/authentication.actions';
import { AnnotationActions } from '../../store/login-mode/annotation/annotation.actions';
import {
  breakMarkerCodeOf,
  selectAllBundleSummaries,
  selectLocalMode,
  selectSelectedBundleId,
  transcriptHasContent,
} from '../../store/login-mode/annotation/annotation.selectors';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import {
  DEFAULT_BUNDLE_ID,
  generateBundleId,
} from '../../store/login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { computeReadyBundleIds } from '../../store/pipeline-queue';
import {
  selectAllRunStatuses,
  selectQueueMode,
} from '../../store/pipeline-queue/pipeline-queue.selectors';
import { describePipeline } from './pipeline-summary';

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
    AutoTranslateOptionsComponent,
    CapacityIndicatorComponent,
    NgTemplateOutlet,
  ],
})
export class WorkbenchComponent
  extends DefaultComponent
  implements OnInit, AfterViewInit, OnDestroy
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

  /**
   * Which bundle / AudioManager the mounted editor was created for. Every
   * editor captures `AudioService.current` once in its ngOnInit and never
   * looks again, so the editor has to be remounted whenever the selected
   * bundle (or that bundle's resident manager) changes — otherwise it keeps
   * playing and drawing the PREVIOUS bundle's audio while every edit is
   * routed to the newly selected bundle's transcript.
   */
  private mountedBundleId?: string;
  private mountedManager?: AudioManager;
  // The level the mounted editor shows. Text editors read the current level
  // once, when they mount; picking another level (navbar) must remount them.
  private mountedLevelIndex?: number;

  /**
   * What the editor pane shows instead of an editor when the selected bundle
   * has no resident audio: 'loading' while an evicted bundle re-decodes from
   * its retained file, 'awaiting-media' when the file must be re-attached.
   */
  editorPlaceholder = signal<'none' | 'loading' | 'awaiting-media'>('none');

  private selectedBundleId = this.store.selectSignal(selectSelectedBundleId);
  private localMode = this.store.selectSignal(selectLocalMode);
  private alertService = inject(AlertService);
  private saveTracker = inject(AnnotationSaveTracker);
  private catalogueExport = inject(CatalogueExportService);
  private selectedLevelIndex = computed(
    () =>
      this.localMode()?.bundles.entities[this.selectedBundleId()]?.transcript
        ?.selectedLevelIndex,
  );
  private unregisterPendingEdits?: () => void;

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
  /** The project allows exporting (projectconfig navigation.export). */
  exportEnabled = false;
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
   * leave this stale until something else it depends on changes. All real
   * residency-changing call sites (runFirstWave, runLaterWave,
   * completeReattach) write to the store immediately afterwards.
   */
  readyBundleIds = computed(() =>
    computeReadyBundleIds(
      this.bundleSummaries(),
      this.runStatuses(),
      (bundleId) => this.audioService.canRestore(bundleId),
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
   * Translation config from the persistent settings panel, forwarded to the
   * queue: `PipelineRunnerService.run()` chains translation after ASR (and
   * optional diarization) when `translateOptions` is set, exactly as /local
   * does. (Previously the panel was rendered but its value was dropped, so
   * ticking "Translate transcript locally" silently did nothing.)
   */
  queueTranslateOptions = signal<TranslationOptions | null>(null);

  onQueueTranslateOptionsChange(options: TranslationOptions | null): void {
    this.queueTranslateOptions.set(options);
    this.pipelineQueueService.setTranslateOptions(options);
  }

  /** UI language, for naming languages in the pipeline summary. */
  private readonly uiLang = toSignal(inject(TranslocoService).langChanges$, {
    initialValue: inject(TranslocoService).getActiveLang(),
  });

  /**
   * What the rail shows about the pipeline: whether new files are
   * transcribed, and with what. The settings themselves are in a dialog.
   */
  readonly pipelineSummary = computed(() =>
    describePipeline(
      this.queueOptions(),
      this.queueTranslateOptions(),
      this.uiLang(),
    ),
  );

  @ViewChild('pipelineDialog')
  private pipelineDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('pipelineButton')
  private pipelineButton?: ElementRef<HTMLButtonElement>;

  /** Opens the pipeline settings as a modal dialog (top layer, Esc). */
  openPipelineSettings(): void {
    const dialog = this.pipelineDialog?.nativeElement;
    if (!dialog || dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      // No <dialog> support (jsdom): just show it.
      dialog.setAttribute('open', '');
    }
  }

  closePipelineSettings(): void {
    const dialog = this.pipelineDialog?.nativeElement;
    if (!dialog) {
      return;
    }
    if (typeof dialog.close === 'function') {
      dialog.close(); // fires `close` → onPipelineDialogClosed()
    } else {
      dialog.removeAttribute('open');
      this.onPipelineDialogClosed();
    }
  }

  /** A click on the dialog element itself, not its content, is the
   * backdrop. */
  onPipelineDialogClick(event: MouseEvent): void {
    if (event.target === this.pipelineDialog?.nativeElement) {
      this.closePipelineSettings();
    }
  }

  /** Done, ×, Esc or the backdrop: back to the icon that opened it. */
  onPipelineDialogClosed(): void {
    this.pipelineButton?.nativeElement.focus();
  }

  // Step 6 continuous ingestion bookkeeping.
  private ingestedIds = new Set<number>();
  private visitBootstrapped = false;
  // Bundle ids created this visit whose creation dispatch may still be
  // in flight (first wave only — later wave's createBundle dispatch is
  // synchronous) — see this task's own doc comment on the race it closes.
  private pendingAutoEnqueueIds = new Set<string>();
  // First-drop bundles (other than the first) whose paired transcript waits
  // for onLoginLocal$ to create them.
  private pendingTranscriptsByBundle = new Map<string, OAnnotJSON>();

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
        /** Unset while the file's audio isn't available this session. */
        durationText?: string;
        sampleRateKhz?: number;
        channels?: number;
        sizeText?: string;
      }
    | undefined {
    // Media info is captured at registration and survives LRU eviction, so
    // the header stays put while an evicted bundle re-decodes.
    const info =
      this.audioService.getMediaInfo(this.selectedBundleId()) ??
      this.audioService.current?.resource?.info;
    if (!info) {
      // A file restored after a reload: still name it, so its per-file
      // actions (export) are reachable before the audio is re-attached.
      const name =
        this.localMode()?.bundles.entities[this.selectedBundleId()]?.sessionFile
          ?.name;
      return name ? { name } : undefined;
    }
    const fileSize = getFileSize(info.size);
    return {
      name: info.fullname,
      durationText: formatMinutesSeconds(info.duration.seconds),
      sampleRateKhz: Math.round(info.sampleRate / 1000),
      channels: info.channels,
      sizeText: `${fileSize.size} ${fileSize.label}`,
    };
  }

  /**
   * "Export this transcription". Resolves the selected file's media the way
   * the catalogue export does — registration-time info, a resident or
   * re-decodable manager, else the transcript's own timing — so a file can
   * be exported before (or without) re-attaching its audio.
   */
  async exportSelected(): Promise<void> {
    // Export what is on screen, including typing still in the debounce.
    this.pendingEdits.flush();
    const media = await this.catalogueExport.resolveBundleMedia(
      this.selectedBundleId(),
    );
    if (!media) {
      this.alertService
        .showAlert(
          'warning',
          this.transloco.translate(
            'workbench.editor_header.export_unavailable',
          ),
        )
        .catch((error) => console.error(error));
      return;
    }
    this.modService.openModalRef(
      ExportFilesModalComponent,
      ExportFilesModalComponent.options,
      { uiService: this.uiService, media },
    );
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
    private pendingEdits: PendingEditsService,
    private ngZone: NgZone,
    private transloco: TranslocoService,
  ) {
    super();

    // Keep the mounted editor in lock-step with the selected bundle. Reads
    // are reactive: `getManager()`/`canRestore()` track AudioService's
    // registry version, so this also fires when the selected bundle's audio
    // finishes re-decoding after an LRU eviction.
    effect(() => {
      const bundleId = this.selectedBundleId();
      const manager = this.audioService.getManager(bundleId);
      const restorable = this.audioService.canRestore(bundleId);
      const levelIndex = this.selectedLevelIndex();
      untracked(() =>
        this.syncEditorToSelection(bundleId, manager, restorable, levelIndex),
      );
    });

    // Step 6: fires once per pending bundle id, exactly when that bundle's
    // sessionFile (and, in the same reducer case, its transcript) have
    // actually landed in the store — see this task's doc comment above.
    //
    // Deviation from task-6-brief.md (documented in task-6-report.md): the
    // brief's own version of this effect checks
    // `pendingAutoEnqueueIds.size === 0` and returns BEFORE reading
    // `bundleSummaries()`/`queueOptions()`. `pendingAutoEnqueueIds` is a
    // plain `Set`, not a signal, so on the component's very first effect
    // flush (which happens before any file has ever been dropped, i.e.
    // while the set is still empty) that early return means NEITHER signal
    // is read on that run — Angular's effect() only re-runs when a signal
    // it actually read last time changes, so an effect whose first run
    // tracks zero signals never runs again, period (confirmed empirically
    // with an isolated TestBed probe during this task's self-review).
    // Concretely: ngOnInit's own detectChanges() call flushes this effect
    // once, with the set still empty, before ngAfterViewInit's dropzone
    // subscription has ever had a chance to add anything to it — so with
    // the brief's literal ordering, auto-enqueue would silently never fire
    // for the lifetime of the component, in every real run of the app.
    // Reading both signals unconditionally, before the (now purely
    // bookkeeping) emptiness check, fixes this: the effect always tracks
    // bundleSummaries()/queueOptions(), so it reliably re-runs once this
    // task's own runFirstWave()/runLaterWave() populate
    // pendingAutoEnqueueIds and the store later writes that bundle's name.
    // The race this effect exists to close (see this task's doc comment
    // above) is unaffected — the one-shot per-id enqueue gate below is
    // unchanged.
    effect(() => {
      const summaries = this.bundleSummaries();
      const options = this.queueOptions();
      if (this.pendingAutoEnqueueIds.size === 0) {
        return;
      }
      for (const summary of summaries) {
        if (
          this.pendingAutoEnqueueIds.has(summary.bundleId) &&
          summary.name !== undefined
        ) {
          this.pendingAutoEnqueueIds.delete(summary.bundleId);
          if (options !== null) {
            this.pipelineQueueService.enqueue([summary.bundleId]);
          }
        }
      }
    });

    // First-drop files other than the first are created by onLoginLocal$
    // after the login chain started; their paired transcripts are applied
    // as soon as they appear. (Signals read before the emptiness check — see
    // the auto-enqueue effect above for why.)
    effect(() => {
      const summaries = this.bundleSummaries();
      if (this.pendingTranscriptsByBundle.size === 0) {
        return;
      }
      for (const summary of summaries) {
        const annotation = this.pendingTranscriptsByBundle.get(
          summary.bundleId,
        );
        if (annotation && summary.name !== undefined) {
          this.pendingTranscriptsByBundle.delete(summary.bundleId);
          untracked(() => this.applyTranscript(summary.bundleId, annotation));
        }
      }
    });
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

    this.unregisterPendingEdits = this.pendingEdits.register(() =>
      this.flushMountedEditor(),
    );

    // A pipeline result replaced the transcript of the bundle on screen:
    // editors only read the transcript when they mount, so remount to show
    // it (otherwise the editor kept showing the empty pre-run transcript
    // until the user clicked away and back).
    const transcriptReplaced$ = this.pipelineQueueService.transcriptReplaced$;
    if (transcriptReplaced$) {
      this.subscribe(transcriptReplaced$, (bundleId: string) =>
        this.remountIfShowing(bundleId),
      );
    }

    this.subscribe(
      this.appStoreService.loading$,
      (loading: ApplicationState['loading']) => {
        const wasReady = this.sessionReady;
        this.sessionReady = loading?.status === LoadingStatus.FINISHED;
        if (wasReady && !this.sessionReady) {
          // `@if (sessionReady)` is about to destroy the right pane together
          // with the mounted editor's view. Forget the stale ComponentRef so
          // the next mountDefaultEditor() really mounts instead of hitting
          // changeEditor()'s "already mounted" no-op guard and leaving the
          // pane empty.
          this.currentEditorRef = undefined;
          this.mountedBundleId = undefined;
          this.mountedManager = undefined;
        }
        if (loading?.status === LoadingStatus.FAILED) {
          // A failed login/bootstrap chain (e.g. HTTP config fetch failure)
          // must not permanently strand the workbench in the background-only
          // ingestion path — clearing this lets a later file drop retry the
          // real bootstrap, mirroring what the deleted sessionStarting reset
          // on FAILED used to provide.
          this.visitBootstrapped = false;
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
          this.exportEnabled =
            this.settingsService.projectsettings?.navigation?.export === true;
          // LOCAL: exporting is a per-file action in the file header
          // ("Export this transcription"); a second, unlabelled "Export" in
          // the top bar read as exporting everything.
          this.navbarServ.showExport =
            this.exportEnabled && this._useMode !== 'local';

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

  ngAfterViewInit(): void {
    if (!this.dropzone) {
      console.warn(
        'WorkbenchComponent.ngAfterViewInit: dropzone ViewChild did not resolve — continuous ingestion will not work this session.',
      );
      return;
    }
    this.subscribe(
      this.dropzone.filesAdded,
      (event: {
        statistics: DropzoneStatistics;
        addedFiles: FileProgress[];
      }) => {
        // Subscribed here, not via a template (output) binding, so nothing
        // marks this OnPush view: without this a status change that touches
        // no store state (a transcript turning invalid, a decode finishing)
        // stayed a spinner in the dropzone until the next unrelated update.
        this.cd.markForCheck();
        this.onFilesChanged(event.addedFiles);
      },
    );
  }

  private onFilesChanged(addedFiles: FileProgress[]): void {
    if (!this.visitBootstrapped && this.sessionReady) {
      // A LOCAL session already exists although no file was dropped on this
      // visit yet — e.g. the user re-attached audio to a bundle restored from
      // IndexedDB (BundleListComponent.completeReattach() runs the login
      // chain itself), or came back to /workbench mid-session. Treat this
      // visit as bootstrapped: re-running loginLocal() here would re-fire the
      // one-shot login chain and write the new file's session into whichever
      // bundle is selected.
      this.visitBootstrapped = true;
    }
    const isAudio = (f: FileProgress) =>
      AudioManager.isValidAudioFileName(f.file.fullname, AppInfo.audioformats);
    // The dropzone pairs each transcript with the recording of its basename
    // (pairTranscriptsByBasename). A recording waits while a transcript of
    // its name is still being read or imported, so the two are created
    // together — in every drop, not only the first.
    const pendingTranscripts = addedFiles
      .filter(
        (f) =>
          !isAudio(f) && (f.status === 'progress' || f.status === 'waiting'),
      )
      .map((f) => transcriptBasename(f.file.fullname, AppInfo.converters));
    const readyTranscripts = addedFiles.filter(
      (f) =>
        !isAudio(f) &&
        f.status === 'valid' &&
        f.annotation !== undefined &&
        f.pairedBasename !== undefined &&
        !this.ingestedIds.has(f.id),
    );
    const newlyValid = addedFiles.filter(
      (f) =>
        f.status === 'valid' &&
        f.audioManager !== undefined &&
        f.oaudiofile !== undefined &&
        !this.ingestedIds.has(f.id) &&
        !pendingTranscripts.some((name) =>
          sameBasename(name, audioBasename(f.file.fullname)),
        ),
    );
    if (newlyValid.length === 0 && readyTranscripts.length === 0) {
      return;
    }
    for (const f of [...newlyValid, ...readyTranscripts]) {
      this.ingestedIds.add(f.id);
    }

    // Each transcript goes to the recording of its name: one in this drop,
    // else (it was paired via audioForTranscript) a file already listed.
    const used = new Set<FileProgress>();
    const transcriptFor = (audio: FileProgress) => {
      const match = readyTranscripts.find(
        (t) =>
          !used.has(t) &&
          sameBasename(t.pairedBasename!, audioBasename(audio.file.fullname)),
      );
      if (match) {
        used.add(match);
      }
      return match;
    };

    const { reattach, duplicates, fresh } =
      this.matchAwaitingBundles(newlyValid);
    const reattachTranscripts = reattach.map(({ entry }) =>
      transcriptFor(entry),
    );
    const freshTranscripts = fresh.map((entry) => transcriptFor(entry));
    const duplicateTranscripts = duplicates.map(({ entry }) =>
      transcriptFor(entry),
    );

    if (reattach.length > 0) {
      this.reattachDropped(reattach, reattachTranscripts);
    }
    if (duplicates.length > 0) {
      this.skipDuplicates(
        duplicates,
        reattach.length === 0 &&
          fresh.length === 0 &&
          readyTranscripts.length === 0,
      );
      duplicates.forEach(({ bundleId }, i) => {
        const transcript = duplicateTranscripts[i];
        if (transcript && bundleId !== undefined) {
          void this.importTranscriptInto(bundleId, transcript);
        }
      });
    }
    if (fresh.length > 0) {
      if (!this.visitBootstrapped) {
        this.visitBootstrapped = true;
        this.runFirstWave(fresh, freshTranscripts);
      } else {
        this.runLaterWave(fresh, freshTranscripts);
      }
    }

    // Transcripts dropped for files that are already in the list.
    for (const transcript of readyTranscripts) {
      if (used.has(transcript)) {
        continue;
      }
      // Same lookup as audioForTranscript (which paired it): a restored file
      // without its audio counts too.
      const bundleId = this.listedBundleFor(transcript.pairedBasename!, {
        anyAudio: true,
      });
      if (bundleId === undefined) {
        // Removed meanwhile — say so instead of dropping it silently.
        transcript.status = 'invalid';
        transcript.error = this.transloco.translate(
          'workbench.dropzone.transcript_no_recording',
          { name: transcript.pairedBasename },
        );
        continue;
      }
      used.add(transcript);
      void this.importTranscriptInto(bundleId, transcript);
    }
    for (const transcript of used) {
      this.dropzone!.consumeEntry(transcript.id);
    }
  }

  /**
   * For the dropzone (externalAudioFor): the audio of a file already in the
   * list with this basename, so a transcript dropped on its own can be
   * imported against it. A file restored from an earlier visit (audio not
   * re-attached) is described by its stored transcript's timing — the same
   * resolution "Export this transcription" uses. `'no-audio'`: the file is
   * listed but neither is available (e.g. an empty transcript).
   */
  readonly audioForTranscript = (
    basename: string,
  ): OAudiofile | 'no-audio' | undefined | Promise<OAudiofile | 'no-audio'> => {
    const bundleId = this.listedBundleFor(basename, { anyAudio: true });
    if (bundleId === undefined) {
      return undefined;
    }
    const info = this.audioService.getMediaInfo(bundleId);
    if (!info) {
      return this.catalogueExport
        .resolveBundleMedia(bundleId)
        .then((media) => media?.oAudioFile ?? 'no-audio')
        .catch(() => 'no-audio' as const);
    }
    const audio = new OAudiofile();
    audio.name = info.fullname;
    audio.size = info.size;
    audio.sampleRate = info.sampleRate;
    audio.duration = info.duration.samples;
    audio.type =
      this.localMode()?.bundles.entities[bundleId]?.sessionFile?.type ?? '';
    return audio;
  };

  /** A listed file whose recording has this basename (with media info,
   * unless `anyAudio`). */
  private listedBundleFor(
    basename: string,
    opts: { anyAudio?: boolean } = {},
  ): string | undefined {
    const candidates = this.bundleSummaries().filter(
      (b) =>
        b.name !== undefined && sameBasename(audioBasename(b.name), basename),
    );
    const withMedia = candidates.find(
      (b) => this.audioService.getMediaInfo(b.bundleId) !== undefined,
    );
    return (withMedia ?? (opts.anyAudio ? candidates[0] : undefined))?.bundleId;
  }

  /**
   * Loads a dropped transcript into a file that is already in the list.
   * Replacing a transcript that has content asks first.
   */
  private async importTranscriptInto(
    bundleId: string,
    transcript: FileProgress,
  ): Promise<void> {
    const entity = this.localMode()?.bundles.entities[bundleId];
    if (!entity || !transcript.annotation) {
      return;
    }
    const file = transcript.file.fullname;
    const name = entity.sessionFile?.name ?? file;
    if (
      transcriptHasContent(
        entity.transcript,
        breakMarkerCodeOf(entity.guidelines),
      )
    ) {
      let answer: unknown;
      try {
        answer = await this.modService.openModal(
          YesNoModalComponent,
          YesNoModalComponent.options,
          {
            message: this.transloco.translate(
              'workbench.transcript_import.replace_confirm',
              { name, file },
            ),
          },
        );
      } catch {
        answer = 'no';
      }
      if (answer !== 'yes') {
        return;
      }
    }
    this.applyTranscript(bundleId, transcript.annotation);
    this.alertService
      .showAlert(
        'success',
        this.transloco.translate('workbench.transcript_import.applied', {
          name,
          file,
        }),
      )
      .catch((error) => console.error(error));
  }

  /**
   * Remounts the editor if it shows `bundleId`, after that file's transcript
   * was replaced (transcription result, imported transcript). The callers
   * can run outside Angular's zone (the ASR worker's callback); an editor
   * created there never gets its async initialisation change-detected (the
   * 2D editor stayed an empty canvas). Re-enter the zone and defer past the
   * current dispatch.
   */
  private remountIfShowing(bundleId: string): void {
    this.ngZone.run(() =>
      setTimeout(() => {
        if (
          this.sessionReady &&
          this.currentEditorRef &&
          bundleId === this.mountedBundleId
        ) {
          this.mountEditor(
            this.activeEditorName() ?? this.appStorage.interface ?? '',
            { flush: false },
          );
          this.cd.markForCheck();
        }
      }),
    );
  }

  /**
   * Writes an imported transcript into a bundle (persisted to IndexedDB by
   * the queue's persistence effect, like a transcription result) and
   * remounts the editor if it shows that file.
   */
  private applyTranscript(bundleId: string, annotation: OAnnotJSON): void {
    if (bundleId === this.selectedBundleId()) {
      this.pendingEdits.flush();
    }
    const transcript = TrattAnnotation.deserialize(annotation);
    if (transcript.levels.length > 0) {
      transcript.changeCurrentLevelIndex(0);
    }
    this.store.dispatch(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId,
        transcript,
      }),
    );
    this.remountIfShowing(bundleId);
  }

  /**
   * Splits a drop by what each file means for the list (fingerprint: name,
   * size and type):
   *
   * - `reattach` — the file of a bundle that is waiting for its audio (after
   *   a reload). Dropping the same files again used to add a second row per
   *   file; it now goes to the waiting bundle. Each bundle takes one file.
   * - `duplicates` — a file already in the list with its audio, or one
   *   dropped twice in the same drop. Used to add an identical row.
   * - `fresh` — everything else: new bundles.
   */
  private matchAwaitingBundles(entries: FileProgress[]): {
    reattach: { entry: FileProgress; bundleId: string }[];
    duplicates: { entry: FileProgress; bundleId?: string }[];
    fresh: FileProgress[];
  } {
    const entities = this.localMode()?.bundles.entities ?? {};
    const listed = this.bundleSummaries()
      .filter((b) => b.name !== undefined)
      .map((b) => ({
        bundleId: b.bundleId,
        file: entities[b.bundleId]?.sessionFile,
        hasAudio: this.audioService.canRestore(b.bundleId),
      }))
      .filter(
        (b): b is { bundleId: string; file: SessionFile; hasAudio: boolean } =>
          b.file !== undefined,
      );
    const sameFile = (
      a: { name: string; size: number; type: string },
      file: File,
    ) =>
      a.name === file.name &&
      a.size === file.size &&
      a.type === normalizeMimeType(file.type);

    const taken = new Set<string>();
    const reattach: { entry: FileProgress; bundleId: string }[] = [];
    const duplicates: { entry: FileProgress; bundleId?: string }[] = [];
    const fresh: FileProgress[] = [];
    for (const entry of entries) {
      const file = entry.file.file;
      if (!file) {
        fresh.push(entry);
        continue;
      }
      const waiting = listed.find(
        (b) => !b.hasAudio && !taken.has(b.bundleId) && sameFile(b.file, file),
      );
      if (waiting) {
        taken.add(waiting.bundleId);
        reattach.push({ entry, bundleId: waiting.bundleId });
        continue;
      }
      const loaded = listed.find((b) => b.hasAudio && sameFile(b.file, file));
      const earlier = [...fresh, ...reattach.map((r) => r.entry)].some(
        (other) =>
          other.file.file !== undefined &&
          sameFile(
            {
              name: other.file.file.name,
              size: other.file.file.size,
              type: normalizeMimeType(other.file.file.type),
            },
            file,
          ),
      );
      if (loaded || earlier) {
        duplicates.push({ entry, bundleId: loaded?.bundleId });
      } else {
        fresh.push(entry);
      }
    }
    return { reattach, duplicates, fresh };
  }

  /**
   * Drops files that are already in the list: their decoded audio is
   * released (it was never registered) and one notice names them. A drop of
   * nothing but already-listed files selects the first of them — dropping a
   * file again "opens" it.
   */
  private skipDuplicates(
    duplicates: { entry: FileProgress; bundleId?: string }[],
    onlyDuplicates: boolean,
  ): void {
    for (const { entry } of duplicates) {
      entry.audioManager?.destroy();
      this.dropzone!.consumeEntry(entry.id);
    }
    const names = [
      ...new Set(duplicates.map(({ entry }) => entry.file.fullname)),
    ].join(', ');
    this.alertService
      .showAlert(
        'info',
        this.transloco.translate('workbench.dropzone.already_loaded', {
          names,
        }),
      )
      .catch((error) => console.error(error));

    const target = duplicates[0].bundleId;
    if (
      onlyDuplicates &&
      target !== undefined &&
      this.sessionReady &&
      target !== this.selectedBundleId()
    ) {
      this.pendingEdits.flush();
      this.store.dispatch(
        LoginModeActions.selectBundle({
          mode: LoginMode.LOCAL,
          bundleId: target,
        }),
      );
    }
  }

  /**
   * Gives dropped audio to the waiting bundles it matched. With no session
   * yet (first drop after a reload), the first of them goes through the
   * same login chain as "Attach file…" in the list
   * (BundleListComponent.completeReattach) and becomes the selected file;
   * the others just get their audio. Mid-session nothing changes focus.
   */
  private reattachDropped(
    pairs: { entry: FileProgress; bundleId: string }[],
    transcripts: (FileProgress | undefined)[] = [],
  ): void {
    pairs.forEach(({ entry, bundleId }, i) => {
      this.audioService.registerAudioManager(
        bundleId,
        entry.audioManager!,
        entry.file.file!,
      );
      this.store.dispatch(
        LoginModeActions.bundleAudioAttached({
          mode: LoginMode.LOCAL,
          bundleId,
        }),
      );
      this.dropzone!.consumeEntry(entry.id);
      const transcript = transcripts[i];
      if (transcript) {
        void this.importTranscriptInto(bundleId, transcript);
      } else {
        // Files restored without a transcript get transcribed like new ones
        // (the queue skips bundles that already have content).
        this.pendingAutoEnqueueIds.add(bundleId);
      }
    });
    if (this.visitBootstrapped || this.sessionReady) {
      this.visitBootstrapped = true;
      return;
    }
    this.visitBootstrapped = true;
    const { entry, bundleId } = pairs[0];
    this.pendingEdits.flush();
    this.store.dispatch(
      LoginModeActions.selectBundle({ mode: LoginMode.LOCAL, bundleId }),
    );
    this.store.dispatch(
      AuthenticationActions.loginLocal.success({
        mode: LoginMode.LOCAL,
        files: [entry.file.file!],
        sessionFile: this.localMode()!.bundles.entities[bundleId]!
          .sessionFile as SessionFile,
        removeData: false,
        audioAlreadyLoaded: true,
      }),
    );
  }

  /**
   * Closing or reloading the tab while work is in flight loses it: a
   * running transcription, files still decoding, a recording that was never
   * exported (media is never stored, so it can't be re-attached later), or
   * transcript writes to IndexedDB that haven't finished. Typing still in
   * an editor's debounce is committed first. Browsers show their own
   * "Leave site?" text; a custom message is not supported.
   */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    this.pendingEdits.flush();
    if (this.hasWorkInFlight()) {
      event.preventDefault();
      // Legacy browsers only show the dialog when returnValue is set.
      event.returnValue = '';
    }
  }

  /** Last chance on mobile / bfcache, where beforeunload doesn't fire. */
  @HostListener('window:pagehide')
  onPageHide(): void {
    this.pendingEdits.flush();
  }

  hasWorkInFlight(): boolean {
    return (
      this.queueRunning() ||
      (this.dropzone?.files ?? []).some((f) => f.status !== 'invalid') ||
      (!!this.recordedFileService.recordedFile &&
        !this.recordedFileService.exported) ||
      this.saveTracker.inFlight > 0
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
    this.unregisterPendingEdits?.();
    super.ngOnDestroy();
  }

  /**
   * Commits the mounted editor's debounced typing to the store. Only while
   * the mounted editor still belongs to the selected bundle — flushing a
   * stale editor would write its text into whatever bundle is selected now.
   */
  private flushMountedEditor(): void {
    if (
      !this.currentEditorRef ||
      this.mountedBundleId !== this.selectedBundleId()
    ) {
      return;
    }
    (
      this.currentEditorRef.instance as unknown as
        | TrattEditorRequirements
        | undefined
    )?.flushPendingEdits?.();
  }

  /**
   * Gives the selected bundle the same starting transcript the session
   * bootstrap gives the first file — one level with one empty segment
   * spanning the recording — if it has no level at all.
   *
   * Only the bundle that is selected while the login chain runs gets that
   * seed (AnnotationLoadEffects.loadSegments). Every other bundle — the
   * second and later files of a multi-file drop, every file dropped later —
   * started with zero levels: nothing to type into in the text editors, no
   * segment to open in the 2D editor, until a pipeline run produced one.
   * A single blank segment is not "content" (transcriptHasContent), so this
   * never stops the bundle from being auto-transcribed.
   */
  private seedEmptyTranscript(manager: AudioManager): void {
    const bundleId = this.selectedBundleId();
    const transcript = this.localMode()?.bundles.entities[bundleId]?.transcript;
    if (!transcript || transcript.levels.length > 0) {
      return;
    }
    const levelName = pickInitialLevelName({
      uiLanguage: this.transloco.getActiveLang(),
    });
    const seeded = new TrattAnnotation<TrattAnnotationSegment>();
    const level = seeded.createSegmentLevel(levelName);
    level.items.push(
      seeded.createSegment(manager.resource.info.duration, [
        new OLabel(levelName, ''),
      ]),
    );
    seeded.addLevel(level);
    seeded.changeLevelIndex(0);
    this.store.dispatch(
      AnnotationActions.overwriteTranscript.do({
        transcript: seeded,
        mode: LoginMode.LOCAL,
        saveToDB: true,
      }),
    );
  }

  /**
   * Remounts (or unmounts) the editor so it always shows the selected
   * bundle's audio — see `mountedBundleId`. Never flushes: by the time the
   * selection has changed, a flush would target the wrong bundle (callers
   * that change the selection flush beforehand via PendingEditsService).
   */
  private syncEditorToSelection(
    bundleId: string,
    manager: AudioManager | undefined,
    restorable: boolean,
    levelIndex?: number,
  ): void {
    if (!this.sessionReady || !this.showEditor) {
      return;
    }
    if (!manager) {
      if (this.currentEditorRef) {
        this.showEditor.viewContainerRef.clear();
        this.currentEditorRef = undefined;
      }
      this.mountedBundleId = undefined;
      this.mountedManager = undefined;
      this.editorPlaceholder.set(restorable ? 'loading' : 'awaiting-media');
      this.cd.markForCheck();
      return;
    }
    this.editorPlaceholder.set('none');
    if (
      this.currentEditorRef &&
      this.mountedBundleId === bundleId &&
      this.mountedManager === manager &&
      this.mountedLevelIndex === levelIndex
    ) {
      return;
    }
    const name = this.activeEditorName() ?? this.appStorage.interface ?? '';
    this.mountEditor(name, { flush: false });
    this.cd.markForCheck();
  }

  private mountDefaultEditor(): void {
    const interfaces = this.settingsService.projectsettings?.interfaces ?? [];
    const current = this.appStorage.interface;
    const valid = interfaces.find((x) => x === current);
    if (valid === undefined && interfaces.length > 0) {
      this.appStorage.interface = interfaces[0];
    }
    // Always mount SOMETHING. With no stored editor preference (fresh
    // profile, cleared storage) and the project's interface list not
    // available yet, this used to mount nothing at all — an empty editor
    // pane with no tab highlighted. changeEditor('') falls back to the
    // default editor.
    this.changeEditor(this.appStorage.interface ?? '');
  }

  /**
   * The login/session-bootstrap chain (AuthenticationStoreService.loginLocal()
   * -> onLoginLocal$) must fire exactly once per workbench visit — see the
   * spec's own grounding fact 1. This is that one call, now driven by the
   * FIRST filesAdded emission containing at least one newly-valid audio
   * file, instead of a manual "Start session" click. Same batch shape as
   * before: entry 0 -> DEFAULT_BUNDLE_ID, the rest -> generateBundleId(),
   * all handed to one loginLocal() call so onLoginLocal$'s own multi-file
   * handling (entry 0 through the prepare/save-gate path, the rest via its
   * own createBundle loop) runs unchanged.
   *
   * Consumes each entry individually via consumeEntry() rather than
   * dropzone.reset() — reset() clears the ENTIRE pending list, which would
   * orphan any other file still mid-decode in the same drop gesture (see
   * this plan's Review Focus #1).
   */
  private runFirstWave(
    entries: FileProgress[],
    transcripts: (FileProgress | undefined)[] = [],
  ): void {
    // The first file's own transcript (paired by name by the dropzone) goes
    // through the login chain, as before; the others' are applied once
    // onLoginLocal$ has created their bundles (pendingTranscriptsByBundle).
    const annotation = transcripts[0]?.annotation;

    // DEFAULT_BUNDLE_ID may already hold a real bundle restored from
    // IndexedDB (the user's previous session). It must not be reused for the
    // first new file: onLoginLocal$ selects the first id and
    // loginLocal.prepare then writes this file's sessionFile (and, with a
    // paired transcript, its annotation) into the SELECTED bundle — silently
    // re-binding the restored transcript to a different recording, or
    // overwriting it outright.
    const bundle1Occupied = this.bundleSummaries().some(
      (b) => b.bundleId === DEFAULT_BUNDLE_ID && b.name !== undefined,
    );

    const audioBundleIds: string[] = [];
    const files: File[] = [];
    entries.forEach((entry, i) => {
      const bundleId =
        i === 0 && !bundle1Occupied ? DEFAULT_BUNDLE_ID : generateBundleId();
      const nativeFile = entry.file.file!;
      this.audioService.registerAudioManager(
        bundleId,
        entry.audioManager!,
        nativeFile,
      );
      audioBundleIds.push(bundleId);
      files.push(nativeFile);
    });

    if (bundle1Occupied) {
      // Create the first file's fresh bundle up front (and select it) so
      // onLoginLocal$'s selectBundle(firstBundleId) finds an entity — for an
      // unknown id that action is a no-op, and prepare would land on the
      // restored bundle again.
      const first = files[0];
      this.store.dispatch(
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId: audioBundleIds[0],
          sessionFile: new SessionFile(
            first.name,
            first.size,
            new Date(first.lastModified),
            normalizeMimeType(first.type),
          ),
          selectAfterCreate: true,
          audioLoaded: true,
        }),
      );
    }

    this.authStoreService.loginLocal(files, annotation, false, audioBundleIds);
    audioBundleIds.forEach((id, i) => {
      const paired = transcripts[i]?.annotation;
      if (paired === undefined) {
        this.pendingAutoEnqueueIds.add(id);
      } else if (i > 0) {
        this.pendingTranscriptsByBundle.set(id, paired);
      }
    });
    for (const entry of entries) {
      this.dropzone!.consumeEntry(entry.id);
    }
  }

  /**
   * Every file after the first-wave bootstrap: registers its AudioManager
   * and dispatches createBundle directly, with selectAfterCreate: false so
   * a file decoding in the background never steals focus from whatever
   * bundle the user is actively editing (Task 2). Deliberately does NOT
   * call authStoreService.loginLocal() — re-firing the login chain per file
   * would re-fetch config over HTTP, reset logging's start time, and force-
   * select the wrong bundle (spec grounding fact 1).
   *
   * Carried-forward gap, not fixed here: a transcript file dropped after the
   * first wave has already bootstrapped has no attachment point — the
   * dropzone's singular _oannotation pairing only ever reaches the
   * bootstrap call (see the spec's step 2.7 finding of the same name).
   */
  private runLaterWave(
    entries: FileProgress[],
    transcripts: (FileProgress | undefined)[] = [],
  ): void {
    // Background files never steal focus from a file being edited — but
    // when the selection is the empty placeholder bundle (every file was
    // removed), there is nothing to steal from: show the first new file
    // instead of a pane asking to attach audio to a file that isn't there.
    // Only once the session is ready: while the first wave's login chain is
    // still running, the selected bundle has no file YET and that chain
    // writes into whatever is selected.
    const selected =
      this.localMode()?.bundles.entities[this.selectedBundleId()];
    let selectNext =
      this.sessionReady &&
      selected !== undefined &&
      selected.sessionFile === undefined;
    entries.forEach((entry, i) => {
      const bundleId = generateBundleId();
      const nativeFile = entry.file.file!;
      this.audioService.registerAudioManager(
        bundleId,
        entry.audioManager!,
        nativeFile,
      );
      this.store.dispatch(
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId,
          sessionFile: new SessionFile(
            nativeFile.name,
            nativeFile.size,
            new Date(nativeFile.lastModified),
            normalizeMimeType(nativeFile.type),
          ),
          selectAfterCreate: selectNext,
          audioLoaded: true,
        }),
      );
      selectNext = false;
      const paired = transcripts[i]?.annotation;
      if (paired) {
        // A new, empty file: its own transcript goes straight in, and it
        // is not transcribed.
        this.applyTranscript(bundleId, paired);
      } else {
        this.pendingAutoEnqueueIds.add(bundleId);
      }
      this.dropzone!.consumeEntry(entry.id);
    });
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

    this.mountEditor(name, { flush: true });
  }

  /**
   * Disposes whatever editor is mounted and mounts `name` for the currently
   * selected bundle. `flush` must only be true when the selection has NOT
   * changed since the old editor was mounted (an editor-tab switch) — see
   * `syncEditorToSelection()`.
   */
  private mountEditor(name: string, opts: { flush: boolean }): void {
    if (name === undefined || name === '') {
      name = editorComponents[editorComponents.length - 1].name;
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
    if (opts.flush) {
      this.flushMountedEditor();
    }

    const viewContainerRef = this.showEditor.viewContainerRef;
    try {
      viewContainerRef.clear();
    } catch (error) {
      // A failing teardown of the previous editor must not leave the pane
      // empty: carry on and mount the new one.
      console.error('ERROR while unmounting the previous editor', error);
    }
    this.currentEditorRef = undefined;
    this.mountedBundleId = undefined;
    this.mountedManager = undefined;

    const manager = this.audioService.current;
    if (!manager) {
      // Every editor dereferences `AudioService.current` in ngOnInit; with
      // the selected bundle's audio not resident (re-decoding, or awaiting a
      // re-attach) mounting would throw. Remember the choice and let
      // syncEditorToSelection() mount it once the audio is back.
      this.appStorage.interface = name;
      this.activeEditorName.set(name);
      this.editorPlaceholder.set(
        this.audioService.canRestore(this.selectedBundleId())
          ? 'loading'
          : 'awaiting-media',
      );
      return;
    }

    // F6 (final whole-branch review): a throw during mount must not leave
    // appStorage.interface/activeEditorName claiming a switch that didn't
    // actually happen — clear() has already emptied the pane, so the
    // honest state is "nothing is mounted", not "the new editor is active".
    // Left pointing at the previous editor's name rather than blanked, so
    // the tab row's highlight still matches the caller's last real
    // intent — a click on that same tab retries the mount (see the guard
    // above).
    this.seedEmptyTranscript(manager);

    try {
      this.currentEditorRef =
        viewContainerRef.createComponent<TRATTEditor>(comp);
    } catch (error) {
      this.currentEditorRef = undefined;
      console.error('ERROR failed to mount editor component', error);
      return;
    }

    this.mountedBundleId = this.selectedBundleId();
    this.mountedManager = manager;
    this.mountedLevelIndex = this.selectedLevelIndex();
    this.editorPlaceholder.set('none');
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

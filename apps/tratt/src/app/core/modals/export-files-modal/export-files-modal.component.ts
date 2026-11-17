import { NgClass } from '@angular/common';
import {
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  NgbActiveModal,
  NgbModalOptions,
  NgbPopover,
  NgbTooltip,
} from '@ng-bootstrap/ng-bootstrap';
import { Converter, ExportCategory } from '@tratt/annotation';
import {
  fadeInExpandOnEnterAnimation,
  fadeOutCollapseOnLeaveAnimation,
} from 'angular-animations';
import { Subscription } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { NavbarService } from '../../component/navbar/navbar.service';
import { audioBasename } from '../../component/tratt-dropzone/transcript-pairing';
import { AudioService, UserInteractionsService } from '../../shared/service';
import { AlertService } from '../../shared/service/alert.service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import {
  archiveFileName,
  archiveFolderName,
  CatalogueExportService,
  ExportDownload,
  NATIVE_FORMAT,
  ResolvedMedia,
} from '../../shared/service/catalogue-export.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { TableConfiguratorComponent } from '../../tools/table-configurator/table-configurator.component';
import { TrattModal } from '../types';

/** What the dialog needs to know about each recording bundle it can export. */
export interface ExportBundle {
  bundleId: string;
  name: string;
  /** Its audio is attached, so the export can carry it. */
  hasAudio: boolean;
  /** It has a transcript; one without is left out. */
  hasTranscript: boolean;
  /** Its annotation levels, in order; segment tiers are the ones exported. */
  levels: { name: string; segment: boolean }[];
}

/** Which recording bundles an export covers. */
export type ExportScope = 'open' | 'ticked' | 'all';

/** One file in the dialog's preview of the export. */
export interface ExportEntryFile {
  name: string;
  kind: 'audio' | 'transcript' | 'native';
}

/** One recording bundle's folder in the dialog's preview of a .zip. */
export interface ExportEntryFolder {
  folder: string;
  hasAudio: boolean;
  files: ExportEntryFile[];
}

/** One option of a format, shown under it once the format is ticked. */
interface FormatOption {
  /** The converter option it sets. */
  key: string;
  /** A checkbox's label; absent for a choice between values. */
  label?: string;
  /** A choice between values (radio buttons). */
  choices?: { value: string; label: string }[];
  /** An example of the output, shown under the label. */
  example?: string;
  /** Only meaningful when a recording has more than one tier. */
  multiTierOnly?: boolean;
}

const SPEAKER_ID: FormatOption = {
  key: 'addSpeakerId',
  label: 'export.options.mark speaker id',
};
const GROUP_BY_TIER: FormatOption = {
  key: 'groupByTier',
  label: 'export.options.group by tier',
  multiTierOnly: true,
};
const DOCUMENT_OPTIONS: FormatOption[] = [
  {
    key: 'mode',
    choices: [
      { value: 'separate', label: 'export.options.separate lines' },
      { value: 'continuous', label: 'export.options.continuous text' },
    ],
  },
  SPEAKER_ID,
  { key: 'addTimestamps', label: 'export.options.sentence timestamps' },
  GROUP_BY_TIER,
];

/**
 * The one export dialog. Opened from the list, it exports the open
 * recording bundle, the ticked ones or all of them; opened from the navbar
 * (online, demo and URL modes), the transcript on screen.
 *
 * Several formats can be ticked, each with its options, and every tier is
 * exported. When that makes exactly one file it downloads as it is;
 * otherwise everything goes in a .zip, together with Tratt's own transcript
 * of each recording, so the .zip loads back into Tratt.
 */
@Component({
  selector: 'tratt-export-files-modal',
  templateUrl: './export-files-modal.component.html',
  styleUrls: ['./export-files-modal.component.scss'],
  animations: [
    fadeInExpandOnEnterAnimation(),
    fadeOutCollapseOnLeaveAnimation(),
  ],
  imports: [
    NgClass,
    NgbPopover,
    NgbTooltip,
    FormsModule,
    TableConfiguratorComponent,
    TranslocoPipe,
  ],
})
export class ExportFilesModalComponent
  extends TrattModal
  implements OnInit, OnDestroy
{
  public static options: NgbModalOptions = {
    size: 'xl',
    keyboard: true,
    backdrop: true,
    scrollable: true,
  };

  /** Ticked when the dialog first opens: a document to read. */
  static readonly DEFAULT_FORMATS: readonly string[] = ['DOCX'];
  /** The formats last exported, ticked again the next time. */
  private static lastFormats?: Set<string>;

  static readonly FORMAT_OPTIONS: Record<string, FormatOption[]> = {
    DOCX: DOCUMENT_OPTIONS,
    ODT: DOCUMENT_OPTIONS,
    PlainText: [
      SPEAKER_ID,
      { key: 'addNewLineString', label: 'export.options.add newline' },
      {
        key: 'showTimestampString',
        label: 'export.options.add timestamps',
        example: 'This is an example <ts="00:00:03.222"> of a transcript.',
      },
      {
        key: 'showTimestampSamples',
        label: 'export.options.add samplepoints',
        example: 'This is an example <sp="379736"> of a transcript.',
      },
      GROUP_BY_TIER,
    ],
    SRT: [SPEAKER_ID],
    TextGrid: [SPEAKER_ID],
    PraatTextTable: [SPEAKER_ID],
    CTM: [SPEAKER_ID],
    BASPartitur: [SPEAKER_ID],
  };

  readonly NATIVE_FORMAT = NATIVE_FORMAT;

  // ── Set by the opener (TrattModalService.applyData) ──────────────────────

  /**
   * Every recording bundle in the list, in list order. Unset when opened
   * from the navbar: the dialog then exports the transcript on screen.
   */
  set bundles(value: ExportBundle[] | undefined) {
    this._bundles.set(value);
  }
  get bundles(): ExportBundle[] | undefined {
    return this._bundles();
  }
  /** The bundles ticked in the list. */
  set tickedIds(value: string[]) {
    this._tickedIds.set(value);
  }
  get tickedIds(): string[] {
    return this._tickedIds();
  }
  /** The bundle open in the editor. */
  set openBundleId(value: string | undefined) {
    this._openBundleId.set(value);
  }
  get openBundleId(): string | undefined {
    return this._openBundleId();
  }
  /**
   * Media to export the on-screen transcript against when it has no
   * current audio. Unset: the current audio.
   */
  media?: ResolvedMedia;
  navbarService?: NavbarService;
  uiService: UserInteractionsService = inject(UserInteractionsService);

  private readonly _bundles = signal<ExportBundle[] | undefined>(undefined);
  private readonly _tickedIds = signal<string[]>([]);
  private readonly _openBundleId = signal<string | undefined>(undefined);

  // ── Formats ──────────────────────────────────────────────────────────────

  readonly categoryOrder: ExportCategory[] = [
    'general',
    'linguistic',
    'specialist',
  ];
  readonly formatsByCategory: Map<ExportCategory, Converter[]>;

  readonly checkedFormats = signal<Set<string>>(
    new Set(
      ExportFilesModalComponent.lastFormats ??
        ExportFilesModalComponent.DEFAULT_FORMATS,
    ),
  );

  isChecked(name: string): boolean {
    return this.effectiveFormats().has(name);
  }

  /** Ticked formats; in list mode Tratt's own is always among them. */
  private readonly effectiveFormats = computed(() => {
    const checked = this.checkedFormats();
    return this.listMode() ? new Set([...checked, NATIVE_FORMAT]) : checked;
  });

  toggleFormat(name: string): void {
    if (name === NATIVE_FORMAT && this.listMode()) {
      return;
    }
    const next = new Set(this.checkedFormats());
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this.checkedFormats.set(next);
  }

  optionsOf(converter: Converter): FormatOption[] {
    return (
      ExportFilesModalComponent.FORMAT_OPTIONS[converter.name] ?? []
    ).filter((o) => !o.multiTierOnly || this.hasSeveralTiers());
  }

  // ── Scope ────────────────────────────────────────────────────────────────

  /** Opened from the list (rather than for the transcript on screen). */
  readonly listMode = computed(() => this._bundles() !== undefined);

  private readonly openBundle = computed(() =>
    this._bundles()?.find((b) => b.bundleId === this._openBundleId()),
  );
  private readonly tickedBundles = computed(() => {
    const ticked = new Set(this._tickedIds());
    return (this._bundles() ?? []).filter((b) => ticked.has(b.bundleId));
  });

  /** The scopes on offer; the choice is only shown with more than one. */
  readonly scopes = computed(() => {
    const all = this._bundles() ?? [];
    const scopes: { scope: ExportScope; count: number }[] = [];
    if (this.openBundle()) {
      scopes.push({ scope: 'open', count: 1 });
    }
    if (this.tickedBundles().length > 0) {
      scopes.push({ scope: 'ticked', count: this.tickedBundles().length });
    }
    if (all.length > 1) {
      scopes.push({ scope: 'all', count: all.length });
    }
    return scopes;
  });

  private readonly chosenScope = signal<ExportScope | undefined>(undefined);

  /** The ticked bundles if there are any, else the open one, else all. */
  readonly scope = computed<ExportScope>(() => {
    const offered = this.scopes().map((s) => s.scope);
    const chosen = this.chosenScope();
    if (chosen && offered.includes(chosen)) {
      return chosen;
    }
    return (
      (['ticked', 'open', 'all'] as const).find((s) => offered.includes(s)) ??
      'all'
    );
  });

  setScope(scope: ExportScope): void {
    this.chosenScope.set(scope);
  }

  /** The name of the bundle open in the editor, for the scope's label. */
  readonly openBundleName = computed(() => this.openBundle()?.name ?? '');

  /** The recordings the export covers, in list order. */
  readonly scopedBundles = computed<ExportBundle[]>(() => {
    const bundles = this._bundles();
    if (bundles === undefined) {
      return [this.onScreenRecording()];
    }
    switch (this.scope()) {
      case 'open':
        return this.openBundle() ? [this.openBundle()!] : [];
      case 'ticked':
        return this.tickedBundles();
      default:
        return bundles;
    }
  });

  /** The transcript on screen, described like a list entry. */
  private onScreenRecording(): ExportBundle {
    return {
      bundleId: '',
      name: this.audioFileName ?? 'transcript',
      hasAudio: false,
      hasTranscript: true,
      levels: (this.annotationStoreService.transcript?.levels ?? []).map(
        (l) => ({ name: l.name, segment: l.type === 'SEGMENT' }),
      ),
    };
  }

  /**
   * Some recording in scope has a transcript. Without one there is nothing
   * to write in any format, so the formats are not offered at all.
   */
  readonly hasAnyTranscript = computed(() =>
    this.scopedBundles().some((b) => b.hasTranscript),
  );

  /** Some recording in scope has more than one tier. */
  readonly hasSeveralTiers = computed(() =>
    this.scopedBundles().some(
      (b) => b.levels.filter((l) => l.segment).length > 1,
    ),
  );

  // ── Audio ────────────────────────────────────────────────────────────────

  /** Some recording in scope has its audio attached, so it can go along. */
  readonly audioAvailable = computed(() =>
    this.scopedBundles().some((b) => b.hasAudio),
  );

  private readonly chosenAudio = signal<boolean | undefined>(undefined);

  /** Until the user decides: yes, when there is audio to include. */
  readonly includeAudio = computed(
    () => this.audioAvailable() && (this.chosenAudio() ?? true),
  );

  setIncludeAudio(value: boolean): void {
    this.chosenAudio.set(value);
  }

  /** Recordings in scope with a transcript but no audio attached. */
  readonly withoutAudio = computed(() =>
    this.includeAudio()
      ? this.scopedBundles().filter((b) => b.hasTranscript && !b.hasAudio)
          .length
      : 0,
  );

  // ── Preview ──────────────────────────────────────────────────────────────

  /**
   * What the export will produce for the current choices, named as
   * CatalogueExportService writes it: one file per format per recording (one
   * per tier for a single-tier format such as SRT), and the audio if asked
   * for. Exactly one such file downloads as it is; more make a .zip with a
   * folder per recording, Tratt's own transcript in each, and the manifests.
   */
  readonly contents = computed(() => {
    const checked = this.effectiveFormats();
    const formats = this.exportableConverters.filter((c) =>
      checked.has(c.name),
    );
    const withAudio = this.includeAudio();
    const used = new Set<string>();
    const folders: ExportEntryFolder[] = [];
    const leftOut: string[] = [];
    const audioOnly: string[] = [];
    let chosen = 0;
    for (const bundle of this.scopedBundles()) {
      const hasAudio = withAudio && bundle.hasAudio;
      if (!bundle.hasTranscript) {
        // Its formats would be blank: it goes along for its audio alone.
        if (hasAudio) {
          chosen += 1;
          audioOnly.push(bundle.name);
          folders.push({
            folder: archiveFolderName(bundle.name, used),
            hasAudio,
            files: [{ name: bundle.name, kind: 'audio' }],
          });
        } else {
          leftOut.push(bundle.name);
        }
        continue;
      }
      const base = audioBasename(bundle.name);
      const files: ExportEntryFile[] = [];
      const segments = bundle.levels.filter((l) => l.segment);
      for (const format of formats) {
        const ext = format.extensions[0] ?? '';
        if (format.name === NATIVE_FORMAT && this.listMode()) {
          files.push({ name: base + '_annot.json', kind: 'native' });
        } else if (
          format.multitiers ||
          format.multiTierExport ||
          segments.length <= 1
        ) {
          files.push({ name: base + ext, kind: 'transcript' });
        } else {
          for (const tier of segments) {
            const suffix = bundle.levels.length > 1 ? `-${tier.name}` : '';
            files.push({ name: base + suffix + ext, kind: 'transcript' });
          }
        }
      }
      if (hasAudio) {
        files.unshift({ name: bundle.name, kind: 'audio' });
      }
      chosen += files.length;
      folders.push({
        folder: archiveFolderName(bundle.name, used),
        hasAudio,
        files,
      });
    }
    const single =
      chosen === 1 ? folders.flatMap((f) => f.files)[0] : undefined;
    return {
      /** Nothing to export: no format, or no recording with a transcript. */
      empty: chosen === 0,
      /** No recording in scope has a transcript, but there is audio to tick. */
      onlyAudio:
        chosen === 0 &&
        this.audioAvailable() &&
        this.scopedBundles().every((b) => !b.hasTranscript),
      /** The one file that downloads as it is, when there is just one. */
      single,
      archiveName: this.listMode()
        ? archiveFileName(folders.length)
        : archiveFileName(1),
      folders,
      leftOut,
      /**
       * Recordings exported for their audio alone because they have no
       * transcript yet; worth saying when formats are ticked, which they
       * then do not get.
       */
      // Only beside the formats panel, which is hidden when nothing in
      // scope has a transcript (see hasAnyTranscript).
      audioOnly: formats.length > 0 && this.hasAnyTranscript() ? audioOnly : [],
    };
  });

  // ── Exporting ────────────────────────────────────────────────────────────

  readonly exportableConverters = AppInfo.converters.filter(
    (c) => c.conversion.export,
  );

  progress = signal<{ completed: number; total: number } | null>(null);
  warnings = signal<string[]>([]);
  errorMessage = signal<string | null>(null);
  exportDone = signal(false);
  isExporting = signal(false);
  private downloadUrl?: string;
  private progressAlert?: Promise<{ id: number }>;
  private exportSubscription?: Subscription;

  // ── More (the transcript on screen only) ─────────────────────────────────

  /**
   * The table configurator and the interaction log work on the transcript
   * in the editor, so they are offered only when that is what is exported.
   */
  readonly showMore = computed(
    () =>
      !!this.annotationStoreService.transcript &&
      this.hasAnyTranscript() &&
      (!this.listMode() || this.scope() === 'open'),
  );
  public tools = {
    tableConfigurator: {
      opened: false,
      columns: [],
    },
  };
  @ViewChild('tableConfigurator', { static: false })
  tableConfigurator?: TableConfiguratorComponent;
  public protocol: { download: string; uri?: SafeUrl } | null = null;

  /** The exported recording's file name, for the dialog title. */
  get audioFileName(): string | undefined {
    return (
      this.media?.oAudioFile.name ??
      this.audio.current?.resource?.info?.fullname
    );
  }

  private readonly exportService = inject(CatalogueExportService);
  private readonly alertService = inject(AlertService);
  private readonly transloco = inject(TranslocoService);

  constructor(
    private sanitizer: DomSanitizer,
    private audio: AudioService,
    public annotationStoreService: AnnotationStoreService,
    private appStorage: AppStorageService,
    protected override activeModal: NgbActiveModal,
    public recordedFileService: RecordedFileService,
  ) {
    super('ExportFilesModalComponent', activeModal);
    const map = new Map<ExportCategory, Converter[]>();
    for (const cat of this.categoryOrder) map.set(cat, []);
    for (const c of this.exportableConverters) {
      map.get(c.category)?.push(c);
    }
    this.formatsByCategory = map;
  }

  ngOnInit() {
    this.logEvent('opened');
    const uiLanguage = this.appStorage.language ?? 'en';
    for (const converter of AppInfo.converters) {
      if (converter.options && 'uiLanguage' in converter.options) {
        converter.options.uiLanguage = uiLanguage;
      }
    }
  }

  private logEvent(value: 'opened' | 'closed'): void {
    this.uiService?.addElementFromEvent(
      'export',
      { value },
      Date.now(),
      this.audio.current?.playPosition,
      undefined,
      undefined,
      undefined,
      'modals',
    );
  }

  /** Disabled: nothing chosen, or an export is already running. */
  get canExport(): boolean {
    return !this.isExporting() && !this.contents().empty;
  }

  onExport(): void {
    if (!this.canExport) {
      return;
    }
    const names = this.exportableConverters
      .map((c) => c.name)
      .filter((n) => this.effectiveFormats().has(n));
    ExportFilesModalComponent.lastFormats = new Set(
      names.filter((n) => !this.listMode() || n !== NATIVE_FORMAT),
    );
    if (this.listMode()) {
      this.exportBundles(names);
    } else {
      this.exportOnScreen(names);
    }
  }

  /** The transcript on screen: converted at once, no audio. */
  private exportOnScreen(names: string[]): void {
    const media = this.resolveOnScreenMedia();
    const transcript = this.annotationStoreService.transcript;
    if (!media || !transcript) {
      this.errorMessage.set('There is no transcript to export.');
      return;
    }
    const annot = transcript.serialize(
      media.oAudioFile.name,
      media.sampleRate,
      media.duration,
    );
    const { download, warnings } = this.exportService.exportTranscript(
      annot,
      media.oAudioFile,
      names,
      this.annotationStoreService.breakMarker?.code ?? '<P>',
    );
    if (download) {
      this.save(download);
      this.close();
    }
    this.warnings.set(warnings);
    if (warnings.length > 0) {
      void this.alertService.showAlert('warning', warnings.join('\n'));
    }
  }

  private resolveOnScreenMedia(): ResolvedMedia | undefined {
    if (this.media) {
      return this.media;
    }
    const manager = this.audio.current;
    return manager
      ? {
          oAudioFile: manager.resource.getOAudioFile(),
          sampleRate: manager.sampleRate,
          duration: manager.resource.info.duration,
        }
      : undefined;
  }

  /** Bundles from the list: run in the background, the dialog closes. */
  private exportBundles(names: string[]): void {
    const bundleIds = this.scopedBundles()
      .filter((b) => b.hasTranscript || (this.includeAudio() && b.hasAudio))
      .map((b) => b.bundleId);
    this.warnings.set([]);
    this.errorMessage.set(null);
    this.exportDone.set(false);
    this.isExporting.set(true);
    // Stays up (10 min cap) until the export settles; see closeProgressAlert().
    this.progressAlert = this.alertService.showAlert(
      'info',
      this.transloco.translate('workbench.export.started', {
        count: bundleIds.length,
      }),
      true,
      600_000,
    );
    this.exportSubscription = this.exportService
      .exportBundles(bundleIds, names, { includeAudio: this.includeAudio() })
      .subscribe({
        next: (event) => {
          this.progress.set({
            completed: event.completedBundles,
            total: event.totalBundles,
          });
          this.warnings.set(event.warnings);
          if (event.completedBundles < event.totalBundles) {
            return;
          }
          this.closeProgressAlert();
          this.exportDone.set(true);
          if (event.download) {
            this.save(event.download);
          }
          if (event.warnings.length > 0) {
            void this.alertService.showAlert(
              'warning',
              event.warnings.join('\n'),
            );
          }
        },
        error: (error: unknown) => {
          this.closeProgressAlert();
          this.isExporting.set(false);
          this.progress.set(null);
          const message =
            error instanceof Error ? error.message : String(error);
          this.errorMessage.set(message);
          // The dialog is already closed, so say so in an alert.
          void this.alertService.showAlert(
            'danger',
            this.transloco.translate('workbench.export.failed', { message }),
          );
        },
        complete: () => {
          this.isExporting.set(false);
        },
      });
    // Closing is the "export is on its way" signal. The subscription
    // deliberately outlives the dialog; the download starts from the
    // callback above when the files are ready.
    this.activeModal.close();
  }

  /** Hands the browser one file, or the .zip, to save. */
  private save(download: ExportDownload): void {
    if (this.downloadUrl) {
      URL.revokeObjectURL(this.downloadUrl);
    }
    const blob = new Blob([download.bytes as BlobPart], {
      type: download.type,
    });
    this.downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = this.downloadUrl;
    a.download = download.name;
    a.click();
  }

  private closeProgressAlert(): void {
    void this.progressAlert?.then(({ id }) => this.alertService.closeAlert(id));
    this.progressAlert = undefined;
  }

  /** The interaction log ("protocol") as a .json file. */
  getProtocol(): void {
    const download =
      (this.audioFileName ?? 'transcript').replace(/\.[^.]+$/, '') + '.json';
    if (this.protocol?.uri) {
      URL.revokeObjectURL(this.protocol.uri.toString());
    }
    const json = new File(
      [
        JSON.stringify(
          this.annotationStoreService.extractUI(this.uiService.elements),
          undefined,
          2,
        ),
      ],
      download,
    );
    this.protocol = {
      download,
      uri: this.sanitizer.bypassSecurityTrustUrl(URL.createObjectURL(json)),
    };
  }

  public override close() {
    this.logEvent('closed');
    // A running export outlives the dialog on purpose (see exportBundles).
    if (!this.isExporting()) {
      this.exportSubscription?.unsubscribe();
    }
    return super.close();
  }

  override ngOnDestroy(): void {
    if (!this.isExporting()) {
      this.exportSubscription?.unsubscribe();
    }
    const url = this.downloadUrl;
    if (url) {
      // Give the browser time to start the download before the blob goes.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    if (this.protocol?.uri) {
      URL.revokeObjectURL(this.protocol.uri.toString());
    }
    super.ngOnDestroy();
  }
}

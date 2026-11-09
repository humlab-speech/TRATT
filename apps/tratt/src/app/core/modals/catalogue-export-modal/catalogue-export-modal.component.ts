import { Component, computed, Input, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { Subscription } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { audioBasename } from '../../component/tratt-dropzone/transcript-pairing';
import { AlertService } from '../../shared/service/alert.service';
import {
  archiveFileName,
  archiveFolderName,
  CatalogueExportService,
} from '../../shared/service/catalogue-export.service';

/** What the dialog needs to know about each recording bundle it saves. */
export interface CatalogueExportBundle {
  bundleId: string;
  name: string;
  /** Its audio is attached, so the archive carries it. */
  hasAudio: boolean;
  /** It has a transcript; one without is left out of the archive. */
  hasTranscript: boolean;
}

/** One file in the dialog's preview of the archive. */
export interface ArchiveEntryFile {
  name: string;
  kind: 'audio' | 'transcript' | 'native';
}

/** One recording bundle's folder in the dialog's preview of the archive. */
export interface ArchiveEntryFolder {
  folder: string;
  hasAudio: boolean;
  files: ArchiveEntryFile[];
}

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

  /** The recording bundles to save, in list order. */
  @Input() set bundles(value: CatalogueExportBundle[]) {
    this._bundles.set(value);
  }
  get bundles(): CatalogueExportBundle[] {
    return this._bundles();
  }
  private readonly _bundles = signal<CatalogueExportBundle[]>([]);

  get bundleIds(): string[] {
    return this.bundles.map((b) => b.bundleId);
  }
  // Final whole-branch review fix: lets the template surface the
  // "no selection = all N" fallback explicitly (workbench.catalogue_export.
  // all_bundles_hint) — by the time the modal opens, `bundleIds` is already
  // resolved to "all ids", so the modal has no other way to tell that case
  // apart from "the user genuinely checked every bundle".
  @Input() wasAllBundlesDefault = false;
  /** Recording bundles with a transcript but no audio attached: saved
   * without audio. */
  readonly withoutAudio = computed(
    () => this._bundles().filter((b) => b.hasTranscript && !b.hasAudio).length,
  );

  /** Tratt's own format. Always saved (see CatalogueExportService), so it is
   * shown as included rather than offered as a checkbox — ticking it would
   * only write the same file twice. */
  static readonly NATIVE_FORMAT = 'AnnotJSON';
  readonly nativeExtension =
    AppInfo.converters.find(
      (c) => c.name === CatalogueExportModalComponent.NATIVE_FORMAT,
    )?.extensions[0] ?? '_annot.json';

  readonly exportableConverters = AppInfo.converters.filter(
    (c) =>
      c.conversion.export &&
      c.name !== CatalogueExportModalComponent.NATIVE_FORMAT,
  );
  /** Ticked when the dialog opens: a document to read, subtitles, and
   * ELAN, which keeps everything — every level (transcript, translations)
   * as a tier, with speakers in dependent tiers. */
  static readonly DEFAULT_FORMATS: readonly string[] = ['DOCX', 'SRT', 'ELAN'];
  /** Formats that carry timestamps. At least one must be ticked: a
   * non-time-aligned archive (DOCX, ODT, text) cannot be re-imported or
   * checked against the audio. */
  static readonly TIME_ALIGNED_FORMATS: readonly string[] = [
    'SRT',
    'ELAN',
    'WebVTT',
    'TextGrid',
    'PraatTextTable',
    'BASPartitur',
    'CTM',
    'AnnotJSON',
  ];
  checkedConverters = signal<Set<string>>(
    new Set(CatalogueExportModalComponent.DEFAULT_FORMATS),
  );

  /**
   * A preview of the archive for the current choices, built with the same
   * folder and file names CatalogueExportService writes: one folder per
   * recording bundle that has a transcript, holding its audio (if attached),
   * one file per ticked format and Tratt's own transcript file.
   *
   * Single-tier formats (SRT, DOCX, ...) write one file per tier, so a
   * translated recording bundle gets e.g. two .srt files; the preview shows
   * one per format, which is what the user chooses between.
   */
  readonly contents = computed(() => {
    const checked = this.checkedConverters();
    const formats = this.exportableConverters.filter((c) =>
      checked.has(c.name),
    );
    const used = new Set<string>();
    const folders: ArchiveEntryFolder[] = [];
    const leftOut: string[] = [];
    for (const bundle of this._bundles()) {
      if (!bundle.hasTranscript) {
        leftOut.push(bundle.name);
        continue;
      }
      const base = audioBasename(bundle.name);
      const files: ArchiveEntryFile[] = [];
      if (bundle.hasAudio) {
        files.push({ name: bundle.name, kind: 'audio' });
      }
      for (const format of formats) {
        files.push({
          name: base + (format.extensions[0] ?? ''),
          kind: 'transcript',
        });
      }
      files.push({ name: base + this.nativeExtension, kind: 'native' });
      folders.push({
        folder: archiveFolderName(bundle.name, used),
        hasAudio: bundle.hasAudio,
        files,
      });
    }
    return {
      archiveName: archiveFileName(folders.length),
      folders,
      leftOut,
      withAudio: folders.filter((f) => f.hasAudio).length,
      transcriptOnly: folders.filter((f) => !f.hasAudio).length,
    };
  });

  progress = signal<{ completed: number; total: number } | null>(null);
  warnings = signal<string[]>([]);
  downloadUrl = signal<string | null>(null);
  errorMessage = signal<string | null>(null);
  // Final whole-branch review fix: distinguishes "final, archive-bearing
  // emission received" from "still running" so the template can show the
  // unambiguous workbench.catalogue_export.done message instead of leaving
  // the last progress line on screen.
  exportDone = signal(false);
  // Final whole-branch review fix: guards against a second concurrent
  // export (also enforced by disabling the Export button in the template
  // while true) and gates the in-flight state the template needs.
  isExporting = signal(false);

  private progressAlert?: Promise<{ id: number }>;
  private exportSubscription?: Subscription;

  constructor(
    private exportService: CatalogueExportService,
    private activeModal: NgbActiveModal,
    private alertService: AlertService,
    private transloco: TranslocoService,
  ) {}

  hasTimeAligned(): boolean {
    return CatalogueExportModalComponent.TIME_ALIGNED_FORMATS.some((n) =>
      this.checkedConverters().has(n),
    );
  }

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
    if (
      this.isExporting() ||
      !this.hasTimeAligned() ||
      this.contents().folders.length === 0
    ) {
      return;
    }
    const names = [...this.checkedConverters()];
    this.warnings.set([]);
    this.errorMessage.set(null);
    this.exportDone.set(false);
    this.isExporting.set(true);
    // Stays up (10 min cap) until the export settles; see closeProgressAlert().
    this.progressAlert = this.alertService.showAlert(
      'info',
      this.transloco.translate('workbench.catalogue_export.started', {
        count: this.bundleIds.length,
      }),
      true,
      600_000,
    );
    this.exportSubscription = this.exportService
      .exportBundles(this.bundleIds, names)
      .subscribe({
        next: (event) => {
          this.progress.set({
            completed: event.completedBundles,
            total: event.totalBundles,
          });
          this.warnings.set(event.warnings);
          if (event.archive) {
            this.closeProgressAlert();
            this.exportDone.set(true);
            // Revoke any prior object URL before replacing it — covers a
            // second export running within the same modal instance.
            const previousUrl = this.downloadUrl();
            if (previousUrl) {
              URL.revokeObjectURL(previousUrl);
            }
            const blob = new Blob([event.archive as BlobPart], {
              type: 'application/zip',
            });
            const url = URL.createObjectURL(blob);
            this.downloadUrl.set(url);
            const a = document.createElement('a');
            a.href = url;
            a.download = archiveFileName(event.exportedCount ?? 0);
            a.click();
            if (event.warnings.length > 0) {
              void this.alertService.showAlert(
                'warning',
                event.warnings.join('\n'),
              );
            }
          }
        },
        error: (error: unknown) => {
          // Previously swallowed: the modal then sat on "Exporting 1 of N…"
          // forever with no hint that anything had gone wrong.
          this.closeProgressAlert();
          this.isExporting.set(false);
          this.progress.set(null);
          const message =
            error instanceof Error ? error.message : String(error);
          this.errorMessage.set(message);
          // The modal is already closed, so surface the failure as an alert.
          void this.alertService.showAlert(
            'danger',
            this.transloco.translate('workbench.catalogue_export.failed', {
              message,
            }),
          );
        },
        complete: () => {
          this.isExporting.set(false);
        },
      });
    // Dismiss the dialog right away: closing is the "export is on its way"
    // signal. The subscription deliberately outlives the modal; the download
    // starts from the callback above when the archive is ready.
    this.activeModal.close();
  }

  private closeProgressAlert(): void {
    void this.progressAlert?.then(({ id }) => this.alertService.closeAlert(id));
    this.progressAlert = undefined;
  }

  close(): void {
    // Final whole-branch review fix: Cancel used to leave a running export
    // subscribed in the background, still writing to signals on a
    // (soon-to-be) destroyed component, and could create-then-never-revoke
    // an object URL if it completed after ngOnDestroy() had already run.
    if (!this.isExporting()) {
      this.exportSubscription?.unsubscribe();
    }
    this.activeModal.close();
  }

  ngOnDestroy(): void {
    // Covers Esc/backdrop dismiss, which may not go through close().
    if (!this.isExporting()) {
      this.exportSubscription?.unsubscribe();
    }
    const url = this.downloadUrl();
    if (url) {
      // Give the browser time to start the download before the blob goes.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}

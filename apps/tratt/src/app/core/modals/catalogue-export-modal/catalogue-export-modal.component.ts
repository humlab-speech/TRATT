import { Component, Input, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { Subscription } from 'rxjs';
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
  // Final whole-branch review fix: lets the template surface the
  // "no selection = all N" fallback explicitly (workbench.catalogue_export.
  // all_bundles_hint) — by the time the modal opens, `bundleIds` is already
  // resolved to "all ids", so the modal has no other way to tell that case
  // apart from "the user genuinely checked every bundle".
  @Input() wasAllBundlesDefault = false;

  readonly exportableConverters = AppInfo.converters.filter(
    (c) => c.conversion.export,
  );
  checkedConverters = signal<Set<string>>(new Set(['AnnotJSON']));

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

  private exportSubscription?: Subscription;

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
    if (this.isExporting()) {
      return;
    }
    const names = [...this.checkedConverters()];
    this.warnings.set([]);
    this.errorMessage.set(null);
    this.exportDone.set(false);
    this.isExporting.set(true);
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
            this.exportDone.set(true);
            // Revoke any prior object URL before replacing it — covers a
            // second export running within the same modal instance.
            const previousUrl = this.downloadUrl();
            if (previousUrl) {
              URL.revokeObjectURL(previousUrl);
            }
            const blob = new Blob([event.archive], {
              type: 'application/zip',
            });
            const url = URL.createObjectURL(blob);
            this.downloadUrl.set(url);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'catalogue-export.zip';
            a.click();
          }
        },
        error: (error: unknown) => {
          // Previously swallowed: the modal then sat on "Exporting 1 of N…"
          // forever with no hint that anything had gone wrong.
          this.isExporting.set(false);
          this.progress.set(null);
          this.errorMessage.set(
            error instanceof Error ? error.message : String(error),
          );
        },
        complete: () => {
          this.isExporting.set(false);
        },
      });
  }

  close(): void {
    // Final whole-branch review fix: Cancel used to leave a running export
    // subscribed in the background, still writing to signals on a
    // (soon-to-be) destroyed component, and could create-then-never-revoke
    // an object URL if it completed after ngOnDestroy() had already run.
    this.exportSubscription?.unsubscribe();
    this.activeModal.close();
  }

  ngOnDestroy(): void {
    // Covers Esc/backdrop dismiss, which may not go through close().
    this.exportSubscription?.unsubscribe();
    const url = this.downloadUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}

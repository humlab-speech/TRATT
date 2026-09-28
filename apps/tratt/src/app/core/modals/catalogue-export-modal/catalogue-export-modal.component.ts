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

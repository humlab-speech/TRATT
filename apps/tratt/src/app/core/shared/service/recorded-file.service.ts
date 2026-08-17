import { Injectable } from '@angular/core';
import { OctraModalService } from '../../modals/octra-modal.service';
import { UnsavedRecordingModalComponent } from '../../modals/unsaved-recording-modal/unsaved-recording-modal.component';

@Injectable({ providedIn: 'root' })
export class RecordedFileService {
  private _recordedFile: File | null = null;
  exported = false;

  get recordedFile(): File | null {
    return this._recordedFile;
  }

  set recordedFile(f: File | null) {
    this._recordedFile = f;
    this.exported = false;
  }

  triggerExport(): void {
    if (!this._recordedFile) return;
    const url = URL.createObjectURL(this._recordedFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._recordedFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.exported = true;
  }

  async checkUnsaved(modalService: OctraModalService): Promise<boolean> {
    if (!this._recordedFile || this.exported) return true;
    let answer: string;
    try {
      answer = await modalService.openModal<
        typeof UnsavedRecordingModalComponent,
        string
      >(UnsavedRecordingModalComponent, UnsavedRecordingModalComponent.options);
    } catch {
      return false;
    }
    if (answer === 'export') {
      this.triggerExport();
      return true;
    }
    return answer === 'leave';
  }

  clear(): void {
    this._recordedFile = null;
    this.exported = false;
  }
}

import { NgStyle } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { SessionFile } from '../../obj/SessionFile';

/** Browsers report a zip as application/zip, application/x-zip-compressed, or nothing at all. */
export function isZipFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /zip/i.test(file.type) || /\.zip$/i.test(file.name);
}

@Component({
  selector: 'tratt-drop-zone',
  templateUrl: './drop-zone.component.html',
  styleUrls: ['./drop-zone.component.scss'],
  imports: [NgStyle],
})
export class DropZoneComponent implements OnInit {
  @Input()
  innerhtml = '';
  @Input() height = 'auto';
  /** Hides the decorative folder icon once the consumer has real content to
   * show (a file list) — it previously stayed absolutely centered over
   * `<ng-content>` regardless, overlapping whatever text/table was
   * projected in. Defaults to true so existing bare usages are unchanged. */
  @Input() showIcon = true;
  /** Lets `.zip` files through (they are filtered out by default). */
  @Input() allowZip = false;
  @Output() public afterdrop: EventEmitter<File[]> = new EventEmitter<File[]>();
  @ViewChild('fileinput', { static: true }) fileinput!: ElementRef;
  private fileAPIsupported = false;

  private _files?: File[];

  get files(): File[] | undefined {
    return this._files;
  }

  private _sessionfile?: SessionFile;

  get sessionfile(): SessionFile | undefined {
    return this._sessionfile;
  }

  ngOnInit() {
    // Check for the various File API support.
    if (window.File && window.FileReader && window.FileList && window.Blob) {
      this.fileAPIsupported = true;
    }
  }

  onDragOver($event: DragEvent) {
    $event.stopPropagation();
    $event.preventDefault();
    $event.dataTransfer!.dropEffect = 'copy';
  }

  onFileDrop($event: DragEvent) {
    $event.stopPropagation();
    $event.preventDefault();

    if (this.fileAPIsupported) {
      this._files = this.filterFiles($event.dataTransfer!.files);
      this.afterdrop.emit(Array.from(this._files));
    }
  }

  onClick() {
    this.fileinput.nativeElement.click();
  }

  onFileChange($event: any) {
    this._files = this.filterFiles($event.target.files);
    // Reset the input so choosing the same file again (e.g. after removing
    // it from the list) fires `change` again instead of being a silent no-op.
    // filterFiles() has already copied the FileList into an array.
    $event.target.value = '';
    this.afterdrop.emit(this._files);
  }

  private filterFiles(files: FileList): File[] {
    return Array.from(files).filter((a) => this.allowZip || !isZipFile(a));
  }
}

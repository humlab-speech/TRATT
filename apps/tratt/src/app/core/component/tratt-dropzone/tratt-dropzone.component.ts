import { NgStyle } from '@angular/common';
import { Component, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbPopover } from '@ng-bootstrap/ng-bootstrap';
import { OAnnotJSON } from '@tratt/annotation';
import { OAudiofile } from '@tratt/media';
import { TrattUtilitiesModule } from '@tratt/ngx-utilities';
import { endonymToLanguageCode, FileSize, getFileSize } from '@tratt/utilities';
import { AudioManager } from '@tratt/web-media';
import { AppInfo } from '../../../app.info';
import { SupportedFilesModalComponent } from '../../modals/supportedfiles-modal/supportedfiles-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { FileProgress } from '../../obj/objects';
import { SpeakerTurn } from '../../shared/service/local-diarization.service';
import { TranscriptionOptions } from '../../shared/service/local-transcription.service';
import { TranslationOptions } from '../../shared/service/local-translation.service';
import { DefaultComponent } from '../default.component';
import { DropZoneComponent } from '../drop-zone';
import { DropZoneComponent as DropZoneComponent_1 } from '../drop-zone/drop-zone.component';
import { AutoTranscribeOptionsComponent } from './auto-transcribe-options.component';
import { AutoTranslateOptionsComponent } from './auto-translate-options.component';
import {
  DropzoneStatistics,
  TrattDropzoneService,
} from './tratt-dropzone.service';

@Component({
  selector: 'tratt-dropzone',
  templateUrl: './tratt-dropzone.component.html',
  styleUrls: ['./tratt-dropzone.component.scss'],
  providers: [TrattDropzoneService],
  imports: [
    DropZoneComponent_1,
    NgbPopover,
    NgStyle,
    TrattUtilitiesModule,
    TranslocoPipe,
    AutoTranscribeOptionsComponent,
    AutoTranslateOptionsComponent,
  ],
})
export class TrattDropzoneComponent
  extends DefaultComponent
  implements OnDestroy
{
  @ViewChild('dropzone', { static: true }) dropzone!: DropZoneComponent;
  @Input() height = '250px';
  @Input() showAutoTranscribe = false;
  transcribeOptions: TranscriptionOptions | null = null;
  translateOptions: TranslationOptions | null = null;
  private pendingSpeakerTurns: SpeakerTurn[] = [];

  onTranscribeOptionsChange(opts: TranscriptionOptions | null): void {
    this.transcribeOptions = opts;
  }

  onTranslateOptionsChange(opts: TranslationOptions | null): void {
    this.translateOptions = opts;
  }

  /** Best-effort: derive a BCP-47 base code from the loaded annotation's
   * first level name (which we set to the language endonym). Returns
   * undefined when no match — the translate component falls back. */
  get annotationSourceLangCode(): string | undefined {
    const name = this.trattDropzoneService.oannotation?.levels?.[0]?.name;
    return name ? endonymToLanguageCode(name) : undefined;
  }

  setAnnotationFromAnnotJson(
    annotJson: import('@tratt/annotation').OAnnotJSON,
  ): void {
    this.trattDropzoneService.setAnnotationFromAnnotJson(annotJson);
    this.applyPendingSpeakerTurns();
  }

  setSpeakerTurns(turns: SpeakerTurn[]): void {
    this.pendingSpeakerTurns = turns;
    this.applyPendingSpeakerTurns();
  }

  get hasAudio(): boolean {
    return this.trattDropzoneService.hasAudio;
  }

  get hasAnnotation(): boolean {
    return this.trattDropzoneService.hasAnnotation;
  }

  @Input() set oldFiles(
    value: {
      name: string;
      type: string;
      size: number;
    }[],
  ) {
    this.trattDropzoneService.oldFiles = value;
  }
  @Output() filesAdded = this.trattDropzoneService.filesChange;

  get AppInfo(): AppInfo {
    return AppInfo;
  }

  get files(): FileProgress[] {
    return this.trattDropzoneService.files;
  }

  get oaudiofile(): OAudiofile {
    return this.trattDropzoneService.oaudiofile;
  }

  public get audioManager(): AudioManager {
    return this.trattDropzoneService.audioManager;
  }

  public releaseAudioManager(): void {
    this.trattDropzoneService.releaseAudioManager();
  }

  public get statistics(): DropzoneStatistics {
    return this.trattDropzoneService.statistics;
  }

  get oannotation(): OAnnotJSON | undefined {
    return this.trattDropzoneService.oannotation;
  }

  constructor(
    protected trattDropzoneService: TrattDropzoneService,
    private modService: TrattModalService,
  ) {
    super();
  }

  public afterDrop = async () => {
    const files = this.dropzone.files!;
    for (const file of files) {
      this.trattDropzoneService.add(file);
    }
  };

  /** Stage a programmatically supplied file (e.g. from the recording panel). */
  public addFile(file: File): void {
    this.trattDropzoneService.add(file);
  }

  getDropzoneFileString(file: { name: string; size: number }) {
    const fsize: FileSize = getFileSize(file.size);
    return `${file.name} (${Math.round(fsize.size * 100) / 100} ${
      fsize.label
    })`;
  }

  showSupported() {
    this.modService
      .openModal(
        SupportedFilesModalComponent,
        SupportedFilesModalComponent.options,
      )
      .catch((error) => {
        console.error(error);
      });
  }

  onDeleteEntry($event: MouseEvent, fileProgressID: number) {
    if (fileProgressID) {
      $event.stopImmediatePropagation();
      $event.stopPropagation();

      this.trattDropzoneService.remove(fileProgressID);
    }
  }

  override ngOnDestroy() {
    super.ngOnDestroy();
    this.trattDropzoneService.destroy();
  }

  private applyPendingSpeakerTurns(): void {
    if (!this.hasAnnotation || this.pendingSpeakerTurns.length === 0) {
      return;
    }

    this.trattDropzoneService.applySpeakerTurnsToAnnotation(
      this.pendingSpeakerTurns,
    );
  }

  protected readonly AudioManager = AudioManager;
}

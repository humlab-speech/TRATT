import { EventEmitter, Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import {
  AnnotationLevelType,
  Converter,
  IFile,
  ImportResult,
  OAnnotJSON,
  OLabel,
  OSegment,
  OSegmentLevel,
} from '@tratt/annotation';
import { OAudiofile } from '@tratt/media';
import { escapeRegex, SubscriptionManager } from '@tratt/utilities';
import { AudioManager, FileInfo, readFile } from '@tratt/web-media';
import { exhaustMap, forkJoin, map, Observable, throwError } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { ImportOptionsModalComponent } from '../../modals/import-options-modal/import-options-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { FileProgress } from '../../obj/objects';
import {
  applySpeakerTurnsToAnnotJson,
  SpeakerTurn,
} from '../../shared/service/local-diarization.service';
import { LoginMode, RootState } from '../../store';
import { LoginModeActions } from '../../store/login-mode';

export interface DropzoneStatistics {
  new: number;
  progress: number;
  invalid: number;
  valid: number;
  waiting: number;
}

@Injectable()
export class TrattDropzoneService {
  get oannotation(): OAnnotJSON | undefined {
    return this._oannotation;
  }

  get hasAudio(): boolean {
    return !!this._oaudiofile;
  }

  get hasAnnotation(): boolean {
    return !!this._oannotation;
  }

  setAnnotationFromAnnotJson(annotJson: OAnnotJSON): void {
    this._oannotation = annotJson;
  }

  applySpeakerTurnsToAnnotation(turns: SpeakerTurn[]): void {
    if (!this._oannotation || turns.length === 0) {
      return;
    }

    this._oannotation = applySpeakerTurnsToAnnotJson(this._oannotation, turns);
  }
  get oldFiles(): {
    name: string;
    type: string;
    size: number;
  }[] {
    return this._oldFiles;
  }

  set oldFiles(
    value: {
      name: string;
      type: string;
      size: number;
    }[],
  ) {
    this._oldFiles = value;
  }
  get statistics(): DropzoneStatistics {
    return this._statistics;
  }
  get oaudiofile(): OAudiofile {
    if (!this._oaudiofile)
      throw new Error('oaudiofile accessed before initialization');
    return this._oaudiofile;
  }

  get audioManager(): AudioManager {
    if (!this._audioManager)
      throw new Error('audioManager accessed before initialization');
    return this._audioManager;
  }

  releaseAudioManager(): void {
    this._audioManager = undefined;
  }

  get files(): FileProgress[] {
    return this._files;
  }

  private _oldFiles: {
    name: string;
    type: string;
    size: number;
  }[] = [];

  private static id = 1;
  private _files: FileProgress[] = [];
  private _statistics: DropzoneStatistics = {
    new: 0,
    progress: 0,
    invalid: 0,
    valid: 0,
    waiting: 0,
  };

  private _oaudiofile?: OAudiofile;
  private _oannotation?: OAnnotJSON;
  private _subscrManager = new SubscriptionManager();
  filesChange = new EventEmitter<{
    statistics: DropzoneStatistics;
    addedFiles: FileProgress[];
  }>();

  private _audioManager?: AudioManager;

  constructor(
    private modService: TrattModalService,
    private store: Store<RootState>,
    private translocoService: TranslocoService,
  ) {}

  add(file: File) {
    const progressFile: FileProgress = {
      id: TrattDropzoneService.id++,
      status: 'progress',
      progress: 0,
      checked_converters: 0,
      file: new FileInfo(file.name, file.type, file.size, file),
    };

    const isValidaAudioFile = AudioManager.isValidAudioFileName(
      progressFile.file.fullname,
      AppInfo.audioformats,
    );

    if (isValidaAudioFile || !this.isImageOrVideoFile(progressFile.file.type)) {
      const typeToDrop = isValidaAudioFile ? 'audio' : 'transcript';
      this.dropFiles(typeToDrop);
      this._files.push(progressFile);
      this.updateStatistics();

      this._subscrManager.add(
        this.readFile(progressFile).subscribe({
          error: (error: unknown) => {
            progressFile.status = 'invalid';
            progressFile.error =
              typeof error === 'string'
                ? error
                : ((error as Error)?.message ?? String(error));
            this.updateStatistics();
          },
        }),
        `fileProgress${progressFile.id}`,
      );
    } else {
      progressFile.status = 'invalid';
      progressFile.error = this.translocoService.translate(
        'dropzone.invalid file type',
      );
      this._files.push(progressFile);
      this.updateStatistics();
    }
  }

  async remove(id: number) {
    const fileProgressIndex = this._files.findIndex((a) => a.id === id);
    if (fileProgressIndex > -1) {
      const fileProgress = this._files[fileProgressIndex];
      this._files.splice(fileProgressIndex, 1);
      this.stopFileProcessing(fileProgress);
      await this.checkForValidFiles();
    }
  }

  private readFile(fileProgress: FileProgress): Observable<void> {
    fileProgress.status = 'progress';
    this.updateStatistics();

    if (
      AudioManager.isValidAudioFileName(
        fileProgress.file.fullname,
        AppInfo.audioformats,
      )
    ) {
      // process as audio
      return this.readAudioFile(fileProgress);
    }

    // process text file
    return this.readTextFile(fileProgress);
  }

  private updateStatistics() {
    const result: DropzoneStatistics = {
      new: 0,
      progress: 0,
      invalid: 0,
      valid: 0,
      waiting: 0,
    };

    for (const file of this._files) {
      switch (file.status) {
        case 'invalid':
          result.invalid++;
          break;
        case 'valid':
          result.valid++;
          break;
        case 'progress':
          result.progress++;
          break;
        case 'waiting':
          result.waiting++;
          break;
      }

      const getBasename = (filename: string): string => {
        const m = /^(.*?)((?:_annot)?\.[^.]+)$/.exec(filename);
        return m ? m[1] : filename;
      };

      if (
        !this.oldFiles.some(
          (a) =>
            // Exact match: type + full filename + size (original behaviour)
            (a.type === file.file.type &&
              a.name === file.file.fullname &&
              a.size === file.file.size) ||
            // Basename match: same recording uploaded in a different format
            (getBasename(a.name) === file.file.name && file.file.name !== ''),
        )
      ) {
        result.new++;
      }
    }

    this._statistics = result;
    this.filesChange.emit({
      statistics: this._statistics,
      addedFiles: this._files,
    });
  }

  private readAudioFile(fileProgress: FileProgress) {
    this._oaudiofile = undefined;

    const supportedAudioFormats = [
      ...AppInfo.audioformats.map((a) => a.supportedFormats),
    ].flat();
    const formatLimitation = supportedAudioFormats.find((a) =>
      fileProgress.file.fullname.includes(a.extension),
    );

    if (
      !formatLimitation ||
      fileProgress.file.size > formatLimitation.maxFileSize
    ) {
      return throwError(() => Error('Invalid file size'));
    }

    return forkJoin([
      readFile<ArrayBuffer>(fileProgress.file.file!, 'arraybuffer').pipe(
        map((a) => {
          fileProgress.progress = a.progress * 0.5;
          return a;
        }),
      ),
    ]).pipe(
      exhaustMap(([reading]) => {
        // completed
        if (fileProgress.file.size <= AppInfo.maxAudioFileSize * 1024 * 1024) {
          return forkJoin([
            this.decodeArrayBuffer(reading.result!, fileProgress),
          ]).pipe(
            map(([result]) => {
              if (result.audioManager && result.progress === 1) {
                // Destroy previous audio manager if the user replaced the file
                if (this._audioManager !== undefined) {
                  this._audioManager.destroy();
                  this._audioManager = undefined;
                }

                this._audioManager = result.audioManager;
                this._oaudiofile = new OAudiofile();
                this._oaudiofile.name = fileProgress.file.fullname;
                this._oaudiofile.size = fileProgress.file.size;
                this._oaudiofile.duration =
                  this._audioManager.resource.info.duration.samples;
                this._oaudiofile.sampleRate = this._audioManager.sampleRate;
                this._oaudiofile.arraybuffer = reading.result;

                fileProgress.status = 'valid';
                this.checkForValidFiles();
              }
            }),
          );
        } else {
          fileProgress.status = 'invalid';
          fileProgress.error = this.translocoService.translate(
            'dropzone.file too large',
            { maxSize: AppInfo.maxAudioFileSize },
          );
          this.updateStatistics();
          return throwError(
            () =>
              new Error(
                `The file size is bigger than ${AppInfo.maxAudioFileSize} MB.`,
              ),
          );
        }
      }),
    );
  }

  private readTextFile(fileProgress: FileProgress) {
    return forkJoin([
      readFile<string>(fileProgress.file.file!, 'text', 'utf-8').pipe(
        map((a) => {
          fileProgress.progress = a.progress;
          return a;
        }),
      ),
    ]).pipe(
      map(([a]) => {
        // text file read complete
        fileProgress.progress = a.progress;
        fileProgress.status = 'waiting';
        fileProgress.content = a.result;
        this.checkForValidFiles();
      }),
    );
  }

  private stopFileProcessing(fileProgress: FileProgress) {
    this._subscrManager.removeByTag(`fileProgress${fileProgress.id}`);
    if (
      AudioManager.isValidAudioFileName(
        fileProgress.file.fullname,
        AppInfo.audioformats,
      )
    ) {
      this._oaudiofile = undefined;
      this._audioManager?.stopDecoding();
    } else {
      this._oannotation = undefined;
    }
  }

  private async checkForValidFiles() {
    for (const fileProgress of this._files) {
      if (fileProgress.status !== 'progress') {
        const isAudioFile = AudioManager.isValidAudioFileName(
          fileProgress.file.fullname,
          AppInfo.audioformats,
        );
        if (!isAudioFile && !this.isImageOrVideoFile(fileProgress.file.type)) {
          if (!this._oaudiofile) {
            fileProgress.status = 'waiting';
            this.updateStatistics();
            break;
          }
          let converter: Converter | undefined;
          // is transcript file
          for (let i = 0; i < AppInfo.converters.length; i++) {
            converter = AppInfo.converters[i];
            if (
              new RegExp(
                `${converter.extensions
                  .map((a) => `(?:${escapeRegex(a.toLowerCase())})`)
                  .join('|')}$`,
              ).exec(fileProgress.file.fullname.toLowerCase()) !== null
            ) {
              if (converter.conversion.import) {
                const ofile: IFile = {
                  name: fileProgress.file.fullname,
                  type: fileProgress.file.type,
                  content: fileProgress.content as string,
                  encoding: converter.encoding,
                };

                const optionsSchema: any = converter.needsOptionsForImport(
                  ofile,
                  this._oaudiofile!,
                );
                fileProgress.needsOptions = optionsSchema;
                fileProgress.converter = converter;

                if (optionsSchema) {
                  await this.openImportOptionsModal(fileProgress);
                }

                const importResult: ImportResult | undefined = converter.import(
                  ofile,
                  this._oaudiofile!,
                  fileProgress.options,
                );

                if (
                  importResult !== undefined &&
                  importResult.audiofile !== undefined
                ) {
                  // is bundle file
                  this.dropFiles('audio');
                  const audioProcess: FileProgress = {
                    id: TrattDropzoneService.id++,
                    status: 'progress',
                    file: fileProgress.file,
                    content: importResult?.audiofile?.arraybuffer,
                    checked_converters: 0,
                    progress: 0,
                    error: '',
                  };
                  this._files.push(audioProcess);
                  this.filesChange.emit({
                    statistics: this._statistics,
                    addedFiles: this._files,
                  });
                } else {
                  await this.setAnnotation(
                    fileProgress,
                    converter,
                    importResult,
                  );
                  if (this._oannotation) {
                    break;
                  }
                }
              }
            } else {
              converter = undefined;
            }

            if (converter?.name === 'AnnotJSON') {
              // stop because there is only one file format with ending "_annot.json"
              break;
            }
            // else not valid converter
            converter = undefined;
          }

          if (this._oaudiofile) {
            // audio was already loaded
            if (!converter) {
              // no valid converter found
              fileProgress.status = 'invalid';
              fileProgress.error = this.translocoService.translate(
                'dropzone.file format not supported',
              );
            } else if (fileProgress.status !== 'valid') {
              fileProgress.status = 'invalid';
            }
          }
        }
      }
    }
    this.updateStatistics();
  }

  private setAnnotation = async (
    fileProgress: FileProgress,
    converter: Converter,
    importResult?: ImportResult,
  ) => {
    if (
      this._oaudiofile !== undefined &&
      importResult !== undefined &&
      importResult.annotjson !== undefined &&
      !importResult.error
    ) {
      const audioName = this._oaudiofile.name.replace(/\.[^.]+$/g, '');

      const regexStr = `${escapeRegex(audioName)}${converter.extensions
        .map(
          (a) => `((?:${escapeRegex(a)})|(?:${escapeRegex(a.toLowerCase())}))`,
        )
        .join('|')}$`;
      if (new RegExp(regexStr).exec(fileProgress.file.fullname) === null) {
        fileProgress.warning = this.translocoService.translate(
          'dropzone.file names not same',
        );
      }
      for (const lvl of importResult.annotjson.levels) {
        if (lvl.type === AnnotationLevelType.SEGMENT) {
          const level = lvl as OSegmentLevel<OSegment>;

          if (level.items[0].sampleStart !== 0) {
            let temp = [];
            temp.push(
              new OSegment(0, 0, level.items[0].sampleStart!, [
                new OLabel(level.name, ''),
              ]),
            );
            temp = temp.concat(
              level.items.map(
                (a) =>
                  new OSegment(a.id, a.sampleStart!, a.sampleDur!, a.labels),
              ),
            );
            level.items = temp;

            for (let j = 1; j < level.items.length + 1; j++) {
              level.items[j - 1].id = j;
            }
          }

          const last = level.items[level.items.length - 1];
          if (
            last.sampleStart! + last.sampleDur! !==
            this._oaudiofile.duration
          ) {
            level.items.push(
              new OSegment(
                last.id + 1,
                last.sampleStart! + last.sampleDur!,
                this._oaudiofile.duration! -
                  (last.sampleStart! + last.sampleDur!),
                [new OLabel(level.name, '')],
              ),
            );
          }
        }
      }
      this._oannotation = importResult.annotjson;
      fileProgress.status = 'valid';
      this.updateStatistics();
    } else {
      if (
        fileProgress.checked_converters >= AppInfo.converters.length ||
        converter.name === 'BundleJSON' ||
        importResult?.error
      ) {
        fileProgress.status = 'invalid';
        fileProgress.error = importResult?.error;
        this._oannotation = undefined;
        this.updateStatistics();
      } else if (fileProgress.error) {
        fileProgress.status = 'invalid';
        fileProgress.error = importResult?.error;
        this._oannotation = undefined;
        this.updateStatistics();
      }
    }
  };

  private dropFiles(type: 'audio' | 'transcript') {
    this._files = this._files.filter((a) => {
      if (
        type === 'audio' &&
        AudioManager.isValidAudioFileName(a.file.fullname, AppInfo.audioformats)
      ) {
        return false;
      } else if (
        type === 'transcript' &&
        !AudioManager.isValidAudioFileName(
          a.file.fullname,
          AppInfo.audioformats,
        )
      ) {
        return false;
      }
      return true;
    });
  }

  private decodeArrayBuffer(buffer: ArrayBuffer, fileProgress: FileProgress) {
    fileProgress.progress = 0.5;

    return AudioManager.create(
      fileProgress.file.fullname,
      fileProgress.file.type,
      buffer,
    ).pipe(
      map((result) => {
        fileProgress.progress = 0.5 + 0.5 * result.progress;
        return result;
      }),
    );
  }

  async openImportOptionsModal(fileProgress: FileProgress) {
    const result = await this.modService.openModal<
      typeof ImportOptionsModalComponent,
      any
    >(ImportOptionsModalComponent, ImportOptionsModalComponent.options, {
      schema: fileProgress.needsOptions,
      value: fileProgress.options,
      converter: fileProgress.converter,
    });

    if (result.action === 'apply') {
      fileProgress.options = result.result;
    }

    const importOptions: Record<string, any> = {};
    importOptions[fileProgress.converter!.name] = fileProgress.options;

    this.store.dispatch(
      LoginModeActions.setImportConverter.do({
        mode: LoginMode.LOCAL,
        importConverter: fileProgress.converter!.name,
      }),
    );
    this.store.dispatch(
      LoginModeActions.changeImportOptions.do({
        mode: LoginMode.LOCAL,
        importOptions,
      }),
    );
  }

  destroy() {
    this._audioManager?.destroy();
    this._subscrManager.destroy();
  }

  private isImageOrVideoFile(type: string): boolean {
    return type.includes('image') || type.includes('video');
  }
}

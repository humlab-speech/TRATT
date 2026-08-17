import { AsyncPipe, DecimalPipe } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { NgForm } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import type { OAnnotJSON } from '@octra/annotation';
import { AccountLoginMethod } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { FileSize, getFileSize } from '@octra/utilities';
import { filter, firstValueFrom, Observable, Subscription, tap } from 'rxjs';
import { AuthenticationComponent } from '../../component/authentication-component/authentication-component.component';
import { DefaultComponent } from '../../component/default.component';
import { MaintenanceBannerComponent } from '../../component/maintenance/maintenance-banner/maint-banner.component';
import {
  KB_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from '../../component/octra-dropzone/auto-transcribe-options.component';
import { OctraDropzoneComponent } from '../../component/octra-dropzone/octra-dropzone.component';
import { RecordingPanelComponent } from '../../component/recording-panel/recording-panel.component';
import { AppSettings } from '../../obj';
import { SessionFile } from '../../obj/SessionFile';
import { AudioService, SettingsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { CompatibilityService } from '../../shared/service/compatibility.service';
import {
  DIARIZATION_DEFAULT_MODEL_ID,
  DiarizationEvent,
  LocalDiarizationRuntimeService,
} from '../../shared/service/local-diarization-runtime.service';
import { LOCAL_DIARIZATION_WORKER_FACTORY } from '../../shared/service/local-diarization-worker.token';
import {
  LocalTranscriptionService,
  TranscriptionEvent,
  TranscriptionOptions,
} from '../../shared/service/local-transcription.service';
import {
  LocalTranslationService,
  TranslationEvent,
} from '../../shared/service/local-translation.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { AuthenticationStoreService } from '../../store/authentication';
import { BrowserTestComponent } from '../browser-test/browser-test.component';
import { applyOptionalSpeakerSegmentation } from './local-offline-transcription.helpers';
import { ComponentCanDeactivate } from './login.deactivateguard';
import { LoginService } from './login.service';

type TranslationPhase =
  | 'idle'
  | 'downloading'
  | 'initializing'
  | 'translating'
  | 'finalizing';

const TRANSLATION_DOWNLOAD_STALL_MS = 30_000;
const TRANSLATION_INIT_STALL_MS = 60_000;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

@Component({
  selector: 'octra-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  providers: [
    LoginService,
    LocalDiarizationRuntimeService,
    {
      provide: LOCAL_DIARIZATION_WORKER_FACTORY,
      useValue: () =>
        new Worker(
          new URL('../../workers/pyannote-diarization.worker', import.meta.url),
          {
            type: 'module',
          },
        ),
    },
  ],
  imports: [
    MaintenanceBannerComponent,
    AuthenticationComponent,
    OctraDropzoneComponent,
    RecordingPanelComponent,
    BrowserTestComponent,
    NgbNavModule,
    AsyncPipe,
    DecimalPipe,
    TranslocoPipe,
  ],
})
export class LoginComponent
  extends DefaultComponent
  implements ComponentCanDeactivate
{
  @ViewChild('f', { static: false }) loginform?: NgForm;
  @ViewChild('dropzone', { static: false }) dropzone?: OctraDropzoneComponent;
  @ViewChild('agreement', { static: false }) agreement?: ElementRef;
  @ViewChild('localmode', { static: true }) localmode?: ElementRef;
  @ViewChild('onlinemode', { static: true }) onlinemode?: ElementRef;

  email_link = '';
  activeTab: 'upload' | 'record' = 'upload';

  onUseRecording(file: File): void {
    this.recordedFileService.recordedFile = file;
    this.dropzone?.addFile(file);
    this.activeTab = 'upload';
  }

  transcription: {
    active: boolean;
    phase: 'downloading' | 'transcribing' | 'diarizing' | 'finalizing' | 'idle';
    downloadLoaded: number;
    downloadTotal: number;
    downloadExpectedBytes: number;
    downloadFile: string;
    elapsedMs: number;
    audioDurationS: number;
    segmentEndS: number;
    error: string | null;
    usedWebGPU: boolean;
  } = {
    active: false,
    phase: 'idle',
    downloadLoaded: 0,
    downloadTotal: 0,
    downloadExpectedBytes: 0,
    downloadFile: '',
    elapsedMs: 0,
    audioDurationS: 0,
    segmentEndS: 0,
    error: null,
    usedWebGPU: false,
  };

  diarizationWarning: string | null = null;

  private _elapsedIntervalId: ReturnType<typeof setInterval> | null = null;
  private _transcriptionStartTime = 0;

  readonly formatDuration = formatDuration;

  private _transcriptionSub: Subscription | null = null;
  private _translationSub: Subscription | null = null;
  private _pendingRemoveData = false;

  translation: {
    active: boolean;
    phase: TranslationPhase;
    downloadLoaded: number;
    downloadTotal: number;
    downloadFile: string;
    elapsedMs: number;
    segmentIndex: number;
    segmentTotal: number;
    error: string | null;
  } = {
    active: false,
    phase: 'idle',
    downloadLoaded: 0,
    downloadTotal: 0,
    downloadFile: '',
    elapsedMs: 0,
    segmentIndex: 0,
    segmentTotal: 0,
    error: null,
  };

  private _translationElapsedIntervalId: ReturnType<typeof setInterval> | null =
    null;
  private _translationStartTime = 0;
  private _translationStallTimerId: ReturnType<typeof setTimeout> | null = null;

  state: {
    online: {
      apiStatus: 'init' | 'available' | 'unavailable';
      user: {
        nameOrEmail: string;
        password: string;
      };
      form: {
        valid: boolean;
        err: string;
      };
    };
  } = {
    online: {
      apiStatus: 'available',
      user: {
        nameOrEmail: '',
        password: '',
      },
      form: {
        valid: false,
        err: '',
      },
    },
  };

  get sessionfile(): SessionFile {
    return this.appStorage.sessionfile;
  }

  get apc(): AppSettings {
    return this.settingsService.appSettings;
  }

  public get Math(): Math {
    return Math;
  }

  compatibleBrowser?: boolean;
  localOnly = false;

  constructor(
    private elementRef: ElementRef,
    public appStorage: AppStorageService,
    public api: OctraAPIService,
    public settingsService: SettingsService,
    private audioService: AudioService,
    public authStoreService: AuthenticationStoreService,
    protected compatibilityService: CompatibilityService,
    private localTranscriptionService: LocalTranscriptionService,
    private localDiarizationRuntimeService: LocalDiarizationRuntimeService,
    private localTranslationService: LocalTranslationService,
    private route: ActivatedRoute,
    public recordedFileService: RecordedFileService,
  ) {
    super();
    this.localOnly = !!this.route.snapshot.data['localOnly'];
    this.compatibilityService.testCompability().then((result) => {
      this.compatibleBrowser = result;
      setTimeout(() => {
        elementRef.nativeElement.scroll({
          top: 0,
          left: 0,
        });
      }, 0);
    });
    const subject = 'Octra Server is offline';
    const body = `Hello,

I just want to let you know, that the OCTRA server is currently offline.

 Best,
 a TRATT user
 `;
    const url = `mailto:${
      this.settingsService.appSettings.octra.supportEmail
    }?subject=${encodeURI(subject)}&body=${encodeURI(body)}`;

    this.email_link = `<br/><a href="${url}">${this.settingsService.appSettings.octra.supportEmail}</a>`;
  }

  onOfflineSubmit = (removeData: boolean) => {
    const opts = this.dropzone?.transcribeOptions;
    const trOpts = this.dropzone?.translateOptions;
    console.log('[LoginComponent.onOfflineSubmit] transcribeOptions:', opts);
    this._pendingRemoveData = removeData;

    if (opts && this.dropzone?.hasAudio && !this.dropzone?.hasAnnotation) {
      this._startTranscription(opts);
      return;
    }

    if (trOpts && this.dropzone?.hasAnnotation && this.dropzone?.oannotation) {
      this._startTranslation(this.dropzone.oannotation);
      return;
    }

    this.proceedWithLogin(removeData);
  };

  private _startTranscription(opts: TranscriptionOptions): void {
    this.diarizationWarning = null;
    const modelMeta =
      KB_WHISPER_MODELS.find((m) => m.modelId === opts.modelId) ??
      OPENAI_WHISPER_MODELS.find((m) => m.modelId === opts.modelId);
    this.transcription = {
      active: true,
      phase: 'downloading',
      downloadLoaded: 0,
      downloadTotal: 0,
      downloadExpectedBytes: (modelMeta?.sizeMb ?? 0) * 1024 * 1024,
      downloadFile: '',
      elapsedMs: 0,
      audioDurationS: 0,
      segmentEndS: 0,
      error: null,
      usedWebGPU: opts.useWebGPU,
    };
    this._transcriptionSub = this.localTranscriptionService
      .transcribe(this.dropzone!.audioManager, this.dropzone!.oaudiofile, opts)
      .subscribe({
        next: (event: TranscriptionEvent) => this.onTranscriptionEvent(event),
        error: (err: Error) => {
          this._clearElapsedInterval();
          this.transcription.error = err.message;
          this.transcription.active = false;
        },
      });
  }

  private onTranscriptionEvent(event: TranscriptionEvent): void {
    if (event.type === 'download-progress') {
      this.transcription.phase = 'downloading';
      this.transcription.downloadLoaded = event.loaded;
      this.transcription.downloadTotal = event.total;
      this.transcription.downloadFile = event.file;
    } else if (event.type === 'transcribe-start') {
      this.transcription.phase = 'transcribing';
      this.transcription.audioDurationS = event.audioDurationS;
      this.transcription.elapsedMs = 0;
      this.transcription.segmentEndS = 0;
      this._transcriptionStartTime = Date.now();
      this._elapsedIntervalId = setInterval(() => {
        this.transcription.elapsedMs =
          Date.now() - this._transcriptionStartTime;
      }, 1000);
    } else if (event.type === 'segment-progress') {
      this.transcription.segmentEndS = event.segmentEndS;
    } else if (event.type === 'backend-fallback') {
      this.transcription.usedWebGPU = false;
      this.transcription.phase = 'downloading';
      this.transcription.downloadLoaded = 0;
      this.transcription.downloadTotal = 0;
      this.transcription.downloadFile =
        'Retrying with WASM after WebGPU startup failure';
    } else if (event.type === 'result') {
      this._clearElapsedInterval();
      this._transcriptionSub = null;
      this.transcription.phase = 'finalizing';
      void this.handleCompletedTranscription(event.annotJson);
    }
  }

  private async handleCompletedTranscription(
    annotJson: OAnnotJSON,
  ): Promise<void> {
    const opts = this.dropzone?.transcribeOptions;
    const diarizationEnabled = !!opts?.diarization;

    if (diarizationEnabled) {
      this.transcription.phase = 'diarizing';
    }

    const segmented = await applyOptionalSpeakerSegmentation({
      annotJson,
      diarizationEnabled,
      runDiarization: async () => {
        const diarizationOptions = opts?.diarization ?? {
          modelId: DIARIZATION_DEFAULT_MODEL_ID,
          useWebGPU: false,
        };

        const result = await firstValueFrom(
          this.localDiarizationRuntimeService
            .diarize(this.dropzone!.audioManager, diarizationOptions)
            .pipe(
              tap((event: DiarizationEvent) => {
                if (event.type === 'download-progress') {
                  this.transcription.downloadLoaded = event.loaded;
                  this.transcription.downloadTotal = event.total;
                  this.transcription.downloadFile = event.file;
                }
              }),
              filter(
                (
                  event: DiarizationEvent,
                ): event is Extract<DiarizationEvent, { type: 'result' }> =>
                  event.type === 'result',
              ),
            ),
        );

        return result.turns;
      },
    });

    this.diarizationWarning = segmented.warning;
    if (this.diarizationWarning) {
      console.error('[diarization]', this.diarizationWarning);
    }
    this.transcription.active = false;

    const trOpts = this.dropzone?.translateOptions;
    if (trOpts) {
      this.transcription.phase = 'idle';
      this._startTranslation(segmented.annotJson);
    } else {
      this.dropzone?.setAnnotationFromAnnotJson(segmented.annotJson);
      this.proceedWithLogin(false);
    }
  }

  private _startTranslation(annotJson: OAnnotJSON): void {
    const trOpts = this.dropzone!.translateOptions!;
    this.translation = {
      active: true,
      phase: 'downloading',
      downloadLoaded: 0,
      downloadTotal: 0,
      downloadFile: '',
      elapsedMs: 0,
      segmentIndex: 0,
      segmentTotal: 0,
      error: null,
    };
    this._armTranslationStallTimer();
    this._translationSub = this.localTranslationService
      .translate(annotJson, trOpts)
      .subscribe({
        next: (event: TranslationEvent) => this.onTranslationEvent(event),
        error: (err: Error) => {
          this._clearTranslationElapsed();
          this._clearTranslationStallTimer();
          this.translation.error = err.message;
          this.translation.active = false;
          this.translation.phase = 'idle';
        },
      });
  }

  private onTranslationEvent(event: TranslationEvent): void {
    if (event.type === 'download-progress') {
      this.translation.phase = 'downloading';
      this.translation.downloadLoaded = event.loaded;
      this.translation.downloadTotal = event.total;
      this.translation.downloadFile = event.file;
    } else if (event.type === 'model-init') {
      this.translation.phase = 'initializing';
    } else if (event.type === 'translate-start') {
      this.translation.phase = 'translating';
      this.translation.segmentTotal = event.total;
      this.translation.segmentIndex = 0;
      this.translation.elapsedMs = 0;
      this._translationStartTime = Date.now();
      this._translationElapsedIntervalId = setInterval(() => {
        this.translation.elapsedMs = Date.now() - this._translationStartTime;
      }, 1000);
    } else if (event.type === 'segment-progress') {
      this.translation.segmentIndex = event.index;
      this.translation.segmentTotal = event.total;
    } else if (event.type === 'result') {
      this._clearTranslationElapsed();
      this._clearTranslationStallTimer();
      this.dropzone?.setAnnotationFromAnnotJson(event.annotJson);
      this.translation.active = false;
      this.translation.phase = 'finalizing';
      this._translationSub = null;
      this.proceedWithLogin(false);
      return;
    }
    this._armTranslationStallTimer();
  }

  private _armTranslationStallTimer(): void {
    this._clearTranslationStallTimer();
    const phase = this.translation.phase;
    const budget =
      phase === 'initializing' || phase === 'translating'
        ? TRANSLATION_INIT_STALL_MS
        : TRANSLATION_DOWNLOAD_STALL_MS;
    this._translationStallTimerId = setTimeout(() => {
      if (!this.translation.active) {
        return;
      }
      this.translation.error =
        phase === 'initializing'
          ? 'Model load stalled. Try refreshing the page.'
          : phase === 'translating'
            ? 'Translation stalled — no progress for 60 seconds. Cancel and retry.'
            : 'Download stalled — likely a browser storage limit. Cancel and retry with "Skip browser cache" enabled.';
    }, budget);
  }

  private _clearTranslationStallTimer(): void {
    if (this._translationStallTimerId !== null) {
      clearTimeout(this._translationStallTimerId);
      this._translationStallTimerId = null;
    }
  }

  private _clearTranslationElapsed(): void {
    if (this._translationElapsedIntervalId !== null) {
      clearInterval(this._translationElapsedIntervalId);
      this._translationElapsedIntervalId = null;
    }
  }

  cancelTranslation(): void {
    this._clearTranslationElapsed();
    this._clearTranslationStallTimer();
    this.localTranslationService.cancel();
    this._translationSub?.unsubscribe();
    this._translationSub = null;
    this.translation.active = false;
    this.translation.phase = 'idle';
  }

  dismissTranslationError(): void {
    if (this.translation.active) {
      this.cancelTranslation();
    } else {
      this._clearTranslationElapsed();
      this.translation.error = null;
    }
  }

  private _clearElapsedInterval(): void {
    if (this._elapsedIntervalId !== null) {
      clearInterval(this._elapsedIntervalId);
      this._elapsedIntervalId = null;
    }
  }

  cancelTranscription(): void {
    this._clearElapsedInterval();
    this.localTranscriptionService.cancel();
    this.localDiarizationRuntimeService.cancel();
    this._transcriptionSub?.unsubscribe();
    this._transcriptionSub = null;
    this.transcription.active = false;
    this.transcription.phase = 'idle';
  }

  dismissTranscriptionError(): void {
    if (this.transcription.active) {
      this.cancelTranscription();
    } else {
      this._clearElapsedInterval();
      this.transcription.error = null;
    }
  }

  private proceedWithLogin(removeData: boolean): void {
    const manager = this.dropzone?.audioManager;
    if (!manager) {
      console.error(
        '[proceedWithLogin] audioManager is null/undefined — cannot proceed',
      );
      return;
    }
    const files = this.dropzone!.files.map((a) => a.file.file!).filter(
      Boolean,
    ) as File[];
    if (files.length === 0) {
      console.error(
        '[proceedWithLogin] no valid File objects in dropzone — cannot proceed',
      );
      return;
    }
    if (
      this.recordedFileService.recordedFile &&
      !files.includes(this.recordedFileService.recordedFile)
    ) {
      this.recordedFileService.clear();
    }
    this.audioService.registerAudioManager(manager);
    this.dropzone!.releaseAudioManager();
    this.authStoreService.loginLocal(
      files,
      this.dropzone!.hasAnnotation ? this.dropzone!.oannotation : undefined,
      removeData,
    );
  }

  onOnlineSubmit($event: {
    type: AccountLoginMethod;
    credentials?: {
      usernameEmail: string;
      password: string;
    };
  }) {
    this.authStoreService.loginOnline(
      $event.type,
      $event.credentials?.usernameEmail,
      $event.credentials?.password,
    );
  }

  onOnlineCredentialsSubmit() {
    this.authStoreService.loginOnline(
      AccountLoginMethod.local,
      this.state.online.user.nameOrEmail,
      this.state.online.user.password,
    );
  }

  canDeactivate(): Observable<boolean> | boolean {
    return this.state.online.form.valid;
  }

  getDropzoneFileString(file: File | SessionFile) {
    if (file !== undefined) {
      const fsize: FileSize = getFileSize(file.size);
      return `${file.name} (${Math.round(fsize.size * 100) / 100} ${
        fsize.label
      })`;
    }
    return '';
  }

  public startDemo() {
    this.authStoreService.loginDemo();
  }
}

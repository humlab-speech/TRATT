import { AsyncPipe, DecimalPipe } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { NgForm } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { AccountLoginMethod } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { FileSize, getFileSize, formatMinutesSeconds } from '@tratt/utilities';
import { Observable, Subscription } from 'rxjs';
import { AuthenticationComponent } from '../../component/authentication-component/authentication-component.component';
import { DefaultComponent } from '../../component/default.component';
import { MaintenanceBannerComponent } from '../../component/maintenance/maintenance-banner/maint-banner.component';
import { RecordingPanelComponent } from '../../component/recording-panel/recording-panel.component';
import {
  KB_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from '../../component/tratt-dropzone/auto-transcribe-options.component';
import { TrattDropzoneComponent } from '../../component/tratt-dropzone/tratt-dropzone.component';
import { AppSettings } from '../../obj';
import { SessionFile } from '../../obj/SessionFile';
import { AudioService, SettingsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { DEFAULT_BUNDLE_ID } from '../../store/login-mode/annotation/local-bundle-collection';
import { CompatibilityService } from '../../shared/service/compatibility.service';
import {
  TranscriptionEvent,
  TranscriptionOptions,
} from '../../shared/service/local-transcription.service';
import { TranslationEvent } from '../../shared/service/local-translation.service';
import {
  PipelineEvent,
  PipelineInput,
  PipelineRunnerService,
} from '../../shared/service/pipeline-runner.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { AuthenticationStoreService } from '../../store/authentication';
import { BrowserTestComponent } from '../browser-test/browser-test.component';
import { offlineSubmitLabelKey } from './offline-submit-label.helper';
import { ComponentCanDeactivate } from './login.deactivateguard';
import { LoginService } from './login.service';

type TranslationPhase =
  | 'idle'
  | 'downloading'
  | 'initializing'
  | 'translating'
  | 'finalizing';

function formatDuration(seconds: number): string {
  return formatMinutesSeconds(seconds);
}

@Component({
  selector: 'tratt-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  providers: [LoginService],
  imports: [
    MaintenanceBannerComponent,
    AuthenticationComponent,
    TrattDropzoneComponent,
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
  @ViewChild('dropzone', { static: false }) dropzone?: TrattDropzoneComponent;
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

  private _pipelineSub: Subscription | null = null;
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
    private pipelineRunnerService: PipelineRunnerService,
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
      this.settingsService.appSettings.tratt.supportEmail
    }?subject=${encodeURI(subject)}&body=${encodeURI(body)}`;

    this.email_link = `<br/><a href="${url}">${this.settingsService.appSettings.tratt.supportEmail}</a>`;
  }

  onOfflineSubmit = (removeData: boolean) => {
    const opts = this.dropzone?.transcribeOptions;
    const trOpts = this.dropzone?.translateOptions;
    this._pendingRemoveData = removeData;

    if (opts && this.dropzone?.hasAudio) {
      this._startTranscriptionPipeline(opts);
      return;
    }

    if (trOpts && this.dropzone?.hasAnnotation && this.dropzone?.oannotation) {
      this._runPipeline({
        audioManager: this.dropzone.audioManager,
        oaudiofile: this.dropzone.oaudiofile,
        translateOptions: trOpts,
        annotJson: this.dropzone.oannotation,
      });
      return;
    }

    this.proceedWithLogin(removeData);
  };

  offlineSubmitLabelKey(): string {
    return offlineSubmitLabelKey({
      hasAnnotation: this.dropzone?.hasAnnotation ?? false,
      transcribeSelected: !!this.dropzone?.transcribeOptions,
      translateSelected: !!this.dropzone?.translateOptions,
    });
  }

  // Presentation-only reset (matches today's `_startTranscription`'s
  // object-literal reset exactly) — computing `downloadExpectedBytes` needs
  // KB_WHISPER_MODELS/OPENAI_WHISPER_MODELS, which are UI concerns, not
  // pipeline state, so this stays here rather than moving into
  // PipelineRunnerService.
  private _startTranscriptionPipeline(opts: TranscriptionOptions): void {
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
    this._runPipeline({
      audioManager: this.dropzone!.audioManager,
      oaudiofile: this.dropzone!.oaudiofile,
      transcribeOptions: opts,
      translateOptions: this.dropzone?.translateOptions ?? undefined,
    });
  }

  private _runPipeline(input: PipelineInput): void {
    this._pipelineSub = this.pipelineRunnerService.run(input).subscribe({
      next: (event: PipelineEvent) => this._onPipelineEvent(event),
      error: (err: Error) => this._onPipelineError(err),
    });
  }

  private _onPipelineEvent(event: PipelineEvent): void {
    if (event.stage === 'transcription') {
      if ('event' in event) {
        this._onTranscriptionEvent(event.event);
      } else {
        // 'finalized': diarization (or the skipped-diarization branch) has
        // resolved — mirrors today's inline `this.transcription.active =
        // false;` (+ conditional phase reset when translation follows),
        // which used to run directly inside handleCompletedTranscription().
        // diarizationWarning is set HERE (not only on the terminal
        // 'pipeline result' event) so it's visible for the whole translation
        // phase that may follow, matching today's timing exactly — setting
        // it only at the very end would mean it's superseded by navigation
        // before ever being shown. `willTranslate` is the SAME captured
        // value the service used to decide whether to chain into
        // translation, rather than a second, independent read of
        // `dropzone.translateOptions` that could in principle disagree.
        this.transcription.active = false;
        this.diarizationWarning = event.diarizationWarning;
        if (event.willTranslate) {
          this.transcription.phase = 'idle';
        }
      }
    } else if (event.stage === 'diarization') {
      if ('event' in event && event.event.type === 'download-progress') {
        this.transcription.downloadLoaded = event.event.loaded;
        this.transcription.downloadTotal = event.event.total;
        this.transcription.downloadFile = event.event.file;
      } else if ('type' in event && event.type === 'started') {
        // Mirrors today's inline `this.transcription.phase = 'diarizing';`
        // write, which used to happen synchronously right before diarize()
        // was called.
        this.transcription.phase = 'diarizing';
      }
      // 'skipped' is a no-op, matching today exactly (the original code
      // only ever set phase='diarizing' inside the `if (diarizationEnabled)`
      // branch — the disabled branch never touched .phase at all).
    } else if (event.stage === 'translation') {
      if ('type' in event && event.type === 'start') {
        // Mirrors today's `_startTranslation`'s object-literal reset
        // exactly, for both the chained-after-transcription and the
        // direct translation-only submit entry points.
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
      } else {
        this._onTranslationEvent(event.event);
      }
    } else if (event.stage === 'pipeline') {
      if (event.type === 'result') {
        this.diarizationWarning = event.diarizationWarning;
        this.dropzone?.setAnnotationFromAnnotJson(event.annotJson);
        this.proceedWithLogin(false);
      } else if (event.type === 'stalled') {
        this.translation.error = event.message;
      }
      // 'cancelled' is a no-op here — cancelTranscription()/
      // cancelTranslation() already do their own synchronous field resets
      // below, independent of any event from the pipeline.
    }
  }

  private _onPipelineError(err: Error): void {
    if (this.transcription.active) {
      this._clearElapsedInterval();
      this.transcription.error = err.message;
      this.transcription.active = false;
    } else if (this.translation.active) {
      this._clearTranslationElapsed();
      this.translation.error = err.message;
      this.translation.active = false;
      this.translation.phase = 'idle';
    }
  }

  private _onTranscriptionEvent(event: TranscriptionEvent): void {
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
      this.transcription.phase = 'finalizing';
    }
  }

  private _onTranslationEvent(event: TranslationEvent): void {
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
      this.translation.active = false;
      this.translation.phase = 'finalizing';
    }
  }

  private _clearTranslationElapsed(): void {
    if (this._translationElapsedIntervalId !== null) {
      clearInterval(this._translationElapsedIntervalId);
      this._translationElapsedIntervalId = null;
    }
  }

  // NOTE (cancel-symmetry judgment call): PipelineRunnerService.cancel() is
  // the single, stage-aware method the extraction plan calls for — it reads
  // its OWN tracked active-stage state and cancels exactly the right
  // underlying worker service(s), rather than being told which stage to
  // cancel. login.component.ts still exposes two distinctly-named methods
  // (cancelTranscription/cancelTranslation) because login.component.spec.ts's
  // characterization suite probes them directly, from a fresh component with
  // no pipeline ever started, and asserts two DIFFERENT outcomes from that
  // *identical* (idle) state purely based on which method name was called —
  // an invariant no state-derived single method can reproduce, since there is
  // no state to derive from yet. In every reachable production call site
  // (both route through dismissTranscriptionError()/dismissTranslationError(),
  // themselves gated behind `.active`), PipelineRunnerService.cancel() is only
  // ever invoked while its internal active-stage tracking genuinely agrees
  // with which of these two methods is calling it, so behavior is identical
  // to today's. See task-2-report.md for the full reasoning.
  cancelTranslation(): void {
    this._clearTranslationElapsed();
    this.pipelineRunnerService.cancel();
    this._pipelineSub?.unsubscribe();
    this._pipelineSub = null;
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
    this.pipelineRunnerService.cancel();
    this._pipelineSub?.unsubscribe();
    this._pipelineSub = null;
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
    this.audioService.registerAudioManager(DEFAULT_BUNDLE_ID, manager);
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

import { AsyncPipe, DecimalPipe } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { NgForm } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { AccountLoginMethod } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { Store } from '@ngrx/store';
import { FileSize, getFileSize, formatMinutesSeconds } from '@tratt/utilities';
import { map, Observable, Subscription, tap } from 'rxjs';
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
import { RootState } from '../../store';
import { AuthenticationStoreService } from '../../store/authentication';
import {
  dispatchPipelineActions,
  mapPipelineEventToAction,
} from '../../store/pipeline/pipeline-event-mapping';
import { PipelineActions } from '../../store/pipeline/pipeline.actions';
import {
  selectDiarizationWarning,
  selectTranscription,
  selectTranslation,
} from '../../store/pipeline/pipeline.selectors';
import { BrowserTestComponent } from '../browser-test/browser-test.component';
import { offlineSubmitLabelKey } from './offline-submit-label.helper';
import { ComponentCanDeactivate } from './login.deactivateguard';
import { LoginService } from './login.service';

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

  // Store-backed progress/phase/error state (Task 3's `pipeline` feature
  // slice) — signals, read directly in the template as `transcription()`/
  // `translation()`/`diarizationWarning()`, matching the `selectSignal`
  // convention already used by workbench.component.ts/bundle-list.component.ts
  // for component-level selector reads.
  readonly transcription = this.store.selectSignal(selectTranscription);
  readonly translation = this.store.selectSignal(selectTranslation);
  readonly diarizationWarning = this.store.selectSignal(
    selectDiarizationWarning,
  );

  // Elapsed-time ticking is DELIBERATELY kept local and unthrottled (Global
  // Constraint from the master plan) — a `setInterval` writing into NgRx
  // every second forever is exactly the reducer-flooding problem
  // `dispatchPipelineActions()` exists to prevent. These two fields are
  // driven by the RAW (unthrottled) event stream in `_onRawPipelineEvent`
  // below, not by anything dispatched into the store.
  transcriptionElapsedMs = 0;
  translationElapsedMs = 0;

  private _elapsedIntervalId: ReturnType<typeof setInterval> | null = null;
  private _transcriptionStartTime = 0;
  private _translationElapsedIntervalId: ReturnType<typeof setInterval> | null =
    null;
  private _translationStartTime = 0;

  readonly formatDuration = formatDuration;

  private _pipelineSub: Subscription | null = null;
  private _pendingRemoveData = false;

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
    private store: Store<RootState>,
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

  // Dispatched synchronously, BEFORE calling pipelineRunnerService.run() —
  // mirrors today's inline object-literal reset exactly. `downloadExpectedBytes`
  // needs KB_WHISPER_MODELS/OPENAI_WHISPER_MODELS, which are UI concerns, not
  // pipeline state, so that computation stays here rather than moving into
  // PipelineRunnerService or PipelineActions.
  private _startTranscriptionPipeline(opts: TranscriptionOptions): void {
    const modelMeta =
      KB_WHISPER_MODELS.find((m) => m.modelId === opts.modelId) ??
      OPENAI_WHISPER_MODELS.find((m) => m.modelId === opts.modelId);
    this.store.dispatch(
      PipelineActions.transcriptionStart({
        downloadExpectedBytes: (modelMeta?.sizeMb ?? 0) * 1024 * 1024,
        usedWebGPU: opts.useWebGPU,
      }),
    );
    this._runPipeline({
      audioManager: this.dropzone!.audioManager,
      oaudiofile: this.dropzone!.oaudiofile,
      transcribeOptions: opts,
      translateOptions: this.dropzone?.translateOptions ?? undefined,
    });
  }

  // Single subscription to the pipeline run. `tap()` sees every RAW event,
  // unthrottled — used only for the handful of concerns that must never be
  // delayed/collapsed (elapsed-time bookkeeping, and the terminal
  // navigation side effect). `map(mapPipelineEventToAction)` +
  // `dispatchPipelineActions()` (Task 3's tested trio, the last one added
  // to fix a real bug — see its own doc comment) is what actually reaches
  // the store: discrete state-transition/terminal actions dispatch
  // immediately, every time, while only pure progress ticks
  // (download-progress/segment-progress) are capped at ~4Hz, so a real-time
  // stream of progress events can't flood the reducer/change detection
  // without ever being able to silently drop something like
  // `transcriptionFinalized`.
  private _runPipeline(input: PipelineInput): void {
    this._pipelineSub = dispatchPipelineActions(
      this.pipelineRunnerService.run(input).pipe(
        tap((event: PipelineEvent) => this._onRawPipelineEvent(event)),
        map(mapPipelineEventToAction),
      ),
    ).subscribe({
      next: (action) => this.store.dispatch(action),
      error: (err: Error) => this._onPipelineError(err),
    });
  }

  private _onRawPipelineEvent(event: PipelineEvent): void {
    if (event.stage === 'transcription' && 'event' in event) {
      this._onRawTranscriptionEvent(event.event);
    } else if (event.stage === 'translation' && 'event' in event) {
      this._onRawTranslationEvent(event.event);
    } else if (event.stage === 'pipeline' && event.type === 'result') {
      // Mirrors today's finalization: routes straight to the dropzone/login
      // flow, independent of the (throttled) store dispatch for this same
      // event — this must never be delayed by throttling.
      this.dropzone?.setAnnotationFromAnnotJson(event.annotJson);
      this.proceedWithLogin(false);
    }
  }

  private _onRawTranscriptionEvent(event: TranscriptionEvent): void {
    if (event.type === 'transcribe-start') {
      this.transcriptionElapsedMs = 0;
      this._transcriptionStartTime = Date.now();
      this._elapsedIntervalId = setInterval(() => {
        this.transcriptionElapsedMs = Date.now() - this._transcriptionStartTime;
      }, 1000);
    } else if (event.type === 'result') {
      this._clearElapsedInterval();
    }
  }

  private _onRawTranslationEvent(event: TranslationEvent): void {
    if (event.type === 'translate-start') {
      this.translationElapsedMs = 0;
      this._translationStartTime = Date.now();
      this._translationElapsedIntervalId = setInterval(() => {
        this.translationElapsedMs = Date.now() - this._translationStartTime;
      }, 1000);
    } else if (event.type === 'result') {
      this._clearTranslationElapsed();
    }
  }

  // Mirrors today's `_onPipelineError`: whichever stage is active absorbs
  // the error (the reducer itself decides which — see pipeline.reducer.ts's
  // `PipelineActions.error` case, which reproduces the exact same
  // transcription-vs-translation asymmetry the old inline branches had).
  // Dispatched directly (never throttled) — delivered via the run()
  // Observable's error() channel, not next(), so there's no burst to
  // collapse.
  private _onPipelineError(err: Error): void {
    this._clearElapsedInterval();
    this._clearTranslationElapsed();
    this.store.dispatch(PipelineActions.error({ message: err.message }));
  }

  private _clearTranslationElapsed(): void {
    if (this._translationElapsedIntervalId !== null) {
      clearInterval(this._translationElapsedIntervalId);
      this._translationElapsedIntervalId = null;
    }
  }

  private _clearElapsedInterval(): void {
    if (this._elapsedIntervalId !== null) {
      clearInterval(this._elapsedIntervalId);
      this._elapsedIntervalId = null;
    }
  }

  // NOTE (cancel-symmetry judgment call, carried over from Task 2):
  // PipelineRunnerService.cancel() is the single, stage-aware method the
  // extraction plan calls for — it reads its OWN tracked active-stage state
  // and cancels exactly the right underlying worker service(s), rather than
  // being told which stage to cancel. login.component.ts still exposes two
  // distinctly-named methods (cancelTranscription/cancelTranslation) because
  // login.component.spec.ts's characterization suite probes them directly.
  // See task-2-report.md for the full reasoning.
  cancelTranslation(): void {
    this._clearTranslationElapsed();
    this.pipelineRunnerService.cancel();
    this._pipelineSub?.unsubscribe();
    this._pipelineSub = null;
    this.store.dispatch(PipelineActions.translationCancelled());
  }

  dismissTranslationError(): void {
    if (this.translation().active) {
      this.cancelTranslation();
    } else {
      this._clearTranslationElapsed();
      this.store.dispatch(PipelineActions.translationErrorDismissed());
    }
  }

  cancelTranscription(): void {
    this._clearElapsedInterval();
    this.pipelineRunnerService.cancel();
    this._pipelineSub?.unsubscribe();
    this._pipelineSub = null;
    this.store.dispatch(PipelineActions.transcriptionCancelled());
  }

  dismissTranscriptionError(): void {
    if (this.transcription().active) {
      this.cancelTranscription();
    } else {
      this._clearElapsedInterval();
      this.store.dispatch(PipelineActions.transcriptionErrorDismissed());
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

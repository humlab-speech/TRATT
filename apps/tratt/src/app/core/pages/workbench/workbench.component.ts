import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  Type,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { AnnotJSONConverter, Converter } from '@tratt/annotation';
import { timer } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { editorComponents } from '../../../editors/components';
import { TRATTEditor } from '../../../editors/tratt-editor';
import { BundleListComponent } from '../../component/bundle-list/bundle-list.component';
import { DefaultComponent } from '../../component/default.component';
import { NavbarService } from '../../component/navbar/navbar.service';
import { FastbarComponent } from '../../component/taskbar/taskbar.component';
import { TrattDropzoneComponent } from '../../component/tratt-dropzone/tratt-dropzone.component';
import { OverviewModalComponent } from '../../modals/overview-modal/overview-modal.component';
import { ShortcutsModalComponent } from '../../modals/shortcuts-modal/shortcuts-modal.component';
import {
  ModalEndAnswer,
  TranscriptionDemoEndModalComponent,
} from '../../modals/transcription-demo-end/transcription-demo-end-modal.component';
import { TranscriptionSendingModalComponent } from '../../modals/transcription-sending-modal/transcription-sending-modal.component';
import {
  TranscriptionStopModalAnswer,
  TranscriptionStopModalComponent,
} from '../../modals/transcription-stop-modal/transcription-stop-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { ProjectSettings } from '../../obj/Settings';
import { LoadeditorDirective } from '../../shared/directive/loadeditor.directive';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { AudioService } from '../../shared/service/audio.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { RoutingService } from '../../shared/service/routing.service';
import { LoadingStatus, LoginMode } from '../../store';
import { ApplicationState } from '../../store/application';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import {
  DEFAULT_BUNDLE_ID,
  generateBundleId,
} from '../../store/login-mode/annotation/local-bundle-collection';

@Component({
  selector: 'tratt-workbench',
  templateUrl: './workbench.component.html',
  styleUrls: ['./workbench.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TrattDropzoneComponent,
    BundleListComponent,
    TranslocoPipe,
    FastbarComponent,
    LoadeditorDirective,
    FormsModule,
  ],
})
export class WorkbenchComponent extends DefaultComponent implements OnInit {
  @ViewChild(TrattDropzoneComponent) dropzone?: TrattDropzoneComponent;
  @ViewChild(LoadeditorDirective) showEditor?: LoadeditorDirective;

  sessionStarting = false;
  sessionReady = false;

  showCommentSection = false;
  modalOverview?: NgbModalRef;
  modalShortcutsDialogue?: NgbModalRef;
  transcrSendingModal?: NgbModalRef;
  modalVisiblities = {
    overview: false,
    shortcuts: false,
  };

  private _useMode = '';
  private _selectedTheme = '';

  get useMode(): string {
    return this._useMode;
  }

  get selectedTheme(): string {
    return this._selectedTheme;
  }

  get projectsettings(): ProjectSettings {
    return this.settingsService.projectsettings!;
  }

  get comment(): string {
    return this.annotationStoreService.comment;
  }

  constructor(
    private audioService: AudioService,
    private authStoreService: AuthenticationStoreService,
    public appStorage: AppStorageService,
    public routingService: RoutingService,
    public navbarServ: NavbarService,
    public recordedFileService: RecordedFileService,
    public annotationStoreService: AnnotationStoreService,
    private settingsService: SettingsService,
    private modService: TrattModalService,
    private appStoreService: ApplicationStoreService,
    private uiService: UserInteractionsService,
    private cd: ChangeDetectorRef,
  ) {
    super();
  }

  ngOnInit(): void {
    this.subscribe(
      this.appStoreService.loading$,
      (loading: ApplicationState['loading']) => {
        const wasReady = this.sessionReady;
        this.sessionReady = loading?.status === LoadingStatus.FINISHED;
        // Reset the Start button's disabled state whenever a session attempt
        // has actually concluded (successfully or not) — startSession() sets
        // sessionStarting = true but nothing else ever clears it, so a failed
        // or still-in-progress load must not leave the button permanently
        // disabled.
        if (
          loading?.status === LoadingStatus.FINISHED ||
          loading?.status === LoadingStatus.FAILED
        ) {
          this.sessionStarting = false;
        }
        if (!wasReady && this.sessionReady) {
          // `_useMode`/`_selectedTheme`/`showCommentSection` must reflect the
          // real session state, not whatever appStorage.useMode happened to
          // be at route activation (it's still undefined on a clean/logged-out
          // profile at that point — see ngOnInit in
          // pages/intern/transcription/transcription.component.ts for the
          // mirrored logic this is copied from). Compute them here, once a
          // session genuinely exists.
          this._useMode = this.appStorage.useMode;
          this._selectedTheme = !this.projectsettings?.tratt?.theme
            ? 'default'
            : this.projectsettings?.tratt.theme;
          this.showCommentSection =
            this.settingsService.isTheme('shortAudioFiles') &&
            (this._useMode === 'online' || this._useMode === 'demo');
          this.navbarServ.showExport =
            this.settingsService.projectsettings?.navigation?.export === true;

          // The right pane (and its `trattLoadeditor` ViewChild) only exists in
          // the DOM once `sessionReady` is true, and that's gated behind
          // `@if (sessionReady)` in the template. `markForCheck()` alone only
          // schedules a future check, so force a synchronous render here to
          // resolve `showEditor` before `mountDefaultEditor()` tries to use it.
          this.cd.detectChanges();
          this.mountDefaultEditor();
        }
        this.cd.markForCheck();
      },
    );
  }

  private mountDefaultEditor(): void {
    const interfaces = this.settingsService.projectsettings?.interfaces ?? [];
    const current = this.appStorage.interface;
    const valid = interfaces.find((x) => x === current);
    if (valid === undefined && interfaces.length > 0) {
      this.appStorage.interface = interfaces[0];
    }
    if (this.appStorage.interface) {
      this.changeEditor(this.appStorage.interface);
    }
  }

  startSession(removeData: boolean): void {
    const entries = this.dropzone?.validAudioEntries ?? [];
    if (entries.length === 0) {
      return;
    }
    this.sessionStarting = true;
    const annotation = this.dropzone!.hasAnnotation
      ? this.dropzone!.oannotation
      : undefined;

    const audioBundleIds: string[] = [];
    const files: File[] = [];
    entries.forEach((entry, i) => {
      const bundleId = i === 0 ? DEFAULT_BUNDLE_ID : generateBundleId();
      const nativeFile = entry.fileProgress.file.file!;
      this.audioService.registerAudioManager(
        bundleId,
        entry.audioManager,
        nativeFile,
      );
      audioBundleIds.push(bundleId);
      files.push(nativeFile);
    });

    this.authStoreService.loginLocal(files, annotation, removeData, audioBundleIds);
    this.dropzone!.reset();
  }

  // Unlike TranscriptionComponent.changeEditor(), this does NOT write
  // `appStorage.interface` / `this.interface` — it's currently safe only
  // because `mountDefaultEditor()` is the sole caller and already writes
  // `appStorage.interface` before invoking this. If an editor-switcher UI
  // ever calls `changeEditor()` directly, editor selection will silently
  // stop persisting; that bookkeeping needs restoring first.
  changeEditor(name: string): void {
    let comp: Type<TRATTEditor> | undefined;

    if (name === undefined || name === '') {
      // fallback to last editor
      name = editorComponents[editorComponents.length - 1].name;
    }
    for (const editorComponent of editorComponents) {
      if (name === editorComponent.name) {
        comp = editorComponent.editor;
        break;
      }
    }

    if (comp === undefined) {
      console.error('ERROR editor component is undefined');
      return;
    }

    if (this.showEditor === undefined) {
      console.error('ERROR showEditor is undefined');
      return;
    }

    const viewContainerRef = this.showEditor.viewContainerRef;
    viewContainerRef.clear();
    viewContainerRef.createComponent<TRATTEditor>(comp);
  }

  openOverview() {
    this.annotationStoreService.analyse();
    this.modalOverview = this.modService.openModalRef(
      OverviewModalComponent,
      OverviewModalComponent.options,
    );

    this.appStoreService.setShortcutsEnabled(false);
    this.subscriptionManager.removeByTag('overview modal transcr send');
    this.subscribe(
      this.modalOverview.componentInstance.transcriptionSend,
      () => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalOverview?.close();
        this.modalVisiblities.overview = false;
        timer(1000).subscribe({
          next: () => {
            this.onSendNowClick();
          },
        });
      },
      'overview modal transcr send',
    );

    this.modalOverview.result
      .then(() => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalVisiblities.overview = false;
      })
      .catch(() => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalVisiblities.overview = false;
      });
    this.modalVisiblities.overview = true;
  }

  openShortcutsModal() {
    this.modalShortcutsDialogue = this.modService.openModalRef(
      ShortcutsModalComponent,
      ShortcutsModalComponent.options,
    );
    this.appStoreService.setShortcutsEnabled(false);
    this.modalShortcutsDialogue.result
      .then(() => {
        this.appStoreService.setShortcutsEnabled(true);
        this.modalVisiblities.shortcuts = false;
      })
      .catch(() => {
        this.appStoreService.setShortcutsEnabled(true);
      });
    this.modalVisiblities.shortcuts = true;
  }

  abortTranscription = async () => {
    if (!(await this.recordedFileService.checkUnsaved(this.modService))) return;
    if ([LoginMode.ONLINE, LoginMode.URL].includes(this.appStorage.useMode)) {
      this.modService
        .openModal(
          TranscriptionStopModalComponent,
          TranscriptionStopModalComponent.options,
        )
        .then((answer: any) => {
          if (answer === TranscriptionStopModalAnswer.QUIT) {
            this.annotationStoreService.quit(false, false, false);
          } else if (answer === TranscriptionStopModalAnswer.QUITRELEASE) {
            this.annotationStoreService.quit(true, true, false);
          }
          // else do nothing
        })
        .catch((error) => {
          console.error(error);
        });
    } else {
      this.annotationStoreService.quit(false, false, false);
    }
  };

  public onSendNowClick() {
    if (this._useMode === LoginMode.ONLINE) {
      if (this._useMode === LoginMode.ONLINE) {
        this.annotationStoreService.sendOnlineAnnotation();
      }
    } else if (this._useMode === LoginMode.DEMO) {
      // only if opened
      if (this.modalVisiblities.overview) {
        this.modalOverview!.close();
      }

      this.modService
        .openModal(
          TranscriptionDemoEndModalComponent,
          TranscriptionDemoEndModalComponent.options,
        )
        .then((action: any) => {
          this.appStorage.savingNeeded = false;

          switch (action) {
            case ModalEndAnswer.CANCEL:
              break;
            case ModalEndAnswer.QUIT:
              this.abortTranscription();
              break;
            case ModalEndAnswer.CONTINUE:
              this.transcrSendingModal = this.modService.openModalRef(
                TranscriptionSendingModalComponent,
                TranscriptionSendingModalComponent.options,
              );
              this.subscribe(timer(1000), () => {
                // simulate nextTranscription
                this.transcrSendingModal!.close();
                this.reloadDemo();
              });
              break;
          }
        })
        .catch((error) => {
          console.error(error);
        });
    }
  }

  onSendButtonClick() {
    const showOverview =
      this.projectsettings.tratt?.showOverviewIfTranscriptNotValid === undefined
        ? true
        : this.projectsettings.tratt?.sendValidatedTranscriptionOnly;
    const validTranscriptOnly =
      this.projectsettings.tratt?.sendValidatedTranscriptionOnly === undefined
        ? false
        : this.projectsettings.tratt?.sendValidatedTranscriptionOnly;

    this.annotationStoreService.validateAll();
    const validTranscript = this.annotationStoreService.transcriptValid;

    if (
      (!validTranscript && showOverview) ||
      (validTranscriptOnly && !validTranscript)
    ) {
      this.modalOverview = this.modService.openModalRef(
        OverviewModalComponent,
        OverviewModalComponent.options,
      );
      this.subscriptionManager.removeByTag('overview modal transcr send');
      this.subscribe(
        this.modalOverview.componentInstance.transcriptionSend,
        () => {
          this.appStoreService.setShortcutsEnabled(true);
          this.modalOverview?.close();
          this.modalVisiblities.overview = false;
          timer(1000).subscribe({
            next: () => {
              this.onSendNowClick();
            },
          });
        },
        'overview modal transcr send',
      );
    } else {
      this.onSendNowClick();
    }
  }

  reloadDemo() {
    this.annotationStoreService.endTranscription(true);
    this.clearDataPermanently();
    this.authStoreService.loginDemo();
  }

  clearDataPermanently() {
    // replace with store method
    this.appStorage.clearAnnotationPermanently(); // ok
    this.appStorage.feedback = {}; // ok
    this.annotationStoreService.changeComment(''); // ok
    this.appStorage.clearLoggingDataPermanently(); // ok
    this.uiService.elements = [];
  }

  public onSaveTranscriptionButtonClicked() {
    const aType = this.routingService.staticQueryParams.annotationExportType;
    let converter: Converter | undefined = undefined;

    if (!aType || aType === 'AnnotJSON') {
      converter = new AnnotJSONConverter();
    } else {
      converter = AppInfo.converters.find((a) => a.name === aType);

      if (!converter) {
        window.parent.postMessage(
          {
            error: `Export Type ${aType} is not supported.`,
            status: 'error',
          },
          '*',
        );
        return;
      }
    }

    const manager = this.audioService.current!;
    const oannotjson = this.annotationStoreService.transcript!.serialize(
      manager.resource.info.fullname,
      manager.resource.info.sampleRate,
      manager.resource.info.duration,
    );
    const result = converter.export(
      oannotjson,
      manager.resource.getOAudioFile(),
      0,
    );

    if (!result.error && result.file) {
      // send result to iframe owner
      window.parent.postMessage(
        {
          data: {
            annotation: result.file,
          },
          status: 'success',
        },
        '*',
      );
    } else {
      console.error(`Annotation conversion failed: ${result.error}`);
      window.parent.postMessage(
        {
          error: `Annotation conversion failed: ${result.error}`,
          status: 'error',
        },
        '*',
      );
    }
  }

  public sendTranscriptionForShortAudioFiles(type: 'bad' | 'middle' | 'good') {
    switch (type) {
      case 'bad':
        this.appStorage.feedback = 'SEVERE';
        break;
      case 'middle':
        this.appStorage.feedback = 'SLIGHT';
        break;
      case 'good':
        this.appStorage.feedback = 'OK';
        break;
      default:
    }

    this.onSendButtonClick();
  }
}

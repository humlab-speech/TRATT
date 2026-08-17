import { NgClass, NgStyle, UpperCasePipe } from '@angular/common';
import {
  Component,
  OnInit,
  TemplateRef,
  ViewChild,
  inject,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  NgbCollapse,
  NgbDropdown,
  NgbDropdownItem,
  NgbDropdownMenu,
  NgbDropdownToggle,
  NgbModalRef,
  NgbOffcanvas,
  NgbPopover,
} from '@ng-bootstrap/ng-bootstrap';
import { AccountRole, ProjectDto } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import {
  AnnotationLevelType,
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { TrattComponentsModule } from '@tratt/ngx-components';
import { TimespanPipe } from '@tratt/ngx-utilities';
import { filter, first } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AppInfo } from '../../../app.info';
import { editorComponents } from '../../../editors/components';
import { AboutModalComponent } from '../../modals/about-modal/about-modal.component';
import {
  AddTranslatedLevelModalComponent,
  AddTranslatedLevelResult,
} from '../../modals/add-translated-level-modal/add-translated-level-modal.component';
import { ExportFilesModalComponent } from '../../modals/export-files-modal/export-files-modal.component';
import { StatisticsModalComponent } from '../../modals/statistics-modal/statistics-modal.component';
import { ToolsModalComponent } from '../../modals/tools-modal/tools-modal.component';
import { TranslateLinkedLevelModalComponent } from '../../modals/translate-linked-level-modal/translate-linked-level-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { YesNoModalComponent } from '../../modals/yes-no-modal/yes-no-modal.component';
import {
  AudioService,
  SettingsService,
  SpeakerManagementService,
  UserInteractionsService,
} from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import {
  BugReportService,
  ConsoleEntry,
  ConsoleGroupEntry,
  ConsoleType,
} from '../../shared/service/bug-report.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { LoginMode } from '../../store';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { AsrStoreService } from '../../store/asr/asr-store-service.service';
import { AuthenticationStoreService } from '../../store/authentication';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { DefaultComponent } from '../default.component';
import { NavbarService } from './navbar.service';

@Component({
  selector: 'tratt-navigation',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
  imports: [
    NgbPopover,
    NgbCollapse,
    RouterLinkActive,
    RouterLink,
    NgClass,
    NgbDropdown,
    NgStyle,
    NgbDropdownToggle,
    NgbDropdownMenu,
    NgbDropdownItem,
    UpperCasePipe,
    TranslocoPipe,
    TimespanPipe,
    TrattComponentsModule,
  ],
})
export class NavigationComponent extends DefaultComponent implements OnInit {
  readonly speakerService = inject(SpeakerManagementService);

  modalexport?: NgbModalRef;
  modalTools?: NgbModalRef;
  modalStatistics?: NgbModalRef;

  isCollapsed = true;
  localOnly = false;

  public get environment(): any {
    return environment;
  }

  public get converters(): any[] {
    return AppInfo.converters;
  }

  public get isAdministrator() {
    return (
      this.appStorage.snapshot.authentication.me?.systemRole.label ===
      AccountRole.administrator
    );
  }

  public get AppInfo(): any {
    return AppInfo;
  }

  public get uiService(): UserInteractionsService {
    return this.navbarServ.uiService;
  }

  public get editors() {
    return editorComponents;
  }

  get annotJSONType() {
    return AnnotationLevelType;
  }

  @ViewChild('canvasContent') canvasContent?: TemplateRef<any>;

  public get errorsFound(): boolean {
    let beginCheck = false;
    return (
      this.bugService.console.filter((a) => {
        const hasError = (b: ConsoleEntry) => {
          if (b.type === ConsoleType.ERROR && beginCheck) {
            return true;
          }
          if (
            typeof b.message === 'string' &&
            b.message.indexOf('AFTER RELOAD') > -1
          ) {
            beginCheck = true;
          }
          return false;
        };

        if (
          Object.keys(a).includes('label') ||
          Object.keys(a).includes('entries')
        ) {
          for (const entry of (a as ConsoleGroupEntry).entries) {
            if (hasError(entry)) {
              return true;
            }
          }
          return false;
        } else {
          return hasError(a as ConsoleEntry);
        }
      }).length > 0
    );
  }

  constructor(
    public appStorage: AppStorageService,
    private appStoreService: ApplicationStoreService,
    public navbarServ: NavbarService,
    public sanitizer: DomSanitizer,
    public langService: TranslocoService,
    public modalService: TrattModalService,
    public settService: SettingsService,
    public bugService: BugReportService,
    public annotationStoreService: AnnotationStoreService,
    public authStoreService: AuthenticationStoreService,
    public audio: AudioService,
    public api: OctraAPIService,
    private offcanvasService: NgbOffcanvas,
    protected asrStoreService: AsrStoreService,
    private router: Router,
    public recordedFileService: RecordedFileService,
  ) {
    super();
  }

  private getRouteData(key: string): any {
    let route = this.router.routerState.root;
    while (route) {
      if (route.snapshot.data[key]) {
        return route.snapshot.data[key];
      }
      route = route.firstChild as any;
    }
    return null;
  }

  ngOnInit() {
    this.subscribe(this.navbarServ.onclick, (name) => {
      switch (name) {
        case 'export':
          this.modalexport = this.modalService.openModalRef(
            ExportFilesModalComponent,
            ExportFilesModalComponent.options,
            {
              navbarService: this,
              uiService: this.uiService,
            },
          );
          break;
      }
    });

    this.subscribe(this.navbarServ.openSettings, {
      next: () => {
        this.openEnd();
      },
    });

    this.subscribe(this.router.events, {
      next: () => {
        this.localOnly = !!this.getRouteData('localOnly');
      },
    });
  }

  setInterface(newInterface: string) {
    this.navbarServ.interfacechange.emit(newInterface);
  }

  changeLanguage(lang: string) {
    this.langService.setActiveLang(lang);
    this.appStorage.language = lang;

    this.applyASRLanguageForLang(lang);
  }

  private applyASRLanguageForLang(lang: string): void {
    const applyIfFound = (langs: Array<{ value: string }>) => {
      const matched = langs.find((l) =>
        l.value.toLowerCase().startsWith(lang.toLowerCase()),
      )?.value;
      if (matched) {
        this.asrStoreService.setASRSettings({
          ...this.asrStoreService.asrOptions,
          selectedASRLanguage: matched,
        });
      }
    };

    const current = this.asrStoreService.asrLanguages as
      | Array<{ value: string }>
      | undefined;
    if (current?.length) {
      applyIfFound(current);
    } else {
      // Languages not yet loaded — apply once they arrive
      this.asrStoreService.asrLanguages$
        .pipe(
          filter((langs): langs is Array<{ value: string }> => !!langs?.length),
          first(),
        )
        .subscribe(applyIfFound);
    }
  }

  public interfaceActive(name: string) {
    const found = this.navbarServ.interfaces.find((x) => {
      return name === x;
    });
    return !(found === undefined || false);
  }

  toggleSettings(option: string) {
    (this.appStorage as any)[option] = !(this.appStorage as any)[option];
    if (option === 'logging') {
      this.uiService.enabled = this.appStorage[option];
    }
  }

  public openBugReport() {
    this.appStorage.disableUndoRedo();
    this.appStoreService.setShortcutsEnabled(false);
    this.modalService
      .openBugreportModal()
      .then(() => {
        this.appStorage.enableUndoRedo();
        this.appStoreService.setShortcutsEnabled(true);
        window.location.hash = '';
      })
      .catch((err) => {
        this.appStorage.enableUndoRedo();
        this.appStoreService.setShortcutsEnabled(true);
        console.error(err);
      });
  }

  onLevelNameLeave(event: any, tiernum: number) {
    this.annotationStoreService.changeLevelName(tiernum, event.target.value);
  }

  get speakerIds(): string[] {
    return this.speakerService.getSpeakerIds();
  }

  get hasSpeakers(): boolean {
    return this.appStorage.audioLoaded === true;
  }

  onSpeakerNameLeave(event: Event, oldId: string): void {
    const newId = (event.target as HTMLInputElement).value;
    this.speakerService.rename(oldId, newId);
  }

  onSpeakerRemoveClick(id: string) {
    this.annotationStoreService.removeSpeakerId(id);
  }

  onSpeakerAddClick() {
    const existing = this.speakerService.getSpeakerIds();
    let n = existing.length + 1;
    let newId = `Speaker ${n}`;
    while (existing.includes(newId)) newId = `Speaker ${++n}`;
    this.annotationStoreService.addSpeakerId(newId);
  }

  onLevelAddClick() {
    this.annotationStoreService.addAnnotationLevel(AnnotationLevelType.SEGMENT);
  }

  onAddTranslatedLevelClick() {
    const sourceLevels = this.annotationStoreService.transcript?.levels ?? [];
    this.modalService
      .openModal<
        typeof AddTranslatedLevelModalComponent,
        AddTranslatedLevelResult
      >(
        AddTranslatedLevelModalComponent,
        AddTranslatedLevelModalComponent.options,
        { sourceLevels },
      )
      .then((result) => {
        if (!result) return;
        this.annotationStoreService.addTranslatedLevel(
          result.sourceLevelId,
          result.targetLanguageLabel,
        );
        if (!result.autoTranslate) return;
        // Locate the just-created linked level (same source, matching name).
        const transcript = this.annotationStoreService.transcript;
        const created = transcript?.levels.find(
          (l: any) =>
            l.linkedToLevelId === result.sourceLevelId &&
            l.name === result.targetLanguageLabel,
        );
        const sourceLevel = transcript?.levels.find(
          (l) => l.id === result.sourceLevelId,
        );
        if (created && sourceLevel) {
          this.openTranslateLinkedLevelModal(
            created.id,
            created.name,
            sourceLevel.name,
          );
        }
      })
      .catch((err) => {
        console.error(err);
      });
  }

  onLevelRemoveClick(level: TrattAnnotationAnyLevel<TrattAnnotationSegment>) {
    this.modalService
      .openModal(YesNoModalComponent, YesNoModalComponent.options, {
        message: this.langService.translate('modal.level remove', {
          name: level.name,
        }),
      })
      .then((answer) => {
        if (answer === 'yes') {
          this.appStorage.removeAnnotationLevel(level.id).catch((err) => {
            console.error(err);
          });
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }

  onLevelDuplicateClick(tiernum: number) {
    this.annotationStoreService.duplicateLevel(tiernum);
  }

  onDetachLinkedClick(level: TrattAnnotationAnyLevel<TrattAnnotationSegment>) {
    this.annotationStoreService.detachLinkedLevel(level.id);
  }

  onTranslateLinkedClick(
    level: TrattAnnotationAnyLevel<TrattAnnotationSegment>,
  ) {
    const linkedToLevelId = (level as any).linkedToLevelId as
      | number
      | undefined;
    if (linkedToLevelId === undefined) return;
    const sourceLevel = this.annotationStoreService.transcript?.levels.find(
      (l) => l.id === linkedToLevelId,
    );
    this.openTranslateLinkedLevelModal(
      level.id,
      level.name,
      sourceLevel?.name ?? '',
    );
  }

  private openTranslateLinkedLevelModal(
    linkedLevelId: number,
    linkedLevelName: string,
    sourceLevelName: string,
  ) {
    this.modalService
      .openModal(
        TranslateLinkedLevelModalComponent,
        TranslateLinkedLevelModalComponent.options,
        {
          linkedLevelId,
          linkedLevelName,
          sourceLevelName,
        },
      )
      .catch((err) => {
        console.error(err);
      });
  }

  public selectLevel(tiernum: number) {
    this.annotationStoreService.setLevelIndex(tiernum);
  }

  public changeSecondsPerLine(seconds: number) {
    this.appStorage.secondsPerLine = seconds;
  }

  openExportModal() {
    this.modalexport = this.modalService.openModalRef(
      ExportFilesModalComponent,
      ExportFilesModalComponent.options,
      {
        navbarService: this,
        uiService: this.uiService,
      },
    );
  }

  openToolsModal() {
    this.modalTools = this.modalService.openModalRef(
      ToolsModalComponent,
      ToolsModalComponent.options,
    );
  }

  openStatisticsModal() {
    this.modalStatistics = this.modalService.openModalRef(
      StatisticsModalComponent,
      StatisticsModalComponent.options,
    );
  }

  backToProjectsList() {
    this.logout(true);
  }

  async logout(redirectToProjects = false) {
    if (!(await this.recordedFileService.checkUnsaved(this.modalService)))
      return;
    this.recordedFileService.clear();
    if (
      this.appStorage.snapshot.application.mode === LoginMode.ONLINE &&
      this.appStorage.snapshot.onlineMode.currentSession.currentProject
    ) {
      this.annotationStoreService.quit(
        true,
        !redirectToProjects,
        redirectToProjects,
      );
    } else {
      this.appStorage.logout(true);
    }
  }

  getFreeAnnotationTasks(project: ProjectDto | undefined) {
    return (
      project?.statistics?.tasks.find((a) => a.type === 'annotation')?.status
        .free ?? 0
    );
  }

  openAboutModal() {
    this.modalService.openModalRef(
      AboutModalComponent,
      AboutModalComponent.options,
    );
  }

  openEnd() {
    this.appStoreService.setShortcutsEnabled(false);
    const ref = this.offcanvasService.open(this.canvasContent, {
      position: 'end',
    });
    this.subscribe(
      ref.dismissed,
      {
        next: () => {
          this.appStoreService.setShortcutsEnabled(true);
          this.subscriptionManager.removeByTag('canvasDismissed');
        },
      },
      'canvasDismissed',
    );
  }
}

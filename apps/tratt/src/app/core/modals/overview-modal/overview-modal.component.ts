import { AsyncPipe, NgClass } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TrattAnnotationSegment } from '@tratt/annotation';
import {
  NgbActiveModal,
  NgbModal,
  NgbModalOptions,
} from '@ng-bootstrap/ng-bootstrap';
import { OverviewTimelineComponent } from '../../component/transcr-overview/overview-timeline/overview-timeline.component';
import { TranscrOverviewComponent } from '../../component/transcr-overview/transcr-overview.component';
import { TranscriptionFeedbackComponent } from '../../component/transcription-feedback/transcription-feedback.component';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { ShortcutService } from '../../shared/service/shortcut.service';
import { LoginMode } from '../../store';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { TrattModal } from '../types';

const OVERVIEW_WIDTH_KEY = 'tratt.overview.width';
const MIN_WIDTH = 800;

@Component({
  selector: 'tratt-overview-modal',
  templateUrl: './overview-modal.component.html',
  styleUrls: ['./overview-modal.component.scss'],
  imports: [
    NgClass,
    TranscrOverviewComponent,
    OverviewTimelineComponent,
    TranscriptionFeedbackComponent,
    AsyncPipe,
    TranslocoPipe,
  ],
})
export class OverviewModalComponent
  extends TrattModal
  implements OnInit, OnDestroy, AfterViewInit
{
  public override name = 'OverviewModalComponent';
  public static options: NgbModalOptions = {
    keyboard: false,
    backdrop: true,
    scrollable: true,
    size: 'xl',
    fullscreen: 'xl',
  };

  private readonly host = inject(ElementRef<HTMLElement>);
  private resizeStart?: { x: number; width: number; side: 1 | -1 };

  @ViewChild('overview', { static: false })
  overview?: TranscrOverviewComponent;
  /** Unit selected in the table and on the footer timeline. */
  selectedUnit = -1;
  /** Where the timeline's position line rests while nothing plays. */
  timelineCursor?: number;

  @ViewChild('feedback', { static: false })
  feedback?: TranscriptionFeedbackComponent;
  @Output() transcriptionSend = new EventEmitter<void>();

  protected data = undefined;
  private shortcutID = -1;
  visible = false;

  public get feedBackComponent(): TranscriptionFeedbackComponent | undefined {
    return this.feedback;
  }

  public get sendValidTranscriptOnly(): boolean {
    return (
      this.settingsService.projectsettings?.tratt
        ?.sendValidatedTranscriptionOnly ?? false
    );
  }

  public shownSegments: {
    transcription: {
      html: string;
      text: string;
    };
  }[] = [];

  public trnEditorswitch = new EventEmitter<void>();

  constructor(
    public modalService: NgbModal,
    public settingsService: SettingsService,
    public annotationStoreService: AnnotationStoreService,
    private shortcutsService: ShortcutService,
    public appStorage: AppStorageService,
    private uiService: UserInteractionsService,
    protected override activeModal: NgbActiveModal,
  ) {
    super('overviewModal', activeModal);
  }

  ngOnInit() {
    if (
      this.settingsService.isTheme('shortAudioFiles') ||
      this.settingsService.isTheme('secondSegmentFast')
    ) {
      this.shortcutsService.registerShortcutGroup({
        name: 'overview modal',
        items: [
          {
            name: 'send good',
            title: 'overview modal.good',
            keys: {
              mac: 'CTRL + 1',
              pc: 'CTRL + 1',
            },
            callback: () => {
              this.sendTranscriptionForShortAudioFiles('good');
            },
          },
          {
            name: 'send middle',
            title: 'overview modal.middle',
            keys: {
              mac: 'CTRL + 2',
              pc: 'CTRL + 2',
            },
            callback: () => {
              this.sendTranscriptionForShortAudioFiles('middle');
            },
          },
          {
            name: 'send bad',
            title: 'overview modal.bad',
            keys: {
              mac: 'CTRL + 3',
              pc: 'CTRL + 3',
            },
            callback: () => {
              this.sendTranscriptionForShortAudioFiles('bad');
            },
          },
        ],
        enabled: true,
      });
    }

    this.uiService.addElementFromEvent(
      'overview',
      { value: 'opened' },
      Date.now(),
      undefined,
      undefined,
      undefined,
      undefined,
      'overview',
    );
  }

  ngAfterViewInit() {
    const saved = Number(localStorage.getItem(OVERVIEW_WIDTH_KEY));
    if (saved > 0) this.setDialogWidth(saved);
    if (this.feedback) {
      this.feedback.comment = this.annotationStoreService.comment;
    }
  }

  public override close(fromModal = false) {
    if (this.feedback) {
      this.annotationStoreService.comment = this.feedback.comment;
    }

    // unsubscribe shortcut listener
    if (this.shortcutID > -1) {
      this.subscriptionManager.removeById(this.shortcutID);
      this.shortcutID = -1;
    }

    if (
      (this.appStorage.useMode === LoginMode.ONLINE ||
        this.appStorage.useMode === LoginMode.DEMO) &&
      this.feedback
    ) {
      this.feedback.saveFeedbackform();
    }

    if (fromModal) {
      this.uiService.addElementFromEvent(
        'overview',
        { value: 'closed' },
        Date.now(),
        undefined,
        undefined,
        undefined,
        undefined,
        'overview',
      );
    }
    return super.close();
  }

  private get dialog(): HTMLElement | null {
    return (this.host.nativeElement as HTMLElement).closest('.modal-dialog');
  }

  /**
   * Width set by dragging an edge, kept between visits. The dialog stays
   * centred, so it grows by twice the drag: the dragged edge follows the
   * pointer. Undefined returns to the default width.
   */
  private setDialogWidth(width?: number) {
    const dialog = this.dialog;
    if (!dialog) return;
    if (width === undefined) {
      dialog.style.removeProperty('max-width');
      return;
    }
    const max = window.innerWidth - 16;
    dialog.style.maxWidth = `${Math.round(Math.min(max, Math.max(MIN_WIDTH, width)))}px`;
  }

  onResizeStart(event: PointerEvent, side: 1 | -1) {
    const dialog = this.dialog;
    if (!dialog) return;
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.resizeStart = { x: event.clientX, width: dialog.offsetWidth, side };
  }

  onResizeMove(event: PointerEvent) {
    const start = this.resizeStart;
    if (!start) return;
    this.setDialogWidth(start.width + 2 * start.side * (event.clientX - start.x));
  }

  onResizeEnd() {
    if (!this.resizeStart) return;
    this.resizeStart = undefined;
    const width = this.dialog?.offsetWidth;
    if (width) localStorage.setItem(OVERVIEW_WIDTH_KEY, String(width));
  }

  /** Double-click on an edge: back to the default width. */
  resetWidth() {
    localStorage.removeItem(OVERVIEW_WIDTH_KEY);
    this.setDialogWidth(undefined);
  }

  /** A row was clicked: show its unit on the timeline. */
  onRowSelected(unit: number) {
    this.selectedUnit = unit;
    const items = this.annotationStoreService.currentLevel?.items;
    this.timelineCursor =
      unit > 0 && items
        ? (items[unit - 1] as TrattAnnotationSegment).time.samples
        : 0;
  }

  /** The timeline was clicked: select that unit in the table and scroll to it. */
  onTimelinePicked(event: { unit: number; sample: number }) {
    this.selectedUnit = event.unit;
    this.timelineCursor = event.sample;
    this.overview?.selectRow(event.unit, true);
  }

  onSegmentInOverviewClicked(segnumber: number) {
    this.annotationStoreService.requestSegment(segnumber);
    this.close();
  }

  sendTranscription() {
    if (
      this.appStorage.useMode === LoginMode.ONLINE ||
      this.appStorage.useMode === LoginMode.DEMO
    ) {
      // TODO implement feedback form
      // this.feedback.saveFeedbackform();
    }

    if (this.feedback) {
      this.annotationStoreService.comment = this.feedback.comment;
    }
    this.transcriptionSend.emit();
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

    if (
      (this.sendValidTranscriptOnly &&
        this.annotationStoreService.transcriptValid) ||
      !this.sendValidTranscriptOnly
    ) {
      this.sendTranscription();
    }
  }

  override ngOnDestroy() {
    super.ngOnDestroy();
    this.shortcutsService.unregisterShortcutGroup('overview modal');
  }
}

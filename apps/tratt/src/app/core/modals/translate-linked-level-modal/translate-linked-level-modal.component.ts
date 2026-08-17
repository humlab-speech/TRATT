import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import {
  OctraAnnotationSegment,
  OctraAnnotationSegmentLevel,
} from '@octra/annotation';
import { getEnglishLanguageLabel } from '@octra/utilities';
import { Subscription } from 'rxjs';
import { HYMT_LANGUAGES } from '../../component/octra-dropzone/auto-translate-options.component';
import { LocalTranslationService } from '../../shared/service/local-translation.service';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { OctraModal } from '../types';

type Phase =
  | 'idle'
  | 'probing'
  | 'unavailable'
  | 'downloading'
  | 'initializing'
  | 'translating'
  | 'done'
  | 'error'
  | 'cancelled';

@Component({
  selector: 'octra-translate-linked-level-modal',
  standalone: true,
  imports: [FormsModule, TranslocoPipe],
  templateUrl: './translate-linked-level-modal.component.html',
})
export class TranslateLinkedLevelModalComponent
  extends OctraModal
  implements OnInit, OnDestroy
{
  public static options: NgbModalOptions = {
    keyboard: false,
    backdrop: 'static',
  };

  @Input() linkedLevelId!: number;
  @Input() linkedLevelName = '';
  @Input() sourceLevelName = '';

  private readonly translationService = inject(LocalTranslationService);
  private readonly annotationStore = inject(AnnotationStoreService);

  readonly languages = HYMT_LANGUAGES.map((code) => ({
    code,
    label: getEnglishLanguageLabel(code),
  }));

  sourceLanguage = 'en';
  targetLanguage = 'de';

  phase: Phase = 'idle';
  errorMessage = '';
  downloadFile = '';
  downloadLoaded = 0;
  downloadTotal = 0;
  segmentIndex = 0;
  segmentTotal = 0;
  filledCount = 0;
  estimatedBytes = 0;
  availabilityKind: 'direct' | 'pivot' | 'unavailable' | 'probing' | 'idle' =
    'idle';

  private subscription: Subscription | null = null;
  private probeSeq = 0;

  constructor(protected override activeModal: NgbActiveModal) {
    super('translateLinkedLevel', activeModal);
  }

  ngOnInit() {
    this.sourceLanguage = this.inferLanguageCode(this.sourceLevelName, 'en');
    this.targetLanguage = this.inferLanguageCode(
      this.linkedLevelName,
      this.sourceLanguage === 'en' ? 'de' : 'en',
    );
    void this.probeAvailability();
  }

  override ngOnDestroy() {
    this.cancelTranslation();
    super.ngOnDestroy?.();
  }

  private inferLanguageCode(levelName: string, fallback: string): string {
    if (!levelName) return fallback;
    const match = HYMT_LANGUAGES.find(
      (code) =>
        getEnglishLanguageLabel(code).toLowerCase() === levelName.toLowerCase(),
    );
    return match ?? fallback;
  }

  async onLanguageChange() {
    await this.probeAvailability();
  }

  private async probeAvailability() {
    if (this.sourceLanguage === this.targetLanguage) {
      this.availabilityKind = 'unavailable';
      this.estimatedBytes = 0;
      return;
    }
    const seq = ++this.probeSeq;
    this.availabilityKind = 'probing';
    const a = await this.translationService.resolveAvailability(
      this.sourceLanguage,
      this.targetLanguage,
    );
    if (seq !== this.probeSeq) return;
    this.availabilityKind = a.kind;
    this.estimatedBytes = a.kind === 'unavailable' ? 0 : a.estimatedBytes;
  }

  get canTranslate(): boolean {
    return (
      this.phase !== 'translating' &&
      this.phase !== 'downloading' &&
      this.phase !== 'initializing' &&
      this.availabilityKind !== 'unavailable' &&
      this.availabilityKind !== 'probing' &&
      this.sourceLanguage !== this.targetLanguage
    );
  }

  get isRunning(): boolean {
    return (
      this.phase === 'downloading' ||
      this.phase === 'initializing' ||
      this.phase === 'translating'
    );
  }

  translate() {
    const transcript = this.annotationStore.transcript;
    if (!transcript) return;
    const linkedLevel = transcript.levels.find(
      (l) => l.id === this.linkedLevelId,
    );
    if (!(linkedLevel instanceof OctraAnnotationSegmentLevel)) return;
    if (linkedLevel.linkedToLevelId === undefined) return;
    const sourceLevel = transcript.levels.find(
      (l) => l.id === linkedLevel.linkedToLevelId,
    );
    if (!(sourceLevel instanceof OctraAnnotationSegmentLevel)) return;

    const sourceTexts = sourceLevel.items.map((item) => {
      const primary =
        item.labels.find((l) => l.name === sourceLevel.name) ??
        item.labels.find((l) => l.name !== 'Speaker');
      return primary?.value ?? '';
    });

    this.errorMessage = '';
    this.segmentIndex = 0;
    this.segmentTotal = sourceTexts.length;
    this.filledCount = 0;
    this.phase = 'initializing';

    this.subscription = this.translationService
      .translateSegments(sourceTexts, {
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
        skipBrowserCache: false,
      })
      .subscribe({
        next: (event) => {
          switch (event.type) {
            case 'download-progress':
              this.phase = 'downloading';
              this.downloadFile = event.file;
              this.downloadLoaded = event.loaded;
              this.downloadTotal = event.total;
              break;
            case 'model-init':
              this.phase = 'initializing';
              break;
            case 'translate-start':
              this.phase = 'translating';
              this.segmentTotal = event.total;
              this.segmentIndex = 0;
              break;
            case 'segment-progress':
              this.phase = 'translating';
              this.segmentIndex = event.index;
              this.segmentTotal = event.total;
              break;
            case 'segments': {
              const emptyBefore = (
                linkedLevel as OctraAnnotationSegmentLevel<OctraAnnotationSegment>
              ).items.filter((item, idx) => {
                const primary =
                  item.labels.find((l) => l.name === linkedLevel.name) ??
                  item.labels.find((l) => l.name !== 'Speaker');
                const empty =
                  !primary || !primary.value || !primary.value.trim();
                const tr = event.translated.find((t) => t.id === idx);
                return empty && tr && tr.text.trim();
              }).length;
              this.filledCount = emptyBefore;
              this.annotationStore.applyTranslationToLinkedLevel(
                this.linkedLevelId,
                event.translated,
              );
              this.phase = 'done';
              break;
            }
            case 'error':
              this.errorMessage = event.message;
              this.phase = 'error';
              break;
          }
        },
        error: (err) => {
          this.errorMessage = err instanceof Error ? err.message : String(err);
          this.phase = 'error';
        },
      });
  }

  cancelTranslation() {
    if (this.subscription) {
      this.translationService.cancel();
      this.subscription.unsubscribe();
      this.subscription = null;
      if (this.isRunning) {
        this.phase = 'cancelled';
      }
    }
  }

  onCancelClick() {
    this.cancelTranslation();
  }

  onCloseClick() {
    this.cancelTranslation();
    this.close();
  }

  formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    return `${(bytes / 1e6).toFixed(0)} MB`;
  }
}

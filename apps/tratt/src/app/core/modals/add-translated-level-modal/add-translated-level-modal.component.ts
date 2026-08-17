import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import {
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { getEnglishLanguageLabel } from '@tratt/utilities';
import { HYMT_LANGUAGES } from '../../component/tratt-dropzone/auto-translate-options.component';
import { TrattModal } from '../types';

export interface AddTranslatedLevelResult {
  sourceLevelId: number;
  targetLanguage: string;
  targetLanguageLabel: string;
  autoTranslate: boolean;
}

@Component({
  selector: 'tratt-add-translated-level-modal',
  standalone: true,
  imports: [FormsModule, TranslocoPipe],
  templateUrl: './add-translated-level-modal.component.html',
})
export class AddTranslatedLevelModalComponent
  extends TrattModal
  implements OnInit
{
  public static options: NgbModalOptions = {
    keyboard: true,
    backdrop: true,
  };

  @Input() sourceLevels: TrattAnnotationAnyLevel<TrattAnnotationSegment>[] = [];

  readonly languages = HYMT_LANGUAGES.map((code) => ({
    code,
    label: getEnglishLanguageLabel(code),
  }));

  selectedSourceLevelId: number | null = null;
  targetLanguage = 'en';

  constructor(protected override activeModal: NgbActiveModal) {
    super('addTranslatedLevel', activeModal);
  }

  get eligibleSourceLevels(): TrattAnnotationSegmentLevel<TrattAnnotationSegment>[] {
    return this.sourceLevels.filter(
      (l) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId === undefined,
    ) as TrattAnnotationSegmentLevel<TrattAnnotationSegment>[];
  }

  ngOnInit() {
    const first = this.eligibleSourceLevels[0];
    if (first) {
      this.selectedSourceLevelId = first.id;
    }
  }

  get canSubmit(): boolean {
    return (
      this.selectedSourceLevelId !== null &&
      this.targetLanguage !== '' &&
      this.eligibleSourceLevels.length > 0
    );
  }

  submit(autoTranslate: boolean) {
    if (!this.canSubmit || this.selectedSourceLevelId === null) {
      return;
    }
    const result: AddTranslatedLevelResult = {
      sourceLevelId: this.selectedSourceLevelId,
      targetLanguage: this.targetLanguage,
      targetLanguageLabel: getEnglishLanguageLabel(this.targetLanguage),
      autoTranslate,
    };
    this.close(result);
  }
}

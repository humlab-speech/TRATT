import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import {
  OctraAnnotationAnyLevel,
  OctraAnnotationSegment,
  OctraAnnotationSegmentLevel,
} from '@octra/annotation';
import { getEnglishLanguageLabel } from '@octra/utilities';
import { HYMT_LANGUAGES } from '../../component/octra-dropzone/auto-translate-options.component';
import { OctraModal } from '../types';

export interface AddTranslatedLevelResult {
  sourceLevelId: number;
  targetLanguage: string;
  targetLanguageLabel: string;
  autoTranslate: boolean;
}

@Component({
  selector: 'octra-add-translated-level-modal',
  standalone: true,
  imports: [FormsModule, TranslocoPipe],
  templateUrl: './add-translated-level-modal.component.html',
})
export class AddTranslatedLevelModalComponent
  extends OctraModal
  implements OnInit
{
  public static options: NgbModalOptions = {
    keyboard: true,
    backdrop: true,
  };

  @Input() sourceLevels: OctraAnnotationAnyLevel<OctraAnnotationSegment>[] = [];

  readonly languages = HYMT_LANGUAGES.map((code) => ({
    code,
    label: getEnglishLanguageLabel(code),
  }));

  selectedSourceLevelId: number | null = null;
  targetLanguage = 'en';

  constructor(protected override activeModal: NgbActiveModal) {
    super('addTranslatedLevel', activeModal);
  }

  get eligibleSourceLevels(): OctraAnnotationSegmentLevel<OctraAnnotationSegment>[] {
    return this.sourceLevels.filter(
      (l) =>
        l instanceof OctraAnnotationSegmentLevel &&
        l.linkedToLevelId === undefined,
    ) as OctraAnnotationSegmentLevel<OctraAnnotationSegment>[];
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

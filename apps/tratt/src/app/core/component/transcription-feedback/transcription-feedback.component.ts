import { AsyncPipe } from '@angular/common';
import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { getProperties } from '@tratt/utilities';
import { map } from 'rxjs';
import { FeedBackForm } from '../../obj/FeedbackForm/FeedBackForm';
import { SettingsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import {
  AnnotationStoreService,
  FeedbackAssessment,
} from '../../store/login-mode/annotation/annotation.store.service';

@Component({
  selector: 'tratt-transcription-feedback',
  templateUrl: './transcription-feedback.component.html',
  styleUrls: ['./transcription-feedback.component.scss'],
  imports: [FormsModule, AsyncPipe, TranslocoPipe],
})
export class TranscriptionFeedbackComponent implements OnChanges, OnDestroy {
  @Input() feedbackData: FeedbackAssessment = {};
  @Input() showCommentFieldOnly = false;
  @ViewChild('fo', { static: true }) feedbackForm!: NgForm;

  comment = '';

  public get valid(): boolean {
    return this.feedbackForm.valid!;
  }

  internFeedbackData: {
    name: string;
    value: any;
  }[] = [];

  feedbackForm$ = this.annotationStoreService.feedback$.pipe(
    map((feedback) => (feedback instanceof FeedBackForm ? feedback : undefined)),
  );

  constructor(
    public annotationStoreService: AnnotationStoreService,
    public langService: TranslocoService,
    private appStorage: AppStorageService,
    private settingsService: SettingsService,
  ) {}

  translate(languages: any, lang: string): string {
    if (languages[lang] === undefined || languages[lang] === undefined) {
      return getProperties(languages)[0][1] as string;
    }
    return languages[lang];
  }

  public saveFeedbackform() {
    const feedback = this.annotationStoreService.feedback;
    // feedback can also be a legacy rating string ('SEVERE'/'SLIGHT'/'OK') or {}
    // (set via AppStorageService.feedback) — neither has .comment/.exportData().
    const isFeedbackForm = feedback instanceof FeedBackForm;

    if (
      isFeedbackForm &&
      feedback.comment !== undefined &&
      feedback.comment !== ''
    ) {
      this.annotationStoreService.changeFeedback({
        ...feedback,
        comment: feedback.comment.replace(/(<)|(\/>)|(>)/g, ' '),
      });
    }
    this.annotationStoreService.comment = isFeedbackForm
      ? feedback.comment
      : undefined;

    if (!this.settingsService.isTheme('shortAudioFiles')) {
      for (const [name, value] of getProperties(this.feedbackData)) {
        this.changeValue(name, value);
      }
      this.appStorage.save(
        'feedback',
        isFeedbackForm ? feedback.exportData() : undefined,
      );
    }
  }

  changeValue(control: string, value: any) {
    const feedback = this.annotationStoreService.feedback;
    if (!(feedback instanceof FeedBackForm)) {
      // feedback can also be a legacy rating string ('SEVERE'/'SLIGHT'/'OK') or {}
      // (set via AppStorageService.feedback) — neither has setValueForControl().
      return;
    }
    const result = feedback.setValueForControl(control, value.toString());
    this.annotationStoreService.changeFeedback(feedback);
    console.warn(result);
  }

  ngOnChanges(changes: SimpleChanges) {
    const feedbackData = changes['feedbackData'];

    if (feedbackData) {
      if (!feedbackData.currentValue) {
        this.internFeedbackData = [];
      } else {
        for (const key of Object.keys(feedbackData.currentValue)) {
          this.internFeedbackData.push({
            name: key,
            value: feedbackData.currentValue[key],
          });
        }
      }
    }
  }

  public checkBoxChanged(groupName: string, checkb: string) {
    const feedback = this.annotationStoreService.feedback;
    if (!(feedback instanceof FeedBackForm)) {
      // feedback can also be a legacy rating string ('SEVERE'/'SLIGHT'/'OK') or {}
      // (set via AppStorageService.feedback) — neither has a .groups property.
      return;
    }
    const groups = feedback.groups;
    if (!groups) {
      return;
    }
    for (const group of groups) {
      if (group.name === groupName) {
        for (const control of group.controls) {
          if (control.value === checkb) {
            control.custom.checked =
              control.custom.checked === undefined ||
              control.custom.checked === undefined
                ? true
                : !control.custom.checked;
            break;
          }
        }
        break;
      }
    }
  }

  ngOnDestroy() {
    this.annotationStoreService.comment = this.comment;
  }
}

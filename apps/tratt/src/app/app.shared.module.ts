import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslocoModule } from '@jsverse/transloco';
import {
  NgbDropdownModule,
  NgbPopoverModule,
  NgbToast,
} from '@ng-bootstrap/ng-bootstrap';
import { TrattComponentsModule } from '@tratt/ngx-components';
import { TrattUtilitiesModule } from '@tratt/ngx-utilities';
import { NgxJoditComponent } from 'ngx-jodit';
import {
  AlertComponent,
  DropZoneComponent,
  TranscrEditorComponent,
} from './core/component';
import { SignupComponent } from './core/component/authentication-component/signup/signup.component';
import { ValidationPopoverComponent } from './core/component/transcr-editor/validation-popover/validation-popover.component';
import { TranscrOverviewComponent } from './core/component/transcr-overview';
import { TranscriptionFeedbackComponent } from './core/component/transcription-feedback/transcription-feedback.component';
import { TrattDropzoneComponent } from './core/component/tratt-dropzone/tratt-dropzone.component';
import { ClipTextPipe } from './core/shared/clip-text.pipe';

/**
 * @deprecated Use SHARED_PROVIDERS from app.shared.providers.ts instead
 */
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    DragDropModule,
    NgbDropdownModule,
    NgbPopoverModule,
    TrattComponentsModule,
    TrattUtilitiesModule,
    TranslocoModule,
    NgbToast,
    NgxJoditComponent,
    TranscriptionFeedbackComponent,
    ClipTextPipe,
    TrattDropzoneComponent,
    DropZoneComponent,
    AlertComponent,
    SignupComponent,
    TranscrOverviewComponent,
    TranscrEditorComponent,
    ValidationPopoverComponent,
  ],
  exports: [
    TranscriptionFeedbackComponent,
    ClipTextPipe,
    TrattDropzoneComponent,
    DropZoneComponent,
    AlertComponent,
    SignupComponent,
    TranscrOverviewComponent,
    TranscrEditorComponent,
    ValidationPopoverComponent,
  ],
})
export class AppSharedModule {}

import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Provider } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslocoModule } from '@jsverse/transloco';
import {
  NgbDropdownModule,
  NgbPopoverModule,
  NgbToast,
} from '@ng-bootstrap/ng-bootstrap';
import {
  AsrOptionsComponent,
  TrattComponentsModule,
} from '@tratt/ngx-components';
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

export const SHARED_PROVIDERS: Provider[] = [
  // Angular core modules
  CommonModule,
  FormsModule,
  RouterModule,

  // CDK modules
  DragDropModule,

  // ng-bootstrap modules and components
  NgbDropdownModule,
  NgbPopoverModule,
  NgbToast,

  // TRATT libraries
  TrattComponentsModule,
  TrattUtilitiesModule,

  // i18n
  TranslocoModule,

  // Editor
  NgxJoditComponent,

  // Standalone components
  TranscriptionFeedbackComponent,
  TrattDropzoneComponent,
  DropZoneComponent,
  AlertComponent,
  SignupComponent,
  TranscrOverviewComponent,
  TranscrEditorComponent,
  ValidationPopoverComponent,
  AsrOptionsComponent,

  // Standalone pipes
  ClipTextPipe,
];

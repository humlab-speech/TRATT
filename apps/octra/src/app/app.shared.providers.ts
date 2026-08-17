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
  OctraComponentsModule,
} from '@octra/ngx-components';
import { OctraUtilitiesModule } from '@octra/ngx-utilities';
import { NgxJoditComponent } from 'ngx-jodit';
import {
  AlertComponent,
  DropZoneComponent,
  TranscrEditorComponent,
} from './core/component';
import { SignupComponent } from './core/component/authentication-component/signup/signup.component';
import { OctraDropzoneComponent } from './core/component/octra-dropzone/octra-dropzone.component';
import { ValidationPopoverComponent } from './core/component/transcr-editor/validation-popover/validation-popover.component';
import { TranscrOverviewComponent } from './core/component/transcr-overview';
import { TranscriptionFeedbackComponent } from './core/component/transcription-feedback/transcription-feedback.component';
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
  OctraComponentsModule,
  OctraUtilitiesModule,

  // i18n
  TranslocoModule,

  // Editor
  NgxJoditComponent,

  // Standalone components
  TranscriptionFeedbackComponent,
  OctraDropzoneComponent,
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

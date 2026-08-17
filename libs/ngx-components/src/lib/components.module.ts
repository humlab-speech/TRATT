import { CommonModule } from '@angular/common';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TrattUtilitiesModule } from '@tratt/ngx-utilities';
import { AsrOptionsComponent } from './components/asr-options';
import { AudioViewerComponent } from './components/audio/audio-viewer';
import { AudioplayerComponent } from './components/audio/audioplayer';

@NgModule({
  declarations: [],
  exports: [AudioplayerComponent, AudioViewerComponent, AsrOptionsComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TrattUtilitiesModule,
    AudioplayerComponent,
    AudioViewerComponent,
    AsrOptionsComponent,
  ],
  providers: [provideHttpClient(withInterceptorsFromDi())],
})
export class TrattComponentsModule {}

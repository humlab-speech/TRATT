import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TrattDropzoneComponent } from '../../component/tratt-dropzone/tratt-dropzone.component';
import { AudioService } from '../../shared/service/audio.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';

@Component({
  selector: 'tratt-workbench',
  templateUrl: './workbench.component.html',
  styleUrls: ['./workbench.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TrattDropzoneComponent, TranslocoPipe],
})
export class WorkbenchComponent {
  @ViewChild(TrattDropzoneComponent) dropzone?: TrattDropzoneComponent;
  sessionStarting = false;

  constructor(
    private audioService: AudioService,
    private authStoreService: AuthenticationStoreService,
  ) {}

  startSession(removeData: boolean): void {
    const manager = this.dropzone?.audioManager;
    if (!manager) {
      return;
    }
    const files = this.dropzone!.files
      .map((a) => a.file.file!)
      .filter(Boolean) as File[];
    if (files.length === 0) {
      return;
    }
    this.sessionStarting = true;
    const annotation = this.dropzone!.hasAnnotation
      ? this.dropzone!.oannotation
      : undefined;
    this.audioService.registerAudioManager(manager);
    this.dropzone!.releaseAudioManager();
    this.authStoreService.loginLocal(files, annotation, removeData);
  }
}

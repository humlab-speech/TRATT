import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { navigateTo } from '@octra/ngx-utilities';
import { DefaultComponent } from '../../../component/default.component';
import { NavbarService } from '../../../component/navbar/navbar.service';
import { UserInteractionsService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { AnnotationStoreService } from '../../../store/login-mode/annotation/annotation.store.service';

@Component({
  selector: 'octra-transcription-submitted',
  templateUrl: './transcription-end.component.html',
  styleUrls: ['./transcription-end.component.scss'],
  imports: [TranslocoPipe],
})
export class TranscriptionEndComponent extends DefaultComponent {
  constructor(
    private router: Router,
    private appStorage: AppStorageService,
    private annotationStoreService: AnnotationStoreService,
    private uiService: UserInteractionsService,
    private navService: NavbarService,
  ) {
    super();
    this.navService.showInterfaces = false;
    this.navService.showExport = false;
    this.navService.dataloaded = false;
  }
  leave() {
    this.annotationStoreService.endTranscription();

    this.uiService.elements = [];
    this.appStorage.logout(true);
  }

  backToProjectsList() {
    this.annotationStoreService.endTranscription();
    this.uiService.elements = [];
    console.warn('backToProjectsList');
    navigateTo(this.router, ['intern/projects']);
  }
}

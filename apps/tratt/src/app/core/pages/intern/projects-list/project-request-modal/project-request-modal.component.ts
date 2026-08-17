import { Component, SecurityContext } from '@angular/core';
import {
  DomSanitizer,
  SafeHtml,
  SafeResourceUrl,
} from '@angular/platform-browser';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { SubscriberComponent } from '@octra/ngx-utilities';
import { ApplicationStoreService } from '../../../../store/application/application-store.service';

@Component({
  selector: 'octra-project-request-modal',
  templateUrl: './project-request-modal.component.html',
  styleUrls: ['./project-request-modal.component.scss'],
  imports: [TranslocoPipe],
})
export class ProjectRequestModalComponent extends SubscriberComponent {
  public static options: NgbModalOptions = {
    keyboard: false,
    backdrop: 'static',
    fullscreen: 'md',
    size: 'xl',
  };
  public message = '';
  protected supportEmailURL?: SafeResourceUrl;
  protected introductionHTML?: SafeHtml;
  protected description?: SafeHtml;

  constructor(
    protected activeModal: NgbActiveModal,
    protected api: OctraAPIService,
    private sanitizer: DomSanitizer,
    protected appStorage: ApplicationStoreService,
    private transloco: TranslocoService,
  ) {
    super();
    if (this.api.appProperties?.support?.admin_email) {
      this.supportEmailURL = this.sanitizer.bypassSecurityTrustResourceUrl(
        `mailto:${this.api.appProperties?.support?.admin_email}`,
      );
    }

    this.subscribe(this.appStorage.appconfig$, {
      next: (appSettings) => {
        const introRaw = this.transloco.translate(
          'modals.create project request.introduction',
          {
            octraBackendURL:
              "<a href='" +
              appSettings?.octraBackend?.url +
              "' target='_blank'>OCTRA-Backend</a>",
          },
        );
        this.introductionHTML = this.sanitizer.bypassSecurityTrustHtml(
          this.sanitizer.sanitize(SecurityContext.HTML, introRaw) ?? '',
        );
        const adminEmail = this.api.appProperties?.support?.admin_email;
        const descRaw = this.transloco.translate(
          'modals.create project request.description',
          {
            adminEmail: adminEmail
              ? `<a href="mailto:${adminEmail}">${adminEmail}</a>`
              : '',
          },
        );
        this.description = this.sanitizer.bypassSecurityTrustHtml(
          this.sanitizer.sanitize(SecurityContext.HTML, descRaw) ?? '',
        );
      },
    });
  }
}

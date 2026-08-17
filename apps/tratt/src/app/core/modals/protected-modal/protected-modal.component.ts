import { Component, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TrattModal } from '../types';

@Component({
  selector: 'tratt-protected-modal',
  templateUrl: './protected-modal.component.html',
  styleUrls: ['./protected-modal.component.scss'],
})
export class ProtectedModalComponent extends TrattModal {
  public htmlMessage = '';

  public get sanitizedHTMLMessage() {
    return this.sanitizer.sanitize(SecurityContext.HTML, this.htmlMessage);
  }

  constructor(
    protected override activeModal: NgbActiveModal,
    private sanitizer: DomSanitizer,
  ) {
    super('messageModal', activeModal);
  }
}

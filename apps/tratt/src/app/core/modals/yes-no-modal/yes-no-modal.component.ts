import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { TrattModal } from '../types';

@Component({
  selector: 'tratt-yes-no-modal',
  templateUrl: './yes-no-modal.component.html',
  styleUrls: ['./yes-no-modal.component.scss'],
  imports: [TranslocoPipe],
})
export class YesNoModalComponent extends TrattModal {
  public static options: NgbModalOptions = {
    keyboard: false,
    backdrop: 'static',
    size: 'md',
  };
  public message = '';

  constructor(protected override activeModal: NgbActiveModal) {
    super('yesNoModal', activeModal);
  }
}

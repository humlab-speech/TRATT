import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TrattModal } from '../types';

@Component({
  selector: 'tratt-login-invalid-modal',
  templateUrl: './login-invalid-modal.component.html',
  styleUrls: ['./login-invalid-modal.component.scss'],
  imports: [TranslocoPipe],
})
export class LoginInvalidModalComponent extends TrattModal {
  constructor(protected override activeModal: NgbActiveModal) {
    super('yesNoModal', activeModal);
  }
}

import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { DefaultComponent } from '../../component/default.component';

@Component({
  selector: 'octra-unsaved-recording-modal',
  templateUrl: './unsaved-recording-modal.component.html',
  standalone: true,
  imports: [TranslocoPipe],
})
export class UnsavedRecordingModalComponent extends DefaultComponent {
  static options: NgbModalOptions = {
    size: 'md',
    keyboard: false,
    backdrop: 'static',
  };

  constructor(private activeModal: NgbActiveModal) {
    super();
  }

  close(action: 'export' | 'leave' | 'cancel'): void {
    this.activeModal.close(action);
  }
}

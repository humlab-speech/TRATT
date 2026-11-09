import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { TrattModal } from '../types';

/** What the user decided; the modal closes with undefined when cancelled. */
export interface VispBundleStatus {
  finishedEditing: boolean;
  comment: string;
}

/**
 * A VISP bundle's "finished" mark and comment, which the project owner sees in
 * VISP. Kept out of the bundle list, behind a small button on each row.
 */
@Component({
  selector: 'tratt-visp-bundle-status-modal',
  templateUrl: './visp-bundle-status-modal.component.html',
  styleUrls: ['./visp-bundle-status-modal.component.scss'],
  imports: [FormsModule, TranslocoPipe],
})
export class VispBundleStatusModalComponent extends TrattModal {
  public static options: NgbModalOptions = {
    keyboard: true,
    backdrop: true,
    size: 'md',
  };

  /** Set by openModal(). */
  public bundleName = '';
  public finishedEditing = false;
  public comment = '';

  constructor(protected override activeModal: NgbActiveModal) {
    super('vispBundleStatusModal', activeModal);
  }

  save(): void {
    const result: VispBundleStatus = {
      finishedEditing: this.finishedEditing,
      comment: this.comment.trim(),
    };
    this.close(result);
  }
}

import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { TrattModal } from '../types';

/**
 * Answer emitted by `BundleReattachMismatchModalComponent.close(...)` when
 * the picked file's fingerprint ({name, size, type, lastModified}) doesn't
 * match the bundle's persisted `SessionFile` closely enough to auto-accept.
 */
export enum BundleReattachMismatchAnswer {
  USE_ANYWAY = 'USE_ANYWAY',
  CANCEL = 'CANCEL',
}

@Component({
  selector: 'tratt-bundle-reattach-mismatch-modal',
  templateUrl: './bundle-reattach-mismatch-modal.component.html',
  styleUrls: ['./bundle-reattach-mismatch-modal.component.scss'],
  imports: [TranslocoPipe],
})
export class BundleReattachMismatchModalComponent extends TrattModal {
  public static options: NgbModalOptions = {
    keyboard: false,
    backdrop: true,
  };

  /** The bundle's originally recorded file name/size, for display. Either may be
   * `undefined` if the bundle predates SessionFile round-tripping these fields. */
  expectedName?: string;
  expectedSize?: number;

  /** The file the user just picked, for display. */
  actualName = '';
  actualSize = 0;

  constructor(protected override activeModal: NgbActiveModal) {
    super('bundleReattachMismatch', activeModal);
  }
}

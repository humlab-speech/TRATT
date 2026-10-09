import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { ManualLinkService } from '../../shared/service';
import { TrattModal } from '../types';

@Component({
  selector: 'tratt-help-modal',
  templateUrl: './help-modal.component.html',
  styleUrls: ['./help-modal.component.scss'],
  imports: [TranslocoPipe],
})
export class HelpModalComponent extends TrattModal {
  public static options: NgbModalOptions = {
    size: 'xl',
    backdrop: true,
  };
  public visible = false;

  private manualLink = inject(ManualLinkService);

  /**
   * The manual chapter for the page behind this dialog, so that Help opened in
   * the workbench lands on the workbench chapter rather than the front page.
   * Shares its route table with the navigation bar's Manual entry.
   */
  get manualURL(): string {
    return this.manualLink.href;
  }

  /** Keyboard-shortcut reference: the page most often wanted mid-task. */
  get shortcutsURL(): string {
    return this.manualLink.shortcutsHref;
  }

  @ViewChild('modal', { static: true }) modal!: any;
  @ViewChild('content', { static: false }) contentElement!: ElementRef;

  constructor(protected override activeModal: NgbActiveModal) {
    super('HelpModalComponent', activeModal);
  }
}

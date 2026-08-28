import { Component, ElementRef, ViewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { AppInfo } from '../../../app.info';
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

  /** Landing page of the TRATT manual. */
  get manualURL(): string {
    return AppInfo.manualURL;
  }

  /** Keyboard-shortcut reference — the page most often wanted mid-task. */
  get shortcutsURL(): string {
    return AppInfo.manualLink('shortcuts');
  }

  @ViewChild('modal', { static: true }) modal!: any;
  @ViewChild('content', { static: false }) contentElement!: ElementRef;

  constructor(protected override activeModal: NgbActiveModal) {
    super('HelpModalComponent', activeModal);
  }
}

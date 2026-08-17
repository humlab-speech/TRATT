import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  NgbActiveModal,
  NgbModalOptions,
  NgbPopover,
  NgbTooltip,
} from '@ng-bootstrap/ng-bootstrap';
import { Converter } from '@tratt/annotation';
import { TrattUtilitiesModule } from '@tratt/ngx-utilities';
import { AudioFormat } from '@tratt/web-media';
import { AppInfo } from '../../../app.info';
import { TrattModal } from '../types';

@Component({
  selector: 'tratt-supportedfiles-modal',
  templateUrl: './supportedfiles-modal.component.html',
  styleUrls: ['./supportedfiles-modal.component.scss'],
  imports: [NgbPopover, NgbTooltip, TranslocoPipe, TrattUtilitiesModule],
})
export class SupportedFilesModalComponent extends TrattModal {
  public static options: NgbModalOptions = {
    backdrop: true,
    size: 'lg',
  };

  AppInfo = AppInfo;

  supportedFormats: AudioFormat[] = AppInfo.audioformats;
  converters: Converter[] = [];

  constructor(protected override activeModal: NgbActiveModal) {
    super('supportedFilesModal', activeModal);
    this.converters = AppInfo.converters.map((a) => {
      (a as any)._applications = (a as any)._applications.filter(
        (a: any) => a.application.name !== 'Octra',
      );
      return a;
    });
  }
}

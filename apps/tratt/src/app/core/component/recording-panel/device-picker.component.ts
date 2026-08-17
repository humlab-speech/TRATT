import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  NgbDropdownModule,
  NgbTooltipModule,
} from '@ng-bootstrap/ng-bootstrap';
import { RecordingDevicesService } from '../../shared/service/recording-devices.service';

@Component({
  selector: 'octra-device-picker',
  standalone: true,
  templateUrl: './device-picker.component.html',
  styleUrls: ['./device-picker.component.scss'],
  imports: [
    AsyncPipe,
    NgFor,
    NgIf,
    NgbDropdownModule,
    NgbTooltipModule,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicePickerComponent implements OnInit {
  @Input() mode: 'audio' | 'audio+video' = 'audio';

  constructor(public devicesSvc: RecordingDevicesService) {}

  async ngOnInit(): Promise<void> {
    await this.devicesSvc.refresh();
  }

  async onRequestPermission(): Promise<void> {
    try {
      await this.devicesSvc.requestPermissionAndEnumerate();
    } catch {
      // swallow — permission denial leaves hasPermission$ false
    }
  }
}

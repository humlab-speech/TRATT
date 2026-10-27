import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';

export interface DataSelectorHeader {
  name: string;
  durationText?: string;
  sampleRateKhz?: number;
  channels?: number;
  sizeText?: string;
}

@Component({
  selector: 'tratt-data-selector',
  imports: [NgbDropdownModule, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-selector.component.html',
  styleUrl: './data-selector.component.scss',
})
export class DataSelectorComponent {
  readonly header = input.required<DataSelectorHeader>();
  readonly files = input<{ id: string; name: string }[]>([]);
  readonly selectedId = input<string | undefined>(undefined);
  readonly selectFile = output<string>();

  readonly position = computed(() => {
    const i = this.files().findIndex((f) => f.id === this.selectedId());
    return i < 0 ? undefined : { index: i + 1, total: this.files().length };
  });
}

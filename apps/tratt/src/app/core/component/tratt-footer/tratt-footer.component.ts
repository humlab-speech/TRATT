import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsService } from '../../shared/service';

@Component({
  selector: 'tratt-footer',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tratt-footer.component.html',
  styleUrl: './tratt-footer.component.scss',
})
export class TrattFooterComponent {
  private readonly settings = inject(SettingsService);
  readonly base = 'https://sprakbanken.se';
  get node() {
    return this.settings.appSettings?.tratt?.branding?.node;
  }
}

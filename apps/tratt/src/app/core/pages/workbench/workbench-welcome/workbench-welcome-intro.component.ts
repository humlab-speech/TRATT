import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { MaintenanceBannerComponent } from '../../../component/maintenance/maintenance-banner/maint-banner.component';
import { AppSettings } from '../../../obj';
import { SettingsService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { CompatibilityService } from '../../../shared/service/compatibility.service';
import { BrowserTestComponent } from '../../browser-test/browser-test.component';

/**
 * The top of the start page, above the rail's upload and record tabs:
 * notices, the title, and the browser check.
 */
@Component({
  selector: 'tratt-workbench-welcome-intro',
  templateUrl: './workbench-welcome-intro.component.html',
  styleUrls: ['./workbench-welcome-intro.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, MaintenanceBannerComponent, BrowserTestComponent],
})
export class WorkbenchWelcomeIntroComponent {
  protected readonly settingsService = inject(SettingsService);
  protected readonly appStorage = inject(AppStorageService);

  /** The result of the browser check; the workbench hides its tabs on false. */
  readonly compatibility = output<boolean>();

  /** Unknown until the check has run. */
  protected readonly compatibleBrowser = signal<boolean | undefined>(undefined);

  // Typed as always set, but absent until the app config has loaded.
  protected get trattSettings(): AppSettings['tratt'] | undefined {
    return this.settingsService.appSettings?.tratt;
  }

  constructor() {
    inject(CompatibilityService)
      .testCompability()
      .catch(() => true)
      .then((result) => {
        this.compatibleBrowser.set(result);
        this.compatibility.emit(result);
      });
  }
}

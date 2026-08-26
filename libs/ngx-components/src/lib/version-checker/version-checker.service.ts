import { ApplicationRef, Injectable } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { SubscriberComponent } from '@tratt/ngx-utilities';
import { interval } from 'rxjs';

export class VersionCheckerOptions {
  interval = 5000;

  constructor(partial?: Partial<VersionCheckerOptions>) {
    if (partial) Object.assign(this, partial);
  }
}

@Injectable({ providedIn: 'root' })
export class VersionCheckerService extends SubscriberComponent {
  isNewVersionAvailable = false;
  private options = new VersionCheckerOptions();

  constructor(
    private swUpdate: SwUpdate,
    private appRef: ApplicationRef,
  ) {
    super();
  }

  init(options?: VersionCheckerOptions) {
    this.options = options ? new VersionCheckerOptions(options) : this.options;
    this.checkForUpdate();
  }

  checkForUpdate(): void {
    this.subscriptionManager.destroy();
    if (!this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.checkForUpdate();

    // check for updates every 5 minutes
    this.subscribe(interval(this.options.interval), {
      next: () => {
        this.swUpdate.checkForUpdate();
      },
    });

    this.subscribe(this.swUpdate.versionUpdates, {
      next: (evt) => {
        switch (evt.type) {
          case 'VERSION_DETECTED':
            break;
          case 'VERSION_READY':
            this.isNewVersionAvailable = true;
            break;
          case 'VERSION_INSTALLATION_FAILED':
            break;
        }
      },
    });
  }

  applyUpdate() {
    // Reload the page to update to the latest version after the new version is activated
    document.location.reload();
  }
}

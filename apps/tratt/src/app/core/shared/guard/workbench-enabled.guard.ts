import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../../../environments/environment';

export const WORKBENCH_ENABLED_GUARD: CanActivateFn = () => {
  if (environment.workbenchEnabled) {
    return true;
  }
  return inject(Router).parseUrl('/local');
};

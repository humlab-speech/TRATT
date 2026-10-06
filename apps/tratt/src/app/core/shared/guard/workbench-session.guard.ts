import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { Store } from '@ngrx/store';
import { combineLatest, map, take } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { LoginMode } from '../../store';
import {
  selectLoggedIn,
  selectMode,
} from '../../store/application/application.selectors';
import { RoutingService } from '../service/routing.service';

/**
 * /workbench's replacement for `ALoginGuard`.
 *
 * `ALoginGuard` (shared with /login and /local) bounces EVERY logged-in
 * session to `/intern/transcr`. For the workbench that is wrong: a LOCAL
 * session is exactly what the workbench hosts, and `loggedIn` survives a
 * page reload via sessionStorage — so reloading /workbench after working on
 * any file sent the user to /intern/transcr, which (no audio in memory after
 * a reload) forwarded them on to the legacy single-file
 * /intern/transcr/reload-file page, out of the workbench altogether.
 *
 * LOCAL (or no mode yet) is allowed through; restored bundles then show up
 * in the left rail with "Attach file…". Server-backed sessions (online /
 * demo / URL) keep the old behaviour: the workbench is LOCAL-only.
 */
export const WORKBENCH_SESSION_GUARD: CanActivateFn = (route) => {
  const store = inject(Store);
  const routingService = inject(RoutingService);

  return combineLatest([
    store.select(selectLoggedIn),
    store.select(selectMode),
  ]).pipe(
    take(1),
    map(([loggedIn, mode]) => {
      if (!loggedIn || mode === undefined || mode === LoginMode.LOCAL) {
        return true;
      }
      const params = { ...AppInfo.queryParamsHandling };
      params.fragment = route.fragment ?? undefined;
      params.queryParams = route.queryParams;
      routingService
        .navigate('workbench session guard', ['/intern/transcr'], params)
        .catch((error) => {
          console.error(error);
        });
      return false;
    }),
  );
};

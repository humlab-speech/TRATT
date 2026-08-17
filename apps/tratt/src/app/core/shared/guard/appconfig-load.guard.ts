import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  RouterStateSnapshot,
} from '@angular/router';
import { map, take } from 'rxjs';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { RoutingService } from '../service/routing.service';

export const CONFIG_LOADED_GUARD: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const applicationStoreService = inject(ApplicationStoreService);
  return applicationStoreService.appconfig$.pipe(
    map((a) => {
      return a !== undefined;
    }),
  );
};
/*
export const APP_INITIALIZED_GUARD: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const routingService: RoutingService = inject(RoutingService);
  return inject(ApplicationStoreService).appInitialized.pipe(
    take(1),
    map((a) => {
      if (!a) {
        routingService.navigate(
          'guard app init, to load',
          ['/load'],
          AppInfo.queryParamsHandling,
        );
      }
      return a;
    }),
  );
};
*/
export const APP_INITIALIZED_GUARD: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const routingService: RoutingService = inject(RoutingService);
  const appStoreService: ApplicationStoreService = inject(
    ApplicationStoreService,
  );

  console.log(
    'APP_INITIALIZED_GUARD: Activated for route:',
    route.url.join('/'),
  );

  appStoreService.appInitialized$.pipe(take(1)).subscribe((currentState) => {
    console.log(
      'APP_INITIALIZED_GUARD: Current appInitialized state:',
      currentState,
    );
  });

  return appStoreService.appInitialized$.pipe(
    take(1),
    map((a: any) => {
      console.log('APP_INITIALIZED_GUARD: appInitialized emitted:', a);
      if (!a) {
        console.log(
          'APP_INITIALIZED_GUARD: appInitialized is false, navigating to /load',
        );
        routingService.navigate(
          'guard app init, to load',
          ['/load'],
          undefined,
          null, // don't merge unknown params into the /load redirect
        );
        console.log('APP_INITIALIZED_GUARD: Navigation to /load initiated');
      } else {
        console.log(
          'APP_INITIALIZED_GUARD: appInitialized is true, allowing navigation',
        );
      }
      return a;
    }),
  );
};

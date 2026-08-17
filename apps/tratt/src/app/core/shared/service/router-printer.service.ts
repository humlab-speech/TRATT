import { Injectable } from '@angular/core';
import { Route, Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class RoutePrinterService {
  constructor(private router: Router) {}

  printRoutes(): void {
    console.log('Registered Angular Routes:');
    //this.logRoutes(this.router.config);
  }

  private logRoutes(routes: Route[], parentPath = '') {
    for (const route of routes) {
      const fullPath = parentPath + '/' + (route.path || '');
      console.log(fullPath);

      if (route.children) {
        this.logRoutes(route.children, fullPath);
      } else if (
        route.loadChildren &&
        typeof route.loadChildren !== 'function'
      ) {
        // Lazy-loaded module that has been resolved
        const loadedRoutes = (route as any)._loadedConfig?.routes || [];
        this.logRoutes(loadedRoutes, fullPath);
      }
    }
  }
}

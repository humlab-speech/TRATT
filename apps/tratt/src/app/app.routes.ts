import { Routes } from '@angular/router';

import { ALoginGuard, LoadingComponent } from './core/pages';
import { LoginComponent } from './core/pages/login';
import {
  APP_INITIALIZED_GUARD,
  CONFIG_LOADED_GUARD,
} from './core/shared/guard/appconfig-load.guard';
import { IDB_LOADED_GUARD } from './core/shared/guard/idb.activateguard';

export const APP_ROUTES: Routes = [
  { path: 'load', component: LoadingComponent },
  { path: '', redirectTo: '/local', pathMatch: 'full' },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [APP_INITIALIZED_GUARD, ALoginGuard],
  },
  {
    path: 'local',
    component: LoginComponent,
    canActivate: [APP_INITIALIZED_GUARD, ALoginGuard],
    data: { localOnly: true },
  },
  {
    path: 'intern',
    loadChildren: () =>
      import('./core/pages/intern/intern-routing.module').then(
        (m) => m.InternRoutingModule,
      ),
    canActivate: [APP_INITIALIZED_GUARD],
  },
  {
    path: 'test',
    loadComponent: () =>
      import('./core/pages/browser-test/browser-test.component').then(
        (m) => m.BrowserTestComponent,
      ),
    canActivate: [CONFIG_LOADED_GUARD, IDB_LOADED_GUARD],
  },
  {
    path: '404',
    loadComponent: () =>
      import('./core/pages/error404/error404.component').then(
        (m) => m.Error404Component,
      ),
    canActivate: [APP_INITIALIZED_GUARD],
  },
  {
    path: 'news',
    loadComponent: () =>
      import('./core/pages/news/news.component').then((m) => m.NewsComponent),
    canActivate: [APP_INITIALIZED_GUARD, CONFIG_LOADED_GUARD, IDB_LOADED_GUARD],
  },
  {
    path: 'features',
    loadComponent: () =>
      import('./core/pages/features/features.component').then(
        (m) => m.FeaturesComponent,
      ),
    canActivate: [APP_INITIALIZED_GUARD, CONFIG_LOADED_GUARD, IDB_LOADED_GUARD],
  },
  {
    path: 'help-tools',
    loadComponent: () =>
      import('./core/pages/help-tools/help-tools.component').then(
        (m) => m.HelpToolsComponent,
      ),
    canActivate: [APP_INITIALIZED_GUARD, CONFIG_LOADED_GUARD],
  },
  {
    path: 'stresstest',
    loadComponent: () =>
      import('./core/tools/stresstest/stresstest.component').then(
        (m) => m.StresstestComponent,
      ),
    canActivate: [APP_INITIALIZED_GUARD, CONFIG_LOADED_GUARD],
  },
  {
    path: 'visp-task/project/:projectId/session/:sessionId/bundle/:bundleId',
    loadComponent: () =>
      import('./core/pages/intern/visp-task/visp-task.component').then(
        (m) => m.VispTaskComponent,
      ),
  },
  { path: '**', redirectTo: '' },
];

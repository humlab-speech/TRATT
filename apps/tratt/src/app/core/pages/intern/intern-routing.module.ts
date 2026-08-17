import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MODALS_PROVIDERS } from '../../modals/modals.providers';
import { TranscActivateGuard } from '../../shared/guard/transcr.activateguard';
import { AUTHENTICATED_GUARD } from './intern.activateguard';
import { ReloadFileGuard } from './reload-file/reload-file.activateguard';

const MEMBER_ROUTES: Routes = [
  {
    path: 'projects',
    loadComponent: () =>
      import('./projects-list/projects-list.component').then(
        (m) => m.ProjectsListComponent,
      ),
    canActivate: [AUTHENTICATED_GUARD],
  },
  {
    path: 'transcr',
    loadComponent: () =>
      import('./transcription/transcription.component').then(
        (m) => m.TranscriptionComponent,
      ),
    canActivate: [AUTHENTICATED_GUARD, TranscActivateGuard],
  },
  {
    path: 'transcr/end',
    loadComponent: () =>
      import('./transcription-end/transcription-end.component').then(
        (m) => m.TranscriptionEndComponent,
      ),
  },
  {
    path: 'transcr/reload-file',
    loadComponent: () =>
      import('./reload-file/reload-file.component').then(
        (m) => m.ReloadFileComponent,
      ),
    canActivate: [ReloadFileGuard],
  },
  {
    path: 'auth',
    loadComponent: () =>
      import('./auth/auth.component').then((m) => m.AuthComponent),
  },
  {
    path: 'auth-success',
    loadComponent: () =>
      import('./auth-success/auth-success.page.component').then(
        (m) => m.AuthSuccessPageComponent,
      ),
  },
  { path: '', redirectTo: '/load', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forChild(MEMBER_ROUTES), MODALS_PROVIDERS],
  exports: [RouterModule],
})
export class InternRoutingModule {}

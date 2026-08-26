import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AccountLoginMethod, ProjectDto } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { filter, take } from 'rxjs';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { LoginMode, RootState } from '../../../store';
import { APIActions } from '../../../store/api';
import { ApplicationStoreService } from '../../../store/application/application-store.service';
import { AuthenticationStoreService } from '../../../store/authentication';

@Component({
  selector: 'tratt-visp-task',
  imports: [CommonModule],
  templateUrl: './visp-task.component.html',
  styleUrl: './visp-task.component.scss',
})
export class VispTaskComponent implements OnInit {
  constructor(
    private route: ActivatedRoute,
    private apiService: OctraAPIService,
    private appStorage: AppStorageService,
    private router: Router,
    private store: Store<RootState>,
    private authStoreService: AuthenticationStoreService,
    private appStoreService: ApplicationStoreService,
    private destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    this.startTask();
  }

  startTask() {
    const projectId = this.route.snapshot.paramMap.get('projectId');

    if (!projectId) {
      console.error('No project ID provided');
      return;
    }

    // Check current authentication and application state
    const authenticated = this.authStoreService.authenticated();
    const appMode = this.appStoreService.useMode;
    const loggedIn = this.appStoreService.loggedIn();


    if (authenticated && appMode === LoginMode.ONLINE && loggedIn) {
      // User is already authenticated and in online mode
      this.fetchProjectAndStartAnnotation(projectId);
    } else {
      // User needs to be authenticated first
      this.authenticateAndStartAnnotation(projectId);
    }
  }

  private authenticateAndStartAnnotation(projectId: string) {
    // Initialize API service first
    const apiUrl = 'http://localhost:3000';
    const appToken = '';

    this.store.dispatch(
      APIActions.init.do({
        url: apiUrl,
        appToken: appToken,
        authType: AccountLoginMethod.local,
        authenticated: false,
      }),
    );

    // Wait for API initialization and then authenticate
    this.store
      .select((state) => state.authentication.serverOnline)
      .pipe(
        filter((serverOnline) => serverOnline !== undefined),
        take(1),
      )
      .subscribe((serverOnline) => {
        if (serverOnline) {
          // For VISP tasks, we'll use a simple local authentication
          // You might need to adjust this based on your authentication requirements
          this.authStoreService.loginOnline(
            AccountLoginMethod.local,
            'visp-user', // You might want to get this from the project or session
            undefined, // No password for local method
          );

          // Wait for successful authentication - use toObservable to convert signal to observable
          const authenticatedSignal = this.authStoreService.authenticated;
          toObservable(authenticatedSignal)
            .pipe(
              filter((authenticated) => authenticated === true),
              take(1),
              takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(() => {
              this.fetchProjectAndStartAnnotation(projectId);
            });

          // Handle authentication failure — takeUntilDestroyed prevents leak when
          // authentication succeeds (filter never fires, subscription stays open).
          this.store
            .select((state) => state.authentication.loginErrorMessage)
            .pipe(
              filter((error) => !!error),
              take(1),
              takeUntilDestroyed(this.destroyRef),
            )
            .subscribe((error) => {
              console.error('Authentication failed:', error);
              // You might want to show an error message or redirect
            });
        } else {
          console.error('API server is not online');
          // Handle offline server case
        }
      });
  }

  private fetchProjectAndStartAnnotation(projectId: string) {
    fetch('http://localhost:3000/visp/project/' + projectId, {})
      .then((response) => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then((trattProject: ProjectDto) => {
        // Start the online annotation process
        this.appStorage.startOnlineAnnotation(trattProject);

        // Navigate to transcription page
        this.router.navigate(['/intern/transcr']);
      })
      .catch((error) => {
        console.error('Error fetching VISP project:', error);
        // Handle project fetch error
      });
  }
}

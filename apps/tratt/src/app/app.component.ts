import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  TrattComponentsModule,
  VersionCheckerService,
  VersionNotificationComponent,
} from '@tratt/ngx-components';
import { environment } from '../environments/environment';
import { AlertComponent, NavigationComponent } from './core/component';
import { DefaultComponent } from './core/component/default.component';
import { TrattModalComponent } from './core/modals/tratt-modal';
import { MultiThreadingService } from './core/shared/multi-threading/multi-threading.service';
import { AppStorageService } from './core/shared/service/appstorage.service';
import { RoutePrinterService } from './core/shared/service/router-printer.service';
import { LoginMode } from './core/store';
import { ApplicationStoreService } from './core/store/application/application-store.service';
import { AnnotationStoreService } from './core/store/login-mode/annotation/annotation.store.service';

@Component({
  selector: 'tratt-app',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [
    AlertComponent,
    TrattModalComponent,
    RouterOutlet,
    TrattComponentsModule,
    NavigationComponent,
    VersionNotificationComponent,
    TranslocoPipe,
  ],
})
export class AppComponent
  extends DefaultComponent
  implements OnInit, OnDestroy
{
  @ViewChild('navigation', { static: true }) navigation:
    | NavigationComponent
    | undefined;

  localOnly = false;

  public get environment(): any {
    return environment;
  }

  constructor(
    public appStorage: AppStorageService,
    private router: Router,
    private route: ActivatedRoute,
    private multiThreading: MultiThreadingService,
    private appStoreService: ApplicationStoreService,
    private annotationStoreService: AnnotationStoreService,
    protected versionChecker: VersionCheckerService,
    routePrinter: RoutePrinterService,
  ) {
    super();
    this.appStoreService.initApplication();
    this.versionChecker.init({
      interval: 5 * 60 * 1000, // check every 5 minutes
    });

    if (environment.debugging.enabled && environment.debugging.logging.routes) {
      this.subscribe(this.router.events, {
        next: (event: any) => {
          if (event.snapshot) {
            console.log(
              `route from ${event.url} to guard: ${event.snapshot.url}, component: ${event.snapshot.component?.name}`,
            );
          }
        },
      });
    }

    routePrinter.printRoutes();
  }

  ngOnInit() {
    this.subscribe(this.route.fragment, {
      next: (fragment) => {
        switch (fragment) {
          case 'feedback':
            this.navigation?.openBugReport();
            break;
        }
      },
    });

    this.subscribe(this.router.events, {
      next: () => {
        this.localOnly = !!this.getRouteData('localOnly');
      },
    });
  }

  private getRouteData(key: string): any {
    let route = this.route.firstChild;
    while (route) {
      if (route.snapshot.data[key]) {
        return route.snapshot.data[key];
      }
      route = route.firstChild;
    }
    return null;
  }

  override ngOnDestroy() {
    super.ngOnDestroy();
    this.multiThreading.destroy();
    this.annotationStoreService.destroy();
    this.appStoreService.destroy();
  }

  queryParamsSet(): boolean {
    const params = this.route.snapshot.queryParams;
    return params['audio_url'] && params['embedded'];
  }

  protected readonly LoginMode = LoginMode;
}

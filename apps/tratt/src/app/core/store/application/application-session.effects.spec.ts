import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslocoService } from '@jsverse/transloco';
import { LocalStorageService, SessionStorageService } from 'ngx-webstorage';
import { ReplaySubject } from 'rxjs';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { AudioService } from '../../shared/service/audio.service';
import { BugReportService } from '../../shared/service/bug-report.service';
import { RoutingService } from '../../shared/service/routing.service';
import { ApplicationActions } from '../application/application.actions';
import { LoginMode, RootState } from '../index';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';
import { ApplicationSessionEffects } from './application-session.effects';

// afterInitApplication$ is a `{ dispatch: false }` effect — it dispatches
// directly via `this.store.dispatch(...)` inside a `tap()`, synchronously,
// so subscribing to the effect observable and reading the MockStore's
// dispatch spy right after is sufficient; there's no async gap to await.
describe('ApplicationSessionEffects.afterInitApplication$ — Fix 3 (LOCAL-mode re-attach bypass)', () => {
  let effects: ApplicationSessionEffects;
  let store: MockStore<RootState>;
  let actions$: ReplaySubject<unknown>;
  let audioServiceStub: { current: unknown };

  const buildState = (
    mode: LoginMode,
    loggedIn: boolean,
  ): RootState => {
    const bundleId = DEFAULT_BUNDLE_ID;
    const fakeAnnotation = {
      bundleId,
      currentSession: {
        currentProject: { id: 1, name: 'p', description: '', jobsLeft: 0 },
        task: { id: 1 },
      },
    } as any;

    return {
      application: {
        initialized: true,
        mode,
        loggedIn,
      },
      authentication: { authenticated: false },
      onlineMode: { currentSession: {} } as any,
      demoMode: { currentSession: {} } as any,
      urlMode: { currentSession: {} } as any,
      localMode: {
        bundles: localBundleAdapter.setOne(
          fakeAnnotation,
          localBundleAdapter.getInitialState(),
        ),
        selectedBundleId: bundleId,
      },
      user: {} as any,
    } as unknown as RootState;
  };

  const setup = (initialState: RootState, audioCurrent: unknown) => {
    actions$ = new ReplaySubject(1);
    audioServiceStub = { current: audioCurrent };

    TestBed.configureTestingModule({
      providers: [
        ApplicationSessionEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: SessionStorageService, useValue: { retrieve: () => undefined } },
        { provide: LocalStorageService, useValue: { retrieve: () => undefined } },
        { provide: TranslocoService, useValue: {} },
        { provide: AppStorageService, useValue: {} },
        { provide: BugReportService, useValue: {} },
        {
          provide: RoutingService,
          useValue: { staticQueryParams: {} },
        },
        { provide: AudioService, useValue: audioServiceStub },
      ],
    });

    effects = TestBed.inject(ApplicationSessionEffects);
    store = TestBed.inject(MockStore);
  };

  it('LOCAL mode, loggedIn=false, resident AudioManager for the selected bundle: dispatches prepareTaskDataForAnnotation.do, not redirectToLastPage.do', () => {
    setup(buildState(LoginMode.LOCAL, false), { fake: 'audio-manager' });
    const dispatchSpy = jest.spyOn(store, 'dispatch');

    const subscription = effects.afterInitApplication$.subscribe();
    actions$.next(
      LoginModeActions.loadProjectAndTaskInformation.success({
        mode: LoginMode.LOCAL,
      }),
    );
    subscription.unsubscribe();

    const dispatchedTypes = dispatchSpy.mock.calls.map(
      ([a]) => (a as unknown as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(
      AnnotationActions.prepareTaskDataForAnnotation.do.type,
    );
    expect(dispatchedTypes).not.toContain(
      ApplicationActions.redirectToLastPage.do.type,
    );
  });

  it('regression: LOCAL mode, loggedIn=false, AudioService.current undefined: still dispatches redirectToLastPage.do', () => {
    setup(buildState(LoginMode.LOCAL, false), undefined);
    const dispatchSpy = jest.spyOn(store, 'dispatch');

    const subscription = effects.afterInitApplication$.subscribe();
    actions$.next(
      LoginModeActions.loadProjectAndTaskInformation.success({
        mode: LoginMode.LOCAL,
      }),
    );
    subscription.unsubscribe();

    const dispatchedTypes = dispatchSpy.mock.calls.map(
      ([a]) => (a as unknown as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(
      ApplicationActions.redirectToLastPage.do.type,
    );
    expect(dispatchedTypes).not.toContain(
      AnnotationActions.prepareTaskDataForAnnotation.do.type,
    );
  });

  it('ONLINE mode is untouched: loggedIn=false still redirects regardless of AudioService.current', () => {
    setup(buildState(LoginMode.ONLINE, false), { fake: 'audio-manager' });
    const dispatchSpy = jest.spyOn(store, 'dispatch');

    const subscription = effects.afterInitApplication$.subscribe();
    actions$.next(
      LoginModeActions.loadProjectAndTaskInformation.success({
        mode: LoginMode.ONLINE,
      }),
    );
    subscription.unsubscribe();

    const dispatchedTypes = dispatchSpy.mock.calls.map(
      ([a]) => (a as unknown as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(
      ApplicationActions.redirectToLastPage.do.type,
    );
    expect(dispatchedTypes).not.toContain(
      AnnotationActions.prepareTaskDataForAnnotation.do.type,
    );
  });
});

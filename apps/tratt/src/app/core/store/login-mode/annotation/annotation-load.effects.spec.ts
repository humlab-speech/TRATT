import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { ReplaySubject, Subject } from 'rxjs';
import { AppInfo } from '../../../../app.info';
import { TrattModalService } from '../../../modals/tratt-modal.service';
import {
  AlertService,
  AudioService,
  UserInteractionsService,
} from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { RoutingService } from '../../../shared/service/routing.service';
import { LoginMode, RootState } from '../../index';
import { AnnotationLoadEffects } from './annotation-load.effects';
import { AnnotationMaintenanceService } from './annotation-maintenance.service';
import { AnnotationActions } from './annotation.actions';

// jest can't parse the ESM build of 'mime' shipped in node_modules (it's not
// matched by this app's jest transformIgnorePatterns). AnnotationLoadEffects
// only uses it outside onAudioLoad$ (mediaType detection), so a stub is safe
// for the code path this spec exercises.
jest.mock('mime', () => ({
  __esModule: true,
  default: { getType: () => undefined },
}));

describe('AnnotationLoadEffects.onAudioLoad$', () => {
  let effects: AnnotationLoadEffects;
  let actions$: ReplaySubject<unknown>;
  let audioStub: { loadAudio: jest.Mock };

  const initialState = {
    application: { mode: LoginMode.URL },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);
    audioStub = { loadAudio: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        AnnotationLoadEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: OctraAPIService, useValue: {} },
        { provide: HttpClient, useValue: {} },
        { provide: AlertService, useValue: { showAlert: () => undefined } },
        { provide: RoutingService, useValue: { navigate: () => undefined } },
        {
          provide: TrattModalService,
          useValue: { openModal: () => undefined },
        },
        { provide: AudioService, useValue: audioStub },
        {
          provide: UserInteractionsService,
          useValue: { afteradd: new Subject() },
        },
        { provide: AppStorageService, useValue: {} },
        { provide: TranslocoService, useValue: {} },
        { provide: AnnotationMaintenanceService, useValue: {} },
      ],
    });

    effects = TestBed.inject(AnnotationLoadEffects);
  });

  it('cancels a still-in-flight loadAudio subscription when a new loadAudio.do arrives', () => {
    const firstLoad$ = new Subject<number>();
    const secondLoad$ = new Subject<number>();
    audioStub.loadAudio
      .mockReturnValueOnce(firstLoad$)
      .mockReturnValueOnce(secondLoad$);

    const subscription = effects.onAudioLoad$.subscribe();

    const doAction = (url: string) =>
      AnnotationActions.loadAudio.do({
        mode: LoginMode.URL,
        audioFile: { filename: 'a.wav', url } as any,
        task: {} as any,
        currentProject: {} as any,
        guidelines: [],
      });

    actions$.next(doAction('first.wav'));
    actions$.next(doAction('second.wav'));

    expect(audioStub.loadAudio).toHaveBeenCalledTimes(2);
    expect(secondLoad$.observed).toBe(true);
    expect(firstLoad$.observed).toBe(false);

    subscription.unsubscribe();
  });
});

describe('AnnotationLoadEffects.onAudioLoad$ LOCAL mode — multi-bundle readiness (bug pin)', () => {
  let effects: AnnotationLoadEffects;
  let actions$: ReplaySubject<unknown>;
  let store: MockStore;
  let audioStub: { audiomanagers: unknown[]; current: unknown };

  // Two distinct bundle ids: `selectedBundleId` is what's currently selected
  // (and has a sessionFile entry in localMode); `otherBundleId` is a
  // different, unrelated bundle that happens to have a manager registered.
  const selectedBundleId = 'bundle-selected';
  const otherBundleId = 'bundle-other';

  const initialState = {
    application: { mode: LoginMode.LOCAL },
    localMode: {
      selectedBundleId,
      bundles: {
        ids: [selectedBundleId],
        entities: {
          [selectedBundleId]: { sessionFile: { name: 'session.json' } } as any,
        },
      },
    },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);

    // Simulates the multi-bundle regression scenario: a manager IS registered,
    // but for `otherBundleId`, NOT the currently selected `selectedBundleId`.
    // `audiomanagers.length > 0` is (wrongly) true, while `current` — which is
    // keyed by the selected bundle id — correctly reports "not ready".
    audioStub = {
      audiomanagers: [{ bundleId: otherBundleId } as any],
      current: undefined,
    };

    TestBed.configureTestingModule({
      providers: [
        AnnotationLoadEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: OctraAPIService, useValue: {} },
        { provide: HttpClient, useValue: {} },
        { provide: AlertService, useValue: { showAlert: () => undefined } },
        { provide: RoutingService, useValue: { navigate: () => undefined } },
        {
          provide: TrattModalService,
          useValue: { openModal: () => undefined },
        },
        { provide: AudioService, useValue: audioStub },
        {
          provide: UserInteractionsService,
          useValue: { afteradd: new Subject() },
        },
        { provide: AppStorageService, useValue: {} },
        { provide: TranslocoService, useValue: {} },
        { provide: AnnotationMaintenanceService, useValue: {} },
      ],
    });

    effects = TestBed.inject(AnnotationLoadEffects);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('dispatches loadAudio.fail (reload needed), NOT loadAudio.success, when a manager is only registered for a different bundle than the one selected', () => {
    const subscription = effects.onAudioLoad$.subscribe();

    actions$.next(
      AnnotationActions.loadAudio.do({
        mode: LoginMode.LOCAL,
        audioFile: { filename: 'a.wav' } as any,
        task: {} as any,
        currentProject: {} as any,
        guidelines: [],
      }),
    );

    expect(store.dispatch).toHaveBeenCalledWith(
      AnnotationActions.loadAudio.fail({
        error: 'audio from sessionfile not loaded. Reload needed.',
      }),
    );
    expect(store.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: AnnotationActions.loadAudio.success.type,
      }),
    );

    subscription.unsubscribe();
  });
});

describe('AnnotationLoadEffects.loadSegmentsSuccess$', () => {
  let effects: AnnotationLoadEffects;
  let actions$: ReplaySubject<unknown>;
  let routingService: { navigate: jest.Mock };
  let router: { url: string; navigated: boolean };

  const initialState = {
    application: { mode: LoginMode.LOCAL },
  } as unknown as RootState;

  const successPayloadFixture =
    AnnotationActions.initTranscriptionService.success({
      mode: LoginMode.LOCAL,
      transcript: {} as any,
      saveToDB: true,
    });

  beforeEach(() => {
    actions$ = new ReplaySubject(1);
    routingService = { navigate: jest.fn() };
    router = { url: '/login', navigated: true };

    TestBed.configureTestingModule({
      providers: [
        AnnotationLoadEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: OctraAPIService, useValue: {} },
        { provide: HttpClient, useValue: {} },
        { provide: AlertService, useValue: { showAlert: () => undefined } },
        { provide: RoutingService, useValue: routingService },
        {
          provide: TrattModalService,
          useValue: { openModal: () => undefined },
        },
        { provide: AudioService, useValue: { loadAudio: jest.fn() } },
        {
          provide: UserInteractionsService,
          useValue: { afteradd: new Subject() },
        },
        { provide: AppStorageService, useValue: {} },
        { provide: TranslocoService, useValue: {} },
        { provide: AnnotationMaintenanceService, useValue: {} },
        { provide: Router, useValue: router },
      ],
    });

    effects = TestBed.inject(AnnotationLoadEffects);
  });

  it('navigates to /intern/transcr when the current URL is not the workbench', (done) => {
    router.url = '/login';
    actions$.next(successPayloadFixture);

    effects.loadSegmentsSuccess$.subscribe(() => {
      expect(routingService.navigate).toHaveBeenCalledWith(
        'transcription initialized',
        ['/intern/transcr'],
        AppInfo.queryParamsHandling,
      );
      done();
    });
  });

  it('does not navigate to /intern/transcr on the workbench (/)', (done) => {
    router.url = '/';
    actions$.next(successPayloadFixture);

    effects.loadSegmentsSuccess$.subscribe(() => {
      expect(routingService.navigate).not.toHaveBeenCalled();
      done();
    });
  });

  it('does not navigate to /intern/transcr on the workbench with a query string', (done) => {
    router.url = '/?foo=bar';
    actions$.next(successPayloadFixture);

    effects.loadSegmentsSuccess$.subscribe(() => {
      expect(routingService.navigate).not.toHaveBeenCalled();
      done();
    });
  });

  it('DOES navigate to /intern/transcr when the current URL is a lookalike route like /workbench-v2 (regression guard for the fragile startsWith check)', (done) => {
    router.url = '/workbench-v2';
    actions$.next(successPayloadFixture);

    effects.loadSegmentsSuccess$.subscribe(() => {
      expect(routingService.navigate).toHaveBeenCalledWith(
        'transcription initialized',
        ['/intern/transcr'],
        AppInfo.queryParamsHandling,
      );
      done();
    });
  });

  // Before the first navigation router.url is '/' (the workbench's route)
  // whatever page is loading; only the address bar tells them apart.
  describe('while booting (no navigation yet)', () => {
    afterEach(() => window.history.replaceState({}, '', '/'));

    it('navigates when the browser is loading another page', (done) => {
      router.url = '/';
      router.navigated = false;
      window.history.replaceState({}, '', '/intern/transcr');
      actions$.next(successPayloadFixture);

      effects.loadSegmentsSuccess$.subscribe(() => {
        expect(routingService.navigate).toHaveBeenCalledWith(
          'transcription initialized',
          ['/intern/transcr'],
          AppInfo.queryParamsHandling,
        );
        done();
      });
    });

    it('stays put when the browser is loading the workbench', (done) => {
      router.url = '/';
      router.navigated = false;
      window.history.replaceState({}, '', '/');
      actions$.next(successPayloadFixture);

      effects.loadSegmentsSuccess$.subscribe(() => {
        expect(routingService.navigate).not.toHaveBeenCalled();
        done();
      });
    });
  });
});

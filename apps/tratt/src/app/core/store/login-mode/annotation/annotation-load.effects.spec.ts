import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { HttpClient } from '@angular/common/http';
import { TranslocoService } from '@jsverse/transloco';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { ReplaySubject, Subject } from 'rxjs';
import { AlertService, AudioService, UserInteractionsService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { RoutingService } from '../../../shared/service/routing.service';
import { TrattModalService } from '../../../modals/tratt-modal.service';
import { LoginMode, RootState } from '../../index';
import { AnnotationActions } from './annotation.actions';
import { AnnotationLoadEffects } from './annotation-load.effects';
import { AnnotationMaintenanceService } from './annotation-maintenance.service';

// jest can't parse the ESM build of 'mime' shipped in node_modules (it's not
// matched by this app's jest transformIgnorePatterns). AnnotationLoadEffects
// only uses it outside onAudioLoad$ (mediaType detection), so a stub is safe
// for the code path this spec exercises.
jest.mock('mime', () => ({ __esModule: true, default: { getType: () => undefined } }));

describe('AnnotationLoadEffects.onAudioLoad$', () => {
  let effects: AnnotationLoadEffects;
  let store: MockStore<RootState>;
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
        { provide: TrattModalService, useValue: { openModal: () => undefined } },
        { provide: AudioService, useValue: audioStub },
        { provide: UserInteractionsService, useValue: { afteradd: new Subject() } },
        { provide: AppStorageService, useValue: {} },
        { provide: TranslocoService, useValue: {} },
        { provide: AnnotationMaintenanceService, useValue: {} },
      ],
    });

    effects = TestBed.inject(AnnotationLoadEffects);
    store = TestBed.inject(MockStore);
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

    expect(firstLoad$.observed).toBe(false);

    subscription.unsubscribe();
  });
});

import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { describe, expect, it, beforeEach } from '@jest/globals';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { TranslocoService } from '@jsverse/transloco';
import { ReplaySubject } from 'rxjs';
import { AlertService } from '../../../shared/service';
import { TrattModalService } from '../../../modals/tratt-modal.service';
import { AnnotationPersistenceService } from './annotation-persistence.service';
import { AnnotationSaveEffects } from './annotation-save.effects';
import { AnnotationActions } from './annotation.actions';
import { LoginMode, RootState } from '../../index';

describe('AnnotationSaveEffects.onAnnotationSend$ timer unsubscribe (C7)', () => {
  let effects: AnnotationSaveEffects;
  let actions$: ReplaySubject<unknown>;

  // onlineMode.currentSession is deliberately empty (no currentProject/task):
  // that makes onAnnotationSend$ take the "Current project or current task is
  // undefined" branch, which returns `of(...)` — a *synchronous* inner
  // observable. That's what lets exhaustMap accept the second dispatch
  // immediately, without needing to mock persistence.saveTaskToServer at all.
  const initialState = {
    application: { mode: LoginMode.ONLINE },
    onlineMode: { currentSession: {} },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);

    TestBed.configureTestingModule({
      providers: [
        AnnotationSaveEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        { provide: OctraAPIService, useValue: {} },
        { provide: AlertService, useValue: { showAlert: () => undefined } },
        {
          provide: TrattModalService,
          useValue: { openModalRef: () => ({ componentInstance: {} }) },
        },
        { provide: TranslocoService, useValue: {} },
        { provide: AnnotationPersistenceService, useValue: {} },
      ],
    });

    effects = TestBed.inject(AnnotationSaveEffects);
  });

  it('unsubscribes the prior pending sending-modal timer before starting a new one', () => {
    const subscription = effects.onAnnotationSend$.subscribe();

    actions$.next(AnnotationActions.sendOnlineAnnotation.do({ mode: LoginMode.ONLINE }));
    const firstTimeout = (effects as any).transcrSendingModal.timeout;
    expect(firstTimeout).toBeDefined();
    expect(firstTimeout.closed).toBe(false);

    actions$.next(AnnotationActions.sendOnlineAnnotation.do({ mode: LoginMode.ONLINE }));
    const secondTimeout = (effects as any).transcrSendingModal.timeout;

    expect(secondTimeout).not.toBe(firstTimeout);
    expect(firstTimeout.closed).toBe(true);

    subscription.unsubscribe();
  });
});

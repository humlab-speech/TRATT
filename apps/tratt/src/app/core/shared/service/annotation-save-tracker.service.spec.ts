import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { Subject } from 'rxjs';
import { LoginMode } from '../../store';
import { IDBActions } from '../../store/idb/idb.actions';
import { AnnotationActions } from '../../store/login-mode/annotation/annotation.actions';
import { AnnotationSaveTracker } from './annotation-save-tracker.service';

describe('AnnotationSaveTracker', () => {
  function setup() {
    const actions$ = new Subject<any>();
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$)],
    });
    return { actions$, tracker: TestBed.inject(AnnotationSaveTracker) };
  }

  it('counts writes from trigger to success/fail', () => {
    const { actions$, tracker } = setup();
    const edit = AnnotationActions.overwriteTranscript.do({
      transcript: {} as any,
      mode: LoginMode.LOCAL,
      saveToDB: true,
    });

    actions$.next(edit);
    actions$.next(edit);
    expect(tracker.inFlight).toBe(2);

    actions$.next(IDBActions.saveAnnotation.success());
    expect(tracker.inFlight).toBe(1);
    actions$.next(IDBActions.saveAnnotation.fail({ error: 'x' }));
    expect(tracker.inFlight).toBe(0);
  });

  it('ignores answers to writes it never saw', () => {
    const { actions$, tracker } = setup();

    actions$.next(IDBActions.saveAnnotation.success());

    expect(tracker.inFlight).toBe(0);
  });
});

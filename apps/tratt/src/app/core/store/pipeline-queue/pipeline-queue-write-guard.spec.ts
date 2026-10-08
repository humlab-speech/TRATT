import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, Subject, of } from 'rxjs';
import { SessionFile } from '../../obj/SessionFile';
import { AnnotationSaveTracker } from '../../shared/service/annotation-save-tracker.service';
import { AudioService } from '../../shared/service/audio.service';
import { IDBService } from '../../shared/service/idb.service';
import { LoginMode, RootState } from '../index';
import { localBundleAdapter } from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { PipelineQueuePersistenceEffects } from './pipeline-queue-persistence.effects';

/**
 * R3: `workbench.component.ts`'s beforeunload guard reports "work in flight"
 * from `AnnotationSaveTracker.inFlight` (and `queueRunning()`). The queue's
 * only transcript write is `saveBundleTranscript$`, which is neither in
 * `ANNOTATION_SAVE_TRIGGERS` nor answered by `saveAnnotation.success/fail`,
 * so for the LAST queued bundle (whose `bundleDone` already cleared
 * `queueRunning()`) the write is invisible to the guard.
 */
describe('R3 queue transcript write is visible to the leave-page guard', () => {
  let actions$: Subject<any>;
  let write: Subject<void>;
  let idbService: {
    saveModeOptions: jest.Mock<any>;
    saveAnnotation: jest.Mock<any>;
  };
  let audioService: {
    getManager: jest.Mock<any>;
    getMediaInfo: jest.Mock<any>;
  };
  let tracker: AnnotationSaveTracker;

  const bundleA = {
    bundleId: 'a',
    sessionFile: new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav'),
    transcript: { selectedLevelIndex: 0 },
  } as any;

  const initialState = {
    authentication: { me: undefined },
    localMode: {
      bundles: localBundleAdapter.setAll(
        [bundleA],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'a',
    },
    pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
  } as unknown as RootState;

  const setTranscript = () =>
    actions$.next(
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'a',
        transcript: { serialize: jest.fn(() => ({ levels: [] })) } as any,
      }),
    );

  beforeEach(() => {
    actions$ = new Subject<any>();
    write = new Subject<void>();
    idbService = {
      saveModeOptions: jest.fn(() => of(undefined)),
      saveAnnotation: jest.fn(() => write),
    };
    audioService = {
      getManager: jest.fn(() => undefined),
      getMediaInfo: jest.fn(() => ({
        fullname: 'a.wav',
        sampleRate: 16000,
        duration: 1,
      })),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        PipelineQueuePersistenceEffects,
        provideMockActions(() => actions$ as Observable<any>),
        provideMockStore({ initialState }),
        { provide: IDBService, useValue: idbService },
        { provide: AudioService, useValue: audioService },
      ],
    });

    tracker = TestBed.inject(AnnotationSaveTracker);
    TestBed.inject(
      PipelineQueuePersistenceEffects,
    ).saveBundleTranscript$.subscribe();
  });

  it('counts the write while it is pending', () => {
    setTranscript();

    expect(idbService.saveAnnotation).toHaveBeenCalledTimes(1);
    expect(tracker.inFlight).toBe(1);
  });

  it('stops counting once the write settles (no permanent leave prompt)', () => {
    setTranscript();
    write.complete();

    expect(tracker.inFlight).toBe(0);
  });

  it('does not count a write it skipped', () => {
    audioService.getMediaInfo.mockReturnValue(undefined);
    audioService.getManager.mockReturnValue(undefined);

    setTranscript();

    expect(idbService.saveAnnotation).not.toHaveBeenCalled();
    expect(tracker.inFlight).toBe(0);
  });
});

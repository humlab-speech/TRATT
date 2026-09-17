import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// Same workaround as pipeline-queue.service.spec.ts: these two services
// construct their Worker via `new URL('...', import.meta.url)` at module
// scope, which ts-jest's CommonJS config cannot compile. This spec never
// touches the real classes — PipelineQueueService itself is replaced by a
// mock below, but its import graph still reaches these two modules.
jest.mock('../../shared/service/local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { TranslocoService } from '@jsverse/transloco';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AudioManager } from '@tratt/web-media';
import { of } from 'rxjs';
import { BundleReattachMismatchAnswer } from '../../modals/bundle-reattach-mismatch-modal/bundle-reattach-mismatch-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { SessionFile } from '../../obj/SessionFile';
import { AudioService } from '../../shared/service/audio.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { LoginMode, RootState } from '../../store/index';
import { localBundleAdapter } from '../../store/login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { BundleListComponent } from './bundle-list.component';

// Convention: mock Store via @ngrx/store/testing's provideMockStore with a
// real initialState (rather than overrideSelector), matching
// audio.service.spec.ts / annotation.selectors.spec.ts — this exercises the
// real selectAllBundleSummaries selector against real state.
describe('BundleListComponent', () => {
  let fixture: ComponentFixture<BundleListComponent>;
  let store: MockStore<RootState>;
  let audioService: {
    registerAudioManager: jest.Mock;
    hasResident: jest.Mock;
  };
  let modalService: { openModal: jest.Mock<any> };
  let pipelineQueueService: { retry: jest.Mock };

  const matchingSessionFile = new SessionFile(
    'a.wav',
    4,
    new Date(2024, 0, 1),
    'audio/wav',
  );

  const bundleA = {
    bundleId: 'bundle-a',
    sessionFile: matchingSessionFile,
    audio: { loaded: false },
  } as any;
  const bundleB = {
    bundleId: 'bundle-b',
    sessionFile: new SessionFile('b.wav', 2, new Date(), 'audio/wav'),
    audio: { loaded: true },
  } as any;

  const initialState = {
    application: { mode: LoginMode.LOCAL },
    localMode: {
      bundles: localBundleAdapter.setAll(
        [bundleA, bundleB],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'bundle-b',
    },
    pipelineQueue: {
      queue: [],
      activeId: null,
      mode: 'idle',
      runs: {},
    },
  } as unknown as RootState;

  const fakeManager = () =>
    ({
      destroy: jest.fn(async () => undefined),
    }) as any;

  // jsdom's real `File`/`Blob` doesn't implement `.arrayBuffer()`, so — like
  // audio.service.spec.ts's `fakeFile` — this fakes just enough of the
  // `File` surface for onReattachFileSelected()'s decode + fingerprint
  // comparison, cast to `File`.
  const fakeFile = (
    name: string,
    size: number,
    type: string,
    lastModified: number,
  ): File =>
    ({
      name,
      size,
      type,
      lastModified,
      arrayBuffer: jest.fn(async () => new ArrayBuffer(size)),
    }) as unknown as File;

  beforeEach(async () => {
    audioService = {
      registerAudioManager: jest.fn(),
      hasResident: jest.fn().mockReturnValue(false),
    };
    modalService = { openModal: jest.fn() };
    pipelineQueueService = { retry: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [BundleListComponent],
      providers: [
        provideMockStore({ initialState }),
        { provide: AudioService, useValue: audioService },
        { provide: TrattModalService, useValue: modalService },
        { provide: PipelineQueueService, useValue: pipelineQueueService },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
            // TranslocoPipe.transform() calls this to resolve the scope
            // before it will call translate() at all — without it, the
            // pipe's internal subscribe() throws (swallowed by RxJS as an
            // unhandled error) and every transloco-piped label renders as
            // the pipe's empty initial `lastValue` instead of the key.
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BundleListComponent);
    store = TestBed.inject(MockStore);
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders one row per bundle summary', () => {
    const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
    expect(rows.length).toBe(2);
  });

  it('dispatches selectBundle with the clicked row bundleId when a non-selected row is clicked', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const buttons = fixture.debugElement.queryAll(
      By.css('.bundle-list__item-btn'),
    );
    // bundle-b is the non-awaiting-media, non-selected... wait bundle-b IS
    // selected; bundle-a is awaiting media so it has no click-to-select
    // button. Use bundle-b's button, deselecting is a no-op-safe dispatch.
    buttons[0].triggerEventHandler('click', null);

    expect(dispatchSpy).toHaveBeenCalledWith(
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-b',
      }),
    );
  });

  it('renders each click-to-select row as a focusable, keyboard-activatable button', () => {
    const buttons = fixture.debugElement.queryAll(
      By.css('.bundle-list__item-btn'),
    );
    expect(buttons.length).toBe(1);
    buttons.forEach((btn) => {
      expect(btn.nativeElement.tagName).toBe('BUTTON');
      expect(btn.nativeElement.type).toBe('button');
    });
  });

  it('marks the currently-selected bundle row as active', () => {
    const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
    const rowB = rows.find((r) =>
      r.nativeElement.textContent.includes('b.wav'),
    );

    expect(rowB!.nativeElement.classList.contains('active')).toBe(true);
  });

  describe('re-attach control', () => {
    it('renders a file input for a bundle with awaitingMedia true', () => {
      const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
      const rowA = rows.find((r) =>
        r.nativeElement.textContent.includes('a.wav'),
      );
      const input = rowA!.query(By.css('input[type="file"]'));
      expect(input).toBeTruthy();
    });

    it('does not render a file input for a bundle with awaitingMedia false', () => {
      const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
      const rowB = rows.find((r) =>
        r.nativeElement.textContent.includes('b.wav'),
      );
      const input = rowB!.query(By.css('input[type="file"]'));
      expect(input).toBeFalsy();
    });

    it('registers the manager and dispatches selectBundle + loadProjectAndTaskInformation.do on a fingerprint match, without opening the modal', async () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const manager = fakeManager();
      jest
        .spyOn(AudioManager, 'create')
        .mockReturnValue(of({ audioManager: manager, progress: 1 }) as any);

      const file = fakeFile(
        'a.wav',
        4,
        'audio/wav',
        matchingSessionFile.timestamp!.getTime(),
      );
      const event = {
        target: { files: [file], value: '' },
      } as unknown as Event;

      await fixture.componentInstance.onReattachFileSelected('bundle-a', event);

      expect(audioService.registerAudioManager).toHaveBeenCalledWith(
        'bundle-a',
        manager,
        file,
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        LoginModeActions.selectBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-a',
        }),
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        LoginModeActions.loadProjectAndTaskInformation.do({
          projectID: '7234892',
          taskID: '73482',
          mode: LoginMode.LOCAL,
        }),
      );
      expect(modalService.openModal).not.toHaveBeenCalled();
    });

    it('opens the mismatch modal on a fingerprint mismatch and does not register the manager until "use anyway" is chosen', async () => {
      const manager = fakeManager();
      jest
        .spyOn(AudioManager, 'create')
        .mockReturnValue(of({ audioManager: manager, progress: 1 }) as any);

      // Different size than matchingSessionFile (4 bytes) -> mismatch.
      const file = fakeFile(
        'a.wav',
        999,
        'audio/wav',
        matchingSessionFile.timestamp!.getTime(),
      );
      const event = {
        target: { files: [file], value: '' },
      } as unknown as Event;

      let resolveModal: (value: BundleReattachMismatchAnswer) => void;
      modalService.openModal.mockReturnValue(
        new Promise<BundleReattachMismatchAnswer>((resolve) => {
          resolveModal = resolve;
        }),
      );

      const pending = fixture.componentInstance.onReattachFileSelected(
        'bundle-a',
        event,
      );
      // Let the decode microtasks settle before the modal promise resolves.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(modalService.openModal).toHaveBeenCalled();
      expect(audioService.registerAudioManager).not.toHaveBeenCalled();

      resolveModal!(BundleReattachMismatchAnswer.USE_ANYWAY);
      await pending;

      expect(audioService.registerAudioManager).toHaveBeenCalledWith(
        'bundle-a',
        manager,
        file,
      );
    });

    it('destroys the decoded manager and makes no store changes when the mismatch modal is cancelled', async () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const manager = fakeManager();
      jest
        .spyOn(AudioManager, 'create')
        .mockReturnValue(of({ audioManager: manager, progress: 1 }) as any);

      const file = fakeFile(
        'a.wav',
        999,
        'audio/wav',
        matchingSessionFile.timestamp!.getTime(),
      );
      const event = {
        target: { files: [file], value: '' },
      } as unknown as Event;

      modalService.openModal.mockResolvedValue(
        BundleReattachMismatchAnswer.CANCEL,
      );

      await fixture.componentInstance.onReattachFileSelected('bundle-a', event);

      expect(manager.destroy).toHaveBeenCalled();
      expect(audioService.registerAudioManager).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        LoginModeActions.selectBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-a',
        }),
      );
    });

    it('still destroys the decoded manager (Minor 4) when the mismatch modal promise rejects (e.g. backdrop dismissal)', async () => {
      const manager = fakeManager();
      jest
        .spyOn(AudioManager, 'create')
        .mockReturnValue(of({ audioManager: manager, progress: 1 }) as any);

      const file = fakeFile(
        'a.wav',
        999,
        'audio/wav',
        matchingSessionFile.timestamp!.getTime(),
      );
      const event = {
        target: { files: [file], value: '' },
      } as unknown as Event;

      modalService.openModal.mockRejectedValue(new Error('backdrop dismissed'));

      await expect(
        fixture.componentInstance.onReattachFileSelected('bundle-a', event),
      ).rejects.toThrow('backdrop dismissed');

      expect(manager.destroy).toHaveBeenCalled();
      expect(audioService.registerAudioManager).not.toHaveBeenCalled();
    });
  });

  describe('Fix 5: awaitingMedia combined with AudioService residency', () => {
    it('renders the normal click-to-select button (not a re-attach input) when awaitingMedia is true from the selector but the bundle already has a resident AudioManager', () => {
      audioService.hasResident.mockImplementation(
        (bundleId) => bundleId === 'bundle-a',
      );
      fixture = TestBed.createComponent(BundleListComponent);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
      const rowA = rows.find((r) =>
        r.nativeElement.textContent.includes('a.wav'),
      );
      expect(rowA!.query(By.css('input[type="file"]'))).toBeFalsy();
      expect(rowA!.query(By.css('button.bundle-list__item-btn'))).toBeTruthy();
    });

    it('still renders the re-attach control when awaitingMedia is true and hasResident is false (genuine restored-and-unresolved case)', () => {
      audioService.hasResident.mockReturnValue(false);
      fixture = TestBed.createComponent(BundleListComponent);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
      const rowA = rows.find((r) =>
        r.nativeElement.textContent.includes('a.wav'),
      );
      expect(rowA!.query(By.css('input[type="file"]'))).toBeTruthy();
    });

    it('is unaffected for a bundle with awaitingMedia false, regardless of hasResident', () => {
      audioService.hasResident.mockReturnValue(true);
      fixture = TestBed.createComponent(BundleListComponent);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
      const rowB = rows.find((r) =>
        r.nativeElement.textContent.includes('b.wav'),
      );
      expect(rowB!.query(By.css('input[type="file"]'))).toBeFalsy();
      expect(rowB!.query(By.css('button.bundle-list__item-btn'))).toBeTruthy();
    });
  });

  describe('Minor 1: fingerprint type-normalization', () => {
    it('matches a video/ogg candidate file against a persisted normalized sessionFile.type', async () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const manager = fakeManager();
      jest
        .spyOn(AudioManager, 'create')
        .mockReturnValue(of({ audioManager: manager, progress: 1 }) as any);

      // normalizeMimeType rewrites 'video/ogg' -> 'audio/ogg'; the persisted
      // sessionFile reflects the normalized form (see authentication.effects.ts's
      // getSessionFile()), so the raw candidate file.type must be normalized
      // the same way before comparing, or this falsely mismatches.
      const oggSessionFile = new SessionFile(
        'c.ogg',
        10,
        new Date(2024, 0, 1),
        'audio/ogg',
      );
      const bundleC = {
        bundleId: 'bundle-c',
        sessionFile: oggSessionFile,
        audio: { loaded: false },
      } as any;
      store.setState({
        application: { mode: LoginMode.LOCAL },
        localMode: {
          bundles: localBundleAdapter.setAll(
            [bundleA, bundleB, bundleC],
            localBundleAdapter.getInitialState(),
          ),
          selectedBundleId: 'bundle-b',
        },
      } as unknown as RootState);

      const file = fakeFile(
        'c.ogg',
        10,
        'video/ogg',
        oggSessionFile.timestamp!.getTime(),
      );
      const event = {
        target: { files: [file], value: '' },
      } as unknown as Event;

      await fixture.componentInstance.onReattachFileSelected('bundle-c', event);

      expect(dispatchSpy).toHaveBeenCalledWith(
        LoginModeActions.selectBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-c',
        }),
      );
      expect(modalService.openModal).not.toHaveBeenCalled();
    });
  });

  describe('pipeline run status and retry', () => {
    it('renders the run status label for each bundle', async () => {
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: 'bundle-b',
          mode: 'running',
          runs: {
            'bundle-b': { state: 'running', stage: 'asr', progress: 0.5 },
          },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const labels = fixture.debugElement
        .queryAll(By.css('.bundle-list__status'))
        .map((el) => el.nativeElement.textContent.trim());
      expect(labels).toContain('workbench.bundle_list.status.running');
    });

    it('renders no status element for a bundle with no run entry', () => {
      fixture.detectChanges();
      expect(
        fixture.debugElement.queryAll(By.css('.bundle-list__status')).length,
      ).toBe(0);
    });

    // F4 (final whole-branch review fix wave): the status/retry block used
    // to live entirely inside the non-awaitingMedia @else branch, but every
    // bundle restored from IndexedDB IS awaitingMedia for the whole first
    // session after a reload (no audio decoded yet) — so the 'interrupted'
    // badge Task 2's restore-as-interrupted work exists to show was
    // invisible at exactly the moment it mattered. bundle-a's fixture
    // already has audio.loaded false and audioService.hasResident() false
    // by default, so it's genuinely awaitingMedia here — no extra mocking
    // needed to reach that branch.
    it("shows the interrupted badge for a row that is both awaitingMedia and has runStatus.state === 'interrupted'", () => {
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: { 'bundle-a': { state: 'interrupted' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      // Still the re-attach control, not the click-to-select button — this
      // row genuinely is awaitingMedia.
      expect(
        fixture.debugElement.query(By.css('.bundle-list__reattach-input')),
      ).toBeTruthy();

      const labels = fixture.debugElement
        .queryAll(By.css('.bundle-list__status'))
        .map((el) => el.nativeElement.textContent.trim());
      expect(labels).toContain('workbench.bundle_list.status.interrupted');

      // Not actionable without re-attaching audio first — no retry button
      // for an awaitingMedia row, even though 'interrupted' would normally
      // grant one.
      expect(
        fixture.debugElement.query(By.css('.bundle-list__retry')),
      ).toBeFalsy();
    });

    it('shows a retry button only for failed and interrupted rows and calls the queue service', () => {
      // bundle-a's fixture has audio.loaded false (awaitingMedia from the
      // selector); as in the "Fix 5" suite above, a resident AudioManager
      // (hasResident true) is what makes a row render the click-to-select
      // branch — and therefore the status/retry UI — instead of the
      // re-attach control. This test is about run-state gating of retry,
      // not the re-attach control, so both rows need to be in that branch.
      audioService.hasResident.mockReturnValue(true);
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: {
            'bundle-a': { state: 'interrupted' },
            'bundle-b': {
              state: 'failed',
              error: { kind: 'oom', message: 'GPU out of memory' },
            },
          },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const retryButtons = fixture.debugElement.queryAll(
        By.css('.bundle-list__retry'),
      );
      expect(retryButtons.length).toBe(2);

      retryButtons[1].nativeElement.click();
      expect(pipelineQueueService.retry).toHaveBeenCalledWith('bundle-b');
    });

    it("exposes the raw failure message as the failed row's title", () => {
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: {
            'bundle-b': {
              state: 'failed',
              error: { kind: 'oom', message: 'GPU out of memory' },
            },
          },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const failed = fixture.debugElement.query(By.css('.bundle-list__error'));
      expect(failed.nativeElement.getAttribute('title')).toBe(
        'GPU out of memory',
      );
    });
  });
});

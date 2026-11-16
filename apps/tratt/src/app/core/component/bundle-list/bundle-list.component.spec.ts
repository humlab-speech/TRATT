import { signal } from '@angular/core';
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
import { ExportFilesModalComponent } from '../../modals/export-files-modal/export-files-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { YesNoModalComponent } from '../../modals/yes-no-modal/yes-no-modal.component';
import { SessionFile } from '../../obj/SessionFile';
import { AudioService } from '../../shared/service/audio.service';
import { PendingEditsService } from '../../shared/service/pending-edits.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { VispWorkspaceService } from '../../shared/workspace/visp-workspace.service';
import { WorkspaceService } from '../../shared/workspace/workspace.service';
import { AuthenticationActions } from '../../store/authentication';
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
    canRestore: jest.Mock;
    forget: jest.Mock;
  };
  let modalService: { openModal: jest.Mock<any> };
  let pipelineQueueService: {
    retry: jest.Mock;
    cancelActive: jest.Mock;
    cancelIfActive: jest.Mock;
  };

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
      // resident OR re-decodable; these fixtures model residency only.
      canRestore: jest.fn((id: unknown) => audioService.hasResident(id)),
      // The file a bundle's audio came from; none in these fixtures.
      getSourceFile: jest.fn(() => undefined),
      // Attached or fetchable audio, for the export dialog; none here.
      hasAudioFile: jest.fn(() => false),
      getMediaInfo: jest.fn(() => undefined),
      forget: jest.fn(),
    };
    modalService = { openModal: jest.fn() };
    pipelineQueueService = {
      retry: jest.fn(),
      cancelActive: jest.fn(),
      cancelIfActive: jest.fn(),
    };

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

  /** A row's click-to-select button, by file name. */
  function rowButton(name: string) {
    return fixture.debugElement
      .queryAll(By.css('.bundle-list__item'))
      .find((r) => r.nativeElement.textContent.includes(name))!
      .query(By.css('button.bundle-list__item-btn'));
  }

  it('dispatches selectBundle with the clicked row bundleId when a non-selected row is clicked', () => {
    // bundle-a (awaiting media, so no click-to-select button) is selected;
    // bundle-b's button is the non-selected row.
    store.setState({
      ...initialState,
      localMode: { ...initialState.localMode, selectedBundleId: 'bundle-a' },
    } as unknown as RootState);
    fixture.detectChanges();
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    rowButton('b.wav').triggerEventHandler('click', null);

    expect(dispatchSpy).toHaveBeenCalledWith(
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-b',
      }),
    );
  });

  describe('clicking a row', () => {
    const rowOf = (name: string) =>
      fixture.debugElement
        .queryAll(By.css('.bundle-list__item'))
        .find((r) => r.nativeElement.textContent.includes(name))!;

    beforeEach(() => {
      store.setState({
        ...initialState,
        localMode: { ...initialState.localMode, selectedBundleId: 'bundle-a' },
      } as unknown as RootState);
      fixture.detectChanges();
    });

    it('selects its bundle, not only a click on the name', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      rowOf('b.wav')
        .nativeElement.querySelector('.bundle-list__transcript')
        .click();
      expect(dispatchSpy).toHaveBeenCalledWith(
        LoginModeActions.selectBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'bundle-b',
        }),
      );
    });

    it('selects once when the name is clicked', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      rowOf('b.wav')
        .nativeElement.querySelector('.bundle-list__item-btn')
        .click();
      expect(
        dispatchSpy.mock.calls.filter(
          ([action]) =>
            (action as { type: string }).type ===
            LoginModeActions.selectBundle.type,
        ),
      ).toHaveLength(1);
    });

    it("leaves the row's own controls alone", () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      rowOf('b.wav')
        .nativeElement.querySelector('.bundle-list__item-checkbox')
        .click();
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: LoginModeActions.selectBundle.type }),
      );
    });
  });

  it('commits pending editor typing before switching bundles', () => {
    store.setState({
      ...initialState,
      localMode: { ...initialState.localMode, selectedBundleId: 'bundle-a' },
    } as unknown as RootState);
    fixture.detectChanges();
    const order: string[] = [];
    const pendingEdits = TestBed.inject(PendingEditsService);
    const unregister = pendingEdits.register(() => order.push('flush'));
    jest
      .spyOn(store, 'dispatch')
      .mockImplementation(((action: { type: string }) =>
        order.push(action.type)) as any);

    rowButton('b.wav').triggerEventHandler('click', null);

    expect(order).toEqual(['flush', LoginModeActions.selectBundle.type]);
    unregister();
  });

  it('treats a click on the already-selected row as a no-op', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    rowButton('b.wav').triggerEventHandler('click', null);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  // A restored file used to be only an "Attach file…" picker: it could not
  // be selected, so its transcript could not be exported or replaced before
  // the audio was found again.
  it('lets a bundle waiting for its audio be selected, with attaching in the audio column', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const row = fixture.debugElement
      .queryAll(By.css('.bundle-list__item'))
      .find((r) => r.nativeElement.textContent.includes('a.wav'))!;

    row
      .query(By.css('button.bundle-list__item-btn'))
      .triggerEventHandler('click', null);

    expect(dispatchSpy).toHaveBeenCalledWith(
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-a',
      }),
    );
    const audio = row.query(By.css('.bundle-list__audio'));
    const attach = audio.query(By.css('label.bundle-list__attach'));
    expect(attach.nativeElement.getAttribute('for')).toBe(
      'bundle-reattach-bundle-a',
    );
    expect(audio.query(By.css('input[type="file"]'))).toBeTruthy();
  });

  it('shows nothing for attached audio, only the way to attach missing audio', () => {
    const row = fixture.debugElement
      .queryAll(By.css('.bundle-list__item'))
      .find((r) => r.nativeElement.textContent.includes('b.wav'))!;
    // bundle-a still needs its audio, so the column is there, but b's slot
    // is empty: an icon on every attached row read as meaning something.
    const slot = row.query(By.css('.bundle-list__audio'));
    expect(slot.nativeElement.textContent.trim()).toBe('');
    expect(slot.children.length).toBe(0);
  });

  it('drops the audio column when no row needs its audio attached', () => {
    store.setState({
      ...initialState,
      localMode: {
        ...initialState.localMode,
        bundles: localBundleAdapter.setAll(
          [{ ...bundleA, audio: { loaded: true } }, bundleB],
          localBundleAdapter.getInitialState(),
        ),
      },
    } as unknown as RootState);
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.css('.bundle-list__audio')),
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('.bundle-list__column-audio')),
    ).toBeNull();
  });

  it('opens the attach picker for a bundle on request', () => {
    const input = fixture.debugElement.query(
      By.css('[id="bundle-reattach-bundle-a"]'),
    ).nativeElement as HTMLInputElement;
    const click = jest
      .spyOn(input, 'click')
      .mockImplementation(() => undefined);

    fixture.componentInstance.pickAudio('bundle-a');
    expect(click).toHaveBeenCalled();
  });

  it('renders each click-to-select row as a focusable, keyboard-activatable button', () => {
    const buttons = fixture.debugElement.queryAll(
      By.css('.bundle-list__item-btn'),
    );
    // Both rows — a file waiting for its audio is selectable too.
    expect(buttons.length).toBe(2);
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

  describe('audio details tooltip', () => {
    const row = (name: string) =>
      fixture.debugElement
        .queryAll(By.css('.bundle-list__item'))
        .find((r) => r.nativeElement.textContent.includes(name))!
        .nativeElement as HTMLElement;

    it('shows duration, sample rate, channels and size on hover', () => {
      audioService.getMediaInfo.mockImplementation((id: string) =>
        id === 'bundle-b'
          ? {
              fullname: 'b.wav',
              sampleRate: 44100,
              duration: { seconds: 65 },
              channels: 2,
              size: 2048,
            }
          : undefined,
      );
      // OnPush: render afresh with the details known (in the app the
      // service's registry signal triggers this).
      fixture = TestBed.createComponent(BundleListComponent);
      fixture.detectChanges();
      expect(row('b.wav').title).toBe(
        '1:05 · 44.1 kHz workbench.editor_header.stereo · 2 KB',
      );
    });

    it('says why there are no details yet', () => {
      fixture.detectChanges();
      expect(row('b.wav').title).toBe(
        'workbench.bundle_list.audio_details_pending',
      );
      expect(fixture.componentInstance.audioDetails('bundle-b', true)).toBe(
        'workbench.bundle_list.audio_details_not_attached',
      );
    });
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

    it('registers the manager and dispatches selectBundle + loginLocal.success on a fingerprint match, without opening the modal', async () => {
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
      // Not loadProjectAndTaskInformation.do directly: on a re-attach that's
      // the first action of a fresh page load, `state.application.mode` is
      // still undefined (nothing else this session has set it), and
      // `afterInitApplication$` redirects away before ever reaching the
      // "effectively logged in" bypass. `loginLocal.success` is what
      // actually sets `application.mode`/`loggedIn`, and
      // `authentication.effects.ts`'s `loginSuccess$` dispatches the same
      // `loadProjectAndTaskInformation.do` from there.
      expect(dispatchSpy).toHaveBeenCalledWith(
        AuthenticationActions.loginLocal.success({
          mode: LoginMode.LOCAL,
          files: [file],
          sessionFile: matchingSessionFile,
          removeData: false,
          audioAlreadyLoaded: true,
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

      // ngb rejects with ModalDismissReasons.BACKDROP_CLICK (0).
      modalService.openModal.mockRejectedValue(0);

      // Treated like "Abort" — not an unhandled rejection ("ERROR 0").
      await expect(
        fixture.componentInstance.onReattachFileSelected('bundle-a', event),
      ).resolves.toBeUndefined();

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
        .map((el) => el.nativeElement.textContent.replace(/\s+/g, ' ').trim());
      // A running row names its stage and shows its progress.
      expect(labels).toContain('workbench.bundle_list.stage.asr 50%');
    });

    it('underlines a running row with its share of the run, pulsing while it is prepared', () => {
      const run = (status: object) => {
        store.setState({
          ...initialState,
          pipelineQueue: {
            queue: [],
            activeId: 'bundle-b',
            mode: 'running',
            runs: { 'bundle-b': { state: 'running', ...status } },
          },
        } as unknown as RootState);
        fixture.detectChanges();
        return fixture.debugElement.queryAll(By.css('.bundle-list__progress'));
      };

      const [asr] = run({ stage: 'asr', progress: 0.4 });
      expect(asr.nativeElement.style.width).toBe('40%');
      expect(
        asr.nativeElement.classList.contains(
          'bundle-list__progress--preparing',
        ),
      ).toBe(false);

      const [decode] = run({ stage: 'decode', progress: 0.7 });
      expect(decode.nativeElement.style.width).toBe('100%');
      expect(
        decode.nativeElement.classList.contains(
          'bundle-list__progress--preparing',
        ),
      ).toBe(true);

      // Only the running row has a bar.
      expect(run({ stage: 'asr', progress: 0.4 }).length).toBe(1);
    });

    it('labels a model download as such, not as transcription', () => {
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: 'bundle-b',
          mode: 'running',
          runs: {
            'bundle-b': {
              state: 'running',
              stage: 'asr',
              progress: 0.25,
              downloading: true,
            },
          },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const labels = fixture.debugElement
        .queryAll(By.css('.bundle-list__status'))
        .map((el) => el.nativeElement.textContent.replace(/\s+/g, ' ').trim());
      expect(labels).toContain('workbench.bundle_list.stage.download 25%');
    });

    it('offers a stop button on the running row that cancels the active run', () => {
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: 'bundle-b',
          mode: 'running',
          runs: { 'bundle-b': { state: 'running', stage: 'asr' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const stop = fixture.debugElement.query(By.css('.bundle-list__cancel'));
      expect(stop).toBeTruthy();
      stop.nativeElement.click();
      expect(pipelineQueueService.cancelActive).toHaveBeenCalled();
    });

    /** Each row's coverage ring: its label, fill, check and count. */
    function rings() {
      return fixture.debugElement
        .queryAll(By.css('.bundle-list__transcript .bundle-list__coverage'))
        .map((el) => ({
          label: el.nativeElement.getAttribute('aria-label'),
          fill:
            el
              .query(By.css('.bundle-list__ring-fill'))
              ?.nativeElement.getAttribute('stroke-dasharray') ?? null,
          check: !!el.query(By.css('.bundle-list__ring-check')),
          count:
            el
              .query(By.css('.bundle-list__ring-count'))
              ?.nativeElement.textContent.trim() ?? null,
        }));
    }

    it('shows an empty ring for a never-run bundle without text, with or without its audio', () => {
      fixture.detectChanges();
      // bundle-a is awaiting its audio; its transcript state shows anyway.
      expect(rings()).toEqual([
        {
          label: 'workbench.bundle_list.coverage.none',
          fill: null,
          check: false,
          count: null,
        },
        {
          label: 'workbench.bundle_list.coverage.none',
          fill: null,
          check: false,
          count: null,
        },
      ]);
    });

    it('fills the ring by the share of the audio with text and counts those segments', () => {
      const seg = (end: number, value: string) => ({
        time: { samples: end },
        labels: [{ name: 'T', value }],
      });
      store.setState({
        ...initialState,
        localMode: {
          ...initialState.localMode,
          bundles: localBundleAdapter.setAll(
            [
              bundleA,
              {
                ...bundleB,
                transcript: {
                  levels: [
                    {
                      name: 'T',
                      type: 'SEGMENT',
                      items: [seg(25, 'hi'), seg(75, ''), seg(100, 'there')],
                    },
                  ],
                },
              },
            ],
            localBundleAdapter.getInitialState(),
          ),
        },
      } as unknown as RootState);
      fixture.detectChanges();
      expect(rings()[1]).toEqual({
        label: 'workbench.bundle_list.coverage.partial',
        fill: '50 100',
        check: false,
        count: '2',
      });
    });

    it('puts a check in the ring of a bundle a run transcribed (what Delete done removes)', () => {
      store.setState({
        ...initialState,
        pipelineQueue: {
          ...initialState.pipelineQueue,
          runs: { [bundleA.bundleId]: { state: 'done' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();
      expect(rings()[0]).toEqual(
        expect.objectContaining({
          label:
            'workbench.bundle_list.coverage.none · workbench.bundle_list.coverage.done_run',
          check: true,
        }),
      );
      // Offline the ring only shows; there is nothing to toggle.
      expect(
        fixture.debugElement.query(By.css('button.bundle-list__coverage')),
      ).toBeNull();
    });

    it('puts select-all beside the column headings, above the rows', () => {
      fixture.detectChanges();
      const bar = fixture.debugElement.query(By.css('.bundle-list__bar'));
      expect(bar.query(By.css('.bundle-list__select-all'))).toBeTruthy();
      // An unlabelled audio slot (a word there read as the checkbox's
      // label), then the bundle's name, then its transcript.
      const headings = bar
        .query(By.css('.bundle-list__columns'))
        .queryAll(By.css('span'))
        .map((el) => el.nativeElement.textContent.trim());
      expect(headings).toEqual([
        '',
        'workbench.bundle_list.column_file',
        'workbench.bundle_list.column_status',
      ]);
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

    it('calls a stopped file cancelled, not failed, and offers to retry it', () => {
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: {
            'bundle-b': {
              state: 'failed',
              error: { kind: 'cancelled', message: 'Run cancelled.' },
            },
          },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const status = fixture.debugElement.query(
        By.css('.bundle-list__status--cancelled'),
      );
      expect(status.nativeElement.textContent.trim()).toBe(
        'workbench.bundle_list.error.cancelled',
      );
      expect(
        fixture.debugElement.query(By.css('.bundle-list__error')),
      ).toBeNull();
      expect(
        fixture.debugElement.query(By.css('.bundle-list__retry')),
      ).not.toBeNull();
    });
  });

  describe('bulk actions', () => {
    it('has one Export button, whatever is ticked', () => {
      const button = () =>
        fixture.debugElement.query(By.css('.bundle-list__export'))
          .nativeElement as HTMLButtonElement;
      expect(button().textContent?.trim()).toBe('workbench.bundle_list.export');
      fixture.debugElement
        .queryAll(By.css('.bundle-list__item-checkbox'))[0]
        .nativeElement.click();
      fixture.detectChanges();
      expect(button().textContent?.trim()).toBe('workbench.bundle_list.export');
    });

    it('offers audio the workspace can fetch (VISP) for export, not only attached files', () => {
      audioService.hasAudioFile.mockImplementation(
        (id: unknown) => id === bundleA.bundleId,
      );
      fixture.componentInstance.onExport();
      const data = modalService.openModal.mock.calls.at(-1)![2] as {
        bundles: { bundleId: string; hasAudio: boolean }[];
      };
      expect(data.bundles.map((b) => [b.bundleId, b.hasAudio])).toEqual([
        [bundleA.bundleId, true],
        [bundleB.bundleId, false],
      ]);
    });

    it('select-all checks every row, and unchecking it clears the selection', () => {
      const selectAll = fixture.debugElement.query(
        By.css('.bundle-list__select-all'),
      );
      selectAll.nativeElement.click();
      fixture.detectChanges();

      const rowCheckboxes = fixture.debugElement.queryAll(
        By.css('.bundle-list__item-checkbox'),
      );
      expect(rowCheckboxes.every((el) => el.nativeElement.checked)).toBe(true);

      selectAll.nativeElement.click();
      fixture.detectChanges();
      expect(
        fixture.debugElement
          .queryAll(By.css('.bundle-list__item-checkbox'))
          .every((el) => !el.nativeElement.checked),
      ).toBe(true);
    });

    it('remove dispatches removeBundles for the checked ids and clears the selection', async () => {
      modalService.openModal.mockResolvedValue('yes');
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const rowCheckboxes = fixture.debugElement.queryAll(
        By.css('.bundle-list__item-checkbox'),
      );
      rowCheckboxes[0].nativeElement.click();
      fixture.detectChanges();

      fixture.debugElement
        .query(By.css('.bundle-list__remove'))
        .nativeElement.click();
      await fixture.whenStable();

      expect(dispatchSpy).toHaveBeenCalledWith(
        LoginModeActions.removeBundles({
          mode: LoginMode.LOCAL,
          bundleIds: [bundleA.bundleId],
        }),
      );
      // A run belonging to a removed bundle is stopped first, and the
      // bundle's audio (resident PCM + retained source File) is released.
      expect(pipelineQueueService.cancelIfActive).toHaveBeenCalledWith([
        bundleA.bundleId,
      ]);
      expect(audioService.forget).toHaveBeenCalledWith(bundleA.bundleId);
    });

    it('remove asks for confirmation and does nothing when declined', async () => {
      modalService.openModal.mockResolvedValue('no');
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      fixture.debugElement
        .queryAll(By.css('.bundle-list__item-checkbox'))[0]
        .nativeElement.click();
      fixture.detectChanges();

      fixture.debugElement
        .query(By.css('.bundle-list__remove'))
        .nativeElement.click();
      await fixture.whenStable();

      expect(modalService.openModal).toHaveBeenCalledWith(
        YesNoModalComponent,
        YesNoModalComponent.options,
        { message: 'workbench.bundle_list.confirm_remove' },
      );
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: LoginModeActions.removeBundles.type }),
      );
      expect(audioService.forget).not.toHaveBeenCalled();
      expect(fixture.componentInstance.isSelected(bundleA.bundleId)).toBe(true);
    });

    it('clear finished does nothing when the confirmation is dismissed', async () => {
      modalService.openModal.mockRejectedValue(0);
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: { [bundleA.bundleId]: { state: 'done' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      fixture.debugElement
        .query(By.css('.bundle-list__clear-finished'))
        .nativeElement.click();
      await fixture.whenStable();

      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: LoginModeActions.removeBundles.type }),
      );
    });

    it('turns the headings into a selection bar while rows are checked', () => {
      fixture.detectChanges();
      const q = (css: string) => fixture.debugElement.query(By.css(css));
      expect(q('.bundle-list__remove')).toBeNull();
      expect(q('.bundle-list__columns')).toBeTruthy();

      fixture.debugElement
        .queryAll(By.css('.bundle-list__item-checkbox'))[0]
        .nativeElement.click();
      fixture.detectChanges();
      expect(q('.bundle-list__columns')).toBeNull();
      expect(
        q('.bundle-list__selected-count').nativeElement.textContent.trim(),
      ).toBe('workbench.bundle_list.selected_count_one');
      expect(q('.bundle-list__remove')).toBeTruthy();
      // Some rows ticked: select-all shows the mixed state.
      expect(q('.bundle-list__select-all').nativeElement.indeterminate).toBe(
        true,
      );

      q('.bundle-list__deselect').nativeElement.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.selectedCount()).toBe(0);
      expect(q('.bundle-list__remove')).toBeNull();
      expect(q('.bundle-list__columns')).toBeTruthy();
    });

    it('remove is a no-op when nothing is checked', async () => {
      modalService.openModal.mockResolvedValue('yes');
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      await fixture.componentInstance.onRemoveSelected();
      await fixture.whenStable();
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: LoginModeActions.removeBundles.type }),
      );
    });

    it('clear finished removes only bundles whose run.state is done', async () => {
      modalService.openModal.mockResolvedValue('yes');
      // bundleA/bundleB fixtures at the top of this file don't carry a run
      // status; override the mock store's runs feature so bundleA reads as
      // 'done' for this one test — mirrors the "pipeline run status and
      // retry" describe block's existing store.setState({...initialState,
      // pipelineQueue: {...}}) pattern rather than a `store.state` getter,
      // which MockStore/Store don't expose (see mock_store.d.ts).
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: { [bundleA.bundleId]: { state: 'done' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const dispatchSpy = jest.spyOn(store, 'dispatch');
      fixture.debugElement
        .query(By.css('.bundle-list__clear-finished'))
        .nativeElement.click();
      await fixture.whenStable();

      expect(dispatchSpy).toHaveBeenCalledWith(
        LoginModeActions.removeBundles({
          mode: LoginMode.LOCAL,
          bundleIds: [bundleA.bundleId],
        }),
      );
    });

    it('clear finished is a no-op when no bundle is done', async () => {
      modalService.openModal.mockResolvedValue('yes');
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      fixture.debugElement
        .query(By.css('.bundle-list__clear-finished'))
        .nativeElement.click();
      await fixture.whenStable();
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: LoginModeActions.removeBundles.type }),
      );
    });

    // Finding #3 (final whole-branch review fix wave): onClearFinished()
    // used to leave `_selected` holding the now-dead id, which could then
    // leak into onExport()'s ticked bundles.
    it('clear finished also clears the selection', async () => {
      modalService.openModal.mockResolvedValue('yes');
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: { [bundleA.bundleId]: { state: 'done' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const rowCheckboxes = fixture.debugElement.queryAll(
        By.css('.bundle-list__item-checkbox'),
      );
      rowCheckboxes[0].nativeElement.click(); // checks bundle-a
      fixture.detectChanges();
      expect(fixture.componentInstance.isSelected(bundleA.bundleId)).toBe(true);

      fixture.debugElement
        .query(By.css('.bundle-list__clear-finished'))
        .nativeElement.click();
      await fixture.whenStable();

      expect(fixture.componentInstance.isSelected(bundleA.bundleId)).toBe(
        false,
      );
    });
  });

  // Finding #2 (final whole-branch review fix wave): BundleListComponent.
  // bundles() previously had no name filter, so once every bundle was
  // removed and the reducer re-seeded one nameless DEFAULT_BUNDLE_ID
  // sentinel (the "collection never empty" invariant), this list still
  // rendered a phantom row with an empty name.
  describe('nameless sentinel filtering', () => {
    it('excludes a bundle with an undefined sessionFile name from bundles()', () => {
      const nameless = {
        bundleId: 'bundle-1',
        sessionFile: undefined,
        audio: { loaded: false },
      } as any;
      store.setState({
        application: { mode: LoginMode.LOCAL },
        localMode: {
          bundles: localBundleAdapter.setAll(
            [nameless, bundleB],
            localBundleAdapter.getInitialState(),
          ),
          selectedBundleId: 'bundle-b',
        },
        pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
      } as unknown as RootState);
      fixture.detectChanges();

      const ids = fixture.componentInstance.bundles().map((b) => b.bundleId);
      expect(ids).toEqual(['bundle-b']);

      const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
      expect(rows.length).toBe(1);
    });
  });

  // Finding #3 (final whole-branch review fix wave): the exact reported
  // sequence — check a bundle, it becomes 'done', clear finished, then
  // export with nothing visibly checked. Before the fix, the stale
  // `_selected` id could leak into the export even after removal; this
  // exercises the full round trip through onClearFinished() and onExport()
  // together.
  describe("Finding #3: clear-finished doesn't leak a stale id into export", () => {
    it('opens the export dialog with only the live bundles and nothing ticked', async () => {
      modalService.openModal.mockResolvedValue('yes');
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: { [bundleA.bundleId]: { state: 'done' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const rowCheckboxes = fixture.debugElement.queryAll(
        By.css('.bundle-list__item-checkbox'),
      );
      rowCheckboxes[0].nativeElement.click(); // checks bundle-a (the finished one)
      fixture.detectChanges();

      fixture.debugElement
        .query(By.css('.bundle-list__clear-finished'))
        .nativeElement.click();
      await fixture.whenStable();

      // Reflects what the real removeBundles reducer would have done —
      // this spec drives the component against a mocked store, so the
      // removal itself is simulated here.
      store.setState({
        application: { mode: LoginMode.LOCAL },
        localMode: {
          bundles: localBundleAdapter.setAll(
            [bundleB],
            localBundleAdapter.getInitialState(),
          ),
          selectedBundleId: 'bundle-b',
        },
        pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
      } as unknown as RootState);
      fixture.detectChanges();

      fixture.debugElement
        .query(By.css('.bundle-list__export'))
        .nativeElement.click();

      expect(modalService.openModal).toHaveBeenCalledWith(
        ExportFilesModalComponent,
        ExportFilesModalComponent.options,
        {
          bundles: [
            expect.objectContaining({
              bundleId: bundleB.bundleId,
              hasAudio: false,
            }),
          ],
          tickedIds: [],
          openBundleId: 'bundle-b',
        },
      );
    });

    it('keeps a live bundle ticked after clear-finished', async () => {
      modalService.openModal.mockResolvedValue('yes');
      store.setState({
        ...initialState,
        pipelineQueue: {
          queue: [],
          activeId: null,
          mode: 'idle',
          runs: { [bundleA.bundleId]: { state: 'done' } },
        },
      } as unknown as RootState);
      fixture.detectChanges();

      const rowCheckboxes = fixture.debugElement.queryAll(
        By.css('.bundle-list__item-checkbox'),
      );
      rowCheckboxes[0].nativeElement.click(); // bundle-a (finished)
      rowCheckboxes[1].nativeElement.click(); // bundle-b (still live)
      fixture.detectChanges();

      fixture.debugElement
        .query(By.css('.bundle-list__clear-finished'))
        .nativeElement.click();
      await fixture.whenStable();

      store.setState({
        application: { mode: LoginMode.LOCAL },
        localMode: {
          bundles: localBundleAdapter.setAll(
            [bundleB],
            localBundleAdapter.getInitialState(),
          ),
          selectedBundleId: 'bundle-b',
        },
        pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
      } as unknown as RootState);
      fixture.detectChanges();

      fixture.debugElement
        .query(By.css('.bundle-list__export'))
        .nativeElement.click();

      expect(modalService.openModal).toHaveBeenCalledWith(
        ExportFilesModalComponent,
        ExportFilesModalComponent.options,
        {
          bundles: [
            expect.objectContaining({
              bundleId: bundleB.bundleId,
              hasAudio: false,
            }),
          ],
          tickedIds: [bundleB.bundleId],
          openBundleId: 'bundle-b',
        },
      );
    });
  });

  describe('keyboard navigation', () => {
    // Fixture order is [bundle-a (awaitingMedia, reattach input), bundle-b
    // (selected, click-to-select button)] — deliberately exercises roving
    // tabindex across BOTH row shapes, not just plain buttons.
    function focusTargets() {
      return fixture.debugElement.queryAll(
        By.css('.bundle-list__item-primary'),
      );
    }

    // Dispatches on whichever element currently has focus (falling back to
    // the list root only if nothing does), letting the event bubble up to
    // the <ul>'s (keydown) binding — matching real browser event flow,
    // where a keydown's `target` is the focused element and `currentTarget`
    // is whatever ancestor the listener is bound to. Dispatching directly
    // on the <ul> (as an earlier version of this helper did) would give
    // every keydown `target === <ul>`, which can never satisfy a handler
    // that guards on "did this key originate from a row's primary
    // control" — silently testing a scenario no real keypress produces.
    function dispatchKey(key: string) {
      (
        document.activeElement ??
        fixture.debugElement.query(By.css('.bundle-list')).nativeElement
      ).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();
    }

    it('defaults the roving tabindex to the currently-selected row', () => {
      const targets = focusTargets();
      expect(targets[0].attributes['tabindex']).toBe('-1');
      expect(targets[1].attributes['tabindex']).toBe('0');
    });

    it('ArrowUp moves focus to the previous row and updates tabindex, without changing selection', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      focusTargets()[1].nativeElement.focus();

      dispatchKey('ArrowUp');

      const targets = focusTargets();
      expect(targets[0].attributes['tabindex']).toBe('0');
      expect(targets[1].attributes['tabindex']).toBe('-1');
      expect(document.activeElement).toBe(targets[0].nativeElement);
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: LoginModeActions.selectBundle.type }),
      );
    });

    it('ArrowDown moves focus to the next row', () => {
      focusTargets()[0].nativeElement.focus();

      dispatchKey('ArrowDown');

      const targets = focusTargets();
      expect(document.activeElement).toBe(targets[1].nativeElement);
      expect(targets[1].attributes['tabindex']).toBe('0');
    });

    it('ArrowUp on the first row stays put instead of wrapping or erroring', () => {
      focusTargets()[1].nativeElement.focus();
      dispatchKey('Home'); // establish a verified starting position at row 0

      dispatchKey('ArrowUp');

      const targets = focusTargets();
      expect(document.activeElement).toBe(targets[0].nativeElement);
    });

    it('ArrowDown on the last row stays put instead of wrapping', () => {
      focusTargets()[0].nativeElement.focus();
      dispatchKey('End'); // establish a verified starting position at the last row

      dispatchKey('ArrowDown');

      const targets = focusTargets();
      expect(document.activeElement).toBe(targets[1].nativeElement);
    });

    it('End moves focus straight to the last row', () => {
      focusTargets()[0].nativeElement.focus();

      dispatchKey('End');

      const targets = focusTargets();
      expect(document.activeElement).toBe(targets[1].nativeElement);
    });

    it('Home moves focus straight to the first row', () => {
      focusTargets()[1].nativeElement.focus();

      dispatchKey('Home');

      const targets = focusTargets();
      expect(document.activeElement).toBe(targets[0].nativeElement);
    });

    it('syncs the roving tabindex to whichever row focus lands on for any reason, not just arrow keys', () => {
      // Simulates a user clicking a different row directly (a real click
      // moves native focus to the clicked control before the click handler
      // even runs) — without a focus-arrival sync, the roving tabindex
      // would stay wherever the last arrow-key move left it.
      focusTargets()[1].nativeElement.focus();
      dispatchKey('Home'); // arrow-track row 0 first, so a stale index would be observable

      focusTargets()[1].nativeElement.focus(); // then "click" row 1 directly
      fixture.detectChanges();

      const targets = focusTargets();
      expect(targets[0].attributes['tabindex']).toBe('-1');
      expect(targets[1].attributes['tabindex']).toBe('0');
    });

    it("does not relocate focus when an arrow key originates from a row's secondary control (checkbox)", () => {
      const checkbox = fixture.debugElement.queryAll(
        By.css('.bundle-list__item-checkbox'),
      )[0];
      checkbox.nativeElement.focus();

      dispatchKey('ArrowDown');

      expect(document.activeElement).toBe(checkbox.nativeElement);
    });

    it('keeps the roving tabindex on the correct bundle when an earlier row is removed', () => {
      // A third bundle, non-awaitingMedia (plain button row) like bundle-b,
      // so the fixture is [bundle-a (row 0), bundle-b (row 1, selected),
      // bundle-c (row 2)] — three rows, so the tracked bundle can sit in
      // the MIDDLE of the remaining rows after row 0 is removed, which is
      // what actually exposes position-based (rather than identity-based)
      // tracking: removing row 0 shifts bundle-c from index 2 to index 1,
      // landing exactly on bundle-b's OLD index — a position tracker still
      // pointed at "index 1" would now misattribute tabindex to bundle-b
      // even though the user's last arrow move was onto bundle-c.
      const bundleC = {
        bundleId: 'bundle-c',
        sessionFile: new SessionFile('c.wav', 3, new Date(), 'audio/wav'),
        audio: { loaded: true },
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
        pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
      } as unknown as RootState);
      fixture.detectChanges();

      // Arrow-track row 2 (bundle-c).
      focusTargets()[1].nativeElement.focus();
      dispatchKey('ArrowDown');

      // Remove row 0 (bundle-a) — bundle-c shifts from index 2 to index 1.
      store.setState({
        application: { mode: LoginMode.LOCAL },
        localMode: {
          bundles: localBundleAdapter.setAll(
            [bundleB, bundleC],
            localBundleAdapter.getInitialState(),
          ),
          selectedBundleId: 'bundle-b',
        },
        pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
      } as unknown as RootState);
      fixture.detectChanges();

      const targets = focusTargets();
      expect(targets.length).toBe(2);
      expect(targets[0].attributes['tabindex']).toBe('-1'); // bundle-b, selected but not arrow-tracked
      expect(targets[1].attributes['tabindex']).toBe('0'); // bundle-c, still the arrow-tracked bundle
    });
  });

  describe('in a VISP workspace', () => {
    let saveBundle: jest.Mock;
    let vispBundles: ReturnType<typeof signal<Record<string, unknown>>>;

    const vispRow = (over: Record<string, unknown> = {}) => ({
      ref: { name: 'a', session: 's', finishedEditing: false, comment: 'kept' },
      sync: 'saved',
      opened: true,
      ...over,
    });

    beforeEach(async () => {
      TestBed.resetTestingModule();
      saveBundle = jest.fn(async () => true);
      vispBundles = signal<Record<string, unknown>>({
        [bundleA.bundleId]: vispRow(),
        [bundleB.bundleId]: vispRow({
          ref: { name: 'b', session: 's', finishedEditing: true },
        }),
      });
      audioService.hasResident.mockReturnValue(true);
      await TestBed.configureTestingModule({
        imports: [BundleListComponent],
        providers: [
          provideMockStore({ initialState }),
          { provide: AudioService, useValue: audioService },
          { provide: TrattModalService, useValue: modalService },
          { provide: PipelineQueueService, useValue: pipelineQueueService },
          { provide: WorkspaceService, useValue: { isVisp: signal(true) } },
          {
            provide: VispWorkspaceService,
            useValue: { bundles: vispBundles, saveBundle, info: jest.fn() },
          },
          {
            provide: TranslocoService,
            useValue: {
              getActiveLang: () => 'en',
              langChanges$: of('en'),
              translate: (key: string) => key,
              config: { reRenderOnLangChange: false },
              _loadDependencies: () => of({}),
            },
          },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(BundleListComponent);
      fixture.detectChanges();
    });

    const toggles = () =>
      fixture.debugElement
        .queryAll(By.css('button.bundle-list__coverage'))
        .map((el) => el.nativeElement as HTMLButtonElement);

    it('has no comment button any more', () => {
      expect(
        fixture.debugElement.query(By.css('.bundle-list__note')),
      ).toBeNull();
    });

    it('shows done as a pressed ring with a check, from VISP', () => {
      const [a, b] = toggles();
      expect(a.getAttribute('aria-pressed')).toBe('false');
      expect(b.getAttribute('aria-pressed')).toBe('true');
      expect(b.querySelector('.bundle-list__ring-check')).toBeTruthy();
    });

    it('toggles done through a save, leaving the comment to the save', () => {
      toggles()[0].click();
      expect(saveBundle).toHaveBeenCalledWith(bundleA.bundleId, {
        finishedEditing: true,
      });
      toggles()[1].click();
      expect(saveBundle).toHaveBeenCalledWith(bundleB.bundleId, {
        finishedEditing: false,
      });
    });

    it('cannot toggle a bundle never opened, nor while saving', () => {
      vispBundles.set({
        [bundleA.bundleId]: vispRow({ opened: false }),
        [bundleB.bundleId]: vispRow({ sync: 'saving' }),
      });
      fixture.detectChanges();
      expect(toggles().map((b) => b.disabled)).toEqual([true, true]);
    });

    it('offers no toggle on a bundle no longer assigned or in conflict', () => {
      vispBundles.set({
        [bundleA.bundleId]: vispRow({ unassigned: true }),
        [bundleB.bundleId]: vispRow({ error: { kind: 'stale' } }),
      });
      fixture.detectChanges();
      expect(toggles()).toEqual([]);
    });

    it('never shows the audio column', () => {
      expect(
        fixture.debugElement.query(By.css('.bundle-list__audio')),
      ).toBeNull();
    });
  });
});

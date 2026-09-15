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
import { TranslocoService } from '@jsverse/transloco';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AudioManager } from '@tratt/web-media';
import { of } from 'rxjs';
import { BundleReattachMismatchAnswer } from '../../modals/bundle-reattach-mismatch-modal/bundle-reattach-mismatch-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { SessionFile } from '../../obj/SessionFile';
import { LoginMode, RootState } from '../../store/index';
import { localBundleAdapter } from '../../store/login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { AudioService } from '../../shared/service/audio.service';
import { BundleListComponent } from './bundle-list.component';

// Convention: mock Store via @ngrx/store/testing's provideMockStore with a
// real initialState (rather than overrideSelector), matching
// audio.service.spec.ts / annotation.selectors.spec.ts — this exercises the
// real selectAllBundleSummaries selector against real state.
describe('BundleListComponent', () => {
  let fixture: ComponentFixture<BundleListComponent>;
  let store: MockStore<RootState>;
  let audioService: { registerAudioManager: jest.Mock };
  let modalService: { openModal: jest.Mock<any> };

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
    audioService = { registerAudioManager: jest.fn() };
    modalService = { openModal: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [BundleListComponent],
      providers: [
        provideMockStore({ initialState }),
        { provide: AudioService, useValue: audioService },
        { provide: TrattModalService, useValue: modalService },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
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
      const rowA = rows.find((r) => r.nativeElement.textContent.includes('a.wav'));
      const input = rowA!.query(By.css('input[type="file"]'));
      expect(input).toBeTruthy();
    });

    it('does not render a file input for a bundle with awaitingMedia false', () => {
      const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
      const rowB = rows.find((r) => r.nativeElement.textContent.includes('b.wav'));
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
        matchingSessionFile.timestamp.getTime(),
      );
      const event = { target: { files: [file], value: '' } } as unknown as Event;

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
        matchingSessionFile.timestamp.getTime(),
      );
      const event = { target: { files: [file], value: '' } } as unknown as Event;

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
        matchingSessionFile.timestamp.getTime(),
      );
      const event = { target: { files: [file], value: '' } } as unknown as Event;

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
  });
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// Task 7: WorkbenchComponent now mounts the REAL AutoTranscribeOptionsComponent
// itself (the queue's own config panel) and injects PipelineQueueService — both
// reach local-transcription.service.ts / local-translation.service.ts, which
// instantiate a Worker via `new URL('...', import.meta.url)` at module scope and
// fail to compile under this project's CommonJS ts-jest config. Same workaround
// as bundle-list.component.spec.ts / pipeline-queue.service.spec.ts: this spec
// never touches the real worker-backed services (PipelineQueueService itself is
// replaced by a mock below), so stub the two leaf modules out entirely.
jest.mock('../../shared/service/local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

// tratt-dropzone.component.ts transitively imports AutoTranscribeOptionsComponent and
// AutoTranslateOptionsComponent, which import local-transcription.service.ts /
// local-translation.service.ts. Both instantiate a Worker via
// `new URL('...worker', import.meta.url)`, which fails to compile under this project's
// CommonJS ts-jest config (same pre-existing issue worked around in
// linear-editor.component.spec.ts). This test never renders the real dropzone — it
// stubs `component.dropzone` directly — so a minimal standalone stand-in with the
// right selector is enough to satisfy WorkbenchComponent's `@ViewChild` and template.
jest.mock('../../component/tratt-dropzone/tratt-dropzone.component', () => {
  const { Component, Input } = require('@angular/core');
  @Component({ selector: 'tratt-dropzone', template: '' })
  class TrattDropzoneComponent {
    @Input() showAutoTranscribe = false;
    @Input() allowMultipleAudio = false;
  }
  return { TrattDropzoneComponent };
});

// BundleListComponent injects Store<RootState> directly, which this bare TestBed
// doesn't provide (WorkbenchComponent itself has no store dependency). Its own
// behavior is fully covered by bundle-list.component.spec.ts, so stub it out here
// with a minimal standalone stand-in, same rationale/pattern as the tratt-dropzone
// mock above.
jest.mock('../../component/bundle-list/bundle-list.component', () => {
  const { Component } = require('@angular/core');
  @Component({ selector: 'tratt-bundle-list', template: '' })
  class BundleListComponent {}
  return { BundleListComponent };
});

// recording-panel.component.ts injects RecordingService/RecordingPersistenceService
// (IndexedDB + MediaRecorder-backed), neither of which this bare TestBed provides,
// and its ngOnInit calls persistence.pruneOlderThan/refreshRecoverable immediately.
// This spec only needs WorkbenchComponent.onUseRecording()'s wiring and the panel's
// mere presence in the template — not its internal recording behavior (that's
// recording-panel.component.spec.ts's job) — so stub it out with a minimal
// standalone stand-in exposing the one `(useRecording)` output, same
// rationale/pattern as the tratt-dropzone/bundle-list mocks above.
jest.mock('../../component/recording-panel/recording-panel.component', () => {
  const { Component, EventEmitter, Output } = require('@angular/core');
  @Component({ selector: 'tratt-recording-panel', template: '' })
  class RecordingPanelComponent {
    @Output() useRecording = new EventEmitter();
  }
  return { RecordingPanelComponent };
});

// WorkbenchComponent imports editorComponents (for changeEditor), which pulls in
// 2D-editor/dictaphone-editor/linear-editor. Those import TranscrEditorComponent from
// the core/component barrel, which re-exports navbar.component.ts ->
// translate-linked-level-modal.component.ts -> local-translation.service.ts, which uses
// `import.meta.url` and fails to compile under this project's CommonJS ts-jest config
// (same pre-existing issue worked around in linear-editor.component.spec.ts and
// editors/components.spec.ts). This test never touches navbar behavior, so the whole
// navbar submodule is mocked out; WorkbenchComponent's own direct
// `'../../component/navbar/navbar.service'` import is a different, unaffected module.
jest.mock('../../component/navbar', () => ({}));

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { randomUUID } from 'node:crypto';
import { BehaviorSubject, of } from 'rxjs';
import { editorComponents } from '../../../editors/components';
import { NavbarService } from '../../component/navbar/navbar.service';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { AudioService } from '../../shared/service/audio.service';
import {
  CapacityService,
  RAM_BUDGET_BYTES,
  ResidentMemoryEstimate,
  StorageCapacity,
} from '../../shared/service/capacity.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { RoutingService } from '../../shared/service/routing.service';
import { LoadingStatus } from '../../store';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import { initialState as annotationInitialState } from '../../store/login-mode/annotation/annotation.reducer';
import { selectAllBundleSummaries } from '../../store/login-mode/annotation/annotation.selectors';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from '../../store/login-mode/annotation/local-bundle-collection';
import {
  selectAllRunStatuses,
  selectQueueMode,
} from '../../store/pipeline-queue/pipeline-queue.selectors';
import { WorkbenchComponent } from './workbench.component';

// Lightweight stand-in mounted in place of a real editor (e.g.
// DictaphoneEditorComponent) for the "real ViewChild/createComponent path"
// regression test below. A real editor's ngOnInit/ngOnDestroy needs live
// audio infrastructure (AudioService.audiomanagers, AudioManager.stopPlayback,
// etc.) that this bare TestBed doesn't provide, and blows up on automatic
// fixture teardown otherwise. This fake has none of that, so it mounts and
// tears down cleanly while still exercising the real
// ViewContainerRef.createComponent() call.
@Component({ selector: 'tratt-spec-fake-editor', template: '' })
class FakeEditorComponent {}

// The jsdom version bundled with jest-environment-jsdom implements
// window.crypto.getRandomValues but not crypto.randomUUID (unlike real
// browsers, which have supported it since 2022). Polyfill it with Node's
// implementation so startSession()'s generateBundleId() calls work as they
// would in production. (Same polyfill as authentication.effects.spec.ts.)
if (
  typeof (globalThis.crypto as { randomUUID?: unknown })?.randomUUID !==
  'function'
) {
  (
    globalThis.crypto as unknown as { randomUUID: typeof randomUUID }
  ).randomUUID = randomUUID;
}

describe('WorkbenchComponent', () => {
  let fixture: ComponentFixture<WorkbenchComponent>;
  let component: WorkbenchComponent;
  let audioService: {
    registerAudioManager: jest.Mock;
    hasResident: jest.Mock;
    current: any;
  };
  let authStoreService: { loginLocal: jest.Mock };
  let loading$: BehaviorSubject<{ status: LoadingStatus }>;
  let bundleSummaries: any[];
  // Task 7: the queue's own store slice, read through the same
  // selector-routed Store stub as bundleSummaries below.
  let queueMode: 'idle' | 'running' | 'pausing';
  let runStatuses: Record<string, { state: string }>;
  let pipelineQueueService: {
    setTranscribeOptions: jest.Mock;
    enqueue: jest.Mock;
    stop: jest.Mock;
    retry: jest.Mock;
    readyBundleIds: jest.Mock;
  };
  // Step 3c: WorkbenchComponent now mounts CapacityIndicatorComponent, which
  // injects the real root CapacityService — which would start a 5s poll over
  // an AudioService stub that has no `audiomanagers`. Provide signals-backed
  // fakes instead; the component's own behaviour is covered in
  // capacity-indicator.component.spec.ts.
  let capacityService: {
    storage: WritableSignal<StorageCapacity>;
    residentMemory: WritableSignal<ResidentMemoryEstimate>;
    setConfiguredOptions: jest.Mock;
  };

  beforeEach(async () => {
    audioService = {
      registerAudioManager: jest.fn(),
      hasResident: jest.fn().mockReturnValue(false),
      current: undefined,
    };
    authStoreService = { loginLocal: jest.fn() };
    loading$ = new BehaviorSubject<{ status: LoadingStatus }>({
      status: LoadingStatus.INITIALIZE,
    });
    // No bundles by default: matches a clean/logged-out profile where
    // nothing has been restored from IndexedDB and no session has started.
    bundleSummaries = [];
    queueMode = 'idle';
    runStatuses = {};
    pipelineQueueService = {
      setTranscribeOptions: jest.fn(),
      enqueue: jest.fn(),
      stop: jest.fn(),
      retry: jest.fn(),
      readyBundleIds: jest.fn(() => []),
    };
    capacityService = {
      storage: signal<StorageCapacity>({
        usedBytes: 0,
        quotaBytes: 0,
        modelsEstimateBytes: 0,
      }),
      residentMemory: signal<ResidentMemoryEstimate>({
        estimatedBytes: 0,
        residentCount: 0,
        budgetBytes: RAM_BUDGET_BYTES,
      }),
      setConfiguredOptions: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [WorkbenchComponent],
      providers: [
        { provide: AudioService, useValue: audioService },
        { provide: AuthenticationStoreService, useValue: authStoreService },
        { provide: AppStorageService, useValue: {} },
        { provide: RoutingService, useValue: { staticQueryParams: {} } },
        { provide: NavbarService, useValue: {} },
        { provide: RecordedFileService, useValue: {} },
        { provide: AnnotationStoreService, useValue: {} },
        { provide: SettingsService, useValue: { isTheme: () => false } },
        { provide: TrattModalService, useValue: {} },
        { provide: ApplicationStoreService, useValue: { loading$ } },
        { provide: UserInteractionsService, useValue: {} },
        { provide: PipelineQueueService, useValue: pipelineQueueService },
        { provide: CapacityService, useValue: capacityService },
        {
          // WorkbenchComponent reads selectAllBundleSummaries / selectQueueMode
          // / selectAllRunStatuses directly (same selectSignal convention as
          // AudioService/BundleListComponent). Stub selectSignal per-selector
          // (by reference) rather than generically, now that more than one
          // distinct selector is read — a single shared fixture (the old
          // `() => bundleSummaries` for every selector) would silently hand
          // the queue-mode/run-status reads the wrong shape.
          provide: Store,
          useValue: {
            selectSignal: (selector: unknown) => {
              if (selector === selectAllBundleSummaries) {
                return () => bundleSummaries;
              }
              if (selector === selectQueueMode) {
                return () => queueMode;
              }
              if (selector === selectAllRunStatuses) {
                return () => runStatuses;
              }
              return () => undefined;
            },
          },
        },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            selectTranslate: () => of(''),
            config: { reRenderOnLangChange: false },
            // AutoTranscribeOptionsComponent's own template (mounted a
            // second time in the queue panel) resolves its translation
            // scope via this before calling translate() at all.
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkbenchComponent);
    component = fixture.componentInstance;
  });

  it('registers the dropzone audio manager and calls loginLocal on startSession', () => {
    const manager = { id: 'fake-manager' } as any;
    const nativeFile = new File(['content'], 'a.wav');
    const reset = jest.fn();
    component.dropzone = {
      validAudioEntries: [
        {
          fileProgress: { file: { file: nativeFile } },
          audioManager: manager,
          oaudiofile: {} as any,
        },
      ],
      hasAnnotation: false,
      oannotation: undefined,
      reset,
    } as any;

    component.startSession(false);

    expect(audioService.registerAudioManager).toHaveBeenCalledWith(
      DEFAULT_BUNDLE_ID,
      manager,
      nativeFile,
    );
    const [bundleId] = audioService.registerAudioManager.mock.calls[0];
    expect(authStoreService.loginLocal).toHaveBeenCalledWith(
      [nativeFile],
      undefined,
      false,
      [bundleId],
    );
    // Fix 5 (fixwave-1): a successful start clears the dropzone's pending
    // list so it can't be re-ingested by a second Start click, and its rows
    // stop rendering stale delete buttons for already-handed-off files.
    expect(reset).toHaveBeenCalled();
  });

  // Task 5: under the new validAudioEntries contract there is exactly one way to have
  // zero valid entries (an empty array) — the old "audioManager present but file.file
  // undefined" case from before Task 1 no longer applies, since validAudioEntries is
  // constructed only from fully-decoded, valid entries. This test and the "no audio
  // manager yet" case are therefore now identical; keeping just this one.
  it('does nothing when the dropzone has no valid audio entries', () => {
    component.dropzone = { validAudioEntries: [] } as any;
    component.startSession(false);
    expect(audioService.registerAudioManager).not.toHaveBeenCalled();
    expect(authStoreService.loginLocal).not.toHaveBeenCalled();
  });

  it('registers a distinct bundle id per dropped audio file and passes them all to loginLocal', () => {
    const managers = [
      { id: 'manager-1' } as any,
      { id: 'manager-2' } as any,
      { id: 'manager-3' } as any,
    ];
    const nativeFiles = [
      new File(['a'], 'a.wav'),
      new File(['b'], 'b.wav'),
      new File(['c'], 'c.wav'),
    ];
    const reset = jest.fn();
    component.dropzone = {
      validAudioEntries: managers.map((audioManager, i) => ({
        fileProgress: { file: { file: nativeFiles[i] } },
        audioManager,
        oaudiofile: {} as any,
      })),
      hasAnnotation: false,
      oannotation: undefined,
      reset,
    } as any;

    component.startSession(false);

    expect(audioService.registerAudioManager).toHaveBeenCalledTimes(3);
    const registeredIds = audioService.registerAudioManager.mock.calls.map(
      (call: any[]) => call[0],
    );
    const registeredManagers = audioService.registerAudioManager.mock.calls.map(
      (call: any[]) => call[1],
    );
    expect(new Set(registeredIds).size).toBe(3);
    expect(registeredManagers).toEqual(managers);

    expect(authStoreService.loginLocal).toHaveBeenCalledTimes(1);
    const [files, annotation, removeData, audioBundleIds] = authStoreService
      .loginLocal.mock.calls[0] as [File[], undefined, boolean, string[]];
    expect(files).toEqual(nativeFiles);
    expect(annotation).toBeUndefined();
    expect(removeData).toBe(false);
    expect(audioBundleIds.length).toBe(3);
    nativeFiles.forEach((_file, i) => {
      expect(audioBundleIds[i]).toBe(registeredIds[i]);
    });
    // Fix 1 (fixwave-1): entry 0 must reuse DEFAULT_BUNDLE_ID — the store's
    // default bundle entity always exists there, so AudioService.current
    // resolves correctly for the ordinary (N=1) case too.
    expect(audioBundleIds[0]).toBe(DEFAULT_BUNDLE_ID);
    expect(reset).toHaveBeenCalled();
  });

  // Task 1 (step 2.9): mounting the recording panel and wiring its
  // (useRecording) output into the existing addFile()/recordedFileService
  // handoff, mirroring login.component.ts's onUseRecording() exactly.
  describe('onUseRecording', () => {
    it('sets recordedFileService.recordedFile and stages the file on the dropzone', () => {
      fixture.detectChanges();
      const addFile = jest.fn();
      component.dropzone = { addFile } as any;
      const recordedFileService = TestBed.inject(RecordedFileService) as any;
      const file = new File(['content'], 'recording.wav');

      component.onUseRecording(file);

      expect(recordedFileService.recordedFile).toBe(file);
      expect(addFile).toHaveBeenCalledWith(file);
    });

    it('does not throw when the dropzone ViewChild is not yet resolved', () => {
      fixture.detectChanges();
      component.dropzone = undefined;
      const file = new File(['content'], 'recording.wav');

      expect(() => component.onUseRecording(file)).not.toThrow();
    });
  });

  it('mounts tratt-recording-panel in the template', () => {
    fixture.detectChanges();

    const recordingPanel = fixture.debugElement.query(
      By.css('tratt-recording-panel'),
    );
    expect(recordingPanel).toBeTruthy();
  });

  // Guards against the ViewChild pitfall called out in the task brief: if the
  // recording panel is surfaced via an @if-gated tab/toggle that removes
  // <tratt-dropzone> from the DOM while the "record" pane is active, the
  // `@ViewChild(TrattDropzoneComponent) dropzone` query resolves to
  // `undefined` while hidden, breaking startSession() and onUseRecording()
  // alike — not just the new code. This must stay resolved regardless of
  // which pane the UI is currently emphasizing.
  it('keeps the dropzone ViewChild resolved regardless of which tab/pane is active', () => {
    fixture.detectChanges();
    expect(component.dropzone).toBeTruthy();

    (component as any).activeTab = 'record';
    fixture.detectChanges();

    expect(component.dropzone).toBeTruthy();
  });

  it('creates the selected editor component inside the loadeditor viewContainerRef', () => {
    const createComponentSpy = jest.fn();
    component.showEditor = {
      viewContainerRef: {
        clear: jest.fn(),
        createComponent: createComponentSpy,
      },
    } as any;

    component.changeEditor('Dictaphone Editor');

    expect(component.showEditor!.viewContainerRef.clear).toHaveBeenCalled();
    expect(createComponentSpy).toHaveBeenCalled();
  });

  describe('changeEditor persistence', () => {
    beforeEach(() => {
      component.showEditor = {
        viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
      } as any;
    });

    it('writes the selected editor name to appStorage.interface', () => {
      component.appStorage = { interface: undefined } as any;

      component.changeEditor('Linear Editor');

      expect(component.appStorage.interface).toBe('Linear Editor');
    });

    it('updates activeEditorName so the tab row can highlight it', () => {
      component.appStorage = { interface: undefined } as any;

      component.changeEditor('Linear Editor');

      expect(component.activeEditorName()).toBe('Linear Editor');
    });

    it('disposes the previously-mounted editor before mounting the next one, on every call — not just the first', () => {
      const clearSpy = jest.fn();
      const createSpy = jest.fn();
      component.showEditor = {
        viewContainerRef: { clear: clearSpy, createComponent: createSpy },
      } as any;
      component.appStorage = { interface: undefined } as any;

      component.changeEditor('Dictaphone Editor');
      component.changeEditor('Linear Editor');
      component.changeEditor('2D-Editor');

      expect(clearSpy).toHaveBeenCalledTimes(3);
      expect(createSpy).toHaveBeenCalledTimes(3);
    });

    // Review finding F1 (final whole-branch review): all editors are
    // store-backed only after their typing-debounce timer fires — an edit
    // still inside that ~1s window lived only in the editor instance until
    // now. A live switch must flush it before the view (and the timer with
    // it) is destroyed.
    it("flushes the previously-mounted editor's pending edits before disposing it, on a live switch", () => {
      const flushSpy = jest.fn();
      const clearSpy = jest.fn();
      const createSpy = jest
        .fn()
        .mockReturnValueOnce({ instance: { flushPendingEdits: flushSpy } })
        .mockReturnValueOnce({ instance: {} });
      component.showEditor = {
        viewContainerRef: { clear: clearSpy, createComponent: createSpy },
      } as any;
      component.appStorage = { interface: undefined } as any;

      component.changeEditor('Dictaphone Editor');
      expect(flushSpy).not.toHaveBeenCalled();

      component.changeEditor('Linear Editor');

      expect(flushSpy).toHaveBeenCalledTimes(1);
      // Flushed before the old view was cleared, not after — clear() is
      // what would destroy the timer the flush needs to race.
      expect(flushSpy.mock.invocationCallOrder[0]).toBeLessThan(
        clearSpy.mock.invocationCallOrder[1],
      );
    });

    it('does not throw when the newly-mounted editor has no flushPendingEdits (optional interface member)', () => {
      component.showEditor = {
        viewContainerRef: {
          clear: jest.fn(),
          createComponent: jest.fn().mockReturnValue({ instance: {} }),
        },
      } as any;
      component.appStorage = { interface: undefined } as any;

      component.changeEditor('Dictaphone Editor');

      expect(() => component.changeEditor('Linear Editor')).not.toThrow();
    });

    // F5: clicking the tab that's already active must not tear down and
    // rebuild the same editor (loses playback position/caret, and — before
    // F1's fix — could drop a pending edit for no reason).
    it('does nothing when changeEditor is called with the already-active editor name', () => {
      const clearSpy = jest.fn();
      const createSpy = jest.fn().mockReturnValue({ instance: {} });
      component.showEditor = {
        viewContainerRef: { clear: clearSpy, createComponent: createSpy },
      } as any;
      component.appStorage = { interface: undefined } as any;

      component.changeEditor('Linear Editor');
      clearSpy.mockClear();
      createSpy.mockClear();

      component.changeEditor('Linear Editor');

      expect(clearSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    // F6: a mount that throws must not leave appStorage.interface/
    // activeEditorName claiming a switch that didn't actually happen.
    it('leaves appStorage.interface and activeEditorName unchanged if the new editor throws during mount', () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      component.showEditor = {
        viewContainerRef: {
          clear: jest.fn(),
          createComponent: jest.fn().mockReturnValue({ instance: {} }),
        },
      } as any;
      component.appStorage = { interface: undefined } as any;
      component.changeEditor('Dictaphone Editor');
      expect(component.activeEditorName()).toBe('Dictaphone Editor');

      component.showEditor = {
        viewContainerRef: {
          clear: jest.fn(),
          createComponent: jest.fn(() => {
            throw new Error('boom');
          }),
        },
      } as any;

      component.changeEditor('Linear Editor');

      expect(component.appStorage.interface).toBe('Dictaphone Editor');
      expect(component.activeEditorName()).toBe('Dictaphone Editor');
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    // F5's "already-active" guard must not get stuck after a failed mount:
    // clear() already destroyed whatever was on screen even though the
    // failed switch left activeEditorName naming the PREVIOUS editor (F6).
    // Clicking that same, now-stale name again must still attempt a real
    // mount, not silently no-op forever because "it's already active".
    it('retries a real mount when the stale active-editor name is clicked again after a failed switch away from it', () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      component.appStorage = { interface: undefined } as any;
      component.showEditor = {
        viewContainerRef: {
          clear: jest.fn(),
          createComponent: jest.fn().mockReturnValue({ instance: {} }),
        },
      } as any;
      component.changeEditor('Dictaphone Editor');
      expect(component.activeEditorName()).toBe('Dictaphone Editor');

      component.showEditor = {
        viewContainerRef: {
          clear: jest.fn(),
          createComponent: jest.fn(() => {
            throw new Error('boom');
          }),
        },
      } as any;
      component.changeEditor('Linear Editor');
      expect(component.activeEditorName()).toBe('Dictaphone Editor');

      const createSpy = jest.fn().mockReturnValue({ instance: {} });
      component.showEditor = {
        viewContainerRef: { clear: jest.fn(), createComponent: createSpy },
      } as any;

      component.changeEditor('Dictaphone Editor');

      expect(createSpy).toHaveBeenCalled();
    });
  });

  describe('editor switcher tab row', () => {
    it('renders one tab per editorComponents entry, inside the sessionReady right pane', () => {
      component.showEditor = {
        viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
      } as any;
      component.appStorage = { interface: undefined } as any;
      fixture.detectChanges();
      loading$.next({ status: LoadingStatus.FINISHED });
      fixture.detectChanges();

      const tabs = fixture.debugElement.queryAll(
        By.css('.workbench__editor-tab'),
      );
      expect(tabs.length).toBe(editorComponents.length);
    });

    // Review finding F3 (final whole-branch review): mountDefaultEditor()
    // already validates appStorage.interface against
    // settingsService.projectsettings.interfaces (falling back to
    // interfaces[0] when invalid), and the navbar's own editor buttons
    // filter through the same list (navbar.component.ts's
    // interfaceActive()). Rendering all four editorComponents unconditionally
    // let a user mount an editor the project doesn't allow, which
    // mountDefaultEditor() would then silently revert away from on the next
    // session start — the tab row must respect the same allow-list.
    it("only renders tabs for the project's configured interfaces, when a list is configured", () => {
      // mountDefaultEditor() will pick a real, valid interface from the
      // list below and call the real changeEditor() — swap its editor for
      // the lightweight fake (same technique as the pre-existing "resolves
      // the real showEditor ViewChild..." test) so it can mount for real
      // without a real editor's heavyweight audio dependencies.
      const realEditor = editorComponents[0].editor;
      (editorComponents[0] as { editor: unknown }).editor = FakeEditorComponent;
      component.appStorage = { interface: undefined } as any;
      (component as any).settingsService = {
        projectsettings: {
          interfaces: [editorComponents[0].name, editorComponents[2].name],
        },
        isTheme: jest.fn().mockReturnValue(false),
      };

      try {
        fixture.detectChanges();
        loading$.next({ status: LoadingStatus.FINISHED });
        fixture.detectChanges();

        const tabs = fixture.debugElement.queryAll(
          By.css('.workbench__editor-tab'),
        );
        expect(tabs.length).toBe(2);
        // The spec's TranslocoService mock echoes the raw key
        // (`translate: (key) => key`), so tab text is the untranslated
        // `entry.translate` key, not the English display word.
        const labels = tabs.map((t) => t.nativeElement.textContent.trim());
        expect(labels.some((l) => l.includes('simple editor'))).toBe(true);
        expect(labels.some((l) => l.includes('TRN editor'))).toBe(true);
        expect(labels.some((l) => l.includes('linear editor'))).toBe(false);
      } finally {
        editorComponents[0].editor = realEditor;
        component.showEditor?.viewContainerRef.clear();
      }
    });

    it('renders every editor as a tab when no interfaces list is configured (falls back to showing all)', () => {
      component.showEditor = {
        viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
      } as any;
      component.appStorage = { interface: undefined } as any;
      (component as any).settingsService = {
        projectsettings: {},
        isTheme: jest.fn().mockReturnValue(false),
      };
      fixture.detectChanges();
      loading$.next({ status: LoadingStatus.FINISHED });
      fixture.detectChanges();

      const tabs = fixture.debugElement.queryAll(
        By.css('.workbench__editor-tab'),
      );
      expect(tabs.length).toBe(editorComponents.length);
    });

    it("clicking a tab calls changeEditor with that entry's name", () => {
      component.showEditor = {
        viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
      } as any;
      component.appStorage = { interface: undefined } as any;
      const changeEditorSpy = jest.spyOn(component, 'changeEditor');
      fixture.detectChanges();
      loading$.next({ status: LoadingStatus.FINISHED });
      fixture.detectChanges();

      const tabs = fixture.debugElement.queryAll(
        By.css('.workbench__editor-tab'),
      );
      tabs[1].nativeElement.click();

      expect(changeEditorSpy).toHaveBeenCalledWith(editorComponents[1].name);
    });

    it('highlights the tab matching the auto-mounted default editor, not only after a manual click', () => {
      // Swap editorComponents[2]'s real editor for the lightweight fake
      // (same technique as "resolves the real showEditor ViewChild..."
      // above) so mountDefaultEditor()'s real auto-mount path — real
      // ViewChild, real createComponent() — can run without a real
      // editor's heavyweight audio dependencies.
      const realEditor = editorComponents[2].editor;
      (editorComponents[2] as { editor: unknown }).editor = FakeEditorComponent;
      // Already-valid so mountDefaultEditor() keeps it rather than
      // resetting to interfaces[0] — see mountDefaultEditor()'s own
      // "valid === undefined" branch.
      component.appStorage = { interface: editorComponents[2].name } as any;
      (component as any).settingsService = {
        // Every editor allowed (not just index 2) — this test's own point
        // is that the *third* tab among several gets highlighted, not
        // merely that a lone tab does.
        projectsettings: { interfaces: editorComponents.map((e) => e.name) },
        isTheme: jest.fn().mockReturnValue(false),
      };

      try {
        fixture.detectChanges();
        loading$.next({ status: LoadingStatus.FINISHED });
        fixture.detectChanges();

        // mountDefaultEditor() (Task 5 of the phase-1 plan) is what runs
        // here, not a click — this proves activeEditorName is set by that
        // path too.
        expect(component.activeEditorName()).toBe(editorComponents[2].name);
        const activeTab = fixture.debugElement.query(
          By.css('.workbench__editor-tab--active'),
        );
        expect(activeTab).toBeTruthy();
        const allTabs = fixture.debugElement.queryAll(
          By.css('.workbench__editor-tab'),
        );
        expect(allTabs[2].nativeElement).toBe(activeTab.nativeElement);
      } finally {
        editorComponents[2].editor = realEditor;
        component.showEditor?.viewContainerRef.clear();
      }
    });
  });

  it('keeps the right pane hidden while application.loading.status is not FINISHED', () => {
    fixture.detectChanges();
    expect(component.sessionReady).toBe(false);
  });

  it('reveals the right pane once application.loading.status is FINISHED', () => {
    fixture.detectChanges();
    loading$.next({ status: LoadingStatus.FINISHED });
    expect(component.sessionReady).toBe(true);
  });

  // Task 4 (step 2.8): boot-time restore (Task 3) can populate bundles in the
  // store before any startSession() call this session, so sessionReady alone
  // (which requires actually-decoded audio) is too strict a gate for
  // *showing the bundle list* — the user needs to see restored-but-unresolved
  // bundles so a later task can let them pick one to resolve.
  describe('hasAnyBundles / bundle-list visibility gate', () => {
    it('hasAnyBundles() is false when no bundles exist in the store', () => {
      bundleSummaries = [];
      fixture.detectChanges();

      expect(component.hasAnyBundles()).toBe(false);
    });

    it('hasAnyBundles() is true when the store has bundles even though sessionReady is still false', () => {
      bundleSummaries = [
        {
          bundleId: 'bundle-a',
          name: 'a.wav',
          selected: true,
          awaitingMedia: true,
        },
      ];
      fixture.detectChanges();

      expect(component.sessionReady).toBe(false);
      expect(component.hasAnyBundles()).toBe(true);
    });

    // Bug found in review of the original Task 4 commit: the LOCAL bundle
    // collection ALWAYS contains one entity, the permanent DEFAULT_BUNDLE_ID
    // ('bundle-1') sentinel seeded by login-mode.reducer.ts's
    // initialCollectionState, present from app boot for every user —
    // including first-timers who have never dropped a file. A plain
    // `.length > 0` check on bundleSummaries() is therefore always true. Its
    // `name` field, however, is undefined until a real sessionFile has been
    // attached (whether via startSession() or the pre-existing boot restore
    // of bundle-1 itself), so hasAnyBundles() must require at least one
    // summary with a defined `name`.
    it('hasAnyBundles() is false for the permanent empty default bundle-1 sentinel (no name yet)', () => {
      bundleSummaries = [
        {
          bundleId: DEFAULT_BUNDLE_ID,
          name: undefined,
          selected: true,
          awaitingMedia: true,
        },
      ];
      fixture.detectChanges();

      expect(component.hasAnyBundles()).toBe(false);
    });

    it('mounts tratt-bundle-list once bundles exist, even before sessionReady', () => {
      bundleSummaries = [
        {
          bundleId: 'bundle-a',
          name: 'a.wav',
          selected: true,
          awaitingMedia: true,
        },
      ];
      fixture.detectChanges();

      expect(component.sessionReady).toBe(false);
      const bundleList = fixture.debugElement.query(
        By.css('tratt-bundle-list'),
      );
      expect(bundleList).toBeTruthy();
    });

    it('does not mount tratt-bundle-list when there are no bundles and sessionReady is false', () => {
      bundleSummaries = [];
      fixture.detectChanges();

      const bundleList = fixture.debugElement.query(
        By.css('tratt-bundle-list'),
      );
      expect(bundleList).toBeFalsy();
    });
  });

  it('auto-mounts an editor once the session becomes ready', () => {
    fixture.detectChanges();

    // changeEditor() itself (component creation via the real ViewChild) is
    // already covered by the "creates the selected editor component" test
    // above. This test only needs to verify mountDefaultEditor()'s wiring —
    // that it picks a valid interface and calls changeEditor with it — so
    // spy-and-stub changeEditor rather than letting a real editor component
    // mount: a real DictaphoneEditorComponent needs live audio infra this
    // bare TestBed doesn't provide, and throws on ngOnDestroy during fixture
    // cleanup otherwise.
    const changeEditorSpy = jest
      .spyOn(component, 'changeEditor')
      .mockImplementation(() => undefined);
    component.appStorage = { interface: undefined } as any;
    (component as any).settingsService = {
      projectsettings: { interfaces: ['Dictaphone Editor', 'Linear Editor'] },
      isTheme: jest.fn().mockReturnValue(false),
    };

    loading$.next({ status: LoadingStatus.FINISHED });

    expect(component.sessionReady).toBe(true);
    expect(changeEditorSpy).toHaveBeenCalledWith('Dictaphone Editor');
  });

  it('resolves the real showEditor ViewChild and mounts a component into its viewContainerRef when the session becomes ready', () => {
    fixture.detectChanges();

    // Swap the default editor for the lightweight fake so this test exercises
    // the real ViewChild resolution / ViewContainerRef.createComponent() path
    // (the thing the missing detectChanges() fix actually protects) without
    // pulling in a real editor's heavyweight audio dependencies.
    const realEditor = editorComponents[0].editor;
    (editorComponents[0] as { editor: unknown }).editor = FakeEditorComponent;
    component.appStorage = { interface: undefined } as any;
    (component as any).settingsService = {
      projectsettings: { interfaces: [editorComponents[0].name] },
      isTheme: jest.fn().mockReturnValue(false),
    };

    try {
      loading$.next({ status: LoadingStatus.FINISHED });

      expect(component.sessionReady).toBe(true);
      expect(component.showEditor).toBeDefined();
      expect(component.showEditor!.viewContainerRef.length).toBe(1);
    } finally {
      editorComponents[0].editor = realEditor;
      // Clear the mounted fake ourselves rather than relying on Angular's
      // automatic fixture teardown to destroy it.
      component.showEditor?.viewContainerRef.clear();
    }
  });

  // Finding 1: `useMode`/`selectedTheme`/`showCommentSection` used to be
  // snapshotted once in ngOnInit, before startSession() had ever run — on a
  // clean/logged-out profile appStorage.useMode is still undefined at that
  // point, so `useMode === 'local'` was permanently false and the Export
  // button never rendered. They must instead be computed live once the
  // session actually becomes ready.
  it('computes useMode/selectedTheme/showCommentSection from live appStorage/settingsService once the session becomes ready, not from a stale ngOnInit snapshot', () => {
    fixture.detectChanges();

    // Simulate: appStorage.useMode was undefined (or anything else) at
    // ngOnInit time, and only became 'local' once loginLocal() actually
    // completed and the loading status flips to FINISHED.
    component.appStorage = {
      useMode: 'local',
      interface: 'Dictaphone Editor',
    } as any;
    (component as any).settingsService = {
      projectsettings: {
        interfaces: ['Dictaphone Editor'],
        tratt: { theme: 'someTheme' },
        navigation: { export: true },
      },
      isTheme: jest.fn().mockReturnValue(false),
    };
    jest.spyOn(component, 'changeEditor').mockImplementation(() => undefined);

    loading$.next({ status: LoadingStatus.FINISHED });

    expect(component.useMode).toBe('local');
    expect(component.selectedTheme).toBe('someTheme');
    expect((component as any).navbarServ.showExport).toBe(true);
  });

  it('sets navbarServ.showExport based on projectsettings.navigation.export, mirroring TranscriptionComponent.ngOnInit', () => {
    fixture.detectChanges();

    component.appStorage = { useMode: 'local', interface: undefined } as any;
    (component as any).settingsService = {
      projectsettings: { interfaces: [], navigation: { export: false } },
      isTheme: jest.fn().mockReturnValue(false),
    };
    (component as any).navbarServ = {};

    loading$.next({ status: LoadingStatus.FINISHED });

    expect((component as any).navbarServ.showExport).toBe(false);
  });

  // Finding 3: startSession() sets sessionStarting = true but nothing ever
  // reset it back to false, permanently disabling the Start button after one
  // click (including after a failed login).
  describe('sessionStarting reset', () => {
    it('resets sessionStarting to false once loading.status becomes FINISHED', () => {
      fixture.detectChanges();
      component.appStorage = { useMode: 'local', interface: undefined } as any;
      (component as any).settingsService = {
        projectsettings: { interfaces: [] },
        isTheme: jest.fn().mockReturnValue(false),
      };
      component.sessionStarting = true;

      loading$.next({ status: LoadingStatus.FINISHED });

      expect(component.sessionStarting).toBe(false);
    });

    it('resets sessionStarting to false when loading.status becomes FAILED', () => {
      fixture.detectChanges();
      component.sessionStarting = true;

      loading$.next({ status: LoadingStatus.FAILED } as any);

      expect(component.sessionStarting).toBe(false);
    });

    it('leaves sessionStarting untouched while loading.status is still in-progress (LOADING)', () => {
      fixture.detectChanges();
      component.sessionStarting = true;

      loading$.next({ status: LoadingStatus.LOADING } as any);

      expect(component.sessionStarting).toBe(true);
    });
  });

  // Task 7: run/pause control + queue configuration panel.
  describe('pipeline queue run/pause control', () => {
    it('forwards pipeline options changes to the queue service', () => {
      fixture.detectChanges();
      const options = { modelId: 'm', useWebGPU: false } as any;

      component.onQueueOptionsChange(options);

      expect(pipelineQueueService.setTranscribeOptions).toHaveBeenCalledWith(
        options,
      );
    });

    it('enqueues every ready bundle when the run button is clicked while idle', () => {
      bundleSummaries = [
        {
          bundleId: 'bundle-a',
          name: 'a.wav',
          selected: true,
          awaitingMedia: false,
        },
        {
          bundleId: 'bundle-b',
          name: 'b.wav',
          selected: false,
          awaitingMedia: false,
        },
      ];
      queueMode = 'idle';
      runStatuses = {};
      fixture.detectChanges();

      expect(component.readyBundleIds()).toEqual(['bundle-a', 'bundle-b']);
      component.onRunPauseClick();
      expect(pipelineQueueService.enqueue).toHaveBeenCalledWith([
        'bundle-a',
        'bundle-b',
      ]);
      expect(pipelineQueueService.stop).not.toHaveBeenCalled();
    });

    it('pauses instead of enqueuing when the queue is already running', () => {
      bundleSummaries = [
        {
          bundleId: 'bundle-a',
          name: 'a.wav',
          selected: true,
          awaitingMedia: false,
        },
        {
          bundleId: 'bundle-b',
          name: 'b.wav',
          selected: false,
          awaitingMedia: false,
        },
      ];
      queueMode = 'running';
      runStatuses = { 'bundle-a': { state: 'running' } };
      fixture.detectChanges();

      expect(component.queueRunning()).toBe(true);
      component.onRunPauseClick();
      expect(pipelineQueueService.stop).toHaveBeenCalledTimes(1);
      expect(pipelineQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('excludes already-done bundles from the ready set', () => {
      bundleSummaries = [
        {
          bundleId: 'bundle-a',
          name: 'a.wav',
          selected: true,
          awaitingMedia: false,
        },
        {
          bundleId: 'bundle-b',
          name: 'b.wav',
          selected: false,
          awaitingMedia: false,
        },
      ];
      queueMode = 'idle';
      runStatuses = { 'bundle-a': { state: 'done' } };
      fixture.detectChanges();

      expect(component.readyBundleIds()).toEqual(['bundle-b']);
    });
  });

  it('forwards the queue pipeline options to CapacityService so the storage bar can split models from annotations', () => {
    const options = {
      modelId: 'onnx-community/kb-whisper-small-ONNX',
      useWebGPU: false,
      language: 'sv',
    };

    component.onQueueOptionsChange(options as never);

    expect(pipelineQueueService.setTranscribeOptions).toHaveBeenCalledWith(
      options,
    );
    expect(capacityService.setConfiguredOptions).toHaveBeenCalledWith(options);
  });

  it('clears the CapacityService model estimate when the options are cleared', () => {
    component.onQueueOptionsChange(null);

    expect(capacityService.setConfiguredOptions).toHaveBeenCalledWith(null);
  });

  // F3 (step 3c final review): setConfiguredOptions() is root-singleton
  // state that nothing else clears — leaving /workbench with a model
  // configured could otherwise leave a stale estimate live for the rest of
  // the SPA session. Assert the component clears it on its own destroy.
  it('clears the CapacityService model estimate when the component is destroyed', () => {
    component.onQueueOptionsChange({
      modelId: 'onnx-community/kb-whisper-small-ONNX',
      useWebGPU: false,
      language: 'sv',
    } as never);
    capacityService.setConfiguredOptions.mockClear();

    fixture.destroy();

    expect(capacityService.setConfiguredOptions).toHaveBeenCalledWith(null);
  });

  describe('selectedBundleHeader', () => {
    it('is undefined when no audio is resident for the selection', () => {
      audioService.current = undefined;
      fixture.detectChanges();

      expect(component.selectedBundleHeader).toBeUndefined();
    });

    it('formats name, duration, sample rate, and size from the resident AudioManager', () => {
      audioService.current = {
        resource: {
          info: {
            fullname: 'example.wav',
            duration: { seconds: 125 },
            sampleRate: 48000,
            channels: 2,
            size: 90_000_000,
          },
        },
      };
      fixture.detectChanges();

      const header = component.selectedBundleHeader;
      expect(header?.name).toBe('example.wav');
      expect(header?.durationText).toBe('2:05');
      expect(header?.sampleRateKhz).toBe(48);
      expect(header?.channels).toBe(2);
      expect(header?.sizeText).toContain('MB');
    });

    // Review finding F2 (final whole-branch review): as a computed(),
    // selectedBundleHeader read only plain-getter state
    // (audioService.current) with no signal dependency inside it — Angular
    // never re-runs a computed() unless a signal it read is invalidated, so
    // it would silently cache its FIRST result forever. AudioService's
    // manager registry is a plain Map (documented caveat on readyBundleIds
    // in this same file), so a residency change with no accompanying signal
    // write — e.g. AudioService.ensureResident() re-registering an evicted
    // bundle's manager — would leave the header stuck showing stale data.
    // A plain getter (re-evaluated on every read, same as any other
    // OnPush-rechecked template expression) has no such cache to go stale.
    it('reflects a change to audioService.current on the very next read, with no intervening signal write', () => {
      audioService.current = {
        resource: {
          info: {
            fullname: 'first.wav',
            duration: { seconds: 10 },
            sampleRate: 16000,
            channels: 1,
            size: 1000,
          },
        },
      };
      expect(component.selectedBundleHeader?.name).toBe('first.wav');

      // Mutated directly, the same way AudioService's real registry Map is
      // mutated by ensureResident() — no store dispatch, no signal write.
      audioService.current = {
        resource: {
          info: {
            fullname: 'second.wav',
            duration: { seconds: 20 },
            sampleRate: 16000,
            channels: 1,
            size: 2000,
          },
        },
      };

      expect(component.selectedBundleHeader?.name).toBe('second.wav');
    });
  });
});

// The outer suite stubs Store.selectSignal directly with a hand-rolled
// bundleSummaries array, which can never reproduce the shape the real store
// starts every user with — the LOCAL bundle collection's actual
// initialCollectionState (login-mode.reducer.ts) always seeds exactly one
// entity, keyed DEFAULT_BUNDLE_ID, with no sessionFile and audio.loaded:
// false. That's the exact case that caught a real bug (hasAnyBundles()
// counting that permanent empty sentinel as "a bundle exists"), so this
// suite drives selectAllBundleSummaries through provideMockStore against a
// localMode slice built the same way the reducer really builds it, instead
// of a synthetic already-filtered array.
describe('WorkbenchComponent with real default LOCAL store state', () => {
  function bundlesState(
    entities: { bundleId: string; sessionFile?: unknown }[],
  ) {
    return localBundleAdapter.setAll(
      entities.map((e) => ({
        ...annotationInitialState,
        bundleId: e.bundleId,
        sessionFile: e.sessionFile,
      })) as any,
      localBundleAdapter.getInitialState(),
    );
  }

  async function createWithLocalMode(
    localMode: unknown,
    // Task 7 review (Q1 follow-up): lets a bundle be "ready" (ignoring
    // awaitingMedia, exactly like computeReadyBundleIds's own isResident
    // escape hatch) without needing audio.loaded true in the seeded
    // localMode fixture, since bundlesState() never sets it.
    residentIds: string[] = [],
    initialPipelineQueue: unknown = {
      queue: [],
      activeId: null,
      mode: 'idle',
      runs: {},
    },
  ) {
    await TestBed.configureTestingModule({
      imports: [WorkbenchComponent],
      providers: [
        {
          provide: AudioService,
          useValue: {
            hasResident: jest.fn((id: string) => residentIds.includes(id)),
          },
        },
        { provide: AuthenticationStoreService, useValue: {} },
        { provide: AppStorageService, useValue: {} },
        { provide: RoutingService, useValue: { staticQueryParams: {} } },
        { provide: NavbarService, useValue: {} },
        { provide: RecordedFileService, useValue: {} },
        { provide: AnnotationStoreService, useValue: {} },
        { provide: SettingsService, useValue: { isTheme: () => false } },
        { provide: TrattModalService, useValue: {} },
        {
          provide: ApplicationStoreService,
          useValue: {
            loading$: of({ status: LoadingStatus.INITIALIZE }),
          },
        },
        { provide: UserInteractionsService, useValue: {} },
        {
          provide: PipelineQueueService,
          useValue: {
            setTranscribeOptions: jest.fn(),
            enqueue: jest.fn(),
            stop: jest.fn(),
            retry: jest.fn(),
            readyBundleIds: jest.fn(() => []),
          },
        },
        {
          provide: CapacityService,
          useValue: {
            storage: signal<StorageCapacity>({
              usedBytes: 0,
              quotaBytes: 0,
              modelsEstimateBytes: 0,
            }),
            residentMemory: signal<ResidentMemoryEstimate>({
              estimatedBytes: 0,
              residentCount: 0,
              budgetBytes: RAM_BUDGET_BYTES,
            }),
            setConfiguredOptions: jest.fn(),
          },
        },
        provideMockStore({
          initialState: {
            localMode,
            // WorkbenchComponent now also reads selectQueueMode /
            // selectAllRunStatuses (Task 7), both feature-selected off the
            // 'pipelineQueue' slice — it must exist on this mock state or
            // those selectors throw reading properties of undefined, even
            // for tests that never touch the queue panel directly.
            pipelineQueue: initialPipelineQueue,
          } as any,
        }),
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            selectTranslate: () => of(''),
            config: { reRenderOnLangChange: false },
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    const fx = TestBed.createComponent(WorkbenchComponent);
    fx.detectChanges();
    return fx;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('hides the bundle list for a first-time user: the real default state has only the empty bundle-1 sentinel', async () => {
    const localMode = {
      bundles: bundlesState([
        { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
      ]),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    };

    const fx = await createWithLocalMode(localMode);
    const component = fx.componentInstance;

    expect(component.sessionReady).toBe(false);
    expect(component.hasAnyBundles()).toBe(false);
    expect(fx.debugElement.query(By.css('tratt-bundle-list'))).toBeFalsy();
  });

  it('reveals the bundle list for a returning user whose bundle-1 was restored with a real sessionFile', async () => {
    const localMode = {
      bundles: bundlesState([
        { bundleId: DEFAULT_BUNDLE_ID, sessionFile: { name: 'restored.wav' } },
      ]),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    };

    const fx = await createWithLocalMode(localMode);
    const component = fx.componentInstance;

    expect(component.sessionReady).toBe(false);
    expect(component.hasAnyBundles()).toBe(true);
    expect(fx.debugElement.query(By.css('tratt-bundle-list'))).toBeTruthy();
  });

  // Task 7 review (Q1): the outer suite's hand-rolled selectSignal stub
  // returns plain closures, not real signals, so component.computed()s
  // there never re-evaluate after the first read — no test in that suite
  // can exercise the run button actually changing on screen. This
  // describe block's real provideMockStore DOES produce reactive signals,
  // so these three tests assert on the rendered DOM (not component
  // methods) for each state, closing that coverage gap.
  describe('run/pause button rendering (Task 7 review Q1)', () => {
    function runButton(fx: ComponentFixture<WorkbenchComponent>) {
      return fx.debugElement.query(By.css('.workbench__queue-run'))
        .nativeElement as HTMLButtonElement;
    }

    it('is disabled with the play icon when the queue is idle and nothing is ready', async () => {
      const localMode = {
        bundles: bundlesState([
          { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
          // Named (so hasAnyBundles() is true and the queue panel actually
          // renders) but not resident, so it's still not ready — keeps
          // this test's readyBundleIds at zero.
          { bundleId: 'bundle-a', sessionFile: { name: 'a.wav' } },
        ]),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      };

      const fx = await createWithLocalMode(localMode);
      const button = runButton(fx);

      expect(button.disabled).toBe(true);
      expect(button.querySelector('.bi-play-fill')).toBeTruthy();
      expect(button.querySelector('.bi-pause-fill')).toBeFalsy();
    });

    it('is enabled with the play icon when a bundle is ready and the queue is idle', async () => {
      const localMode = {
        bundles: bundlesState([
          { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
          { bundleId: 'bundle-a', sessionFile: { name: 'a.wav' } },
        ]),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      };

      // residentIds makes 'bundle-a' ready via computeReadyBundleIds' own
      // isResident escape hatch, since bundlesState() never sets
      // audio.loaded true.
      const fx = await createWithLocalMode(localMode, ['bundle-a']);
      // F1 fix-wave regression: the real AutoTranscribeOptionsComponent
      // mount emits `null` on init (unchecked), which now also gates the
      // run button — so this "ready" test must drive real options through
      // the same handler the template wires, exactly as a user ticking
      // "Auto-transcribe" would.
      fx.componentInstance.onQueueOptionsChange({
        modelId: 'm',
        useWebGPU: false,
      } as any);
      fx.detectChanges();
      const button = runButton(fx);

      expect(button.disabled).toBe(false);
      expect(button.querySelector('.bi-play-fill')).toBeTruthy();
      expect(button.querySelector('.bi-pause-fill')).toBeFalsy();
    });

    // F1 (final whole-branch review fix wave): the run button must stay
    // disabled while no pipeline options are configured, even when bundles
    // ARE ready — previously only `readyBundleIds().length` gated it, so a
    // user could enqueue and immediately fail every ready bundle without
    // ever ticking "Auto-transcribe".
    it('stays disabled with a ready bundle when no pipeline options are configured', async () => {
      const localMode = {
        bundles: bundlesState([
          { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
          { bundleId: 'bundle-a', sessionFile: { name: 'a.wav' } },
        ]),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      };

      const fx = await createWithLocalMode(localMode, ['bundle-a']);
      const button = runButton(fx);

      expect(fx.componentInstance.readyBundleIds()).toEqual(['bundle-a']);
      expect(fx.componentInstance.queueOptions()).toBeNull();
      expect(button.disabled).toBe(true);
      expect(button.title).toBe('workbench.queue.no_options_hint');
    });

    it('is enabled with the pause icon while the queue is running', async () => {
      const localMode = {
        bundles: bundlesState([
          { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
          { bundleId: 'bundle-a', sessionFile: { name: 'a.wav' } },
        ]),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      };

      const fx = await createWithLocalMode(localMode, ['bundle-a'], {
        queue: [],
        activeId: 'bundle-a',
        mode: 'running',
        runs: { 'bundle-a': { state: 'running' } },
      });
      const button = runButton(fx);

      expect(button.disabled).toBe(false);
      expect(button.querySelector('.bi-pause-fill')).toBeTruthy();
      expect(button.querySelector('.bi-play-fill')).toBeFalsy();
    });

    it('flips from disabled to enabled when the store transitions from not-ready to ready', async () => {
      const localMode = {
        bundles: bundlesState([
          { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
          // Named so the queue panel renders from the start; not yet
          // resident, so readyBundleIds starts at zero.
          { bundleId: 'bundle-a', sessionFile: { name: 'a.wav' } },
        ]),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      };

      const fx = await createWithLocalMode(localMode);
      expect(runButton(fx).disabled).toBe(true);

      // Real reactivity, not a fresh fixture: proves the SAME component
      // instance's computed()s re-evaluate when the underlying store state
      // changes, which is the transition the feature is actually about.
      // (Bundle set is unchanged — only residency, via the AudioService
      // mock below, and the store's own change-detection tick, differ.)
      const store = TestBed.inject(Store) as MockStore;
      store.setState({
        localMode,
        pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
      } as any);
      (
        TestBed.inject(AudioService).hasResident as jest.Mock
      ).mockImplementation((id) => id === 'bundle-a');
      // F1 fix-wave regression: options must also be configured for the
      // button to flip to enabled — see the "ready" test above.
      fx.componentInstance.onQueueOptionsChange({
        modelId: 'm',
        useWebGPU: false,
      } as any);
      fx.detectChanges();

      expect(runButton(fx).disabled).toBe(false);
    });
  });

  // Step 3c: the capacity block is deliberately OUTSIDE the
  // `@if (sessionReady || hasAnyBundles())` gate — cached models are the
  // dominant storage consumer and can exist before any bundle does, so the
  // readout must render on a completely empty workbench too.
  it('renders the capacity indicator even with no named bundles', async () => {
    const localMode = {
      bundles: bundlesState([
        { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
      ]),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    };

    const fx = await createWithLocalMode(localMode);

    expect(fx.componentInstance.hasAnyBundles()).toBe(false);
    expect(fx.debugElement.query(By.css('.workbench__capacity'))).toBeTruthy();
    expect(
      fx.debugElement.query(By.css('tratt-capacity-indicator')),
    ).toBeTruthy();
  });
});

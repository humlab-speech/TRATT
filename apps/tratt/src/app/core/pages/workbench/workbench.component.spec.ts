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
// Task 7: WorkbenchComponent's template now also mounts the REAL
// AutoTranslateOptionsComponent (the queue's translation config panel),
// which injects LocalTranslationService in its own constructor — so, unlike
// the LocalTranscriptionService stand-in above (never DI-resolved in this
// spec, since AutoTranscribeOptionsComponent only reaches it lazily, inside
// a method), this stand-in needs real `@Injectable({ providedIn: 'root' })`
// metadata or Angular's DI throws NullInjectorError the instant the panel
// renders (i.e. on every fixture.detectChanges() in this file now, since the
// queue panel is unconditional post-step-6).
jest.mock('../../shared/service/local-translation.service', () => {
  const { Injectable } = require('@angular/core');
  @Injectable({ providedIn: 'root' })
  class LocalTranslationService {}
  return { LocalTranslationService };
});

// tratt-dropzone.component.ts transitively imports AutoTranscribeOptionsComponent and
// AutoTranslateOptionsComponent, which import local-transcription.service.ts /
// local-translation.service.ts. Both instantiate a Worker via
// `new URL('...worker', import.meta.url)`, which fails to compile under this project's
// CommonJS ts-jest config (same pre-existing issue worked around in
// linear-editor.component.spec.ts). This test never renders the real dropzone — it
// stubs `component.dropzone` directly — so a minimal standalone stand-in with the
// right selector is enough to satisfy WorkbenchComponent's `@ViewChild` and template.
jest.mock('../../component/tratt-dropzone/tratt-dropzone.component', () => {
  const { Component, EventEmitter, Input, Output } = require('@angular/core');
  @Component({ selector: 'tratt-dropzone', template: '' })
  class TrattDropzoneComponent {
    // Deviation from task-6-brief.md Step 1 (documented in task-6-report.md):
    // the real workbench.component.html still binds
    // [showAutoTranscribe]="true" to <tratt-dropzone> — this task's own
    // ruling leaves that template untouched until Task 7 removes the Start
    // button and this binding together. Dropping this @Input from the mock
    // now (as the brief's literal text does) throws NG0303 on every
    // fixture.detectChanges() in this spec, failing ~39 pre-existing tests.
    // Kept here until Task 7's template edit actually removes the binding.
    @Input() showAutoTranscribe = false;
    @Input() allowMultipleAudio = false;
    @Input() pairTranscriptsByBasename = false;
    @Input() externalAudioFor: unknown;
    @Output() filesAdded = new EventEmitter();
    hasAnnotation = false;
    oannotation = undefined;
    reset = jest.fn();
    consumeEntry = jest.fn();
    addFile = jest.fn();
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

import { Component, EventEmitter, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  OAnnotJSON,
  OLabel,
  OSegment,
  OSegmentLevel,
  TrattAnnotation,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { OAudiofile, SampleUnit } from '@tratt/media';
import { randomUUID } from 'node:crypto';
import { BehaviorSubject, of } from 'rxjs';
import { editorComponents } from '../../../editors/components';
import { NavbarService } from '../../component/navbar/navbar.service';
import { ExportFilesModalComponent } from '../../modals/export-files-modal/export-files-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { YesNoModalComponent } from '../../modals/yes-no-modal/yes-no-modal.component';
import { SessionFile } from '../../obj/SessionFile';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { AlertService } from '../../shared/service/alert.service';
import { AnnotationSaveTracker } from '../../shared/service/annotation-save-tracker.service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { AudioService } from '../../shared/service/audio.service';
import {
  CapacityService,
  RAM_BUDGET_BYTES,
  ResidentMemoryEstimate,
  StorageCapacity,
} from '../../shared/service/capacity.service';
import { CatalogueExportService } from '../../shared/service/catalogue-export.service';
import { PendingEditsService } from '../../shared/service/pending-edits.service';
import { PipelineQueueService } from '../../shared/service/pipeline-queue.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { RoutingService } from '../../shared/service/routing.service';
import { LoadingStatus, LoginMode } from '../../store';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import { AuthenticationActions } from '../../store/authentication/authentication.actions';
import { AnnotationActions } from '../../store/login-mode/annotation/annotation.actions';
import { initialState as annotationInitialState } from '../../store/login-mode/annotation/annotation.reducer';
import {
  selectAllBundleSummaries,
  selectLocalMode,
  selectSelectedBundleId,
} from '../../store/login-mode/annotation/annotation.selectors';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from '../../store/login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
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

/** A transcript with text: what "Export this transcription" needs. */
function transcriptWithText(text = 'typed by hand'): TrattAnnotation<any> {
  const t = new TrattAnnotation<any>();
  const level = t.createSegmentLevel('words');
  level.items.push(
    t.createSegment(new SampleUnit(16000, 16000), [new OLabel('words', text)]),
  );
  t.addLevel(level);
  return t;
}

describe('WorkbenchComponent', () => {
  let fixture: ComponentFixture<WorkbenchComponent>;
  let component: WorkbenchComponent;
  let audioService: {
    registerAudioManager: jest.Mock;
    hasResident: jest.Mock;
    canRestore: jest.Mock;
    getManager: jest.Mock;
    getMediaInfo: jest.Mock;
    current: any;
  };
  let authStoreService: { loginLocal: jest.Mock };
  let storeDispatch: jest.Mock;
  let loading$: BehaviorSubject<{ status: LoadingStatus }>;
  let bundleSummaries: any[];
  // Drives the selection -> editor sync effect (a real signal, like the
  // store's selectSignal()).
  let selectedBundleId: WritableSignal<string>;
  // selectLocalMode, for the blank-level seeding before an editor mounts.
  // Plain assignment for one-off reads; the signal for tests that need the
  // component's computed()/effect() reads to react to a change.
  let localModeState: any;
  let localModeSig: WritableSignal<any>;
  // Task 7: the queue's own store slice, read through the same
  // selector-routed Store stub as bundleSummaries below.
  let queueMode: 'idle' | 'running' | 'pausing';
  let runStatuses: Record<string, { state: string }>;
  let pipelineQueueService: {
    setTranscribeOptions: jest.Mock;
    setTranslateOptions: jest.Mock;
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
      // canRestore() = resident OR re-decodable; follows hasResident here.
      canRestore: jest.fn((id: unknown) => audioService.hasResident(id)),
      // The selection->editor sync effect reads the selected bundle's
      // manager; mirror `current` so the two never disagree.
      getManager: jest.fn(() => audioService.current),
      getMediaInfo: jest.fn(() => undefined),
      // Editors can only mount for a selection with resident audio (they
      // dereference AudioService.current in ngOnInit), so the default is a
      // resident stand-in; tests about the no-audio case set undefined.
      current: { fakeResidentManager: true },
    };
    authStoreService = { loginLocal: jest.fn() };
    loading$ = new BehaviorSubject<{ status: LoadingStatus }>({
      status: LoadingStatus.INITIALIZE,
    });
    // No bundles by default: matches a clean/logged-out profile where
    // nothing has been restored from IndexedDB and no session has started.
    bundleSummaries = [];
    selectedBundleId = signal<string>(DEFAULT_BUNDLE_ID);
    localModeState = undefined;
    localModeSig = signal<any>(undefined);
    queueMode = 'idle';
    runStatuses = {};
    pipelineQueueService = {
      setTranscribeOptions: jest.fn(),
      setTranslateOptions: jest.fn(),
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
        // The real tracker listens to NgRx Actions (not provided here).
        { provide: AnnotationSaveTracker, useValue: { inFlight: 0 } },
        {
          provide: CatalogueExportService,
          useValue: { resolveBundleMedia: jest.fn(async () => undefined) },
        },
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
            dispatch: (storeDispatch = jest.fn()),
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
              if (selector === selectSelectedBundleId) {
                return selectedBundleId;
              }
              if (selector === selectLocalMode) {
                return () => localModeSig() ?? localModeState;
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

  // navbarServ.showInterfaces is app-singleton state left `true` by the old
  // /intern/transcr page and never reset there — a same-session SPA
  // navigation to /workbench must not inherit it, or the navbar's own
  // (dead, on this route) editor-switcher buttons render alongside this
  // page's own tab row.
  it('forces navbarServ.showInterfaces off on init', () => {
    component.navbarServ = { showInterfaces: true } as any;

    component.ngOnInit();

    expect(component.navbarServ.showInterfaces).toBe(false);
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

  // With auto-transcribe off, only the bootstrap bundle got loadSegments()'s
  // seed level; every later file opened with nothing to type into.
  describe('blank level seeding before an editor mounts', () => {
    const duration = new SampleUnit(48000 * 3, 48000);
    let order: string[];
    let createSpy: jest.Mock;

    beforeEach(() => {
      order = [];
      audioService.current = { resource: { info: { duration } } };
      storeDispatch.mockImplementation((action: any) => {
        order.push(action.type);
      });
      createSpy = jest.fn(() => {
        order.push('createComponent');
      });
      component.showEditor = {
        viewContainerRef: { clear: jest.fn(), createComponent: createSpy },
      } as any;
    });

    const overwriteCalls = () =>
      storeDispatch.mock.calls
        .map(([action]) => action as any)
        .filter(
          (action) =>
            action.type === AnnotationActions.overwriteTranscript.do.type,
        );

    it('seeds one empty full-length segment for a level-less bundle, before creating the editor', () => {
      localModeState = {
        bundles: {
          entities: {
            [DEFAULT_BUNDLE_ID]: { transcript: new TrattAnnotation() },
          },
        },
      };

      component.changeEditor('Dictaphone Editor');

      const calls = overwriteCalls();
      expect(calls).toHaveLength(1);
      const seeded = calls[0].transcript as TrattAnnotation<any>;
      expect(seeded.levels).toHaveLength(1);
      const level = seeded.levels[0] as TrattAnnotationSegmentLevel<any>;
      expect(level.items).toHaveLength(1);
      expect(level.items[0].time.samples).toBe(duration.samples);
      expect(level.items[0].labels[0].value).toBe('');
      expect(seeded.selectedLevelIndex).toBe(0);
      expect(calls[0].mode).toBe(LoginMode.LOCAL);
      expect(
        order.indexOf(AnnotationActions.overwriteTranscript.do.type),
      ).toBeLessThan(order.indexOf('createComponent'));
    });

    it('leaves a bundle that already has a level alone', () => {
      const transcript = new TrattAnnotation();
      transcript.addLevel(transcript.createSegmentLevel('OCTRA_1', []));
      localModeState = {
        bundles: { entities: { [DEFAULT_BUNDLE_ID]: { transcript } } },
      };

      component.changeEditor('Dictaphone Editor');

      expect(overwriteCalls()).toHaveLength(0);
      expect(createSpy).toHaveBeenCalled();
    });
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
    // The tab row belongs to a file: with an empty list the pane shows the
    // "no files" state instead.
    beforeEach(() => {
      bundleSummaries = [
        {
          bundleId: DEFAULT_BUNDLE_ID,
          name: 'a.wav',
          selected: true,
          awaitingMedia: false,
          hasAnnotationContent: false,
        },
      ];
    });

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

  // The single-file export used to be a full-width "Export transcriptions"
  // bar under the editor — on the workbench it reads as acting on the whole
  // list. It now sits in the file header and names what it exports.
  describe('right pane in LOCAL mode', () => {
    const named = {
      bundleId: DEFAULT_BUNDLE_ID,
      name: 'a.wav',
      selected: true,
      awaitingMedia: false,
      hasAnnotationContent: false,
    };

    // The Store stub's selectAllBundleSummaries is a plain function, so the
    // list has to be in place before the first change detection.
    function startLocalSession(
      summaries: any[],
      // null: the file has no transcript at all.
      transcript: TrattAnnotation<any> | null = transcriptWithText(),
    ) {
      bundleSummaries = summaries;
      localModeState = {
        bundles: {
          entities: {
            [DEFAULT_BUNDLE_ID]: { transcript: transcript ?? undefined },
          },
        },
      };
      audioService.current = undefined;
      audioService.getMediaInfo.mockReturnValue({
        fullname: 'a.wav',
        duration: { seconds: 2 },
        sampleRate: 44100,
        channels: 1,
        size: 1000,
      });
      fixture.detectChanges();
      component.appStorage = { useMode: 'local', interface: undefined } as any;
      (component as any).settingsService = {
        projectsettings: { interfaces: [], navigation: { export: true } },
        isTheme: jest.fn().mockReturnValue(false),
      };
      jest.spyOn(component, 'changeEditor').mockImplementation(() => undefined);
      loading$.next({ status: LoadingStatus.FINISHED });
    }

    function exportStubs(media: unknown) {
      const resolveBundleMedia = jest.fn(async () => media);
      (component as any).catalogueExport = { resolveBundleMedia };
      const openModalRef = jest.fn();
      (component as any).modService = { openModalRef };
      const showAlert = jest
        .spyOn(TestBed.inject(AlertService), 'showAlert')
        .mockResolvedValue({ id: 1, component: undefined });
      return { resolveBundleMedia, openModalRef, showAlert };
    }

    it('shows "Export this transcription" next to the editor even when the project config loads after the session is ready', () => {
      bundleSummaries = [named];
      localModeState = {
        bundles: {
          entities: {
            [DEFAULT_BUNDLE_ID]: { transcript: transcriptWithText() },
          },
        },
      };
      audioService.current = undefined;
      audioService.getMediaInfo.mockReturnValue({
        fullname: 'a.wav',
        duration: { seconds: 2 },
        sampleRate: 44100,
        channels: 1,
        size: 1000,
      });
      fixture.detectChanges();
      component.appStorage = { useMode: 'local', interface: undefined } as any;
      // Not loaded yet at the moment the session becomes ready.
      const settings: any = {
        projectsettings: undefined,
        isTheme: jest.fn().mockReturnValue(false),
      };
      (component as any).settingsService = settings;
      jest.spyOn(component, 'changeEditor').mockImplementation(() => undefined);
      loading$.next({ status: LoadingStatus.FINISHED });
      settings.projectsettings = { navigation: { export: true } };
      component.editorPlaceholder.set('none');
      fixture.detectChanges();

      expect(component.sessionReady).toBe(true);
      expect(
        fixture.debugElement.query(
          By.css(
            '.workbench__right:not(.workbench__empty) .workbench__editor-header-actions .btn-primary',
          ),
        ),
      ).toBeTruthy();
    });

    it('offers "Export this transcription" in the file header and has no bottom bar', async () => {
      startLocalSession([named]);
      component.editorPlaceholder.set('none');
      fixture.detectChanges();
      const media = { sampleRate: 44100 };
      const { resolveBundleMedia, openModalRef } = exportStubs(media);

      const button = fixture.debugElement.query(
        By.css(
          '.workbench__editor-header .workbench__editor-header-actions .btn-primary',
        ),
      );
      expect(button.nativeElement.textContent).toContain(
        'workbench.editor_header.export',
      );
      expect(button.nativeElement.disabled).toBe(false);
      expect(
        fixture.debugElement.query(By.css('#bottom-navigation')),
      ).toBeNull();

      await component.exportSelected();
      expect(resolveBundleMedia).toHaveBeenCalledWith(DEFAULT_BUNDLE_ID);
      expect(openModalRef).toHaveBeenCalledWith(
        ExportFilesModalComponent,
        ExportFilesModalComponent.options,
        expect.objectContaining({ media }),
      );
    });

    // Used to be disabled until the audio was re-attached: after a reload
    // nothing could be exported per file.
    it('is not offered for audio alone: a blank level, or no transcript yet', () => {
      const blank = new TrattAnnotation<any>();
      const level = blank.createSegmentLevel('words');
      level.items.push(
        blank.createSegment(new SampleUnit(32000, 16000), [
          new OLabel('words', ''),
        ]),
      );
      blank.addLevel(level);
      startLocalSession([named], blank);
      component.editorPlaceholder.set('none');
      fixture.detectChanges();

      const exportButton = () =>
        fixture.debugElement.query(
          By.css('.workbench__editor-header-actions .btn-primary'),
        );
      expect(component.selectedBundleHeader?.name).toBe('a.wav');
      expect(exportButton()).toBeNull();

      // The transcription arrives (or the user types): now it is offered.
      localModeState = {
        bundles: {
          entities: {
            [DEFAULT_BUNDLE_ID]: { transcript: transcriptWithText() },
          },
        },
      };
      (component as any).cd.markForCheck();
      fixture.detectChanges();
      expect(exportButton()).toBeTruthy();
    });

    it('keeps "Export recording" for a fresh recording without a transcript', () => {
      startLocalSession([named], null);
      (component as any).recordedFileService = {
        recordedFile: { name: 'a.wav' },
        triggerExport: jest.fn(),
      };
      component.editorPlaceholder.set('none');
      (component as any).cd.markForCheck();
      fixture.detectChanges();

      const actions = fixture.debugElement.query(
        By.css('.workbench__editor-header-actions'),
      );
      expect(actions).toBeTruthy();
      expect(actions.nativeElement.textContent).toContain('g.export recording');
      expect(actions.query(By.css('.btn-primary'))).toBeNull();
    });

    it('stays available while the file has no audio, exporting from the transcript', async () => {
      startLocalSession([named]);
      component.editorPlaceholder.set('awaiting-media');
      fixture.detectChanges();
      const { openModalRef } = exportStubs({ sampleRate: 16000 });

      const button = fixture.debugElement.query(
        By.css('.workbench__editor-header-actions .btn-primary'),
      );
      expect(button.nativeElement.disabled).toBe(false);

      await component.exportSelected();
      expect(openModalRef).toHaveBeenCalled();
    });

    it('explains instead of opening an empty dialog when there is nothing to export', async () => {
      startLocalSession([named]);
      const { openModalRef, showAlert } = exportStubs(undefined);

      await component.exportSelected();

      expect(openModalRef).not.toHaveBeenCalled();
      expect(showAlert).toHaveBeenCalledWith(
        'warning',
        'workbench.editor_header.export_unavailable',
      );
    });

    it('commits pending typing before exporting', async () => {
      startLocalSession([named]);
      exportStubs({ sampleRate: 16000 });
      const flush = jest.spyOn(TestBed.inject(PendingEditsService), 'flush');

      await component.exportSelected();

      expect(flush).toHaveBeenCalled();
    });

    it('shows the "no files" state, not an attach prompt, once every file was removed', () => {
      // Only the empty placeholder bundle is left (no file name).
      startLocalSession([{ ...named, name: undefined, awaitingMedia: true }]);
      component.editorPlaceholder.set('awaiting-media');
      fixture.detectChanges();

      const pane = fixture.debugElement.query(By.css('.workbench__right'))
        .nativeElement as HTMLElement;
      expect(pane.textContent).toContain('workbench.empty.title');
      expect(pane.textContent).not.toContain('workbench.editor.awaiting_media');
      expect(
        fixture.debugElement.query(By.css('.workbench__editor-tabs')),
      ).toBeNull();
      expect(
        fixture.debugElement.query(By.css('.workbench__editor-header')),
      ).toBeNull();
      // The editor host stays, so the ViewChild survives the empty state.
      expect(component.showEditor).toBeDefined();
    });
  });

  // Closing/reloading the tab used to drop in-flight work silently.
  describe('leaving the page with work in flight', () => {
    const unloadEvent = () =>
      ({ preventDefault: jest.fn(), returnValue: undefined }) as any;
    let tracker: { inFlight: number };

    beforeEach(() => {
      fixture.detectChanges();
      tracker = TestBed.inject(AnnotationSaveTracker) as any;
      component.dropzone = { files: [] } as any;
    });

    it('lets the page go when nothing is in flight', () => {
      const event = unloadEvent();
      component.onBeforeUnload(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('asks to confirm while the queue is running', () => {
      queueMode = 'running';
      // queueRunning is a computed over a plain stub: build a fresh fixture
      // so it reads the new mode.
      fixture = TestBed.createComponent(WorkbenchComponent);
      component = fixture.componentInstance;
      component.dropzone = { files: [] } as any;
      const event = unloadEvent();
      component.onBeforeUnload(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.returnValue).toBe('');
    });

    it('asks to confirm while dropped files are still being read', () => {
      component.dropzone = { files: [{ status: 'progress' }] } as any;
      const event = unloadEvent();
      component.onBeforeUnload(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('does not count failed (invalid) dropzone rows as work', () => {
      component.dropzone = { files: [{ status: 'invalid' }] } as any;
      const event = unloadEvent();
      component.onBeforeUnload(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('asks to confirm with an un-exported recording', () => {
      const recorded = TestBed.inject(RecordedFileService) as any;
      recorded.recordedFile = new File(['x'], 'rec.wav');
      recorded.exported = false;
      const event = unloadEvent();
      component.onBeforeUnload(event);
      expect(event.preventDefault).toHaveBeenCalled();

      recorded.exported = true;
      const after = unloadEvent();
      component.onBeforeUnload(after);
      expect(after.preventDefault).not.toHaveBeenCalled();
    });

    it('asks to confirm while transcript writes are in flight', () => {
      tracker.inFlight = 1;
      const event = unloadEvent();
      component.onBeforeUnload(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('commits pending typing before deciding (and on pagehide)', () => {
      const flush = jest.spyOn(TestBed.inject(PendingEditsService), 'flush');
      component.onBeforeUnload(unloadEvent());
      component.onPageHide();
      expect(flush).toHaveBeenCalledTimes(2);
    });
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
    expect(component.exportEnabled).toBe(true);
    // LOCAL exports from the file header, not from an unlabelled top-bar
    // "Export" next to it.
    expect((component as any).navbarServ.showExport).toBe(false);
  });

  it('keeps the top-bar Export for non-LOCAL sessions when the project allows it', () => {
    fixture.detectChanges();

    component.appStorage = { useMode: 'url', interface: undefined } as any;
    (component as any).settingsService = {
      projectsettings: { interfaces: [], navigation: { export: true } },
      isTheme: jest.fn().mockReturnValue(false),
    };
    (component as any).navbarServ = {};
    jest.spyOn(component, 'changeEditor').mockImplementation(() => undefined);

    loading$.next({ status: LoadingStatus.FINISHED });

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
    expect(component.exportEnabled).toBe(false);
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

    // Restored after a reload: still named, so "Export this transcription"
    // is reachable before the audio is re-attached.
    // After a reload no session exists yet ("welcome back"); the selected
    // restored file's header — with its export — is shown anyway.
    it('shows the selected restored file, with "Export this transcription", before any session', () => {
      audioService.current = undefined;
      localModeState = {
        bundles: {
          entities: {
            [DEFAULT_BUNDLE_ID]: {
              sessionFile: new SessionFile(
                'restored.wav',
                1,
                new Date(),
                'audio/wav',
              ),
              transcript: transcriptWithText(),
            },
          },
        },
      };
      bundleSummaries = [
        {
          bundleId: DEFAULT_BUNDLE_ID,
          name: 'restored.wav',
          selected: true,
          awaitingMedia: true,
        },
      ];
      fixture.detectChanges();

      expect(component.sessionReady).toBe(false);
      const header = fixture.debugElement.query(
        By.css('.workbench__empty .workbench__editor-header'),
      );
      expect(header.nativeElement.textContent).toContain('restored.wav');
      expect(header.nativeElement.textContent).toContain(
        'workbench.editor_header.audio_not_attached',
      );
      expect(
        header.query(By.css('.workbench__editor-header-actions .btn-primary')),
      ).toBeTruthy();
    });

    it("names a restored file whose audio isn't attached, without media details", () => {
      audioService.current = undefined;
      localModeState = {
        bundles: {
          entities: {
            [DEFAULT_BUNDLE_ID]: {
              sessionFile: new SessionFile(
                'restored.wav',
                1,
                new Date(),
                'audio/wav',
              ),
            },
          },
        },
      };
      fixture.detectChanges();

      expect(component.selectedBundleHeader).toEqual({ name: 'restored.wav' });
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

  function fileProgress(
    id: number,
    file: File,
    overrides: Partial<{
      status: 'valid' | 'progress';
      audioManager: any;
      oaudiofile: any;
    }> = {},
  ) {
    return {
      id,
      status: overrides.status ?? 'progress',
      checked_converters: 0,
      progress: 1,
      file: { file, fullname: file.name, type: file.type, size: file.size },
      audioManager: overrides.audioManager,
      oaudiofile: overrides.oaudiofile,
    } as any;
  }

  describe('editor follows the selected bundle', () => {
    let realEditor: unknown;

    beforeEach(() => {
      realEditor = editorComponents[0].editor;
      (editorComponents[0] as { editor: unknown }).editor = FakeEditorComponent;
      component.appStorage = { interface: editorComponents[0].name } as any;
      (component as any).settingsService = {
        projectsettings: { interfaces: [editorComponents[0].name] },
        isTheme: jest.fn().mockReturnValue(false),
      };
    });

    afterEach(() => {
      (editorComponents[0] as { editor: unknown }).editor = realEditor;
      component.showEditor?.viewContainerRef.clear();
    });

    const managers: Record<string, any> = {
      a: { id: 'manager-a' },
      b: { id: 'manager-b' },
    };

    function startSessionOn(bundleId: string) {
      selectedBundleId.set(bundleId);
      audioService.current = managers[bundleId];
      audioService.getManager.mockImplementation(
        (id: unknown) => managers[id as string],
      );
      fixture.detectChanges();
      loading$.next({ status: LoadingStatus.FINISHED });
      fixture.detectChanges();
    }

    // Regression: editors capture AudioService.current once, in ngOnInit.
    // Switching bundles used to leave the old editor mounted — still
    // playing bundle A's audio while edits went to bundle B.
    it('remounts the editor for the newly selected bundle', () => {
      startSessionOn('a');
      const first = (component as any).currentEditorRef;
      expect(first).toBeDefined();
      expect((component as any).mountedManager).toBe(managers['a']);

      audioService.current = managers['b'];
      selectedBundleId.set('b');
      TestBed.flushEffects();
      fixture.detectChanges();

      expect((component as any).currentEditorRef).toBeDefined();
      expect((component as any).currentEditorRef).not.toBe(first);
      expect((component as any).mountedManager).toBe(managers['b']);
      expect((component as any).mountedBundleId).toBe('b');
    });

    // Text editors read the current level once, when they mount: picking
    // another level in the navbar left them showing the previous level.
    it('remounts the editor when the shown file switches level', () => {
      const withLevel = (index: number) => ({
        bundles: {
          entities: {
            a: {
              transcript: { levels: [{}, {}], selectedLevelIndex: index },
            },
          },
        },
      });
      localModeSig.set(withLevel(0));
      startSessionOn('a');
      const first = (component as any).currentEditorRef;
      expect((component as any).mountedLevelIndex).toBe(0);

      localModeSig.set(withLevel(1));
      TestBed.flushEffects();
      fixture.detectChanges();

      expect((component as any).currentEditorRef).not.toBe(first);
      expect((component as any).mountedLevelIndex).toBe(1);

      // Any other store change keeps the mounted editor.
      const second = (component as any).currentEditorRef;
      localModeSig.set({ ...withLevel(1) });
      TestBed.flushEffects();
      fixture.detectChanges();
      expect((component as any).currentEditorRef).toBe(second);
    });

    // Seen live: an editor destroyed before its ngOnInit ran threw in
    // ngOnDestroy, which aborted the remount and left the pane empty.
    it('still mounts the new editor when tearing down the old one throws', () => {
      startSessionOn('a');
      const vcr = component.showEditor!.viewContainerRef;
      const realClear = vcr.clear.bind(vcr);
      jest.spyOn(vcr, 'clear').mockImplementationOnce(() => {
        realClear();
        throw new Error('teardown failed');
      });
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      audioService.current = managers['b'];
      selectedBundleId.set('b');
      TestBed.flushEffects();
      fixture.detectChanges();

      expect((component as any).currentEditorRef).toBeDefined();
      expect((component as any).mountedBundleId).toBe('b');
      consoleError.mockRestore();
    });

    it('does not flush the old editor into the newly selected bundle', () => {
      startSessionOn('a');
      const flush = jest.fn();
      (component as any).currentEditorRef.instance.flushPendingEdits = flush;

      audioService.current = managers['b'];
      selectedBundleId.set('b');
      TestBed.flushEffects();
      fixture.detectChanges();

      expect(flush).not.toHaveBeenCalled();
    });

    it('shows the re-attach placeholder instead of an editor for a bundle without audio', () => {
      startSessionOn('a');

      audioService.current = undefined;
      audioService.canRestore.mockReturnValue(false);
      selectedBundleId.set('restored');
      TestBed.flushEffects();
      fixture.detectChanges();

      expect((component as any).currentEditorRef).toBeUndefined();
      expect(component.editorPlaceholder()).toBe('awaiting-media');
      expect(
        fixture.debugElement.query(By.css('.workbench__placeholder')),
      ).toBeTruthy();
    });

    it('shows a loading placeholder while an evicted bundle re-decodes, then mounts', () => {
      startSessionOn('a');

      audioService.current = undefined;
      audioService.canRestore.mockReturnValue(true);
      selectedBundleId.set('b');
      TestBed.flushEffects();
      fixture.detectChanges();
      expect(component.editorPlaceholder()).toBe('loading');

      // Re-decode finished: a registry change re-runs the sync. (In the
      // real service the registry version signal triggers this.)
      audioService.current = managers['b'];
      (component as any).syncEditorToSelection('b', managers['b'], true);
      fixture.detectChanges();
      expect(component.editorPlaceholder()).toBe('none');
      expect((component as any).mountedManager).toBe(managers['b']);
    });

    it('flushes the mounted editor through PendingEditsService only while it still matches the selection', () => {
      startSessionOn('a');
      const flush = jest.fn();
      (component as any).currentEditorRef.instance.flushPendingEdits = flush;
      const pendingEdits = TestBed.inject(PendingEditsService);

      pendingEdits.flush();
      expect(flush).toHaveBeenCalledTimes(1);

      // Selection moved but the editor hasn't been remounted yet.
      selectedBundleId.set('b');
      pendingEdits.flush();
      expect(flush).toHaveBeenCalledTimes(1);
    });
  });

  describe('continuous ingestion (step 6)', () => {
    function makeDropzone() {
      return {
        filesAdded: new EventEmitter<any>(),
        hasAnnotation: false,
        oannotation: undefined,
        reset: jest.fn(),
        consumeEntry: jest.fn(),
        addFile: jest.fn(),
      };
    }

    it('bootstraps via loginLocal on the first valid file and consumes just that entry', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      const manager = { id: 'm1' } as any;
      const nativeFile = new File(['a'], 'a.wav');
      const fp = fileProgress(1, nativeFile, {
        status: 'valid',
        audioManager: manager,
        oaudiofile: {},
      });

      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [fp],
      });

      expect(audioService.registerAudioManager).toHaveBeenCalledWith(
        DEFAULT_BUNDLE_ID,
        manager,
        nativeFile,
      );
      expect(authStoreService.loginLocal).toHaveBeenCalledWith(
        [nativeFile],
        undefined,
        false,
        [DEFAULT_BUNDLE_ID],
      );
      expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
      expect(component.dropzone!.reset).not.toHaveBeenCalled();
    });

    it('does nothing when no file has validated yet', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, new File(['a'], 'a.wav'), { status: 'progress' }),
        ],
      });

      expect(audioService.registerAudioManager).not.toHaveBeenCalled();
      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
    });

    it('routes every file after the first through createBundle directly, not loginLocal', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      const file1 = new File(['a'], 'a.wav');
      const file2 = new File(['b'], 'b.wav');
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, file1, {
            status: 'valid',
            audioManager: {} as any,
            oaudiofile: {},
          }),
        ],
      });
      authStoreService.loginLocal.mockClear();

      const manager2 = { id: 'm2' } as any;
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, file1, {
            status: 'valid',
            audioManager: {} as any,
            oaudiofile: {},
          }),
          fileProgress(2, file2, {
            status: 'valid',
            audioManager: manager2,
            oaudiofile: {},
          }),
        ],
      });

      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
      expect(audioService.registerAudioManager).toHaveBeenCalledWith(
        expect.any(String),
        manager2,
        file2,
      );
      expect(storeDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LoginModeActions.createBundle.type,
          selectAfterCreate: false,
        }),
      );
      expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(2);
    });

    // After a reload every file in the list waits for its audio; dropping
    // the same files again used to add a second row per file.
    describe('dropping files that match waiting (restored) files', () => {
      const restored = (name: string, size: number) =>
        new SessionFile(name, size, new Date(0), 'audio/wav');
      const wav = (name: string, bytes: string) =>
        new File([bytes], name, { type: 'audio/wav' });
      const valid = (id: number, file: File, manager: any) =>
        fileProgress(id, file, {
          status: 'valid',
          audioManager: manager,
          oaudiofile: {},
        });
      const dispatched = (type: string) =>
        storeDispatch.mock.calls
          .map(([action]) => action as any)
          .filter((a) => a.type === type);

      beforeEach(() => {
        localModeState = {
          bundles: {
            entities: {
              r1: { sessionFile: restored('a.wav', 3) },
              r2: { sessionFile: restored('b.wav', 3) },
            },
          },
        };
        bundleSummaries = [
          {
            bundleId: 'r1',
            name: 'a.wav',
            selected: false,
            awaitingMedia: true,
          },
          {
            bundleId: 'r2',
            name: 'b.wav',
            selected: false,
            awaitingMedia: true,
          },
        ];
      });

      it('attaches the audio to the waiting bundle and starts the session from it, instead of adding a row', () => {
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();
        const file = wav('a.wav', 'abc');
        const manager = { id: 'm-a' };

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, file, manager)],
        });

        expect(audioService.registerAudioManager).toHaveBeenCalledWith(
          'r1',
          manager,
          file,
        );
        expect(
          dispatched(LoginModeActions.bundleAudioAttached.type).map(
            (a) => a.bundleId,
          ),
        ).toEqual(['r1']);
        expect(dispatched(LoginModeActions.createBundle.type)).toHaveLength(0);
        expect(authStoreService.loginLocal).not.toHaveBeenCalled();
        // The same login chain "Attach file…" runs, on the matched bundle.
        expect(
          dispatched(LoginModeActions.selectBundle.type).map((a) => a.bundleId),
        ).toEqual(['r1']);
        const login = dispatched(AuthenticationActions.loginLocal.success.type);
        expect(login).toHaveLength(1);
        expect(login[0].files).toEqual([file]);
        expect(login[0].sessionFile.name).toBe('a.wav');
        expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
      });

      it('in a mixed drop, matched files are attached and only the rest become new files', () => {
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [
            valid(1, wav('b.wav', 'abc'), { id: 'm-b' }),
            valid(2, wav('new.wav', 'abcd'), { id: 'm-new' }),
          ],
        });

        expect(
          dispatched(LoginModeActions.bundleAudioAttached.type).map(
            (a) => a.bundleId,
          ),
        ).toEqual(['r2']);
        const created = dispatched(LoginModeActions.createBundle.type);
        expect(created.map((a) => a.sessionFile.name)).toEqual(['new.wav']);
        // One session start only: the re-attach's.
        expect(authStoreService.loginLocal).not.toHaveBeenCalled();
        expect(
          dispatched(AuthenticationActions.loginLocal.success.type),
        ).toHaveLength(1);
      });

      it('mid-session, attaches without moving the selection or re-running the login chain', () => {
        component.sessionReady = true;
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, wav('a.wav', 'abc'), { id: 'm-a' })],
        });

        expect(
          dispatched(LoginModeActions.bundleAudioAttached.type),
        ).toHaveLength(1);
        expect(dispatched(LoginModeActions.selectBundle.type)).toHaveLength(0);
        expect(
          dispatched(AuthenticationActions.loginLocal.success.type),
        ).toHaveLength(0);
      });

      it('a file with the same name but a different size is a new file', () => {
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, wav('a.wav', 'abcdef'), { id: 'm-a' })],
        });

        expect(
          dispatched(LoginModeActions.bundleAudioAttached.type),
        ).toHaveLength(0);
        expect(authStoreService.loginLocal).toHaveBeenCalled();
      });

      it('never re-attaches to a bundle whose audio is already available (that drop is a duplicate)', () => {
        audioService.canRestore.mockImplementation(
          (id: unknown) => id === 'r1',
        );
        component.sessionReady = true;
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, wav('a.wav', 'abc'), { id: 'm-a' })],
        });

        expect(
          dispatched(LoginModeActions.bundleAudioAttached.type),
        ).toHaveLength(0);
        // Neither re-attached nor added again (see the duplicate tests).
        expect(dispatched(LoginModeActions.createBundle.type)).toHaveLength(0);
      });
    });

    // Dropping a file that is already in the list (with its audio) used to
    // add an identical row.
    describe('dropping files that are already in the list', () => {
      const listed = (name: string, size: number) =>
        new SessionFile(name, size, new Date(0), 'audio/wav');
      const wav = (name: string, bytes: string) =>
        new File([bytes], name, { type: 'audio/wav' });
      const valid = (id: number, file: File) =>
        fileProgress(id, file, {
          status: 'valid',
          audioManager: { id: `m-${id}`, destroy: jest.fn() },
          oaudiofile: {},
        });
      const dispatched = (type: string) =>
        storeDispatch.mock.calls
          .map(([action]) => action as any)
          .filter((a) => a.type === type);
      let showAlert: jest.SpiedFunction<AlertService['showAlert']>;

      beforeEach(() => {
        localModeState = {
          bundles: { entities: { l1: { sessionFile: listed('a.wav', 3) } } },
        };
        bundleSummaries = [
          {
            bundleId: 'l1',
            name: 'a.wav',
            selected: false,
            awaitingMedia: false,
          },
        ];
        audioService.canRestore.mockImplementation(
          (id: unknown) => id === 'l1',
        );
        showAlert = jest
          .spyOn(TestBed.inject(AlertService), 'showAlert')
          .mockResolvedValue({ id: 1, component: undefined });
        component.sessionReady = true;
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();
      });

      it('skips a file that is already loaded: no new row, decoded audio released, notice shown', () => {
        const dup = valid(1, wav('a.wav', 'abc'));
        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [dup, valid(2, wav('new.wav', 'abcd'))],
        });

        const created = dispatched(LoginModeActions.createBundle.type);
        expect(created.map((a) => a.sessionFile.name)).toEqual(['new.wav']);
        expect(dup.audioManager.destroy).toHaveBeenCalled();
        expect(audioService.registerAudioManager).not.toHaveBeenCalledWith(
          expect.anything(),
          dup.audioManager,
          expect.anything(),
        );
        expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
        expect(showAlert).toHaveBeenCalledWith(
          'info',
          'workbench.dropzone.already_loaded',
        );
        // A mixed drop doesn't move the selection to the duplicate.
        expect(dispatched(LoginModeActions.selectBundle.type)).toHaveLength(0);
      });

      it('dropping only an already-loaded file selects it', () => {
        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, wav('a.wav', 'abc'))],
        });

        expect(dispatched(LoginModeActions.createBundle.type)).toHaveLength(0);
        expect(
          dispatched(LoginModeActions.selectBundle.type).map((a) => a.bundleId),
        ).toEqual(['l1']);
      });

      it('the same new file twice in one drop becomes one row', () => {
        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [
            valid(1, wav('b.wav', 'xyz')),
            valid(2, wav('b.wav', 'xyz')),
          ],
        });

        expect(
          dispatched(LoginModeActions.createBundle.type).map(
            (a) => a.sessionFile.name,
          ),
        ).toEqual(['b.wav']);
        expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(2);
      });

      it('a file with the same name but a different size is added', () => {
        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, wav('a.wav', 'abcdef'))],
        });

        expect(dispatched(LoginModeActions.createBundle.type)).toHaveLength(1);
        expect(showAlert).not.toHaveBeenCalled();
      });
    });

    // A transcript is paired with the recording of its name in every drop
    // (it used to be read only in the first drop, paired with whichever
    // audio decoded last).
    describe('transcripts paired with their recordings by name', () => {
      const wav = (name: string) =>
        new File(['abc'], name, { type: 'audio/wav' });
      const audio = (id: number, name: string) =>
        fileProgress(id, wav(name), {
          status: 'valid',
          audioManager: { id: `m-${id}`, destroy: jest.fn() },
          oaudiofile: {},
        });
      const annot = (text: string) =>
        new OAnnotJSON('x.wav', 'x', 16000, [
          new OSegmentLevel('words', [
            new OSegment(1, 0, 16000, [new OLabel('words', text)]),
          ]),
        ]);
      const transcript = (
        id: number,
        name: string,
        basename: string,
        status: 'valid' | 'waiting' | 'progress' = 'valid',
        text = 'hello',
      ) => {
        const fp = fileProgress(id, new File(['x'], name), {
          status: status as any,
        });
        if (status === 'valid') {
          fp.annotation = annot(text);
          fp.pairedBasename = basename;
        }
        return fp;
      };
      const dispatched = (type: string) =>
        storeDispatch.mock.calls
          .map(([action]) => action as any)
          .filter((a) => a.type === type);
      const transcriptText = (action: any) =>
        action.transcript.levels[0].items[0].labels[0].value;
      let showAlert: jest.SpiedFunction<AlertService['showAlert']>;

      beforeEach(() => {
        showAlert = jest
          .spyOn(TestBed.inject(AlertService), 'showAlert')
          .mockResolvedValue({ id: 1, component: undefined });
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();
      });

      it('later drop: creates the file with its own transcript, and does not transcribe it', () => {
        component.sessionReady = true;

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [
            audio(1, 'b.wav'),
            transcript(2, 'b.TextGrid', 'b', 'valid', 'text of b'),
          ],
        });

        const created = dispatched(LoginModeActions.createBundle.type);
        expect(created.map((a) => a.sessionFile.name)).toEqual(['b.wav']);
        const applied = dispatched(LoginModeActions.setBundleTranscript.type);
        expect(applied.map((a) => a.bundleId)).toEqual([created[0].bundleId]);
        expect(transcriptText(applied[0])).toBe('text of b');
        expect(applied[0].transcript.selectedLevelIndex).toBe(0);
        expect(
          (component as any).pendingAutoEnqueueIds.has(created[0].bundleId),
        ).toBe(false);
        expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
        expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(2);
      });

      it('holds a recording while a transcript of its name is still being read — not one of another name', () => {
        component.sessionReady = true;

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [
            audio(1, 'b.wav'),
            audio(2, 'c.wav'),
            transcript(3, 'b.TextGrid', 'b', 'waiting'),
          ],
        });

        expect(
          dispatched(LoginModeActions.createBundle.type).map(
            (a) => a.sessionFile.name,
          ),
        ).toEqual(['c.wav']);
      });

      it('first drop: the first file gets its own transcript via the login chain, later files theirs once created', () => {
        const a = audio(1, 'a.wav');
        const b = audio(2, 'b.wav');
        const tb = transcript(3, 'b.TextGrid', 'b', 'valid', 'text of b');
        const ta = transcript(4, 'a.TextGrid', 'a', 'valid', 'text of a');

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [a, b, tb, ta],
        });

        const [files, annotation, , ids] = authStoreService.loginLocal.mock
          .calls[0] as any[];
        expect(files).toEqual([a.file.file, b.file.file]);
        expect(annotation).toBe(ta.annotation);
        expect(
          dispatched(LoginModeActions.setBundleTranscript.type),
        ).toHaveLength(0);

        // onLoginLocal$ creates the second bundle later.
        bundleSummaries = [
          {
            bundleId: ids[0],
            name: 'a.wav',
            selected: true,
            awaitingMedia: false,
          },
          {
            bundleId: ids[1],
            name: 'b.wav',
            selected: false,
            awaitingMedia: false,
          },
        ];
        fixture.detectChanges();

        const applied = dispatched(LoginModeActions.setBundleTranscript.type);
        expect(applied.map((x) => x.bundleId)).toEqual([ids[1]]);
        expect(transcriptText(applied[0])).toBe('text of b');
      });

      describe('a transcript dropped for a file already in the list', () => {
        const listed = (transcript: TrattAnnotation<any>) => {
          localModeState = {
            bundles: {
              entities: {
                l1: {
                  sessionFile: new SessionFile(
                    'b.wav',
                    3,
                    new Date(0),
                    'audio/wav',
                  ),
                  transcript,
                },
              },
            },
          };
          bundleSummaries = [
            {
              bundleId: 'l1',
              name: 'b.wav',
              selected: false,
              awaitingMedia: false,
            },
          ];
          audioService.getMediaInfo.mockImplementation((id: unknown) =>
            id === 'l1'
              ? {
                  fullname: 'b.wav',
                  size: 3,
                  sampleRate: 16000,
                  channels: 1,
                  duration: { samples: 16000, seconds: 1 },
                }
              : undefined,
          );
        };
        const withText = () => {
          const t = new TrattAnnotation();
          const level = t.createSegmentLevel('words');
          level.items.push(
            t.createSegment(new SampleUnit(16000, 16000), [
              new OLabel('words', 'typed by hand'),
            ]),
          );
          t.addLevel(level);
          return t;
        };

        beforeEach(() => {
          component.sessionReady = true;
        });

        it('loads it into that file, with a notice', () => {
          listed(new TrattAnnotation());

          component.dropzone!.filesAdded.emit({
            statistics: {} as any,
            addedFiles: [transcript(1, 'b.TextGrid', 'b')],
          });

          const applied = dispatched(LoginModeActions.setBundleTranscript.type);
          expect(applied.map((a) => a.bundleId)).toEqual(['l1']);
          expect(dispatched(LoginModeActions.createBundle.type)).toHaveLength(
            0,
          );
          expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
          expect(showAlert).toHaveBeenCalledWith(
            'success',
            'workbench.transcript_import.applied',
          );
        });

        it('loads it into a restored file whose audio is not attached', () => {
          listed(new TrattAnnotation());
          audioService.getMediaInfo.mockReturnValue(undefined);

          component.dropzone!.filesAdded.emit({
            statistics: {} as any,
            addedFiles: [transcript(1, 'b.TextGrid', 'b')],
          });

          expect(
            dispatched(LoginModeActions.setBundleTranscript.type).map(
              (a) => a.bundleId,
            ),
          ).toEqual(['l1']);
          expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
        });

        it('keeps the transcript, marked invalid, if its file was removed meanwhile', () => {
          listed(new TrattAnnotation());
          bundleSummaries = [];
          const t = transcript(1, 'b.TextGrid', 'b');

          component.dropzone!.filesAdded.emit({
            statistics: {} as any,
            addedFiles: [t],
          });

          expect(t.status).toBe('invalid');
          expect(t.error).toBe('workbench.dropzone.transcript_no_recording');
          expect(component.dropzone!.consumeEntry).not.toHaveBeenCalled();
          expect(
            dispatched(LoginModeActions.setBundleTranscript.type),
          ).toHaveLength(0);
        });

        it('asks before replacing a transcript that has content, and keeps it on "no"', async () => {
          listed(withText());
          const openModal = jest.fn(async () => 'no');
          (component as any).modService = { openModal };

          component.dropzone!.filesAdded.emit({
            statistics: {} as any,
            addedFiles: [transcript(1, 'b.TextGrid', 'b')],
          });
          await Promise.resolve();
          await Promise.resolve();

          expect(openModal).toHaveBeenCalledWith(
            YesNoModalComponent,
            YesNoModalComponent.options,
            { message: 'workbench.transcript_import.replace_confirm' },
          );
          expect(
            dispatched(LoginModeActions.setBundleTranscript.type),
          ).toHaveLength(0);
        });

        it('replaces it on "yes"', async () => {
          listed(withText());
          (component as any).modService = {
            openModal: jest.fn(async () => 'yes'),
          };

          component.dropzone!.filesAdded.emit({
            statistics: {} as any,
            addedFiles: [transcript(1, 'b.TextGrid', 'b')],
          });
          await Promise.resolve();
          await Promise.resolve();

          expect(
            dispatched(LoginModeActions.setBundleTranscript.type).map(
              (a) => a.bundleId,
            ),
          ).toEqual(['l1']);
        });

        it('gives the dropzone the listed recording to import against (externalAudioFor)', async () => {
          listed(new TrattAnnotation());

          const found = component.audioForTranscript('B');
          expect(found).toBeInstanceOf(OAudiofile);
          expect(found).toMatchObject({
            name: 'b.wav',
            sampleRate: 16000,
            duration: 16000,
            type: 'audio/wav',
          });

          // Restored without its audio and nothing to time it by.
          audioService.getMediaInfo.mockReturnValue(undefined);
          await expect(component.audioForTranscript('b')).resolves.toBe(
            'no-audio',
          );
          expect(component.audioForTranscript('nothing')).toBeUndefined();
        });

        it("describes a restored file (audio not attached) by its stored transcript's timing", async () => {
          listed(new TrattAnnotation());
          audioService.getMediaInfo.mockReturnValue(undefined);
          const oAudioFile = new OAudiofile();
          oAudioFile.name = 'b.wav';
          oAudioFile.sampleRate = 16000;
          oAudioFile.duration = 39264;
          const resolveBundleMedia = jest.fn(async () => ({
            oAudioFile,
            sampleRate: 16000,
            duration: {} as any,
          }));
          (component as any).catalogueExport = { resolveBundleMedia };

          await expect(component.audioForTranscript('b')).resolves.toBe(
            oAudioFile,
          );
          expect(resolveBundleMedia).toHaveBeenCalledWith('l1');
        });

        it('re-renders the dropzone on every dropzone update (OnPush, subscribed in code)', () => {
          const markForCheck = jest.spyOn(
            (component as any).cd,
            'markForCheck',
          );
          const t = transcript(1, 'b.TextGrid', 'b');
          t.status = 'invalid';
          t.annotation = undefined;
          component.dropzone!.filesAdded.emit({
            statistics: {} as any,
            addedFiles: [t],
          });
          expect(markForCheck).toHaveBeenCalled();
        });
      });
    });

    // After "Select all -> Remove" the collection falls back to an empty
    // placeholder bundle (no file) and the session stays ready. A drop then
    // goes down the later-wave path; the first new file must be shown
    // instead of a pane asking to attach audio to a file that isn't there.
    describe('focus after every file was removed', () => {
      const valid = (id: number, name: string) =>
        fileProgress(id, new File([name], name), {
          status: 'valid',
          audioManager: { id: name } as any,
          oaudiofile: {},
        });
      const createCalls = () =>
        storeDispatch.mock.calls
          .map(([action]) => action as any)
          .filter((a) => a.type === LoginModeActions.createBundle.type);

      it('selects the first new file when the empty placeholder is selected', () => {
        localModeState = {
          bundles: {
            entities: { [DEFAULT_BUNDLE_ID]: { transcript: undefined } },
          },
        };
        component.sessionReady = true;
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, 'a.wav'), valid(2, 'b.wav')],
        });

        expect(authStoreService.loginLocal).not.toHaveBeenCalled();
        expect(createCalls().map((a) => a.selectAfterCreate)).toEqual([
          true,
          false,
        ]);
        // Their audio is registered right before: navbar items and the
        // list treat them as loaded.
        expect(createCalls().map((a) => a.audioLoaded)).toEqual([true, true]);
      });

      it('never steals focus from a selected file', () => {
        localModeState = {
          bundles: {
            entities: {
              [DEFAULT_BUNDLE_ID]: {
                sessionFile: new SessionFile(
                  'x.wav',
                  1,
                  new Date(),
                  'audio/wav',
                ),
              },
            },
          },
        };
        component.sessionReady = true;
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, 'a.wav')],
        });

        expect(createCalls().map((a) => a.selectAfterCreate)).toEqual([false]);
      });

      it('does not move the selection while the first wave is still logging in', () => {
        // bundle-1 is selected and has no file YET: the login chain writes
        // into whatever is selected, so it must stay selected.
        localModeState = {
          bundles: { entities: { [DEFAULT_BUNDLE_ID]: {} } },
        };
        component.dropzone = makeDropzone() as any;
        component.ngAfterViewInit();
        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(1, 'a.wav')],
        });
        expect(component.sessionReady).toBe(false);

        component.dropzone!.filesAdded.emit({
          statistics: {} as any,
          addedFiles: [valid(2, 'b.wav')],
        });

        expect(createCalls().map((a) => a.selectAfterCreate)).toEqual([false]);
      });
    });

    // Regression: after a reload, DEFAULT_BUNDLE_ID holds the user's
    // restored bundle. The first new file used to be bootstrapped INTO it,
    // re-binding the restored transcript to a different recording.
    it('never bootstraps a new file into bundle-1 when bundle-1 already holds a restored bundle', () => {
      bundleSummaries = [
        {
          bundleId: DEFAULT_BUNDLE_ID,
          name: 'restored.wav',
          selected: true,
          awaitingMedia: true,
          hasAnnotationContent: true,
        },
      ];
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      const manager = { id: 'm1' } as any;
      const nativeFile = new File(['a'], 'new.wav');
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, nativeFile, {
            status: 'valid',
            audioManager: manager,
            oaudiofile: {},
          }),
        ],
      });

      const [registeredId] = audioService.registerAudioManager.mock
        .calls[0] as [string, unknown, unknown];
      expect(registeredId).not.toBe(DEFAULT_BUNDLE_ID);
      // Created (and selected) up front so onLoginLocal$'s selectBundle()
      // finds it instead of no-op'ing onto the restored bundle.
      expect(storeDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LoginModeActions.createBundle.type,
          bundleId: registeredId,
          selectAfterCreate: true,
        }),
      );
      expect(authStoreService.loginLocal).toHaveBeenCalledWith(
        [nativeFile],
        undefined,
        false,
        [registeredId],
      );
    });

    // Regression: re-attaching a restored bundle runs the login chain
    // itself; a file dropped afterwards must not re-run it.
    it('routes even the first dropped file through createBundle when a session already exists', () => {
      component.sessionReady = true;
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      const manager = { id: 'm1' } as any;
      const nativeFile = new File(['a'], 'a.wav');
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, nativeFile, {
            status: 'valid',
            audioManager: manager,
            oaudiofile: {},
          }),
        ],
      });

      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
      expect(storeDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LoginModeActions.createBundle.type,
          selectAfterCreate: false,
        }),
      );
    });

    // Review Focus #1: a file still mid-decode when a DIFFERENT file's
    // first-wave bootstrap fires must not be orphaned.
    it('does not consume or lose an entry that is still decoding when the first wave fires for an earlier entry', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      const file1 = new File(['a'], 'a.wav');
      const stillDecoding = fileProgress(2, new File(['b'], 'b.wav'), {
        status: 'progress',
      });
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, file1, {
            status: 'valid',
            audioManager: {} as any,
            oaudiofile: {},
          }),
          stillDecoding,
        ],
      });

      // Only the valid entry (id 1) was consumed — id 2 was left alone.
      expect(component.dropzone!.consumeEntry).toHaveBeenCalledTimes(1);
      expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(1);
      expect(component.dropzone!.reset).not.toHaveBeenCalled();

      // id 2 finishing later still reaches the later-wave path correctly.
      const manager2 = { id: 'm2' } as any;
      stillDecoding.status = 'valid';
      stillDecoding.audioManager = manager2;
      stillDecoding.oaudiofile = {};
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [stillDecoding],
      });

      expect(audioService.registerAudioManager).toHaveBeenCalledWith(
        expect.any(String),
        manager2,
        stillDecoding.file.file,
      );
      expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(2);
    });

    // C1 (final whole-branch review): a transcript file dropped alongside
    // the first audio file may still be mid-read when the audio decodes
    // first — the first wave must not fire (and discard the transcript) in
    // that window.
    it('defers the first wave while a paired transcript (non-audio) file is still being read', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      const audioFp = fileProgress(1, new File(['a'], 'a.wav'), {
        status: 'valid',
        audioManager: {} as any,
        oaudiofile: {},
      });
      const transcriptFp = fileProgress(
        2,
        new File(['x'], 'a_annot.json', { type: 'application/json' }),
        { status: 'progress' },
      );

      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [audioFp, transcriptFp],
      });

      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
      expect(component.dropzone!.consumeEntry).not.toHaveBeenCalled();
    });

    it('fires the first wave once the paired transcript has also validated, without discarding it', () => {
      const dropzone = makeDropzone();
      component.dropzone = dropzone as any;
      component.ngAfterViewInit();

      const audioFp = fileProgress(1, new File(['a'], 'a.wav'), {
        status: 'valid',
        audioManager: {} as any,
        oaudiofile: {},
      });
      const transcriptFp = fileProgress(
        2,
        new File(['x'], 'a_annot.json', { type: 'application/json' }),
        { status: 'progress' },
      );
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [audioFp, transcriptFp],
      });
      expect(authStoreService.loginLocal).not.toHaveBeenCalled();

      // The dropzone has since paired the transcript with a.wav (by name)
      // and stored the import on the transcript's own entry.
      const oannotation = { levels: [] } as any;
      transcriptFp.status = 'valid';
      transcriptFp.annotation = oannotation;
      transcriptFp.pairedBasename = 'a';
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [audioFp, transcriptFp],
      });

      expect(authStoreService.loginLocal).toHaveBeenCalledWith(
        [audioFp.file.file],
        oannotation,
        false,
        [DEFAULT_BUNDLE_ID],
      );
      expect(component.dropzone!.consumeEntry).toHaveBeenCalledWith(2);
      // It has its transcript: not queued for transcription.
      expect(pipelineQueueService.enqueue).not.toHaveBeenCalled();
    });

    // Regression guard for Task 6's own approved behavior: a sibling AUDIO
    // file still decoding must NOT defer the first wave — only a non-audio
    // (transcript-candidate) entry still in 'progress' does that (C1's scope
    // is deliberately narrower than "any progress entry").
    it('still fires the first wave immediately when a second AUDIO file (no transcript at all) is still decoding', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();

      const audioFp = fileProgress(1, new File(['a'], 'a.wav'), {
        status: 'valid',
        audioManager: {} as any,
        oaudiofile: {},
      });
      const stillDecodingAudio = fileProgress(2, new File(['b'], 'b.wav'), {
        status: 'progress',
      });

      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [audioFp, stillDecodingAudio],
      });

      expect(authStoreService.loginLocal).toHaveBeenCalledWith(
        [audioFp.file.file],
        undefined,
        false,
        [DEFAULT_BUNDLE_ID],
      );
    });

    it('ignores a repeat emission for an already-ingested id', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();
      const fp = fileProgress(1, new File(['a'], 'a.wav'), {
        status: 'valid',
        audioManager: {} as any,
        oaudiofile: {},
      });
      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [fp],
      });
      authStoreService.loginLocal.mockClear();
      audioService.registerAudioManager.mockClear();

      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [fp],
      });

      expect(authStoreService.loginLocal).not.toHaveBeenCalled();
      expect(audioService.registerAudioManager).not.toHaveBeenCalled();
    });
  });

  describe('auto-enqueue on bundle creation (step 6)', () => {
    function makeDropzone() {
      return {
        filesAdded: new EventEmitter<any>(),
        hasAnnotation: false,
        oannotation: undefined,
        reset: jest.fn(),
        consumeEntry: jest.fn(),
        addFile: jest.fn(),
      };
    }

    it('does not enqueue before the first-wave bundle has landed in the store, then does once it has', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();
      component.onQueueOptionsChange({ modelId: 'm', useWebGPU: false } as any);

      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, new File(['a'], 'a.wav'), {
            status: 'valid',
            audioManager: {} as any,
            oaudiofile: {},
          }),
        ],
      });
      // Store hasn't actually written the bundle's sessionFile yet (loginLocal
      // is async) — bundleSummaries still only shows the empty default.
      expect(pipelineQueueService.enqueue).not.toHaveBeenCalled();

      // The async chain lands: selectAllBundleSummaries now shows this bundle
      // with a defined name.
      bundleSummaries = [
        {
          bundleId: DEFAULT_BUNDLE_ID,
          name: 'a.wav',
          selected: true,
          awaitingMedia: false,
          hasAnnotationContent: false,
        },
      ];
      fixture.detectChanges();

      expect(pipelineQueueService.enqueue).toHaveBeenCalledWith([
        DEFAULT_BUNDLE_ID,
      ]);
    });

    it('does not auto-enqueue when no pipeline options are configured', () => {
      component.dropzone = makeDropzone() as any;
      component.ngAfterViewInit();
      // queueOptions() left at its default null — no onQueueOptionsChange call.

      component.dropzone!.filesAdded.emit({
        statistics: {} as any,
        addedFiles: [
          fileProgress(1, new File(['a'], 'a.wav'), {
            status: 'valid',
            audioManager: {} as any,
            oaudiofile: {},
          }),
        ],
      });
      bundleSummaries = [
        {
          bundleId: DEFAULT_BUNDLE_ID,
          name: 'a.wav',
          selected: true,
          awaitingMedia: false,
          hasAnnotationContent: false,
        },
      ];
      fixture.detectChanges();

      expect(pipelineQueueService.enqueue).not.toHaveBeenCalled();
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
          useValue: (() => {
            const mock: any = {
              hasResident: jest.fn((id: string) => residentIds.includes(id)),
              getManager: jest.fn(() => undefined),
              getMediaInfo: jest.fn(() => undefined),
            };
            // resident OR re-decodable — follows hasResident (tests swap
            // hasResident's implementation to model residency changes).
            mock.canRestore = jest.fn((id: unknown) => mock.hasResident(id));
            return mock;
          })(),
        },
        { provide: AuthenticationStoreService, useValue: {} },
        { provide: AppStorageService, useValue: {} },
        { provide: RoutingService, useValue: { staticQueryParams: {} } },
        { provide: NavbarService, useValue: {} },
        { provide: RecordedFileService, useValue: {} },
        // The real tracker listens to NgRx Actions (not provided here).
        { provide: AnnotationSaveTracker, useValue: { inFlight: 0 } },
        {
          provide: CatalogueExportService,
          useValue: { resolveBundleMedia: jest.fn(async () => undefined) },
        },
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
  describe('pipeline summary and settings dialog', () => {
    const oneFile = () => ({
      bundles: bundlesState([
        { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
        { bundleId: 'bundle-a', sessionFile: { name: 'a.wav' } },
      ]),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    });
    const q = (fx: ComponentFixture<WorkbenchComponent>, css: string) =>
      fx.debugElement.query(By.css(css))?.nativeElement as
        | HTMLElement
        | undefined;
    const chips = (fx: ComponentFixture<WorkbenchComponent>) =>
      fx.debugElement
        .queryAll(By.css('.workbench__pipeline-chips li'))
        .map((li) => (li.nativeElement as HTMLElement).textContent!.trim());

    it('keeps the settings mounted while the dialog is closed, so remembered choices still reach the queue', async () => {
      const fx = await createWithLocalMode(oneFile());
      const dialog = q(fx, 'dialog.workbench__pipeline-dialog')!;

      expect(dialog.hasAttribute('open')).toBe(false);
      expect(
        dialog.querySelector('tratt-auto-transcribe-options'),
      ).toBeTruthy();
      expect(dialog.querySelector('tratt-auto-translate-options')).toBeTruthy();
      // Not in the rail any more.
      expect(
        q(fx, '.workbench__queue > tratt-auto-transcribe-options'),
      ).toBeFalsy();
    });

    it('says auto-transcription is off when no options are set', async () => {
      const fx = await createWithLocalMode(oneFile());

      expect(q(fx, '.workbench__pipeline-state')!.textContent!.trim()).toBe(
        'workbench.pipeline.off',
      );
      expect(q(fx, '.workbench__pipeline--off')).toBeTruthy();
      expect(chips(fx)).toEqual([]);
    });

    it('summarises model, language, speakers and translation', async () => {
      const fx = await createWithLocalMode(oneFile());
      fx.componentInstance.onQueueOptionsChange({
        modelId: 'onnx-community/whisper-tiny-ONNX',
        useWebGPU: true,
        language: 'en',
        diarization: { modelId: 'd', useWebGPU: false, numSpeakers: 2 },
      } as any);
      // The real translation panel re-emits (off) when the transcribe
      // options reach it; set the translation after that. (This fixture's
      // queue-service stub has no setTranslateOptions.)
      fx.detectChanges();
      fx.componentInstance.queueTranslateOptions.set({
        sourceLanguage: 'en',
        targetLanguage: 'de',
      });
      fx.detectChanges();

      expect(q(fx, '.workbench__pipeline-state')!.textContent!.trim()).toBe(
        'workbench.pipeline.on',
      );
      expect(chips(fx)).toEqual([
        'Whisper Tiny',
        'English',
        'workbench.pipeline.speakers_other',
        'workbench.pipeline.translate_to',
      ]);
    });

    it('opens from the icon and closes with Done, back on the icon', async () => {
      const fx = await createWithLocalMode(oneFile());
      const dialog = q(fx, 'dialog.workbench__pipeline-dialog')!;
      const icon = q(fx, '.workbench__pipeline-edit') as HTMLButtonElement;

      icon.click();
      expect(dialog.hasAttribute('open')).toBe(true);

      const done = q(
        fx,
        '.workbench__pipeline-dialog-footer .btn-primary',
      ) as HTMLButtonElement;
      done.click();
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(document.activeElement).toBe(icon);
    });

    it('closes on a backdrop click but not on a click inside', async () => {
      const fx = await createWithLocalMode(oneFile());
      const dialog = q(fx, 'dialog.workbench__pipeline-dialog')!;
      fx.componentInstance.openPipelineSettings();

      q(fx, '.workbench__pipeline-dialog-body')!.click();
      expect(dialog.hasAttribute('open')).toBe(true);

      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dialog.hasAttribute('open')).toBe(false);
    });
  });

  describe('run/pause button rendering (Task 7 review Q1)', () => {
    function runButton(fx: ComponentFixture<WorkbenchComponent>) {
      return fx.debugElement.query(By.css('.workbench__queue-run'))
        .nativeElement as HTMLButtonElement;
    }

    it('is disabled with the play icon when the queue is idle and nothing is ready', async () => {
      const localMode = {
        bundles: bundlesState([
          { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
          // Named so hasAnyBundles() is true (unrelated to the queue panel,
          // which now always renders).
          // Not resident, so it's still not ready — keeps this test's
          // readyBundleIds at zero.
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
          // Named so hasAnyBundles() is true (unrelated to the queue panel,
          // which now always renders).
          // Not yet resident, so readyBundleIds starts at zero.
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

  // Task 6 self-review regression: this test exists because the outer
  // `WorkbenchComponent` suite's Store stub hands component.computed()s
  // plain closures, not real Angular signals (see that suite's own
  // "real default LOCAL store state" preamble comment) — so a test written
  // there could pass "vacuously" even if the auto-enqueue effect never
  // actually re-ran reactively. This block uses provideMockStore's REAL
  // signals, in the exact order a real app hits them: a change-detection
  // flush happens (ngOnInit's own loading$ subscription calls
  // this.cd.detectChanges()) BEFORE any file has ever been dropped —
  // i.e. the auto-enqueue effect's very first execution happens while
  // `pendingAutoEnqueueIds` is still empty. An effect that reads no signal
  // on a run where it returns early never gets scheduled again when that
  // signal later changes (Angular only re-runs an effect for signals it
  // actually read on its last execution) — confirmed with an isolated
  // TestBed probe during this task's self-review. Reading
  // bundleSummaries()/queueOptions() unconditionally, before that early
  // return, is what keeps this effect alive across exactly this ordering.
  it('still auto-enqueues after an initial change-detection flush happened while no file had been dropped yet', async () => {
    const localMode = {
      bundles: bundlesState([
        { bundleId: DEFAULT_BUNDLE_ID, sessionFile: undefined },
      ]),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    };
    const authStoreServiceMock = { loginLocal: jest.fn() };
    const pipelineQueueServiceMock = {
      setTranscribeOptions: jest.fn(),
      enqueue: jest.fn(),
      stop: jest.fn(),
      retry: jest.fn(),
      readyBundleIds: jest.fn(() => []),
    };

    await TestBed.configureTestingModule({
      imports: [WorkbenchComponent],
      providers: [
        {
          provide: AudioService,
          useValue: {
            registerAudioManager: jest.fn(),
            hasResident: jest.fn(() => false),
            canRestore: jest.fn(() => false),
            getManager: jest.fn(() => undefined),
            getMediaInfo: jest.fn(() => undefined),
          },
        },
        { provide: AuthenticationStoreService, useValue: authStoreServiceMock },
        { provide: AppStorageService, useValue: {} },
        { provide: RoutingService, useValue: { staticQueryParams: {} } },
        { provide: NavbarService, useValue: {} },
        { provide: RecordedFileService, useValue: {} },
        // The real tracker listens to NgRx Actions (not provided here).
        { provide: AnnotationSaveTracker, useValue: { inFlight: 0 } },
        {
          provide: CatalogueExportService,
          useValue: { resolveBundleMedia: jest.fn(async () => undefined) },
        },
        { provide: AnnotationStoreService, useValue: {} },
        { provide: SettingsService, useValue: { isTheme: () => false } },
        { provide: TrattModalService, useValue: {} },
        {
          provide: ApplicationStoreService,
          useValue: { loading$: of({ status: LoadingStatus.INITIALIZE }) },
        },
        { provide: UserInteractionsService, useValue: {} },
        { provide: PipelineQueueService, useValue: pipelineQueueServiceMock },
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
            pipelineQueue: {
              queue: [],
              activeId: null,
              mode: 'idle',
              runs: {},
            },
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
    // First-ever flush, with no file dropped yet and pendingAutoEnqueueIds
    // still empty — the exact real-app ordering under test.
    fx.detectChanges();

    fx.componentInstance.onQueueOptionsChange({
      modelId: 'm',
      useWebGPU: false,
    } as any);
    const nativeFile = new File(['a'], 'a.wav');
    (fx.componentInstance.dropzone as any).filesAdded.emit({
      statistics: {} as any,
      addedFiles: [
        {
          id: 1,
          status: 'valid',
          checked_converters: 0,
          progress: 1,
          file: {
            file: nativeFile,
            fullname: nativeFile.name,
            type: nativeFile.type,
            size: nativeFile.size,
          },
          audioManager: { id: 'm1' } as any,
          oaudiofile: {},
        },
      ],
    });

    expect(pipelineQueueServiceMock.enqueue).not.toHaveBeenCalled();

    // The async loginLocal chain "lands" in the store.
    const store = TestBed.inject(Store) as MockStore;
    store.setState({
      localMode: {
        bundles: bundlesState([
          { bundleId: DEFAULT_BUNDLE_ID, sessionFile: { name: 'a.wav' } },
        ]),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      },
      pipelineQueue: { queue: [], activeId: null, mode: 'idle', runs: {} },
    } as any);
    fx.detectChanges();

    expect(pipelineQueueServiceMock.enqueue).toHaveBeenCalledWith([
      DEFAULT_BUNDLE_ID,
    ]);
  });
});

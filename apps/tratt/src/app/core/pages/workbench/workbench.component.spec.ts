import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

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

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { randomUUID } from 'node:crypto';
import { BehaviorSubject, of } from 'rxjs';
import { editorComponents } from '../../../editors/components';
import { NavbarService } from '../../component/navbar/navbar.service';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { AudioService } from '../../shared/service/audio.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { RoutingService } from '../../shared/service/routing.service';
import { LoadingStatus } from '../../store';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import { initialState as annotationInitialState } from '../../store/login-mode/annotation/annotation.reducer';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from '../../store/login-mode/annotation/local-bundle-collection';
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
  let audioService: { registerAudioManager: jest.Mock };
  let authStoreService: { loginLocal: jest.Mock };
  let loading$: BehaviorSubject<{ status: LoadingStatus }>;
  let bundleSummaries: any[];

  beforeEach(async () => {
    audioService = { registerAudioManager: jest.fn() };
    authStoreService = { loginLocal: jest.fn() };
    loading$ = new BehaviorSubject<{ status: LoadingStatus }>({
      status: LoadingStatus.INITIALIZE,
    });
    // No bundles by default: matches a clean/logged-out profile where
    // nothing has been restored from IndexedDB and no session has started.
    bundleSummaries = [];

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
        {
          // WorkbenchComponent reads selectAllBundleSummaries directly (same
          // selectSignal convention as AudioService/BundleListComponent) to
          // decide whether restored-but-unresolved bundles should reveal the
          // bundle-list before sessionReady. Stub selectSignal generically so
          // it works regardless of which selector is passed, matching the
          // bundleSummaries fixture set per-test below.
          provide: Store,
          useValue: { selectSignal: () => () => bundleSummaries },
        },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            selectTranslate: () => of(''),
            config: { reRenderOnLangChange: false },
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
    const [files, annotation, removeData, audioBundleIds] =
      authStoreService.loginLocal.mock.calls[0] as [
        File[],
        undefined,
        boolean,
        string[],
      ];
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
        { bundleId: 'bundle-a', name: 'a.wav', selected: true, awaitingMedia: true },
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
        { bundleId: 'bundle-a', name: 'a.wav', selected: true, awaitingMedia: true },
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

  async function createWithLocalMode(localMode: unknown) {
    await TestBed.configureTestingModule({
      imports: [WorkbenchComponent],
      providers: [
        { provide: AudioService, useValue: {} },
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
        provideMockStore({ initialState: { localMode } as any }),
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            selectTranslate: () => of(''),
            config: { reRenderOnLangChange: false },
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
});

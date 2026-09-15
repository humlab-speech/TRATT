import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
import { TranslocoService } from '@jsverse/transloco';
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
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
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

  beforeEach(async () => {
    audioService = { registerAudioManager: jest.fn() };
    authStoreService = { loginLocal: jest.fn() };
    loading$ = new BehaviorSubject<{ status: LoadingStatus }>({
      status: LoadingStatus.INITIALIZE,
    });

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
    } as any;

    component.startSession(false);

    expect(audioService.registerAudioManager).toHaveBeenCalledWith(
      expect.any(String),
      manager,
      nativeFile,
    );
    const [bundleId] = audioService.registerAudioManager.mock.calls[0];
    expect(authStoreService.loginLocal).toHaveBeenCalledWith(
      [nativeFile],
      undefined,
      false,
      { [nativeFile.name]: bundleId },
    );
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
    component.dropzone = {
      validAudioEntries: managers.map((audioManager, i) => ({
        fileProgress: { file: { file: nativeFiles[i] } },
        audioManager,
        oaudiofile: {} as any,
      })),
      hasAnnotation: false,
      oannotation: undefined,
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
    const [files, annotation, removeData, audioBundleIdsByFilename] =
      authStoreService.loginLocal.mock.calls[0] as [
        File[],
        undefined,
        boolean,
        Record<string, string>,
      ];
    expect(files).toEqual(nativeFiles);
    expect(annotation).toBeUndefined();
    expect(removeData).toBe(false);
    expect(Object.keys(audioBundleIdsByFilename).length).toBe(3);
    nativeFiles.forEach((file, i) => {
      expect(audioBundleIdsByFilename[file.name]).toBe(registeredIds[i]);
    });
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

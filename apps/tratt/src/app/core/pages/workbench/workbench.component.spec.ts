import { describe, it, expect, jest, beforeEach } from '@jest/globals';

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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of } from 'rxjs';
import { WorkbenchComponent } from './workbench.component';
import { AudioService } from '../../shared/service/audio.service';
import { AuthenticationStoreService } from '../../store/authentication/authentication-store.service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { RoutingService } from '../../shared/service/routing.service';
import { NavbarService } from '../../component/navbar/navbar.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { SettingsService, UserInteractionsService } from '../../shared/service';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { ApplicationStoreService } from '../../store/application/application-store.service';
import { LoadingStatus } from '../../store';

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
      audioManager: manager,
      files: [{ file: { file: nativeFile } }],
      hasAudio: true,
      hasAnnotation: false,
      oannotation: undefined,
      releaseAudioManager: jest.fn(),
    } as any;

    component.startSession(false);

    expect(audioService.registerAudioManager).toHaveBeenCalledWith(manager);
    expect(component.dropzone!.releaseAudioManager).toHaveBeenCalled();
    expect(authStoreService.loginLocal).toHaveBeenCalledWith(
      [nativeFile],
      undefined,
      false,
    );
  });

  it('does nothing when the dropzone has no audio manager yet', () => {
    component.dropzone = { audioManager: undefined } as any;
    component.startSession(false);
    expect(audioService.registerAudioManager).not.toHaveBeenCalled();
    expect(authStoreService.loginLocal).not.toHaveBeenCalled();
  });

  it('does nothing when the dropzone has no valid File objects', () => {
    const manager = { id: 'fake-manager' } as any;
    component.dropzone = {
      audioManager: manager,
      files: [{ file: { file: undefined } }],
      hasAudio: false,
      hasAnnotation: false,
      oannotation: undefined,
      releaseAudioManager: jest.fn(),
    } as any;

    component.startSession(false);

    expect(audioService.registerAudioManager).not.toHaveBeenCalled();
    expect(authStoreService.loginLocal).not.toHaveBeenCalled();
  });

  it('creates the selected editor component inside the loadeditor viewContainerRef', () => {
    const createComponentSpy = jest.fn();
    component.showEditor = {
      viewContainerRef: { clear: jest.fn(), createComponent: createComponentSpy },
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
    // Let @ViewChild queries resolve first, then stub showEditor so the
    // ViewChild resolution doesn't clobber our spy on the next detectChanges.
    fixture.detectChanges();

    const createComponentSpy = jest.fn();
    component.showEditor = {
      viewContainerRef: { clear: jest.fn(), createComponent: createComponentSpy },
    } as any;
    component.appStorage = { interface: undefined } as any;
    (component as any).settingsService = {
      projectsettings: { interfaces: ['Dictaphone Editor', 'Linear Editor'] },
      isTheme: jest.fn().mockReturnValue(false),
    };

    loading$.next({ status: LoadingStatus.FINISHED });

    expect(component.sessionReady).toBe(true);
    expect(createComponentSpy).toHaveBeenCalled();
  });
});

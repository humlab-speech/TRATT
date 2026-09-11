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
  const { Component } = require('@angular/core');
  @Component({ selector: 'tratt-dropzone', template: '' })
  class TrattDropzoneComponent {}
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
import { of } from 'rxjs';
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

describe('WorkbenchComponent', () => {
  let fixture: ComponentFixture<WorkbenchComponent>;
  let component: WorkbenchComponent;
  let audioService: { registerAudioManager: jest.Mock };
  let authStoreService: { loginLocal: jest.Mock };

  beforeEach(async () => {
    audioService = { registerAudioManager: jest.fn() };
    authStoreService = { loginLocal: jest.fn() };

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
        { provide: SettingsService, useValue: {} },
        { provide: TrattModalService, useValue: {} },
        { provide: ApplicationStoreService, useValue: {} },
        { provide: UserInteractionsService, useValue: {} },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            selectTranslate: () => of(''),
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
});

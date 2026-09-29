import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import {
  AutoTranscribeOptionsComponent,
  KB_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from './auto-transcribe-options.component';

describe('AutoTranscribeOptionsComponent', () => {
  let fixture: ComponentFixture<AutoTranscribeOptionsComponent>;
  let component: AutoTranscribeOptionsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutoTranscribeOptionsComponent],
      providers: [
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
            // TranslocoPipe.transform() calls this to resolve the scope
            // before it will call translate() at all — needed here because
            // the idPrefix tests below call fixture.detectChanges(), which
            // the original ngOnInit()-only test above did not.
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AutoTranscribeOptionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('audioLoaded', true);
    fixture.componentRef.setInput('annotationAlreadyLoaded', false);
    component.enabled.set(true);
    component.hasWebGpu.set(true);
  });

  // resolveInitialLanguage() picks the active UI language when Whisper
  // supports it, falling back to Swedish kb-whisper defaults only when it
  // doesn't (see resolveInitialLanguage()'s own doc comment). This
  // beforeEach's TranslocoService mock reports 'en', which Whisper does
  // support, so the correct outcome here is the OpenAI family, not the
  // Swedish one — this test previously asserted the pre-UI-language-aware
  // behavior and never actually observed the branch it now exercises.
  it('resolves initial language and model family from the active UI language when Whisper supports it', async () => {
    await component.ngOnInit();

    expect(component.selectedLanguage).toBe('en');
    expect(component.models).toBe(OPENAI_WHISPER_MODELS);
    expect(component.selectedModelId).toBe(
      OPENAI_WHISPER_MODELS.find((m) => m.key === 'small')!.modelId,
    );
  });

  it('falls back to swedish kb-whisper defaults when the active UI language is not one Whisper supports', async () => {
    // A separate TestBed configuration, not the shared beforeEach's: the
    // component resolves its initial language as a class field initializer
    // at construction time, so overriding the provider after
    // TestBed.createComponent() (already run in beforeEach) would be too
    // late to affect it.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AutoTranscribeOptionsComponent],
      providers: [
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'xx', // not a WHISPER_LANGUAGES code
            langChanges$: of('xx'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    const fallbackFixture = TestBed.createComponent(
      AutoTranscribeOptionsComponent,
    );
    const fallbackComponent = fallbackFixture.componentInstance;
    fallbackFixture.componentRef.setInput('audioLoaded', true);
    fallbackFixture.componentRef.setInput('annotationAlreadyLoaded', false);
    fallbackComponent.enabled.set(true);
    fallbackComponent.hasWebGpu.set(true);

    await fallbackComponent.ngOnInit();

    expect(fallbackComponent.selectedLanguage).toBe('sv');
    expect(fallbackComponent.models).toBe(KB_WHISPER_MODELS);
    expect(fallbackComponent.selectedModelId).toBe(KB_WHISPER_MODELS[2].modelId);
  });

  // Task 7: idPrefix input, added so /workbench can mount a second instance
  // of this component (the queue's own config) alongside the dropzone's
  // instance without colliding element ids.
  describe('idPrefix', () => {
    it('uses unprefixed ids by default, so /local markup is unchanged', () => {
      fixture.detectChanges();
      expect(
        fixture.debugElement.query(By.css('#autoTranscribeCheck')),
      ).not.toBeNull();
    });

    it('prefixes every generated id when idPrefix is set', () => {
      fixture.componentRef.setInput('idPrefix', 'queue-');
      fixture.detectChanges();
      expect(
        fixture.debugElement.query(By.css('#queue-autoTranscribeCheck')),
      ).not.toBeNull();
      expect(
        fixture.debugElement.query(By.css('#autoTranscribeCheck')),
      ).toBeNull();
    });
  });
});

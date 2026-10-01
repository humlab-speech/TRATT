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
    expect(fallbackComponent.selectedModelId).toBe(
      KB_WHISPER_MODELS[2].modelId,
    );
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

  // Task 4: compact input, added so /workbench's narrow persistent settings
  // panel can suppress decorative hints and use a short per-model label.
  // Default false must keep /local's full descriptive copy byte-identical.
  describe('compact', () => {
    it('suppresses decorative hints and uses the short model label in compact mode', () => {
      fixture.componentRef.setInput('compact', true);
      fixture.componentRef.setInput('audioLoaded', true);
      component.enabled.set(true);
      // This file's TranslocoService stub reports 'en' as the active
      // language, which (per resolveInitialLanguage()) selects the OPENAI
      // model family — it has no 'medium' tier. Force the sv/kb-whisper
      // family (which defaults to 'medium') so the short-label assertion
      // below is deterministic, matching the brief's sample expectation.
      component.selectedLanguage = 'sv';
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain('login.auto-transcription.requires internet');
      expect(text).not.toContain('login.auto-transcription.no webgpu');
      expect(text).not.toContain(
        'login.auto-transcription.speaker separation help',
      );
      expect(text).not.toContain('login.auto-transcription.speaker count help');
      // kept even in compact mode:
      expect(text).toContain(
        'login.auto-transcription.model cached after download',
      );
      expect(text).toMatch(/Medium \(~\d+ MB\)/);
    });

    it('renders the full i18n label (not the short one) when compact is false', () => {
      fixture.componentRef.setInput('compact', false);
      fixture.componentRef.setInput('audioLoaded', true);
      component.enabled.set(true);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent as string).not.toMatch(
        /Medium \(~\d+ MB\)/,
      );
    });

    it('still shows the safari warning in compact mode (hard constraint, not a decorative hint)', () => {
      fixture.componentRef.setInput('compact', true);
      fixture.componentRef.setInput('audioLoaded', true);
      component.enabled.set(true);
      // First detectChanges() runs ngOnInit(), which sets isSafari from
      // isSafariOrWebKit() (false under jsdom) — override after that fires,
      // then re-render.
      fixture.detectChanges();
      component.isSafari.set(true);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('login.auto-transcription.safari warning');
    });

    it('does not suppress the swedish/finnish/norwegian fine-tuned hints only when compact is false', () => {
      fixture.componentRef.setInput('compact', false);
      fixture.componentRef.setInput('audioLoaded', true);
      component.enabled.set(true);
      component.selectedLanguage = 'sv';
      component.onLanguageChange();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent as string).toContain(
        'login.auto-transcription.swedish kb-whisper hint',
      );
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import {
  AutoTranscribeOptionsComponent,
  KB_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from './auto-transcribe-options.component';

async function setup(activeLang: string) {
  await TestBed.configureTestingModule({
    imports: [AutoTranscribeOptionsComponent],
    providers: [
      {
        provide: TranslocoService,
        useValue: {
          getActiveLang: () => activeLang,
          langChanges$: of(activeLang),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AutoTranscribeOptionsComponent);
  const component = fixture.componentInstance;
  fixture.componentRef.setInput('audioLoaded', true);
  fixture.componentRef.setInput('annotationAlreadyLoaded', false);
  component.enabled.set(true);
  component.hasWebGpu.set(true);
  return component;
}

describe('AutoTranscribeOptionsComponent', () => {
  it('follows the active UI language on init', async () => {
    const component = await setup('en');
    await component.ngOnInit();

    expect(component.selectedLanguage).toBe('en');
    expect(component.models).toBe(OPENAI_WHISPER_MODELS);
    expect(component.selectedModelId).toBe(OPENAI_WHISPER_MODELS[1].modelId);
  });

  it('falls back to the swedish kb-whisper defaults for an unsupported UI language', async () => {
    const component = await setup('tlh');
    await component.ngOnInit();

    expect(component.selectedLanguage).toBe('sv');
    expect(component.models).toBe(KB_WHISPER_MODELS);
    expect(component.selectedModelId).toBe(KB_WHISPER_MODELS[2].modelId);
  });
});

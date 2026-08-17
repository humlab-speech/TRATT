import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import {
  AutoTranscribeOptionsComponent,
  KB_WHISPER_MODELS,
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

  it('keeps swedish kb-whisper defaults on init', async () => {
    await component.ngOnInit();

    expect(component.selectedLanguage).toBe('sv');
    expect(component.models).toBe(KB_WHISPER_MODELS);
    expect(component.selectedModelId).toBe(KB_WHISPER_MODELS[2].modelId);
  });
});

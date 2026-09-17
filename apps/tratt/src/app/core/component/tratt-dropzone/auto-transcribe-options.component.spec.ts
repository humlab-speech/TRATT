import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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

  it('keeps swedish kb-whisper defaults on init', async () => {
    await component.ngOnInit();

    expect(component.selectedLanguage).toBe('sv');
    expect(component.models).toBe(KB_WHISPER_MODELS);
    expect(component.selectedModelId).toBe(KB_WHISPER_MODELS[2].modelId);
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

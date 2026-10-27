import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { TrattLogoComponent } from './tratt-logo.component';

describe('TrattLogoComponent', () => {
  const create = (tagline: boolean) => {
    TestBed.configureTestingModule({
      imports: [
        TrattLogoComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: { branding: { tagline: 'Språkbanken’s transcription tool' } } },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
    const f = TestBed.createComponent(TrattLogoComponent);
    f.componentRef.setInput('tagline', tagline);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  };

  it('renders the name, the mark and the tagline', () => {
    const el = create(true);
    expect(el.querySelector('.tratt-logo__name')?.textContent?.trim()).toBe('Tratt');
    expect(el.querySelector('img.tratt-logo__mark')?.getAttribute('alt')).toBe('');
    expect(el.querySelector('.tratt-logo__tagline')?.textContent).toContain('transcription tool');
  });

  it('can omit the tagline', () => {
    expect(create(false).querySelector('.tratt-logo__tagline')).toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { SettingsService } from '../../shared/service';
import { TrattFooterComponent } from './tratt-footer.component';

describe('TrattFooterComponent', () => {
  const create = (node?: { name: string; logo: string; url: string }) => {
    TestBed.configureTestingModule({
      imports: [
        TrattFooterComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: { shell: { footer: { about_us: 'About us' } } } },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [
        {
          provide: SettingsService,
          useValue: { appSettings: { tratt: { branding: node ? { node } : undefined } } },
        },
      ],
    });
    const f = TestBed.createComponent(TrattFooterComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  };

  it('links to the Språkbanken pages', () => {
    const el = create();
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const p of ['/om', '/aktuellt', '/plattformar', '/kontakt', '/om/referera-till-oss']) {
      expect(hrefs).toContain('https://sprakbanken.se' + p);
    }
  });

  it('opens every external link safely', () => {
    const el = create({ name: 'Node', logo: 'n.svg', url: 'https://example.org' });
    const links = Array.from(el.querySelectorAll('a'));
    expect(links.length).toBeGreaterThan(5);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
    }
  });

  it('omits the node column when branding.node is unset', () => {
    expect(create().querySelector('.tratt-footer__node')).toBeNull();
  });

  it('shows the node logo with alt text when set', () => {
    const el = create({ name: 'Node X', logo: 'n.svg', url: 'https://example.org' });
    const img = el.querySelector('.tratt-footer__node img');
    expect(img?.getAttribute('alt')).toBe('Node X');
    expect(img?.getAttribute('src')).toBe('n.svg');
    expect(el.querySelector('.tratt-footer__node a')?.getAttribute('href')).toBe('https://example.org');
  });
});

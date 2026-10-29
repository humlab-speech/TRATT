import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let listeners: ((e: { matches: boolean }) => void)[];
  const stubMatchMedia = (dark: boolean) => {
    listeners = [];
    window.matchMedia = jest.fn().mockReturnValue({
      matches: dark,
      addEventListener: (_: string, l: any) => listeners.push(l),
    }) as any;
  };
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-bs-theme');
  });
  afterEach(() => jest.restoreAllMocks());

  it('follows the system preference by default', () => {
    stubMatchMedia(true);
    const s = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    listeners.forEach((l) => l({ matches: false }));
    TestBed.tick();
    expect(s.effective()).toBe('light');
  });

  it('toggles and remembers the choice', () => {
    stubMatchMedia(false);
    const s = TestBed.inject(ThemeService);
    s.toggle();
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(localStorage.getItem('tratt.theme')).toBe('dark');
  });

  it('survives storage that throws', () => {
    stubMatchMedia(false);
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const s = TestBed.inject(ThemeService);
    expect(() => s.toggle()).not.toThrow();
    expect(s.effective()).toBe('dark');
  });
});

import { applyJoditTheme, currentJoditTheme } from './jodit-theme';

describe('jodit theme', () => {
  afterEach(() => document.documentElement.removeAttribute('data-bs-theme'));

  it('maps data-bs-theme to the Jodit theme name', () => {
    expect(currentJoditTheme()).toBe('default');
    document.documentElement.setAttribute('data-bs-theme', 'dark');
    expect(currentJoditTheme()).toBe('dark');
  });

  it('switches option and container classes in place', () => {
    const container = document.createElement('div');
    container.className = 'jodit jodit_theme_default';
    const jodit = { options: { theme: 'default' }, container };
    applyJoditTheme(jodit, 'dark');
    expect(jodit.options.theme).toBe('dark');
    expect(container.classList.contains('jodit_theme_dark')).toBe(true);
    expect(container.classList.contains('jodit_theme_default')).toBe(false);
    applyJoditTheme(jodit, 'default');
    expect(container.classList.contains('jodit_theme_dark')).toBe(false);
    expect(container.classList.contains('jodit_theme_default')).toBe(true);
  });

  it('ignores a missing editor', () => {
    expect(() => applyJoditTheme(undefined)).not.toThrow();
  });
});

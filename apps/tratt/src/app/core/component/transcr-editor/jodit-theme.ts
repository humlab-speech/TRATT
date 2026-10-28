export type JoditThemeName = 'dark' | 'default';

/** Jodit theme matching <html data-bs-theme> (set by ThemeService). */
export function currentJoditTheme(): JoditThemeName {
  return document.documentElement.getAttribute('data-bs-theme') === 'dark'
    ? 'dark'
    : 'default';
}

/** Minimal shape of a Jodit instance used here. */
export interface ThemableJodit {
  options?: { theme?: string };
  container?: HTMLElement;
}

/** Sets options.theme and the container classes without re-creating the editor. */
export function applyJoditTheme(
  jodit: ThemableJodit | undefined,
  theme: JoditThemeName = currentJoditTheme(),
): void {
  if (!jodit) return;
  // options can be unset while afterInit is still running
  if (jodit.options) jodit.options.theme = theme;
  jodit.container?.classList.toggle('jodit_theme_dark', theme === 'dark');
  jodit.container?.classList.toggle('jodit_theme_default', theme !== 'dark');
}

import { computed, effect, Injectable, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'tratt.theme';

/** Light/dark theme (Språkbanken profile). Sets data-bs-theme on <html>. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(read());
  private readonly systemDark = signal(false);
  readonly effective = computed<'light' | 'dark'>(() =>
    this.preference() === 'system'
      ? this.systemDark()
        ? 'dark'
        : 'light'
      : (this.preference() as 'light' | 'dark'),
  );

  constructor() {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemDark.set(mq.matches);
      mq.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    }
    effect(() =>
      document.documentElement.setAttribute('data-bs-theme', this.effective()),
    );
  }

  toggle(): void {
    const next = this.effective() === 'dark' ? 'light' : 'dark';
    this.preference.set(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode / blocked storage: the choice lasts for this session */
    }
  }
}

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  observeTheme,
  resolveTrattColors,
  TRATT_COLORS,
  TRATT_FONTS,
} from './tratt-colors';

describe('TRATT_COLORS', () => {
  it('uses only hex or rgba() values, never color-mix()', () => {
    for (const value of Object.values(TRATT_COLORS)) {
      expect(value).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\([^)]*\))$/);
      expect(value).not.toContain('color-mix(');
    }
  });

  it('exposes a Noto Sans data font with fallbacks', () => {
    expect(TRATT_FONTS.data).toContain('Noto Sans');
    expect(TRATT_FONTS.data).toContain('sans-serif');
  });

  it('light values equal the light tokens in apps/tratt _tokens.scss', () => {
    const styles = resolve(__dirname, '../../../../../apps/tratt/src/styles');
    const palette = readFileSync(`${styles}/_palette.scss`, 'utf8');
    const tokens = readFileSync(`${styles}/_tokens.scss`, 'utf8');
    const light = tokens.slice(0, tokens.indexOf("[data-bs-theme='dark']"));

    const paletteVar = (name: string) =>
      new RegExp(`\\$${name.replace('$', '')}:\\s*([^;\\s]+)`).exec(
        palette,
      )?.[1];
    const resolveValue = (raw: string): string | undefined => {
      const pal = /^#\{p\.(\$[\w-]+)\}$/.exec(raw);
      if (pal) return paletteVar(pal[1]);
      const ref = /^var\((--[\w-]+)\)$/.exec(raw);
      if (ref) return tokenValue(ref[1]);
      return raw;
    };
    const tokenValue = (cssVar: string): string | undefined => {
      const m = new RegExp(`${cssVar}:\\s*([^;]+);`).exec(light);
      return m ? resolveValue(m[1].trim()) : undefined;
    };
    const norm = (v: string) => v.toLowerCase().replace(/\s+/g, '');

    const pairs: [keyof typeof TRATT_COLORS, string][] = [
      ['surfaceBackground', '--tratt-waveform-background'],
      ['waveformSignal', '--tratt-waveform-signal'],
      ['segmentTranscribed', '--tratt-segment-transcribed'],
      ['segmentSelected', '--tratt-segment-selected'],
      ['boundary', '--tratt-boundary'],
      ['playhead', '--tratt-playhead'],
      ['border', '--tratt-border'],
      ['grid', '--tratt-canvas-grid'],
      ['textPrimary', '--tratt-canvas-text'],
      ['textMuted', '--tratt-text-muted'],
      ['interactive', '--tratt-interactive'],
    ];
    for (const [key, cssVar] of pairs) {
      const token = tokenValue(cssVar);
      expect(token).toBeDefined();
      expect(norm(TRATT_COLORS[key])).toBe(norm(token as string));
    }
  });
});

describe('resolveTrattColors', () => {
  afterEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('falls back to TRATT_COLORS when CSS variables are undefined', () => {
    const c = resolveTrattColors(document.createElement('div'));
    expect(c.playhead).toBe(TRATT_COLORS.playhead);
    expect(c.surfaceBackground).toBe(TRATT_COLORS.surfaceBackground);
  });

  it('prefers CSS custom properties', () => {
    document.documentElement.style.setProperty('--tratt-playhead', ' #123456 ');
    expect(resolveTrattColors().playhead).toBe('#123456');
  });
});

describe('observeTheme', () => {
  it('calls back on data-bs-theme change and stops after unsubscribe', async () => {
    const cb = vi.fn();
    const stop = observeTheme(cb);
    document.documentElement.setAttribute('data-bs-theme', 'dark');
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
    document.documentElement.setAttribute('data-bs-theme', 'light');
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    document.documentElement.removeAttribute('data-bs-theme');
  });
});

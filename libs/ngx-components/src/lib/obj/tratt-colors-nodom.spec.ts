import { resolveTrattColors, TRATT_COLORS, observeTheme } from './tratt-colors';

// Runs in the default (node) vitest environment: no document, no getComputedStyle.
describe('tratt-colors without a DOM', () => {
  it('resolveTrattColors returns the TRATT_COLORS fallbacks', () => {
    expect(typeof document).toBe('undefined');
    const c = resolveTrattColors();
    expect(c.playhead).toBe(TRATT_COLORS.playhead);
    expect(c.surfaceBackground).toBe(TRATT_COLORS.surfaceBackground);
  });

  it('observeTheme is a no-op', () => {
    expect(() => observeTheme(() => undefined)()).not.toThrow();
  });
});

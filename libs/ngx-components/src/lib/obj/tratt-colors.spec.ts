import { TRATT_COLORS, TRATT_FONTS } from './tratt-colors';

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
});

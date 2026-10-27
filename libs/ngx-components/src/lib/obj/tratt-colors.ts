/**
 * Canvas colours for the signal displays (Språkbanken profile).
 *
 * <canvas> cannot read CSS custom properties directly, so these mirror the
 * literal canvas tokens in apps/tratt/src/styles/_tokens.scss. At runtime
 * `resolveTrattColors()` (task 23) prefers the CSS values, so the two only
 * have to agree for the library's standalone fallback.
 */
export const TRATT_COLORS = {
  surfaceBackground: '#FFFFFF',
  surfacePage: '#FFFFFF',
  border: '#D9D9D9',
  grid: '#D9D9D9',
  textPrimary: '#1A1A1A',
  textMuted: '#595959',
  /** Interactive elements (scroll selector, sliders). Brand blue. */
  interactive: '#1E989F',
  /** The audio signal itself. Neutral grey: data, not interaction. */
  waveformSignal: '#595959',
  segmentTranscribed: 'rgba(0, 0, 0, 0.05)',
  segmentSelected: 'rgba(30, 152, 159, 0.14)',
  /** Segment boundaries are draggable, hence interactive blue. */
  boundary: '#1E989F',
  /** Playhead: a graphic element, hence brand orange (red is for errors). */
  playhead: '#F0581A',
  accentSuccess: '#5AA018',
  accentWarning: '#F6C200',
  accentError: '#D42225',
  /** @deprecated Use `interactive`. */
  chrome: '#187A7F',
  /** @deprecated Use `interactive`. */
  chromeHover: '#187A7F',
  /** @deprecated Use `playhead` or `accentSuccess`. */
  cta: '#C04615',
  /** @deprecated Use `accentSuccess`. */
  accentGreen: '#5AA018',
  /** @deprecated */
  accentGreenDark: '#488013',
} as const;

export const TRATT_FONTS = {
  data: '"Noto Sans", Arial, sans-serif',
} as const;

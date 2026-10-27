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

type CanvasKey =
  | 'surfaceBackground'
  | 'waveformSignal'
  | 'segmentTranscribed'
  | 'segmentSelected'
  | 'boundary'
  | 'playhead'
  | 'border'
  | 'grid'
  | 'textPrimary'
  | 'textMuted'
  | 'interactive';

const CSS_VARS: Record<CanvasKey, string> = {
  surfaceBackground: '--tratt-waveform-background',
  waveformSignal: '--tratt-waveform-signal',
  segmentTranscribed: '--tratt-segment-transcribed',
  segmentSelected: '--tratt-segment-selected',
  boundary: '--tratt-boundary',
  playhead: '--tratt-playhead',
  border: '--tratt-border',
  grid: '--tratt-canvas-grid',
  textPrimary: '--tratt-canvas-text',
  textMuted: '--tratt-text-muted',
  interactive: '--tratt-interactive',
};

export type TrattCanvasColors = Record<CanvasKey, string>;

/**
 * Current canvas colours: CSS custom properties win, TRATT_COLORS is the
 * fallback (no DOM, or the app's stylesheet is not loaded).
 */
export function resolveTrattColors(el?: Element | null): TrattCanvasColors {
  const target =
    el ?? (typeof document !== 'undefined' ? document.documentElement : null);
  const cs =
    target && typeof getComputedStyle === 'function'
      ? getComputedStyle(target)
      : null;
  const out = {} as TrattCanvasColors;
  for (const key of Object.keys(CSS_VARS) as CanvasKey[]) {
    out[key] = cs?.getPropertyValue(CSS_VARS[key]).trim() || TRATT_COLORS[key];
  }
  return out;
}

/** Calls `cb` whenever <html data-bs-theme> changes. Returns an unsubscribe. */
export function observeTheme(cb: () => void): () => void {
  if (
    typeof MutationObserver === 'undefined' ||
    typeof document === 'undefined'
  ) {
    return () => undefined;
  }
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bs-theme'],
  });
  return () => mo.disconnect();
}

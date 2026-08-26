/**
 * Canvas colours for the signal displays.
 *
 * The audio viewer paints to a `<canvas>`, which cannot read the CSS custom
 * properties in apps/tratt/src/styles.scss — so the tokens are mirrored here.
 * Keep the two files in sync.
 */
export const TRATT_COLORS = {
  /** Waveform canvas and panel backgrounds. VISP $white. */
  surfaceBackground: '#FFFFFF',
  /** Page canvas behind the editors. VISP $tertiary-light. */
  surfacePage: '#EEF0F4',
  /** Structural chrome: toolbars, scrollbar selector. UMU "Blå". */
  chrome: '#2A4765',
  /** VISP $primary-light. */
  chromeHover: '#3C6289',
  /** Primary action. VISP $secondary. */
  cta: '#D47752',
  /** VISP $dark-font-color. */
  textPrimary: '#1F3044',
  /** Hairlines and frames. VISP $border-light. */
  border: '#D4D9E0',

  /** The audio signal itself. */
  waveformSignal: 'rgba(42, 71, 101, 0.8)',
  /** Fill marking a segment that already has a transcript. */
  segmentTranscribed: 'rgba(60, 98, 137, 0.15)',
  /** Playhead / cursor. VISP $crimson. */
  playhead: '#D7263D',

  /** Status. Green is status-only now, not chrome. UMU "Barrskog". */
  accentSuccess: '#3D6B5C',
  /** UMU "Guld". */
  accentWarning: '#D7B17C',
  /** VISP $crimson. */
  accentError: '#D7263D',

  /**
   * @deprecated Green is no longer structural. Use `chrome` for toolbars and
   * `accentSuccess` for status.
   */
  accentGreen: '#2A4765',
  /** @deprecated Use `chromeHover`. */
  accentGreenDark: '#3C6289',

  /** ASR queue item blocked-by-ASR overlay fill (canvas segment progress bar). */
  asrBlockedFill: 'rgba(255,191,0,0.5)',
  /** ASR queue item blocked-by-ASR progress bar fill. */
  asrBlockedProgress: 'rgba(221,167,14,0.8)',
  /** ASR queue item blocked-by-ASR+MAUS overlay fill. */
  asrMausBlockedFill: 'rgba(179,10,179,0.5)',
  /** ASR queue item blocked-by-ASR+MAUS progress bar fill. */
  asrMausBlockedProgress: 'rgba(179,10,179,0.8)',
  /** ASR queue item blocked-by-MAUS overlay fill. */
  mausBlockedFill: 'rgba(26,229,160,0.5)',
  /** ASR queue item blocked-by-MAUS progress bar fill. */
  mausBlockedProgress: 'rgba(17,176,122,0.8)',
} as const;

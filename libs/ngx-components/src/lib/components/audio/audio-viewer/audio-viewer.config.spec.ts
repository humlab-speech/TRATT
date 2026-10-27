import '@angular/compiler';
import { TrattCanvasColors } from '../../../obj/tratt-colors';
import { applyThemeColors, AudioviewerConfig } from './audio-viewer.config';

describe('applyThemeColors', () => {
  it('writes every colour field of the config', () => {
    const c = {
      surfaceBackground: 'x',
      waveformSignal: 'x',
      segmentTranscribed: 'x',
      segmentSelected: 'x',
      boundary: 'x',
      playhead: 'x',
      border: 'x',
      grid: 'x',
      textPrimary: 'x',
      textMuted: 'x',
      interactive: 'x',
    } as TrattCanvasColors;
    const s = new AudioviewerConfig();
    applyThemeColors(s, c);
    expect(s.backgroundcolor).toBe('x');
    expect(s.cursor.color).toBe('x');
    expect(s.playcursor.color).toBe('x');
    expect(s.scrollbar.background.color).toBe('x');
    expect(s.scrollbar.background.stroke).toBe('x');
    expect(s.scrollbar.selector.color).toBe('x');
    expect(s.scrollbar.selector.stroke).toBe('x');
    expect(s.boundaries.color).toBe('x');
    expect(s.grid.color).toBe('x');
    expect(s.data.color).toBe('x');
    expect(s.selection.color).toBe('x');
    expect(s.frame.color).toBe('x');
    expect(s.timeline.foreColor).toBe('x');
  });
});

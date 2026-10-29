import { ShortcutGroup } from '@tratt/web-media';
import {
  TRATT_COLORS,
  TRATT_FONTS,
  TrattCanvasColors,
} from '../../../obj';

/** Writes theme colours into a viewer config in place (the renderer shares the reference). */
export function applyThemeColors(
  s: AudioviewerConfig,
  c: TrattCanvasColors,
): void {
  s.backgroundcolor = c.surfaceBackground;
  s.cursor.color = c.playhead;
  s.playcursor.color = c.playhead;
  s.scrollbar.background.color = c.surfaceBackground;
  s.scrollbar.background.stroke = c.border;
  s.scrollbar.selector.color = c.interactive;
  s.scrollbar.selector.stroke = c.border;
  s.boundaries.color = c.boundary;
  s.grid.color = c.grid;
  s.data.color = c.waveformSignal;
  s.selection.color = c.segmentSelected;
  s.frame.color = c.border;
  s.timeline.foreColor = c.textPrimary;
}

export class AudioviewerConfig {
  public multiLine = false;
  public pixelPerSec = 50; // only relevant for multiline
  public justifySignalHeight = true;
  public cropping = 'none';
  public lineheight = 60;
  public backgroundcolor: string = TRATT_COLORS.surfaceBackground;
  public margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  } = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  public cursor: {
    color: string;
    fixed: boolean;
  } = {
    fixed: false,
    color: TRATT_COLORS.playhead,
  };

  public scrollbar: {
    enabled: boolean;
    width: number;
    background: { color: string; stroke: string; strokeWidth: number };
    selector: {
      color: string;
      stroke: string;
      strokeWidth: number;
      width: number;
    };
  } = {
    enabled: false,
    width: 20,
    background: {
      color: TRATT_COLORS.surfaceBackground,
      stroke: TRATT_COLORS.border,
      strokeWidth: 1,
    },
    selector: {
      color: TRATT_COLORS.interactive,
      stroke: TRATT_COLORS.border,
      strokeWidth: 1,
      width: 20,
    },
  };

  public playcursor: {
    height: number;
    width: number;
    color: string;
  } = {
    height: 20,
    width: 10,
    color: TRATT_COLORS.playhead,
  };
  public boundaries: {
    enabled: boolean;
    readonly: boolean;
    width: number;
    color: string;
  } = {
    enabled: true,
    readonly: false,
    width: 3,
    color: TRATT_COLORS.boundary,
  };
  public grid: {
    enabled: true;
    color: string;
  } = {
    enabled: true,
    color: TRATT_COLORS.grid,
  };

  public data: {
    color: string;
  } = {
    color: TRATT_COLORS.waveformSignal,
  };

  public selection: {
    enabled: boolean;
    color: string;
  } = {
    enabled: true,
    color: TRATT_COLORS.segmentSelected,
  };
  public frame: {
    color: string;
  } = {
    color: TRATT_COLORS.border,
  };

  // SHORTCUTS
  // SHORTCUTS sheme= KeyMapping [+ <char or charCode>]
  public shortcutsEnabled = true;
  public shortcuts: ShortcutGroup = {
    name: 'audioviewer',
    enabled: true,
    items: [
      {
        name: 'undo',
        keys: {
          mac: 'CMD + Z',
          pc: 'CTRL + Z',
        },
        focusonly: true,
        title: 'undo',
      },
      {
        name: 'redo',
        keys: {
          mac: 'SHIFT + CMD + Z',
          pc: 'CTRL + Y',
        },
        focusonly: true,
        title: 'redo',
      },
      {
        name: 'set_boundary',
        keys: {
          mac: 'S',
          pc: 'S',
        },
        focusonly: true,
        title: 'set segment',
      },
      {
        name: 'set_break',
        keys: {
          mac: 'A',
          pc: 'A',
        },
        focusonly: true,
        title: 'set break',
      },
      {
        name: 'play_selection',
        keys: {
          mac: 'C',
          pc: 'C',
        },
        focusonly: true,
        title: 'play selection',
      },
      {
        name: 'segment_enter',
        keys: {
          mac: 'ENTER',
          pc: 'ENTER',
        },
        focusonly: true,
        title: 'transcribe segment',
      },
      {
        name: 'cursor_left',
        keys: {
          mac: 'ARROWLEFT',
          pc: 'ARROWLEFT',
        },
        focusonly: true,
        title: 'move cursor left',
      },
      {
        name: 'cursor_right',
        keys: {
          mac: 'ARROWRIGHT',
          pc: 'ARROWRIGHT',
        },
        focusonly: true,
        title: 'move cursor right',
      },
      {
        name: 'playonhover',
        keys: {
          mac: 'H',
          pc: 'H',
        },
        focusonly: true,
        title: 'play audio on hover',
      },
      {
        name: 'delete_boundaries',
        keys: {
          mac: 'D',
          pc: 'D',
        },
        focusonly: true,
        title: 'delete boundaries',
      },
    ],
  };

  public disabledKeys = ['SHIFT + SPACE'];
  public timeline: {
    enabled: boolean;
    height: number;
    fontSize: number;
    fontWeight: string;
    font: string;
    foreColor: string;
  } = {
    enabled: false,
    height: 15,
    fontSize: 9,
    fontWeight: 'light',
    font: TRATT_FONTS.data,
    foreColor: TRATT_COLORS.textPrimary,
  };

  public stepWidthRatio = 0.0226;
  public type: string | undefined;
  public roundValues = true;

  public showTimePerLine = false;
  public showTranscripts = false;
  public showProgressBars = false;

  speakerPattern?: string;
}

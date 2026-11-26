import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioViewerService } from './audio-viewer.service';

const DARK: Record<string, string> = {
  '--tratt-waveform-background': '#121212',
  '--tratt-canvas-grid': '#333333',
};

describe('AudioViewerService.initialize', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('themes the default settings before the stage is built', () => {
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => DARK[name] ?? '',
    }));
    let atStageBuild: string[] = [];
    const canvasRenderer: any = {
      renderer: {},
      initialize: () => {
        atStageBuild = [
          service.settings.backgroundcolor,
          service.settings.grid.color,
        ];
      },
    };
    const interaction: any = {
      initialize: () => undefined,
      shortcutsManager: {
        clearShortcuts: () => undefined,
        registerShortcutGroup: () => undefined,
      },
      renderRequest: { subscribe: () => ({ unsubscribe: () => undefined }) },
    };
    const service = new AudioViewerService(
      {} as any,
      {} as any,
      {} as any,
      canvasRenderer,
      interaction,
    );
    const container: any = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };

    service.initialize(100, 100, container, {} as any);

    expect(atStageBuild).toEqual(['#121212', '#333333']);
  });
});

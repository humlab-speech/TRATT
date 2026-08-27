import { describe, expect, it } from 'vitest';
import {
  AudioViewerLineSettings,
  AudioViewerTimeUtils,
} from './audio-viewer-time-utils';

// Not importing AudioviewerConfig here on purpose: its module chain pulls
// in ng-bootstrap via the `obj` barrel, which fails to load in vitest's
// node test environment (no Angular JIT compiler present). A plain object
// satisfying AudioViewerLineSettings exercises the same code paths.
function makeSettings(
  overrides: Partial<AudioViewerLineSettings> = {},
): AudioViewerLineSettings {
  return {
    lineheight: 60,
    margin: { left: 0, top: 0 },
    playcursor: { width: 10 },
    ...overrides,
  };
}

describe('AudioViewerTimeUtils', () => {
  describe('getPixelPerSecond', () => {
    it('divides innerWidth by secondsPerLine when no audioChunk is given', () => {
      const utils = new AudioViewerTimeUtils();

      const result = utils.getPixelPerSecond(10, 500, undefined);

      expect(result).toBe(50);
    });

    it('divides innerWidth by the chunk duration instead, when the chunk is shorter than secondsPerLine', () => {
      const utils = new AudioViewerTimeUtils();
      const audioChunk = {
        time: { duration: { seconds: 1 } },
      } as any;

      const result = utils.getPixelPerSecond(10, 500, audioChunk);

      expect(result).toBe(500);
    });
  });

  describe('computeDisplayData', () => {
    it('computes min/max pairs per pixel column from the raw signal', async () => {
      // Hand-traced from the pre-move formula in audio-viewer.service.ts:
      // width=4, height=2 => yZoom = height/2 = 1
      // xZoom=1, interval {start:0, end:4} => len=4
      // i=0: offset=0, channel[0]=0    => min=max=0    => push 0,0
      // i=1: offset=1, channel[1]=0.5  => min=max=0.5  => push 0.5,0.5
      // i=2: offset=2, channel[2]=-0.5 => min=max=-0.5 => push -0.5,-0.5
      // i=3: offset=3, channel[3]=1    => min=max=1    => push 1,1
      const utils = new AudioViewerTimeUtils();
      const channel = new Float32Array([0, 0.5, -0.5, 1]);

      const result = await utils.computeDisplayData(
        4,
        2,
        channel,
        { start: 0, end: 4 },
        false,
        1,
      );

      expect(result).toEqual([0, 0, 0.5, 0.5, -0.5, -0.5, 1, 1]);
    });

    it('rejects when interval.end is less than interval.start', async () => {
      const utils = new AudioViewerTimeUtils();

      await expect(
        utils.computeDisplayData(
          4,
          2,
          new Float32Array([0, 0.5, -0.5, 1]),
          { start: 4, end: 0 },
          false,
          1,
        ),
      ).rejects.toBe('interval.end is less than interval.start');
    });
  });

  describe('calculateZoom', () => {
    it('grows zoomX/zoomY to fit the signal when justifySignalHeight is on and there is room to grow', () => {
      // Hand-traced from the pre-move formula:
      // height=50, audioPxWidth=3, minmaxarray=[2,-3,4,1] (no NaN, loop runs i=0..3)
      //   maxZoomY ends at 4, maxZoomYMin ends at -3, maxZoomX ends at 3
      // timeLineHeight = 0 (timeline disabled)
      // rest = 50 - 0 - (4 + abs(-3)) = 50 - 7 = 43; floor(43-2) = 41 (>0)
      // zoomY = 41/7 + 1 = 6.857142857142857 -> floor(*10)/10 = 6.8
      // zoomX = width/maxZoomX = 90/3 = 30
      const utils = new AudioViewerTimeUtils();

      const result = utils.calculateZoom(
        50,
        90,
        [2, -3, 4, 1],
        3,
        true,
        false,
        0,
        1,
        1,
      );

      expect(result.zoomX).toBe(30);
      expect(result.zoomY).toBeCloseTo(6.8, 10);
    });

    it('leaves zoomX untouched and forces zoomY to 1 when justifySignalHeight is off', () => {
      const utils = new AudioViewerTimeUtils();

      const result = utils.calculateZoom(
        50,
        90,
        [2, -3, 4, 1],
        3,
        false,
        false,
        0,
        5,
        2,
      );

      expect(result).toEqual({ zoomX: 5, zoomY: 1 });
    });
  });

  describe('getLineNumber', () => {
    it('returns the line index whose [locY, locMaxY] band contains y', () => {
      // Hand-traced: innerWidth=100, audioPxWidth=250 => numOfLines = ceil(250/100) = 3
      // settings.lineheight=60, settings.margin.top=10 => band height = 70
      // line0: [0,60]  line1: [70,130]  line2: [140,200]
      // y=85 falls in line1's band [70,130]
      const utils = new AudioViewerTimeUtils();
      const settings = makeSettings({
        lineheight: 60,
        margin: { left: 0, top: 10 },
      });

      const result = utils.getLineNumber(999, 85, 100, 250, settings);

      expect(result).toBe(1);
    });

    it('returns -1 when y falls outside every line band', () => {
      const utils = new AudioViewerTimeUtils();
      const settings = makeSettings({
        lineheight: 60,
        margin: { left: 0, top: 10 },
      });

      const result = utils.getLineNumber(999, 250, 100, 250, settings);

      expect(result).toBe(-1);
    });
  });

  describe('getNumberOfLines', () => {
    it('ceils audioPxWidth / innerWidth', () => {
      const utils = new AudioViewerTimeUtils();

      expect(utils.getNumberOfLines(100, 250)).toBe(3);
    });

    it('returns -1 when innerWidth is undefined', () => {
      const utils = new AudioViewerTimeUtils();

      expect(utils.getNumberOfLines(undefined, 250)).toBe(-1);
    });
  });
});

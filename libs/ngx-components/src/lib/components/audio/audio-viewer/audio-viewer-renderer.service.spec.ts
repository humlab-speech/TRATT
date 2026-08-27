// @vitest-environment jsdom
//
// This spec needs a real `document` to create a container element for
// `initialize`/`initializeStageContainer` (Konva's Stage constructor calls
// container.tabIndex etc.). The rest of the ngx-components suite runs in
// vitest's default 'node' environment (see vite.config.ts) — this
// docblock comment overrides the environment for just this file.
import { describe, expect, it } from 'vitest';
import { AudioViewerRendererService } from './audio-viewer-renderer.service';

// jsdom doesn't implement canvas 2D contexts without the native `canvas`
// npm package (not a dependency of this workspace) — Konva's Stage still
// needs `getContext('2d')` to return *something* to construct its
// internal SceneCanvas/HitCanvas. A Proxy that turns any method call into
// a no-op and any property read/write into a plain value is enough for
// Konva to build the Stage without throwing; it never needs to actually
// render pixels for this smoke test.
function makeFakeContext2d(): any {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get(target, prop) {
      if (prop === 'measureText') {
        return () => ({ width: 0 });
      }
      if (prop in target) {
        return target[prop as string];
      }
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => makeFakeContext2d()) as any;
}

const noopHandlers = {
  onKeyDown: () => undefined,
  onKeyUp: () => undefined,
  onMouseEnter: () => undefined,
  onMouseLeave: () => undefined,
};
const noopOnWheel = () => undefined;

describe('AudioViewerRendererService', () => {
  it('constructs without throwing', () => {
    expect(() => new AudioViewerRendererService()).not.toThrow();
  });

  it('initializes a Konva stage without throwing given a container element', () => {
    const service = new AudioViewerRendererService();
    const container = document.createElement('div');

    expect(() =>
      service.initialize(
        500,
        200,
        container,
        undefined,
        noopHandlers,
        noopOnWheel,
      ),
    ).not.toThrow();

    expect(service.stage).toBeDefined();
    expect(service.layers).toBeDefined();
  });

  it('initializeStageContainer does not throw before a stage exists', () => {
    const service = new AudioViewerRendererService();
    expect(() => service.initializeStageContainer(noopHandlers)).not.toThrow();
  });

  it('initializeStageContainer does not throw once a stage exists', () => {
    const service = new AudioViewerRendererService();
    const container = document.createElement('div');
    service.initialize(
      500,
      200,
      container,
      undefined,
      noopHandlers,
      noopOnWheel,
    );

    expect(() => service.initializeStageContainer(noopHandlers)).not.toThrow();
  });

  it('redraw/redrawOverlay do not throw before initialize() has run', () => {
    const service = new AudioViewerRendererService();
    expect(() => service.redraw()).not.toThrow();
    expect(() => service.redrawOverlay()).not.toThrow();
  });

  describe('isVisibleInView', () => {
    it('returns false when no viewport has been established yet', () => {
      const service = new AudioViewerRendererService();
      expect(service.isVisibleInView(0, 0, 10, 10)).toBe(false);
    });

    it('returns true for a rect that overlaps the viewport', () => {
      const service = new AudioViewerRendererService();
      service.viewport = { x: 0, y: 0, width: 100, height: 100 };
      expect(service.isVisibleInView(0, 0, 10, 10)).toBe(true);
    });

    it('returns false for a rect entirely outside the viewport', () => {
      const service = new AudioViewerRendererService();
      service.viewport = { x: 0, y: 0, width: 100, height: 100 };
      expect(service.isVisibleInView(1000, 1000, 10, 10)).toBe(false);
    });
  });

  // ---- pure decomposed helpers (drawTextLabel's crop math) -----------
  // These are private, but the underlying algorithm is pure text-width
  // math and worth pinning down directly rather than only indirectly via
  // Konva drawing calls, per the task brief. Accessed via `as any` since
  // they're intentionally not part of the public API.

  describe('cropSingleLineLabel (pure text crop math)', () => {
    it('returns the text unchanged when it already fits', () => {
      const service = new AudioViewerRendererService();
      const measure = (s: string) => s.length * 6;

      const result = (service as any).cropSingleLineLabel(
        'short',
        100,
        measure,
      );

      expect(result.text).toBe('short');
      expect(result.textLength).toBe(30);
    });

    it('crops from the middle and inserts an ellipsis when the text overflows', () => {
      const service = new AudioViewerRendererService();
      const measure = (s: string) => s.length * 6;

      const result = (service as any).cropSingleLineLabel(
        'this is a very long transcript that will not fit',
        60,
        measure,
      );

      expect(result.text).toContain('...');
      expect(result.text.length).toBeLessThan(
        'this is a very long transcript that will not fit'.length,
      );
    });
  });

  describe('shrinkTextToWidth (pure text crop math)', () => {
    it('leaves text untouched when it already fits maxWidth', () => {
      const service = new AudioViewerRendererService();
      const measure = (s: string) => s.length * 5;

      const result = (service as any).shrinkTextToWidth(
        'fits',
        100,
        measure,
        2,
      );

      expect(result.text).toBe('fits');
      expect(result.textLength).toBe(20);
    });

    it('shrinks text and returns the pre-shrink measured width', () => {
      const service = new AudioViewerRendererService();
      const measure = (s: string) => s.length * 10;

      const result = (service as any).shrinkTextToWidth(
        'a much too long piece of text',
        50,
        measure,
        2,
      );

      expect(result.text.length).toBeLessThan(
        'a much too long piece of text'.length,
      );
      // pre-shrink width is what's returned, per the original method's
      // (preserved) quirk of positioning text using the pre-shrink width
      expect(result.textLength).toBe(
        'a much too long piece of text'.length * 10,
      );
    });
  });

  describe('computeProgressBarLayout (pure geometry math)', () => {
    it('computes progress bar geometry from segment width and progress percentage', () => {
      const service = new AudioViewerRendererService();

      const result = (service as any).computeProgressBarLayout({
        x: 0,
        w: 200,
        lineWidth: 200,
        timestampWidth: 20,
        selectStart: 0,
        progress: 50,
      });

      // w === lineWidth => timeStampsWidth = timestampWidth * 2
      expect(result.timeStampsWidth).toBe(40);
      expect(result.progressWidth).toBe(200 - 40 - 20);
      expect(result.progressStart).toBe(0 + 10 + 20);
      expect(result.loadedPixels).toBe(Math.round((200 - 40 - 20) * 0.5));
    });

    it('omits the double timestamp width when the bar does not span the whole line', () => {
      const service = new AudioViewerRendererService();

      const result = (service as any).computeProgressBarLayout({
        x: 5,
        w: 100,
        lineWidth: 200,
        timestampWidth: 20,
        selectStart: 5,
        progress: 0,
      });

      expect(result.timeStampsWidth).toBe(0);
      expect(result.loadedPixels).toBe(0);
    });
  });

  // Regression guard for the "frozen currentLevel" class of bug: the Konva
  // `sceneFunc` closures these builders create outlive the call that built
  // them, while `TrattAnnotation.clone()` replaces the level object on every
  // `@Input() set annotation` write and `applyChanges` only rebuilds the
  // shapes immediately around a change. If a builder captured the level
  // *value* instead of the `getCurrentLevel` accessor, surviving shapes
  // would redraw forever against stale segment data.
  describe('scene-function closures read the level live', () => {
    const makeLevel = (marker: string) =>
      ({ marker, items: [{ id: 1, type: 'segment' }] }) as any;

    it('buildOverlayShape re-reads getCurrentLevel on every redraw', () => {
      const service = new AudioViewerRendererService();
      const seen: any[] = [];
      (service as any).sceneFuncOverlay = (
        _c: any,
        _s: any,
        _seg: any,
        _n: any,
        _si: any,
        _li: any,
        level: any,
      ) => seen.push(level);

      let level = makeLevel('first');
      const shape = (service as any).buildOverlayShape({
        segment: level.items[0],
        lineNum1: 0,
        lineNum2: 0,
        segmentHeight: 10,
        numOfLines: 1,
        segmentInterval: { start: 0, end: 0 },
        getCurrentLevel: () => level,
      });

      shape.sceneFunc()({} as any, shape);
      // the annotation input is rewritten -> whole level replaced by a clone
      level = makeLevel('second');
      shape.sceneFunc()({} as any, shape);

      expect(seen.map((l) => l.marker)).toEqual(['first', 'second']);
    });

    it('buildTranscriptBackgroundShape re-reads getCurrentLevel on every redraw', () => {
      const service = new AudioViewerRendererService();
      const seen: any[] = [];
      (service as any).sceneFuncTranscripts = (
        _c: any,
        _s: any,
        _si: any,
        _seg: any,
        _li: any,
        _n: any,
        level: any,
      ) => seen.push(level);

      let level = makeLevel('first');
      const shape = (service as any).buildTranscriptBackgroundShape({
        segment: level.items[0],
        lineNum1: 0,
        lineNum2: 0,
        segmentHeight: 10,
        numOfLines: 1,
        segmentInterval: { start: 0, end: 0 },
        getCurrentLevel: () => level,
      });

      shape.sceneFunc()({} as any, shape);
      level = makeLevel('second');
      shape.sceneFunc()({} as any, shape);

      expect(seen.map((l) => l.marker)).toEqual(['first', 'second']);
    });

    it('buildSegmentTextShape re-reads getCurrentLevel on every redraw', () => {
      const service = new AudioViewerRendererService();
      const seenTimes: any[] = [];
      // `audioManager` is a getter derived from `audioChunk` — stub it on
      // the instance rather than assigning through the (read-only) getter.
      Object.defineProperty(service, 'audioManager', {
        value: { createSampleUnit: () => ({ samples: 0 }) },
      });
      (service as any).drawTextLabel = (
        _ctx: any,
        text: string,
      ): number | undefined => {
        seenTimes.push(text);
        return 0;
      };

      const makeTextLevel = (label: string) =>
        ({
          items: [
            {
              id: 1,
              type: 'segment',
              time: { clone: () => ({ samples: 0 }) },
              getFirstLabelWithoutName: () => ({ value: label }),
            },
          ],
        }) as any;

      let level = makeTextLevel('first');
      const shape = (service as any).buildSegmentTextShape({
        segment: level.items[0],
        segmentInterval: { start: 0, end: 0 },
        beginX: 0,
        absX: 0,
        numOfLines: 1,
        getCurrentLevel: () => level,
        lastIRef: { value: 0 },
      });

      shape.sceneFunc()({} as any, shape);
      level = makeTextLevel('second');
      shape.sceneFunc()({} as any, shape);

      expect(seenTimes).toEqual(['first', 'second']);
    });
  });
});

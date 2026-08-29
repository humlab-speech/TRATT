import { EventEmitter } from '@angular/core';
import {
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { AudioSelection, SampleUnit } from '@tratt/media';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioViewerInteractionHost,
  AudioViewerInteractionService,
  AudioViewerInteractionSettings,
  AudioViewerRenderRequest,
} from './audio-viewer-interaction.service';

const SAMPLE_RATE = 16000;

function time(samples: number): SampleUnit {
  return new SampleUnit(samples, SAMPLE_RATE);
}

function segment(
  id: number,
  samples: number,
  value = '',
): TrattAnnotationSegment {
  return new TrattAnnotationSegment(id, time(samples), [
    new OLabel('OrthoTranscript', value),
  ]);
}

function annotationWith(items: TrattAnnotationSegment[]) {
  const annotation = new TrattAnnotation<any, TrattAnnotationSegment>([
    new TrattAnnotationSegmentLevel<TrattAnnotationSegment>(
      1,
      'OrthoTranscript',
      items,
    ),
  ]);
  annotation.changeCurrentLevelIndex(0);
  return annotation;
}

function defaultSettings(): AudioViewerInteractionSettings {
  return {
    shortcutsEnabled: true,
    shortcuts: { name: 'audioviewer', enabled: true, items: [] } as any,
    disabledKeys: ['SHIFT + SPACE'],
    multiLine: false,
    lineheight: 60,
    stepWidthRatio: 0.0226,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    boundaries: { enabled: true, readonly: false, width: 3 },
    selection: { enabled: true },
    cursor: { fixed: false },
  };
}

/**
 * A fully synthetic host. Everything the service reads is behind a getter
 * *method* here too, so mutating `state` between calls is observed live —
 * which is exactly what the production wiring does and what the
 * regression tests below rely on.
 */
interface TestHarness {
  service: AudioViewerInteractionService;
  host: AudioViewerInteractionHost;
  state: {
    settings: AudioViewerInteractionSettings;
    annotation?: TrattAnnotation<any, TrattAnnotationSegment>;
    tempAnnotation?: TrattAnnotation<any, TrattAnnotationSegment>;
    drawnSelection?: AudioSelection;
    innerWidth: number;
    audioPxWidth: number;
    silencePlaceholder?: string;
    refreshOnInternChanges: boolean;
    isPlaying: boolean;
  };
  canvasState: Record<string, any>;
  renderRequests: AudioViewerRenderRequest[];
  emitted: {
    shortcut: any[];
    alert: any[];
    segmententer: any[];
    selchange: any[];
    mousecursorchange: any[];
    currentLevelChange: any[];
    annotationChange: any[];
  };
  audioChunk: any;
  playCursor: any;
  spies: {
    addOrRemoveSegment: ReturnType<typeof vi.fn>;
    getSegmentSelection: ReturnType<typeof vi.fn>;
    changeSegment: ReturnType<typeof vi.fn>;
    removeSegmentByIndex: ReturnType<typeof vi.fn>;
    selectSegment: ReturnType<typeof vi.fn>;
    changePlayCursorSamples: ReturnType<typeof vi.fn>;
    playSelection: ReturnType<typeof vi.fn>;
    afterAudioEnded: ReturnType<typeof vi.fn>;
    getLineNumber: ReturnType<typeof vi.fn>;
  };
}

function makeHarness(
  overrides: Partial<TestHarness['state']> = {},
): TestHarness {
  const state: TestHarness['state'] = {
    settings: defaultSettings(),
    annotation: undefined,
    tempAnnotation: undefined,
    drawnSelection: undefined,
    innerWidth: 1000,
    audioPxWidth: 1000,
    silencePlaceholder: '<P>',
    refreshOnInternChanges: false,
    isPlaying: false,
    ...overrides,
  };

  const canvasState: Record<string, any> = {
    hasStage: true,
    hasLayers: true,
    hasCanvasElements: true,
    hasMouseCaret: true,
    hasScrollBar: true,
    hasScrollbarSelector: true,
    hasLastLine: true,
    stageHeight: 500,
    scrollBarHeight: 400,
    scrollBarX: 980,
    scrollbarSelectorY: 100,
    scrollbarSelectorHeight: 50,
    lastLineY: 900,
    lastLineHeight: 100,
    backgroundLayerY: 0,
  };

  const audioChunk: any = {
    startpos: time(0),
    selection: new AudioSelection(time(0), time(0)),
    absolutePlayposition: time(0),
    time: new AudioSelection(time(0), time(160000)),
    get isPlaying() {
      return state.isPlaying;
    },
    stopPlayback: vi.fn().mockResolvedValue(undefined),
  };

  const playCursor: any = { changeSamples: vi.fn() };

  const audioManager: any = {
    get isPlaying() {
      return state.isPlaying;
    },
    state: 'stopped',
    sampleRate: SAMPLE_RATE,
    createSampleUnit: (samples: number) => time(samples),
  };

  // 1px == 160 samples, so absX 100 -> 16000 samples.
  const audioTCalculator: any = {
    absXChunktoSampleUnit: (absX: number) => time(absX * 160),
    samplestoAbsX: (unit: SampleUnit) => unit.samples / 160,
  };

  const renderRequests: AudioViewerRenderRequest[] = [];
  const emitted: TestHarness['emitted'] = {
    shortcut: [],
    alert: [],
    segmententer: [],
    selchange: [],
    mousecursorchange: [],
    currentLevelChange: [],
    annotationChange: [],
  };

  function recorder<T>(bucket: any[]): EventEmitter<T> {
    const emitter = new EventEmitter<T>();
    emitter.subscribe((value: T) => bucket.push(value));
    return emitter;
  }

  const spies: TestHarness['spies'] = {
    addOrRemoveSegment: vi.fn().mockReturnValue(undefined),
    getSegmentSelection: vi.fn().mockReturnValue(undefined),
    changeSegment: vi.fn(),
    // Actually splices, like AudioViewerSegmentsService does: the
    // delete_boundaries loop decrements its index after each removal and
    // relies on the level shrinking to terminate.
    removeSegmentByIndex: vi.fn((index: number) => {
      (state.annotation?.currentLevel?.items as any[])?.splice(index, 1);
    }),
    selectSegment: vi.fn().mockResolvedValue({ posY1: 0, posY2: 0 }),
    changePlayCursorSamples: vi.fn(),
    playSelection: vi.fn(),
    afterAudioEnded: vi.fn(),
    getLineNumber: vi.fn().mockReturnValue(0),
  };

  const host: AudioViewerInteractionHost = {
    canvas: {
      hasStage: () => canvasState['hasStage'],
      hasLayers: () => canvasState['hasLayers'],
      hasCanvasElements: () => canvasState['hasCanvasElements'],
      hasMouseCaret: () => canvasState['hasMouseCaret'],
      hasScrollBar: () => canvasState['hasScrollBar'],
      hasScrollbarSelector: () => canvasState['hasScrollbarSelector'],
      hasLastLine: () => canvasState['hasLastLine'],
      getStageHeight: () => canvasState['stageHeight'],
      getScrollBarHeight: () => canvasState['scrollBarHeight'],
      getScrollBarX: () => canvasState['scrollBarX'],
      getScrollbarSelectorY: () => canvasState['scrollbarSelectorY'],
      getScrollbarSelectorHeight: () => canvasState['scrollbarSelectorHeight'],
      getLastLineY: () => canvasState['lastLineY'],
      getLastLineHeight: () => canvasState['lastLineHeight'],
      getBackgroundLayerY: () => canvasState['backgroundLayerY'],
    },
    getSettings: () => state.settings,
    getAnnotation: () => state.annotation as any,
    setAnnotation: (value) => {
      state.annotation = value as any;
    },
    getTempAnnotation: () => state.tempAnnotation as any,
    setTempAnnotation: (value) => {
      state.tempAnnotation = value as any;
    },
    getCurrentLevel: () => state.annotation?.currentLevel as any,
    getAudioChunk: () => audioChunk,
    getAudioManager: () => audioManager,
    getAudioTCalculator: () => audioTCalculator,
    getPlayCursor: () => playCursor,
    getDrawnSelection: () => state.drawnSelection,
    setDrawnSelection: (value) => {
      state.drawnSelection = value;
    },
    getInnerWidth: () => state.innerWidth,
    getAudioPxWidth: () => state.audioPxWidth,
    getSilencePlaceholder: () => state.silencePlaceholder,
    getRefreshOnInternChanges: () => state.refreshOnInternChanges,

    addOrRemoveSegment: spies.addOrRemoveSegment as any,
    getSegmentSelection: spies.getSegmentSelection as any,
    changeSegment: spies.changeSegment as any,
    removeSegmentByIndex: spies.removeSegmentByIndex as any,
    selectSegment: spies.selectSegment as any,
    changePlayCursorSamples: spies.changePlayCursorSamples as any,
    playSelection: spies.playSelection as any,
    afterAudioEnded: spies.afterAudioEnded as any,
    getLineNumber: spies.getLineNumber as any,

    shortcut: recorder(emitted.shortcut),
    alert: recorder(emitted.alert),
    segmententer: recorder(emitted.segmententer),
    selchange: recorder(emitted.selchange),
    mousecursorchange: recorder(emitted.mousecursorchange),
    currentLevelChange: recorder(emitted.currentLevelChange),
    annotationChange: recorder(emitted.annotationChange),
  };

  const service = new AudioViewerInteractionService();
  service.renderRequest.subscribe((request) => {
    renderRequests.push(request);
    // Mirror what AudioViewerService.handleRenderRequest does to the Konva
    // nodes, so subsequent live canvas reads see the effect — the emitter
    // is synchronous in production too.
    if (request.type === 'set-scrollbar-selector-y') {
      canvasState['scrollbarSelectorY'] = request.y;
    } else if (request.type === 'scroll-layers-to-y') {
      canvasState['backgroundLayerY'] = request.y;
    } else if (request.type === 'set-mouse-caret-position') {
      canvasState['mouseCaretPosition'] = { x: request.x, y: request.y };
    }
  });
  service.initialize(host);

  return {
    service,
    host,
    state,
    canvasState,
    renderRequests,
    emitted,
    audioChunk,
    playCursor,
    spies,
  };
}

/** Feeds a synthetic ShortcutEvent through onKeyDown's dispatch. */
function pressShortcut(
  harness: TestHarness,
  shortcutName: string,
  options: { shortcut?: string; onFocusOnly?: boolean } = {},
) {
  const event = {
    keyCode: 65,
    code: 'KeyA',
    key: 'a',
    type: 'keydown',
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;

  harness.service.shortcutsManager = {
    checkKeyEvent: () => ({
      shortcut: options.shortcut ?? 'CTRL + Z',
      platform: 'pc',
      shortcutName,
      shortcutGroupName: 'audioviewer',
      onFocusOnly: options.onFocusOnly ?? false,
      event,
      timestamp: 4711,
    }),
  } as any;

  harness.service.onKeyDown(event);
  return event;
}

describe('AudioViewerInteractionService', () => {
  it('does not import or reference AudioViewerRendererService', () => {
    // Structural guard for the S1 split's DAG: the interaction bucket may
    // depend on segments/time-utils, but never on the renderer. Rendering
    // side effects have to leave via `renderRequest`.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, 'audio-viewer-interaction.service.ts'),
      'utf-8',
    );
    // Comments are stripped first: the file's docs *explain* why it must
    // not reach the renderer, so they legitimately name it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toContain('AudioViewerRendererService');
    expect(code).not.toContain('audio-viewer-renderer.service');
    expect(code).not.toContain('canvasRenderer');
    expect(code).not.toContain('konva/lib/Layer');
    expect(code).not.toContain('konva/lib/Stage');
  });

  describe('handleBoundaryDragging', () => {
    function draggingHarness() {
      const harness = makeHarness();
      const annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
        segment(3, 48000),
      ]);
      harness.state.annotation = annotation;
      harness.state.tempAnnotation = annotation;
      return harness;
    }

    it('moves the dragged boundary and publishes the change when emit is true', () => {
      const harness = draggingHarness();
      harness.service.dragableBoundaryID = 2;
      harness.emitted.currentLevelChange.length = 0;
      harness.emitted.annotationChange.length = 0;

      // absX 150 -> 24000 samples, comfortably between 16000 and 48000.
      harness.service.handleBoundaryDragging(150, time(24000), true);

      expect(harness.emitted.currentLevelChange).toHaveLength(1);
      expect(harness.emitted.currentLevelChange[0].type).toBe('change');
      expect(harness.emitted.currentLevelChange[0].items[0].instance.id).toBe(
        2,
      );
      expect(
        harness.emitted.currentLevelChange[0].items[0].instance.time.samples,
      ).toBe(24000);
      expect(harness.emitted.annotationChange).toHaveLength(1);

      // The facade's annotation is replaced with the updated clone.
      const items = harness.state.annotation!.currentLevel!
        .items as TrattAnnotationSegment[];
      expect(items[1].time.samples).toBe(24000);
    });

    it('does not emit when emit is false, but still updates the annotation', () => {
      const harness = draggingHarness();
      harness.service.dragableBoundaryID = 2;
      harness.emitted.currentLevelChange.length = 0;

      harness.service.handleBoundaryDragging(150, time(24000), false);

      expect(harness.emitted.currentLevelChange).toHaveLength(0);
      const items = harness.state.annotation!.currentLevel!
        .items as TrattAnnotationSegment[];
      expect(items[1].time.samples).toBe(24000);
    });

    it('clamps the boundary to 500 samples past its left neighbour', () => {
      const harness = draggingHarness();
      harness.service.dragableBoundaryID = 2;

      // absX 10 -> 1600 samples, i.e. left of the previous boundary (16000).
      harness.service.handleBoundaryDragging(10, time(1600), true);

      expect(
        harness.emitted.currentLevelChange[0].items[0].instance.time.samples,
      ).toBe(16500);
    });

    it('clamps the boundary to 500 samples before its right neighbour', () => {
      const harness = draggingHarness();
      harness.service.dragableBoundaryID = 2;

      // absX 400 -> 64000 samples, i.e. right of the next boundary (48000).
      harness.service.handleBoundaryDragging(400, time(64000), true);

      expect(
        harness.emitted.currentLevelChange[0].items[0].instance.time.samples,
      ).toBe(47500);
    });

    it('sets the selection instead of moving a boundary when boundaries are readonly', () => {
      const harness = draggingHarness();
      harness.service.dragableBoundaryID = 2;
      harness.state.settings.boundaries.readonly = true;
      harness.emitted.currentLevelChange.length = 0;

      harness.service.handleBoundaryDragging(150, time(24000), true);

      expect(harness.emitted.currentLevelChange).toHaveLength(0);
      expect(harness.audioChunk.selection.end.samples).toBe(24000);
      expect(harness.state.drawnSelection?.end.samples).toBe(24000);
      expect(harness.playCursor.changeSamples).toHaveBeenCalled();
    });

    it('reads the temp annotation live, not the one present when the handler was created', () => {
      // Regression guard for the task-14 bug class: a frozen capture here
      // would keep dragging against the annotation that existed at wiring
      // time and emit stale clones back into the store.
      const harness = draggingHarness();
      harness.service.dragableBoundaryID = 2;

      const replacement = annotationWith([
        segment(1, 16000),
        segment(2, 32000, 'edited elsewhere'),
        segment(3, 48000),
      ]);
      harness.state.annotation = replacement;
      harness.state.tempAnnotation = replacement;

      harness.service.handleBoundaryDragging(150, time(24000), true);

      const instance = harness.emitted.currentLevelChange.at(-1).items[0]
        .instance as TrattAnnotationSegment;
      expect(instance.getFirstLabelWithoutName('Speaker')?.value).toBe(
        'edited elsewhere',
      );
    });
  });

  describe('dragableBoundaryID', () => {
    it('emits render requests instead of calling the renderer when a drag starts', () => {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([segment(1, 16000)]);
      harness.state.refreshOnInternChanges = true;

      harness.service.dragableBoundaryID = 7;

      expect(harness.renderRequests).toEqual([
        { type: 'redraw-segment', segmentID: 7 },
      ]);
      expect(harness.state.tempAnnotation).toBe(harness.state.annotation);
      expect(harness.service.dragableBoundaryID).toBe(7);
    });

    it('publishes a "started" boundaryDragging event once per drag', () => {
      const harness = makeHarness();
      const events: any[] = [];
      harness.service.boundaryDragging.subscribe((e) => events.push(e));

      harness.service.dragableBoundaryID = 7;
      harness.service.dragableBoundaryID = 8;

      expect(events).toEqual([
        { shiftPressed: false, id: 7, status: 'started' },
      ]);
    });
  });

  describe('setMouseClickPosition', () => {
    function clickHarness() {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
      ]);
      return harness;
    }

    it('on mousedown records the click position and arms the drag state', async () => {
      const harness = clickHarness();

      const result = await harness.service.setMouseClickPosition(100, 3, {
        type: 'mousedown',
      } as Event);

      expect(result).toBe(3);
      expect(harness.service.MouseClickPos?.samples).toBe(16000);
      expect(harness.service.mouseCursor?.samples).toBe(16000);
      expect(harness.service.mouseDown).toBe(true);
      expect(harness.audioChunk.startpos.samples).toBe(16000);
      expect(harness.state.drawnSelection?.start.samples).toBe(16000);
    });

    it('on mousedown with shift held keeps the previous drawn selection', async () => {
      const harness = clickHarness();
      const previous = new AudioSelection(time(1), time(2));
      harness.state.drawnSelection = previous;
      harness.service.shiftPressed = true;

      await harness.service.setMouseClickPosition(100, 0, {
        type: 'mousedown',
      } as Event);

      expect(harness.state.drawnSelection).toBe(previous);
    });

    it('on mouseup finishes the drag and asks for a segment update', async () => {
      const harness = clickHarness();
      harness.state.tempAnnotation = harness.state.annotation;
      harness.service.dragableBoundaryID = 2;
      const dragEvents: any[] = [];
      harness.service.boundaryDragging.subscribe((e) => dragEvents.push(e));
      harness.renderRequests.length = 0;

      await harness.service.setMouseClickPosition(150, 1, {
        type: 'mouseup',
      } as Event);

      expect(dragEvents).toEqual([
        { shiftPressed: false, id: 2, status: 'stopped' },
      ]);
      expect(harness.service.dragableBoundaryID).toBe(-1);
      expect(harness.service.mouseDown).toBe(false);
      expect(harness.service.overboundary).toBe(false);
      expect(harness.renderRequests).toContainEqual({
        type: 'update-all-segments',
      });
    });

    it('returns undefined when the current level has no items', async () => {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([]);

      const result = await harness.service.setMouseClickPosition(100, 2, {
        type: 'mousedown',
      } as Event);

      expect(result).toBeUndefined();
    });
  });

  describe('setMouseMovePosition', () => {
    function moveHarness() {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
      ]);
      harness.state.tempAnnotation = harness.state.annotation;
      return harness;
    }

    it('always tracks the mouse cursor', () => {
      const harness = moveHarness();

      harness.service.setMouseMovePosition(50);

      expect(harness.service.mouseCursor?.samples).toBe(8000);
    });

    it('extends the selection while the mouse is down with nothing dragged', async () => {
      const harness = moveHarness();
      await harness.service.setMouseClickPosition(10, 0, {
        type: 'mousedown',
      } as Event);

      harness.service.setMouseMovePosition(200);

      expect(harness.audioChunk.selection.end.samples).toBe(32000);
      expect(harness.state.drawnSelection?.end.samples).toBe(32000);
    });

    it('does not touch the selection while shift is held', async () => {
      const harness = moveHarness();
      await harness.service.setMouseClickPosition(10, 0, {
        type: 'mousedown',
      } as Event);
      harness.service.shiftPressed = true;
      const before = harness.state.drawnSelection;

      harness.service.setMouseMovePosition(200);

      expect(harness.state.drawnSelection).toBe(before);
      expect(harness.audioChunk.selection.end.samples).toBe(1600);
    });

    it('drags the boundary and asks for an overlay redraw instead of drawing', async () => {
      const harness = moveHarness();
      harness.service.dragableBoundaryID = 2;
      await harness.service.setMouseClickPosition(10, 0, {
        type: 'mousedown',
      } as Event);
      const dragEvents: any[] = [];
      harness.service.boundaryDragging.subscribe((e) => dragEvents.push(e));
      harness.renderRequests.length = 0;

      harness.service.setMouseMovePosition(150);

      expect(dragEvents).toEqual([
        { shiftPressed: false, id: 2, status: 'dragging' },
      ]);
      expect(harness.renderRequests).toEqual([
        { type: 'batch-draw-overlay-layer' },
      ]);
      const items = harness.state.annotation!.currentLevel!
        .items as TrattAnnotationSegment[];
      expect(items[1].time.samples).toBe(24000);
    });

    it('does nothing when there is no annotation yet', () => {
      const harness = makeHarness();

      harness.service.setMouseMovePosition(50);

      expect(harness.service.mouseCursor).toBeUndefined();
    });
  });

  describe('moveCursor', () => {
    it('moves left and right within the chunk', () => {
      const harness = makeHarness();
      harness.service.setMouseCursor(time(80000));

      harness.service.moveCursor('left', 1000);
      expect(harness.service.mouseCursor?.samples).toBe(79000);

      harness.service.moveCursor('right', 4000);
      expect(harness.service.mouseCursor?.samples).toBe(83000);
    });

    it('refuses to move past the start of the chunk', () => {
      const harness = makeHarness();
      harness.service.setMouseCursor(time(100));

      harness.service.moveCursor('left', 1000);

      expect(harness.service.mouseCursor?.samples).toBe(100);
    });

    it('throws when asked to move a non-positive number of samples', () => {
      const harness = makeHarness();
      harness.service.setMouseCursor(time(100));

      expect(() => harness.service.moveCursor('left', 0)).toThrow();
    });
  });

  describe('onKeyDown dispatch guards', () => {
    it('ignores everything when shortcuts are disabled', () => {
      const harness = makeHarness();
      harness.state.settings.shortcutsEnabled = false;
      harness.service.focused = true;

      pressShortcut(harness, 'undo');

      expect(harness.emitted.shortcut).toHaveLength(0);
    });

    it('preventDefaults and stops on a configured disabled key', () => {
      const harness = makeHarness();
      harness.service.focused = true;

      const event = pressShortcut(harness, 'undo', {
        shortcut: 'SHIFT + SPACE',
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(harness.emitted.shortcut).toHaveLength(0);
    });

    it('skips focus-only shortcuts while unfocused', () => {
      const harness = makeHarness();
      harness.service.focused = false;

      pressShortcut(harness, 'undo', { onFocusOnly: true });

      expect(harness.emitted.shortcut).toHaveLength(0);
    });

    it('tracks the shift key', () => {
      const harness = makeHarness();
      harness.service.shortcutsManager = {
        checkKeyEvent: () => undefined,
      } as any;

      harness.service.onKeyDown({
        keyCode: 16,
        code: 'ShiftLeft',
        key: 'Shift',
      } as KeyboardEvent);
      expect(harness.service.shiftPressed).toBe(true);

      harness.service.onKeyDown({
        keyCode: 65,
        code: 'KeyA',
        key: 'a',
      } as KeyboardEvent);
      expect(harness.service.shiftPressed).toBe(false);
    });
  });

  describe('onKeyDown shortcut handlers', () => {
    it('undo/redo emit an application shortcut only when focused and editable', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.service.setMouseCursor(time(1234));

      pressShortcut(harness, 'undo');
      pressShortcut(harness, 'redo');

      expect(harness.emitted.shortcut.map((a) => a.shortcutName)).toEqual([
        'undo',
        'redo',
      ]);
      expect(harness.emitted.shortcut[0].type).toBe('application');
      expect(harness.emitted.shortcut[0].timePosition.samples).toBe(1234);
      expect(harness.emitted.shortcut[0].timestamp).toBe(4711);
    });

    it('undo is suppressed when boundaries are readonly', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.settings.boundaries.readonly = true;

      pressShortcut(harness, 'undo');

      expect(harness.emitted.shortcut).toHaveLength(0);
    });

    it('set_boundary surfaces addOrRemoveSegment messages as alerts', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.annotation = annotationWith([segment(1, 16000)]);
      harness.spies.addOrRemoveSegment.mockReturnValue({
        type: 'add',
        seg_samples: 16000,
        seg_ID: 1,
        msg: { type: 'error', text: 'too close' },
      });

      pressShortcut(harness, 'set_boundary');

      expect(harness.emitted.alert).toEqual([
        { type: 'error', message: 'too close' },
      ]);
      expect(harness.emitted.shortcut).toHaveLength(0);
    });

    it('set_boundary emits a boundary shortcut when there is no message', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.annotation = annotationWith([segment(1, 16000)]);
      harness.spies.addOrRemoveSegment.mockReturnValue({
        type: 'add',
        seg_samples: 16000,
        seg_ID: 1,
        msg: { type: '', text: '' },
      });

      pressShortcut(harness, 'set_boundary');

      expect(harness.emitted.shortcut).toHaveLength(1);
      expect(harness.emitted.shortcut[0]).toMatchObject({
        type: 'boundary',
        value: 'add',
      });
      expect(harness.emitted.shortcut[0].timePosition.samples).toBe(16000);
    });

    it('set_break toggles the silence placeholder and requests a redraw', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
      ]);
      harness.service.setMouseCursor(time(8000));
      harness.renderRequests.length = 0;

      pressShortcut(harness, 'set_break');

      const items = harness.state.annotation!.currentLevel!
        .items as TrattAnnotationSegment[];
      expect(items[0].getFirstLabelWithoutName('Speaker')?.value).toBe('<P>');
      expect(harness.emitted.shortcut[0]).toMatchObject({
        value: 'set_break',
        type: 'segment',
      });
      expect(harness.spies.changeSegment).toHaveBeenCalled();
      // The renderer is never touched directly — only asked for.
      expect(harness.renderRequests).toEqual([{ type: 'redraw' }]);
    });

    it('set_break removes the placeholder again on a second press', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.annotation = annotationWith([
        segment(1, 16000, '<P>'),
        segment(2, 32000),
      ]);
      harness.service.setMouseCursor(time(8000));

      pressShortcut(harness, 'set_break');

      const items = harness.state.annotation!.currentLevel!
        .items as TrattAnnotationSegment[];
      expect(items[0].getFirstLabelWithoutName('Speaker')?.value).toBe('');
      expect(harness.emitted.shortcut[0].value).toBe('remove_break');
    });

    it('cursor_left/cursor_right move the cursor and request a caret move', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.service.setMouseCursor(time(80000));
      harness.renderRequests.length = 0;

      pressShortcut(harness, 'cursor_left');

      const step = Math.round(0.0226 * SAMPLE_RATE);
      expect(harness.service.mouseCursor?.samples).toBe(80000 - step);
      expect(harness.emitted.shortcut[0]).toMatchObject({ type: 'mouse' });
      expect(harness.emitted.mousecursorchange).toHaveLength(1);
      expect(harness.renderRequests.map((a) => a.type)).toEqual([
        'set-mouse-caret-position',
        'batch-draw-playhead-layer',
      ]);

      pressShortcut(harness, 'cursor_right');
      expect(harness.service.mouseCursor?.samples).toBe(80000);
    });

    it('delete_boundaries removes every segment inside the drawn selection', () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
        segment(3, 48000),
      ]);
      harness.state.drawnSelection = new AudioSelection(time(0), time(40000));

      pressShortcut(harness, 'delete_boundaries');

      expect(harness.spies.removeSegmentByIndex).toHaveBeenCalledTimes(2);
      expect(harness.emitted.currentLevelChange).toHaveLength(1);
      expect(harness.emitted.currentLevelChange[0]).toMatchObject({
        type: 'remove',
        items: [{ id: 1 }, { id: 2 }],
        removeOptions: { silenceCode: '<P>', mergeTranscripts: true },
      });
      // The selection is collapsed back to zero afterwards.
      expect(harness.state.drawnSelection!.start.samples).toBe(0);
      expect(harness.state.drawnSelection!.end.samples).toBe(0);
    });

    it('segment_enter delegates to selectSegment and requests drawing afterwards', async () => {
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
      ]);
      harness.service.setMouseCursor(time(8000));
      harness.renderRequests.length = 0;
      harness.spies.selectSegment.mockResolvedValue({ posY1: 5, posY2: 9 });

      pressShortcut(harness, 'segment_enter');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(harness.spies.selectSegment).toHaveBeenCalledWith(0);
      expect(harness.service.focused).toBe(false);
      expect(harness.renderRequests.map((a) => a.type)).toEqual([
        'draw-whole-selection',
        'draw-stage',
      ]);
      expect(harness.emitted.segmententer).toEqual([
        { index: 0, pos: { Y1: 5, Y2: 9 } },
      ]);
    });

    it('reads the annotation live, so a level swapped in after wiring is used', () => {
      // Regression guard for the task-14 bug class on the keyboard path.
      const harness = makeHarness();
      harness.service.focused = true;
      harness.state.annotation = annotationWith([segment(1, 16000)]);
      harness.service.setMouseCursor(time(8000));

      // Replace the whole annotation (never mutated in place in production).
      harness.state.annotation = annotationWith([
        segment(9, 16000, 'fresh'),
        segment(10, 32000),
      ]);

      pressShortcut(harness, 'set_break');

      const items = harness.state.annotation!.currentLevel!
        .items as TrattAnnotationSegment[];
      expect(items[0].id).toBe(9);
      expect(items[0].getFirstLabelWithoutName('Speaker')?.value).toBe('<P>');
    });
  });

  describe('scrolling', () => {
    it('clamps the wheel-driven scrollbar position and re-derives the scroll', () => {
      const harness = makeHarness();
      harness.canvasState['scrollbarSelectorY'] = 100;

      harness.service.onWheel({
        evt: { preventDefault: vi.fn(), deltaY: 40 },
      } as any);

      // 100 + 40/2 = 120, below every cap.
      expect(harness.renderRequests[0]).toEqual({
        type: 'set-scrollbar-selector-y',
        y: 120,
      });
      // ...then onScrollbarDragged re-reads the (now moved) selector and
      // scrolls by -120/400 of the total content height.
      expect(harness.renderRequests[1]).toEqual({
        type: 'scroll-layers-to-y',
        y: (900 + 100) * -(120 / 400),
      });
    });

    it('clamps to stage height minus the selector height', () => {
      const harness = makeHarness();
      harness.canvasState['scrollbarSelectorY'] = 390;

      harness.service.onWheel({
        evt: { preventDefault: vi.fn(), deltaY: 100 },
      } as any);

      // min(400, 390+50) = 400, then min(400, 500-50) = 400.
      expect(harness.renderRequests[0]).toEqual({
        type: 'set-scrollbar-selector-y',
        y: 400,
      });
    });

    it('never goes negative', () => {
      const harness = makeHarness();
      harness.canvasState['scrollbarSelectorY'] = 0;

      harness.service.onWheel({
        evt: { preventDefault: vi.fn(), deltaY: -400 },
      } as any);

      expect(harness.renderRequests[0]).toEqual({
        type: 'set-scrollbar-selector-y',
        y: 0,
      });
    });

    it('does nothing when there is no scrollbar', () => {
      const harness = makeHarness();
      harness.canvasState['hasScrollBar'] = false;
      const preventDefault = vi.fn();

      harness.service.onWheel({
        evt: { preventDefault, deltaY: 40 },
      } as any);

      expect(preventDefault).not.toHaveBeenCalled();
      expect(harness.renderRequests).toHaveLength(0);
    });

    it('skips the scroll when the layers are already at the target offset', () => {
      const harness = makeHarness();
      harness.canvasState['backgroundLayerY'] = -500;

      // (900 + 100) * -0.5 === -500, i.e. already there.
      harness.service.scrollWithDeltaY(-0.5);

      expect(harness.renderRequests).toHaveLength(0);
    });
  });

  describe('focus handling', () => {
    it('focuses the stage through a render request, never directly', () => {
      const harness = makeHarness();

      harness.service.focus();

      expect(harness.service.focused).toBe(true);
      expect(harness.renderRequests).toEqual([
        { type: 'focus-stage-container' },
      ]);
    });

    it('onMouseLeave clears focus without any rendering', () => {
      const harness = makeHarness();
      harness.service.onMouseEnter();
      harness.renderRequests.length = 0;

      harness.service.onMouseLeave();

      expect(harness.service.focused).toBe(false);
      expect(harness.renderRequests).toHaveLength(0);
    });
  });

  describe('mouse events over the canvas', () => {
    it('onMouseMove tracks the hovered line and only requests rendering', () => {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([segment(1, 16000)]);
      harness.state.audioPxWidth = 3000;
      harness.spies.getLineNumber.mockReturnValue(1);
      harness.state.drawnSelection = new AudioSelection(time(0), time(16000));

      harness.service.onMouseMove({ layerX: 200, layerY: 30 });

      expect(harness.renderRequests).toEqual([
        { type: 'set-mouse-caret-position', x: 200, y: 60 },
        { type: 'batch-draw-playhead-layer' },
        { type: 'draw-whole-selection' },
        { type: 'focus-stage-container' },
      ]);
      // hoveredLine 1 * innerWidth 1000 + 200 -> absX 1200 -> 192000 samples
      expect(harness.service.mouseCursor?.samples).toBe(192000);
      expect(harness.emitted.mousecursorchange).toHaveLength(1);
      expect(harness.service.focused).toBe(true);
    });

    it('onMouseMove leaves the caret alone when the cursor is fixed', () => {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([segment(1, 16000)]);
      harness.state.settings.cursor.fixed = true;

      harness.service.onMouseMove({ layerX: 200, layerY: 30 });

      expect(harness.renderRequests).toEqual([
        { type: 'focus-stage-container' },
      ]);
    });

    it('mouseChange delegates a mousedown and only requests playhead drawing', async () => {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
      ]);
      harness.audioChunk.absolutePlayposition = time(4000);
      // hoveredLine starts at -1; a mousemove has to establish it first,
      // exactly like the real event sequence.
      harness.service.onMouseMove({ layerX: 100, layerY: 10 });
      harness.renderRequests.length = 0;

      await harness.service.mouseChange({ type: 'mousedown', layerX: 100 });

      // mouseChange seeds the selection from the play position, then
      // setMouseClickPosition overwrites it with the clicked position
      // (absX 100 -> 16000 samples).
      expect(harness.service.MouseClickPos?.samples).toBe(16000);
      expect(harness.audioChunk.selection.start.samples).toBe(16000);
      expect(harness.renderRequests.map((a) => a.type)).toEqual([
        'update-play-cursor',
        'draw-playhead-layer',
        'draw-whole-selection',
      ]);
      expect(harness.emitted.selchange).toHaveLength(0);
      expect(harness.service.focused).toBe(true);
    });

    it('mouseChange publishes a selection change on mouseup', async () => {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([
        segment(1, 16000),
        segment(2, 32000),
      ]);

      harness.service.onMouseMove({ layerX: 100, layerY: 10 });

      await harness.service.mouseChange({ type: 'mouseup', layerX: 100 });

      expect(harness.emitted.selchange).toHaveLength(1);
    });

    it('mouseChange ignores clicks on the scrollbar', async () => {
      const harness = makeHarness();
      harness.state.annotation = annotationWith([segment(1, 16000)]);

      harness.service.onMouseMove({ layerX: 100, layerY: 10 });
      harness.renderRequests.length = 0;

      await harness.service.mouseChange({ type: 'mousedown', layerX: 990 });

      expect(harness.renderRequests).toHaveLength(0);
    });
  });

  describe('updateShortcuts', () => {
    let harness: TestHarness;

    beforeEach(() => {
      harness = makeHarness();
    });

    it('always writes the new group into the live settings object', () => {
      const group = { name: 'other', enabled: true, items: [] } as any;

      harness.service.updateShortcuts(group);

      expect(harness.state.settings.shortcuts).toBe(group);
    });

    it('re-registers the group only when more than one shortcut is registered', () => {
      const group = { name: 'other', enabled: true, items: [] } as any;
      const clearShortcuts = vi.fn();
      const registerShortcutGroup = vi.fn();
      harness.service.shortcutsManager = {
        shortcuts: [1, 2],
        clearShortcuts,
        registerShortcutGroup,
      } as any;

      harness.service.updateShortcuts(group);

      expect(clearShortcuts).toHaveBeenCalled();
      expect(registerShortcutGroup).toHaveBeenCalledWith(group);
    });
  });

  describe('isDisabledKey', () => {
    it('matches against the live disabledKeys list', () => {
      const harness = makeHarness();

      expect(harness.service.isDisabledKey('SHIFT + SPACE')).toBe(true);
      expect(harness.service.isDisabledKey('CTRL + Z')).toBe(false);

      harness.state.settings.disabledKeys = ['CTRL + Z'];
      expect(harness.service.isDisabledKey('SHIFT + SPACE')).toBe(false);
      expect(harness.service.isDisabledKey('CTRL + Z')).toBe(true);
    });
  });

  describe('onKeyUp', () => {
    it('releases shift and forwards the event to the shortcut manager', () => {
      const harness = makeHarness();
      harness.service.shiftPressed = true;
      const checkKeyEvent = vi.fn();
      harness.service.shortcutsManager = { checkKeyEvent } as any;

      harness.service.onKeyUp({ type: 'keyup' } as KeyboardEvent);

      expect(harness.service.shiftPressed).toBe(false);
      expect(checkKeyEvent).toHaveBeenCalled();
    });
  });
});

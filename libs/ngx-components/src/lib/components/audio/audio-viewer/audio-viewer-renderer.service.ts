import { Injectable, Renderer2 } from '@angular/core';
import {
  AnnotationAnySegment,
  AnnotationLevelType,
  ASRContext,
  ASRQueueItemType,
  getSegmentsOfRange,
  OLabel,
  TrattAnnotation,
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import {
  AudioChunk,
  AudioManager,
  AudioTimeCalculator,
} from '@tratt/web-media';
import { Animation } from 'konva/lib/Animation';
import { Context } from 'konva/lib/Context';
import { Group } from 'konva/lib/Group';
import { Layer } from 'konva/lib/Layer';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Shape } from 'konva/lib/Shape';
import { Stage } from 'konva/lib/Stage';
import { Util } from 'konva/lib/Util';
import { Circle } from 'konva/lib/shapes/Circle';
import { Line } from 'konva/lib/shapes/Line';
import { Rect } from 'konva/lib/shapes/Rect';
import { Text } from 'konva/lib/shapes/Text';
// Direct sub-path imports (not the `../../../obj` barrel) for the same
// reason AudioViewerSegmentsService avoids importing AudioviewerConfig
// directly: the barrel's `./functions` re-export drags in ng-bootstrap,
// which fails to load in vitest's node test environment. `objects.ts`,
// `tratt-colors.ts` and `play-cursor.ts` have no such dependency.
import { Position, Size } from '../../../obj/objects';
import { PlayCursor } from '../../../obj/play-cursor';
import { TRATT_COLORS } from '../../../obj/tratt-colors';
import { AudioViewerTimeUtils } from './audio-viewer-time-utils';
import {
  cycleNextSpeaker,
  getSpeakerColor,
  getSpeakerIds,
  getSpeakerTextColor,
} from './speaker-colors';

/**
 * The subset of AudioviewerConfig's shape that the canvas-drawing bucket
 * reads. Declared locally (rather than importing AudioviewerConfig)
 * because that class imports `TRATT_COLORS` from the `../../../obj`
 * barrel, which drags in ng-bootstrap via the barrel's `./functions`
 * re-export and fails to load in vitest's node test environment (the same
 * reason AudioViewerSegmentsService's AudioViewerBoundarySettings and
 * AudioViewerTimeUtils' AudioViewerLineSettings exist as local
 * interfaces). A real AudioviewerConfig instance satisfies this interface
 * structurally, so AudioViewerService can keep passing `this.settings`
 * unchanged.
 */
export interface AudioViewerRenderSettings {
  multiLine: boolean;
  pixelPerSec: number;
  cropping: string;
  lineheight: number;
  backgroundcolor: string;
  roundValues: boolean;
  showTimePerLine: boolean;
  showTranscripts: boolean;
  showProgressBars: boolean;
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  cursor: {
    color: string;
    fixed: boolean;
  };
  scrollbar: {
    enabled: boolean;
    width: number;
    background: {
      color: string;
      stroke: string;
      strokeWidth: number;
    };
    selector: {
      color: string;
      stroke: string;
      strokeWidth: number;
      width: number;
    };
  };
  playcursor: {
    height: number;
    width: number;
    color: string;
  };
  boundaries: {
    enabled: boolean;
    readonly: boolean;
    width: number;
    color: string;
  };
  grid: {
    color: string;
  };
  data: {
    color: string;
  };
  selection: {
    enabled: boolean;
    color: string;
  };
  frame: {
    color: string;
  };
  timeline: {
    enabled: boolean;
    height: number;
  };
}

/** Minimal, safe standalone default so the service is constructable (and
 * `initialize`/`initializeStageContainer` callable) before
 * AudioViewerService has pushed the real AudioviewerConfig instance in —
 * exercised by this file's smoke test. Overwritten via the `settings`
 * setter as soon as AudioViewerService's `_settings` field exists. */
const DEFAULT_RENDER_SETTINGS: AudioViewerRenderSettings = {
  multiLine: false,
  pixelPerSec: 50,
  cropping: 'none',
  lineheight: 60,
  backgroundcolor: '#ffffff',
  roundValues: true,
  showTimePerLine: false,
  showTranscripts: false,
  showProgressBars: false,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  cursor: { color: '#000000', fixed: false },
  scrollbar: {
    enabled: false,
    width: 20,
    background: { color: '#ffffff', stroke: 'gray', strokeWidth: 1 },
    selector: { color: '#000000', stroke: 'gray', strokeWidth: 1, width: 20 },
  },
  playcursor: { height: 20, width: 10, color: '#000000' },
  boundaries: { enabled: true, readonly: false, width: 3, color: '#000000' },
  grid: { color: 'rgb(224, 224, 224)' },
  data: { color: '#000000' },
  selection: { enabled: true, color: 'gray' },
  frame: { color: '#000000' },
  timeline: { enabled: false, height: 15 },
};

function formatTimespanNumber(num: number, length: number): string {
  let result = '' + num.toFixed(0);
  while (result.length < length) {
    result = '0' + result;
  }
  return result;
}

/**
 * Pure re-implementation of `@tratt/ngx-utilities`'s TimespanPipe#transform
 * (milliseconds -> "hh:mm:ss.mmm" style string), used by the time-label and
 * progress-bar scene functions below. Reimplemented locally rather than
 * imported, for the same reason AudioviewerConfig isn't imported directly:
 * `@tratt/ngx-utilities`'s barrel (`./lib/functions`) references
 * `HttpClient`, which fails Angular's JIT metadata resolution in vitest's
 * node test environment (no `@angular/compiler` present). Logic mirrored
 * verbatim from TimespanPipe#transform.
 */
export function formatTimespan(
  value: number | undefined,
  args?: {
    showHour?: boolean;
    showMilliSeconds?: boolean;
    maxDuration?: number;
  },
): string {
  if (value === undefined) {
    return '';
  }
  let timespan = Number(value);
  if (timespan < 0) {
    timespan = 0;
  }

  const {
    showHour = false,
    showMilliSeconds = false,
    maxDuration = 0,
  } = args ?? {};
  const forceHours = Math.floor(maxDuration / 1000 / 60 / 60) > 0;

  const milliSecondsPart = Math.floor(timespan % 1000);
  const secondsPart = Math.floor(timespan / 1000) % 60;
  const minutesPart = Math.floor(timespan / 1000 / 60) % 60;
  const hoursPart = Math.floor(timespan / 1000 / 60 / 60);

  const milliSeconds = formatTimespanNumber(milliSecondsPart, 3);
  const minutes = formatTimespanNumber(minutesPart, 2);
  const seconds = formatTimespanNumber(secondsPart, 2);
  const hours =
    showHour && (forceHours || hoursPart > 0)
      ? formatTimespanNumber(hoursPart, 2) + ':'
      : '';

  let result = hours + minutes + ':' + seconds;
  if (showMilliSeconds) {
    result += '.' + milliSeconds;
  }
  return result;
}

/**
 * Data + callbacks a handful of the segment-drawing methods need from the
 * segment/annotation model, which this service deliberately does not own
 * (see class doc). Bundled into one object so the several methods that
 * need the full set (initializeView, updateAllSegments, drawAllBoundaries,
 * drawNewBoundaries, addNewSegmentOnCanvas, refresh, onResize) don't need
 * a long, repeated parameter list; lower-level helpers that only need the
 * bare `currentLevel` value (createSegmentOnCanvas and the Konva scene
 * functions it wires up) take that alone, captured by closure at
 * shape-creation time rather than read live from this context later.
 */
export interface AudioViewerSegmentRenderContext {
  currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment> | undefined;
  annotation: TrattAnnotation<ASRContext, TrattAnnotationSegment> | undefined;
  /** Invoked when a boundary line is mousedown'd (starts boundary dragging). */
  onBoundaryMouseDown: (id: number) => void;
  /** Invoked when a segment's speaker label is cycled by clicking it. */
  onSpeakerLabelChanged: (item: AnnotationAnySegment) => void;
}

/** Handlers `initializeStageContainer` wires onto the stage container's
 * native DOM events. These are keyboard/mouse *interaction* handlers that
 * live on AudioViewerService (not this rendering bucket), so they're
 * passed in rather than referenced via `this`. */
export interface AudioViewerStageEventHandlers {
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * AudioViewerRendererService holds the Konva canvas-rendering logic
 * extracted from AudioViewerService (S1 split, task 14/21): building the
 * Konva stage/layers, drawing lines/signal/grid/playhead/segments/
 * boundaries/selection/scrollbar, and the various Konva `sceneFunc`
 * callbacks and Animation frame callback those shapes use to redraw
 * themselves.
 *
 * Ownership rule: this service owns canvas/geometry state that Konva's
 * own internals (a shape's `sceneFunc`, or an `Animation`'s frame
 * callback) read live, on their own schedule, with no way for our code to
 * inject fresh parameters per call — `stage`, `konvaContainer`, `layers`,
 * `canvasElements`, `styles`, `animation`, `croppingData`, `grid`,
 * `viewport`, `size`, plus (found while porting the methods below, since
 * they're read inside those same live callbacks) `audioChunk`,
 * `audioTCalculator`, the play cursor, `minmaxarray`, `zoomX`/`zoomY`,
 * `secondsPerLine`, `silencePlaceholder`, `settings` and the Angular
 * `Renderer2` used for DOM cursor styling. AudioViewerService keeps
 * pass-through accessors under the original field names so its many
 * non-rendering methods (mouse/keyboard handling, playback, ASR) keep
 * compiling unchanged.
 *
 * It deliberately does NOT own annotation/segment-tree data (`annotation`,
 * `currentLevel`, individual segments) — that stays on AudioViewerService
 * and is passed in as an explicit parameter (see
 * AudioViewerSegmentRenderContext) to whichever method needs it,
 * including into the Konva scene-function closures that need it, which
 * capture the parameter value at shape-creation time rather than reading
 * a live field. This service also never imports or injects
 * AudioViewerSegmentsService, or any interaction service.
 */
@Injectable()
export class AudioViewerRendererService {
  private timeUtils = new AudioViewerTimeUtils();

  // ---- Konva stage/layer/canvas state -------------------------------
  stage: Stage | undefined;
  konvaContainer?: HTMLDivElement;
  layers:
    | {
        background: Layer;
        playhead: Layer;
        boundaries: Layer;
        overlay: Layer;
        scrollBars: Layer;
      }
    | undefined;

  canvasElements: {
    playHead: Group | undefined;
    mouseCaret: Group | undefined;
    scrollBar: Group | undefined;
    scrollbarSelector: Rect | undefined;
    lastLine: Group | undefined;
  } = {
    playHead: undefined,
    mouseCaret: undefined,
    scrollBar: undefined,
    scrollbarSelector: undefined,
    lastLine: undefined,
  };

  styles = {
    playHead: {
      backgroundColor: TRATT_COLORS.playhead,
      strokeColor: 'pruple',
      strokeWidth: 1,
      width: 10,
    },
    caret: {
      strokeColor: 'red',
      strokeWidth: 1,
    },
    height: 200,
    border: {
      width: 1,
      color: '#b5b5b5',
    },
    background: {
      color: TRATT_COLORS.surfaceBackground,
    },
    grid: {
      strokeColor: 'gray',
      strokeWidth: 1,
    },
    signal: {
      strokeColor: TRATT_COLORS.waveformSignal,
      strokeWidth: 1,
    },
  };

  animation: {
    playHead: Animation | undefined;
  } = {
    playHead: undefined,
  };

  croppingData:
    | {
        x: number;
        y: number;
        radius: number;
      }
    | undefined;

  grid = {
    verticalLines: 3,
    horizontalLines: 2,
  };

  viewport?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  size?: {
    width: number;
    height: number;
  };

  /** Angular DOM renderer, used only to set cursor styles on
   * `konvaContainer` while hovering boundaries/scrollbar. Set externally
   * by AudioViewerService's `renderer` pass-through accessor. */
  renderer?: Renderer2;

  private refreshRunning = false;

  // ---- "ambient" media/geometry state read live by Konva callbacks --
  audioChunk: AudioChunk | undefined;
  audioTCalculator: AudioTimeCalculator | undefined;
  protected playcursor: PlayCursor | undefined;

  get PlayCursor(): PlayCursor | undefined {
    return this.playcursor;
  }

  set PlayCursor(playcursor: PlayCursor | undefined) {
    this.playcursor = playcursor;
  }

  private _minmaxarray: number[] = [];

  get minmaxarray(): number[] {
    return this._minmaxarray;
  }

  set minmaxarray(value: number[]) {
    this._minmaxarray = value;
  }

  private _zoomX = 1;
  private _zoomY = 1;

  get zoomX(): number {
    return this._zoomX;
  }

  set zoomX(value: number) {
    this._zoomX = value;
  }

  get zoomY(): number {
    return this._zoomY;
  }

  set zoomY(value: number) {
    this._zoomY = value;
  }

  public secondsPerLine = 5;
  public silencePlaceholder?: string;

  private _innerWidth: number | undefined;

  get innerWidth(): number {
    if (this._innerWidth !== undefined) {
      return this._innerWidth;
    }
    return 0;
  }

  protected audioPxW = 0;

  get AudioPxWidth(): number {
    return this.audioPxW;
  }

  set audioPxWidth(value: number) {
    this.audioPxW = value;
  }

  /** Synced by reference from AudioViewerService's `settings` setter (and
   * once, at construction). Since AudioviewerConfig instances are mutated
   * in place elsewhere (`this.settings.pixelPerSec = ...` etc.) rather
   * than replaced, holding the same object reference keeps this in sync
   * automatically without a proxy accessor. */
  settings: AudioViewerRenderSettings = DEFAULT_RENDER_SETTINGS;

  public get audioManager(): AudioManager | undefined {
    return this.audioChunk?.audioManager;
  }

  // =====================================================================
  // Stage / layer / view setup
  // =====================================================================

  public initialize(
    stageWidth: number | undefined,
    stageHeight: number | undefined,
    container: HTMLDivElement | undefined,
    audioChunk: AudioChunk | undefined,
    stageEventHandlers: AudioViewerStageEventHandlers,
    onWheel: (event: KonvaEventObject<any>) => void,
  ) {
    if (stageWidth && stageHeight && container) {
      this.konvaContainer = container;
      this.audioChunk = audioChunk;
      this.updateSize(stageWidth, stageHeight);
      const optionalScrollbarWidth = this.settings.scrollbar.enabled
        ? this.settings.scrollbar.width
        : 0;
      this._innerWidth =
        this.size!.width -
        (this.settings.margin.left + this.settings.margin.right) -
        optionalScrollbarWidth;
      this.settings.pixelPerSec = this.timeUtils.getPixelPerSecond(
        this.secondsPerLine,
        this.innerWidth,
        this.audioChunk,
      );

      if (!this.settings.multiLine && this.size) {
        this.settings.lineheight =
          this.size.height -
          this.settings.margin.top -
          this.settings.margin.bottom;
      }

      if (!this.stage) {
        this.stage = new Stage({
          container, // id of container <div>,
          width: this.size!.width,
          height: this.size!.height,
        });
        this.initializeLayers(onWheel);

        if (this.layers) {
          for (const [, layer] of Object.entries(this.layers)) {
            this.stage.add(layer);
          }
        }
      } else {
        this.stage.width(this.size!.width);
        this.stage.height(this.size!.height);
      }

      this.updateViewPort();
      this.initializeStageContainer(stageEventHandlers);
    }
  }

  public showOnlyLinesInViewport() {
    if (this.viewport && this.layers?.background) {
      const lines = this.layers.background.find('.line');
      let i = 0;
      for (const line of lines) {
        line.visible(
          this.isVisibleInView(line.x(), line.y(), line.width(), line.height()),
        );
        i++;
      }
    }
  }

  public bringToFront(name: string) {
    this.layers?.overlay.find(name).map((a) => {
      // selections to foreground
      a.zIndex((this.layers?.overlay.children?.length ?? 1) - 1);
      return a;
    });
  }

  /**
   * Called on stage resize. `initializeSettings`/`scrollToAbsY` stay on
   * AudioViewerService (they're audio-domain, not rendering — they set up
   * `audioTCalculator`/mouse-cursor/drawn-selection state and scroll the
   * mouse position respectively) so they're supplied as callbacks.
   *
   * Returns whether the guarded resize logic actually ran (and completed
   * without throwing) — AudioViewerService's thin wrapper uses this to
   * decide whether to restore `drawnSelection` and redraw the selection,
   * matching the original method's behavior of only doing so inside the
   * same guard/try that ran the rest of the method.
   */
  public onResize = async (
    newWidth: number | undefined,
    newHeight: number | undefined,
    segmentCtx: AudioViewerSegmentRenderContext,
    stageEventHandlers: AudioViewerStageEventHandlers,
    onWheel: (event: KonvaEventObject<any>) => void,
    onScrollbarDragged: () => void,
    resizeCallbacks: {
      initializeSettings: () => Promise<void>;
      scrollToAbsY: (absY: number) => void;
    },
  ): Promise<boolean> => {
    let completed = false;
    try {
      if (
        this.audioChunk !== undefined &&
        segmentCtx.currentLevel &&
        this.stage !== undefined &&
        newWidth &&
        newHeight &&
        segmentCtx.currentLevel.items.length > 0
      ) {
        const playpos = this.audioChunk?.absolutePlayposition.clone();
        const viewport = this.viewport;
        this.initialize(
          newWidth,
          newHeight,
          this.konvaContainer,
          this.audioChunk,
          stageEventHandlers,
          onWheel,
        );
        this.settings.pixelPerSec = this.timeUtils.getPixelPerSecond(
          this.secondsPerLine,
          this.innerWidth,
          this.audioChunk,
        );
        await resizeCallbacks.initializeSettings();
        this.initializeView(segmentCtx, onScrollbarDragged);

        if (this.audioChunk !== undefined) {
          if (!this.audioChunk.isPlaying) {
            this.audioChunk.absolutePlayposition = playpos.clone();
          }
        }
        resizeCallbacks.scrollToAbsY(viewport!.y!);
        this.bringToFront('#timeStamps');
        this.bringToFront('.line-selections');

        this.updatePlayCursor();
        this.layers?.playhead.draw();
        completed = true;
      }
    } catch (e) {
      //ignore
      console.error(e);
    }
    return completed;
  };

  public initializeView(
    segmentCtx: AudioViewerSegmentRenderContext,
    onScrollbarDragged: () => void,
  ) {
    const currentLevel = segmentCtx.currentLevel;
    if (
      currentLevel &&
      currentLevel.items.length > 0 &&
      this.stage &&
      this.size?.height &&
      this.layers
    ) {
      this.stage.height(this.size.height);

      for (const [, value] of Object.entries(this.layers)) {
        value.removeChildren();
      }

      if (
        this.settings.cropping === 'circle' &&
        this.innerWidth !== undefined
      ) {
        this.settings.lineheight = this.innerWidth;
        const circleWidth = this.innerWidth - 5;
        this.croppingData = {
          x: circleWidth / 2 + 2 + this.settings.margin.left,
          y: circleWidth / 2 + 2 + this.settings.margin.top,
          radius: circleWidth / 2,
        };
      }

      const addSingleLineOnly = () => {
        if (this.innerWidth !== undefined) {
          const line = this.createLine(
            new Size(this.innerWidth, this.settings.lineheight),
            new Position(this.settings.margin.left, 0),
            0,
          );
          this.layers?.background.add(line);
          this.canvasElements.lastLine = line;
        }
      };

      if (
        this.settings.multiLine &&
        this.audioChunk!.time!.duration.seconds > this.secondsPerLine
      ) {
        let lineWidth = this.innerWidth;

        if (lineWidth !== undefined) {
          const numOfLines = Math.ceil(this.AudioPxWidth / lineWidth);
          let y = 0;
          if (numOfLines > 1) {
            let drawnWidth = 0;
            for (let i = 0; i < numOfLines - 1; i++) {
              const line = this.createLine(
                new Size(lineWidth, this.settings.lineheight),
                new Position(this.settings.margin.left, y),
                i,
              );
              line.listening(false);
              line.visible(
                this.isVisibleInView(
                  line.x(),
                  line.y(),
                  line.width(),
                  line.height(),
                ),
              );

              this.layers.background.add(line);
              y += this.settings.lineheight + this.settings.margin.top;
              this.canvasElements.lastLine = line;
              drawnWidth += lineWidth;
            }
            // add last line
            lineWidth = this.AudioPxWidth - drawnWidth;
            if (lineWidth > 0) {
              const line = this.createLine(
                new Size(lineWidth, this.settings.lineheight),
                new Position(this.settings.margin.left, y),
                numOfLines - 1,
              );
              this.layers.background.add(line);
              this.canvasElements.lastLine = line;
            }
          } else {
            addSingleLineOnly();
          }
        } else {
          addSingleLineOnly();
        }
      } else {
        addSingleLineOnly();
      }

      // this.layers.background.batchDraw();
      this.updateAllSegments(false, segmentCtx);

      let y = 0;
      let lineWidth = this.innerWidth!;
      const numOfLines = Math.ceil(this.AudioPxWidth / lineWidth);

      let drawnWidth = 0;
      const selectionGroup = new Group({
        name: 'line-selections',
      });

      for (let i = 0; i < numOfLines - 1; i++) {
        const selectElem = this.createLineSelectionGroup(
          new Size(lineWidth, this.settings.lineheight),
          new Position(this.settings.margin.left, y),
          i,
        );

        selectionGroup.add(selectElem);
        y += this.settings.lineheight + this.settings.margin.top;
        drawnWidth += lineWidth;
      }

      // add last line
      lineWidth = this.AudioPxWidth - drawnWidth;
      if (lineWidth > 0) {
        const selectElem = this.createLineSelectionGroup(
          new Size(lineWidth, this.settings.lineheight),
          new Position(this.settings.margin.left, y),
          numOfLines - 1,
        );
        selectionGroup.add(selectElem);
      }

      this.layers.overlay.add(selectionGroup);
      this.layers.overlay.batchDraw();

      this.canvasElements.playHead = this.createLinePlayCursor();
      if (this.settings.selection.enabled) {
        this.layers.playhead.add(this.canvasElements.playHead);
      }

      this.canvasElements.mouseCaret = this.createLineMouseCaret();
      this.layers.playhead.add(this.canvasElements.mouseCaret);

      if (
        this.settings.cropping === 'circle' &&
        this.croppingData !== undefined
      ) {
        const cropGroup = this.createCropContainer();
        this.layers.playhead.removeChildren();
        this.canvasElements.mouseCaret.position({
          x: this.croppingData.radius + 2,
          y: 2,
        });

        cropGroup.add(this.canvasElements.playHead);
        cropGroup.add(this.canvasElements.mouseCaret);
        this.layers.playhead.add(cropGroup);
      }

      if (this.settings.scrollbar.enabled) {
        this.canvasElements.scrollBar =
          this.createScrollBar(onScrollbarDragged);
        if (this.canvasElements?.scrollBar !== undefined) {
          this.layers.scrollBars.add(this.canvasElements.scrollBar);
        }
      }

      this.stage.batchDraw();
    }
  }

  /** True if `initializeView` actually (re)built the view — lets
   * AudioViewerService's thin wrapper decide whether to emit
   * `onInitialized`, matching the original method's behavior of only
   * emitting inside the same guard that ran the rest of the method. */
  public initializeViewAndReportInitialized(
    segmentCtx: AudioViewerSegmentRenderContext,
    onScrollbarDragged: () => void,
  ): boolean {
    const currentLevel = segmentCtx.currentLevel;
    const willRun = !!(
      currentLevel &&
      currentLevel.items.length > 0 &&
      this.stage &&
      this.size?.height &&
      this.layers
    );
    this.initializeView(segmentCtx, onScrollbarDragged);
    return willRun;
  }

  public updateLines = () => {
    if (this.layers?.background && this.layers?.overlay) {
      const lines: Group[] | undefined = this.layers.background.find('.line');
      const lineSelections: Group[] | undefined =
        this.layers.overlay.find('.line-selection');

      if (this.innerWidth !== undefined) {
        if (lines && lineSelections) {
          // check all lines but the last one
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineSelection = lineSelections[i];
            line.width(this.innerWidth);
            lineSelection.width(this.innerWidth);
            const geometrics = line.getChildren();
            for (let j = 0; j < geometrics.length; j++) {
              const elem = geometrics[j];
              if (
                (lines.length > 1 && i < lines.length - 1) ||
                lines.length === 1
              ) {
                elem.width(this.innerWidth);
              } else {
                const width = this.AudioPxWidth % this.innerWidth;
                line.width(width);
                // last line
                elem.width(width);
              }
            }

            line.visible(
              this.isVisibleInView(
                line.x(),
                line.y(),
                line.width(),
                line.height(),
              ),
            );
          }
        }

        const scrollbars = this.layers?.scrollBars.find('#scrollBar');
        if (scrollbars !== undefined && scrollbars.length > 0) {
          scrollbars[0].x(this.innerWidth + this.settings.margin.left);
        }
      }
    }
  };

  public updateViewPort() {
    if (this.size && this.layers?.background) {
      this.viewport = {
        x: Math.abs(this.layers.background.x()),
        y: Math.abs(this.layers.background.y()),
        width: this.size.width,
        height: this.size.height,
      };
    }
  }

  public createCropContainer(id?: string): Group {
    return new Group({
      id,
      clipFunc: (ctx) => {
        if (this.croppingData !== undefined) {
          ctx.arc(
            this.croppingData.x,
            this.croppingData.y,
            this.croppingData.radius,
            0,
            Math.PI * 2,
            false,
          );
        }
      },
    });
  }

  public createLineBackground(line: Group, size: Size) {
    const container = new Rect({
      fill: this.settings.backgroundcolor,
      width: size.width,
      height: size.height,
      transformsEnabled: 'position',
    });
    line.add(container);
  }

  public createLineBorder(line: Group, size: Size) {
    const frame = new Rect({
      stroke: this.settings.frame.color,
      strokeWidth: 1,
      width: size.width,
      height: size.height,
      transformsEnabled: 'position',
    });
    line.add(frame);
  }

  public createLineSelection(line: Group, size: Size) {
    const frame = new Rect({
      name: 'selection',
      opacity: 0.2,
      fill: this.settings.selection.color,
      width: 0,
      height: size.height,
      transformsEnabled: 'position',
    });
    line.add(frame);
  }

  public createLineGrid(line: Group, size: Size) {
    const frame = new Shape({
      opacity: 0.2,
      stroke: this.settings.grid.color,
      strokeWidth: 1,
      width: size.width,
      height: size.height,
      sceneFunc: this.sceneFuncGrid,
      transformsEnabled: 'position',
    });
    frame.perfectDrawEnabled(false);
    line.add(frame);
  }

  public sceneFuncGrid = (context: Context, shape: Shape) => {
    if (
      this.layers !== undefined &&
      this.stage !== undefined &&
      this.audioManager !== undefined &&
      this.audioTCalculator !== undefined
    ) {
      const position = {
        x: 0,
        y: 0,
      };
      const pxPerSecond = Math.round(
        this.audioTCalculator.samplestoAbsX(
          new SampleUnit(
            this.audioManager.sampleRate,
            this.audioManager.sampleRate,
          ),
        ),
      );

      if (pxPerSecond >= 5) {
        const timeLineHeight = this.settings.timeline.enabled
          ? this.settings.timeline.height
          : 0;
        const vZoom = Math.round(
          (this.settings.lineheight - timeLineHeight) /
            this.grid.horizontalLines,
        );

        if (pxPerSecond > 0 && vZoom > 0) {
          // --- get the appropriate context
          context.beginPath();

          // set horizontal lines
          for (
            let y = Math.round(vZoom / 2);
            y < this.settings.lineheight - timeLineHeight;
            y = y + vZoom
          ) {
            context.moveTo(position.x, y + position.y);
            context.lineTo(
              position.x +
                shape.width() -
                (this.settings.margin.left + this.settings.margin.right),
              y + position.y,
            );
          }
          // set vertical lines
          for (
            let x = pxPerSecond;
            x <
            shape.width() -
              (this.settings.margin.left + this.settings.margin.right);
            x = x + pxPerSecond
          ) {
            context.moveTo(position.x + x, position.y);
            context.lineTo(
              position.x + x,
              position.y + this.settings.lineheight - timeLineHeight,
            );
          }

          context.stroke();
          context.fillStrokeShape(shape);
        }
      }
    }
  };

  public createLinePlayCursor() {
    const group = new Group({
      name: 'playhead',
      x: this.settings.margin.left - this.settings.playcursor.width / 2,
      y: 0,
      transformsEnabled: 'position',
    });

    const frame = new Rect({
      fill: this.settings.playcursor.color,
      width: this.settings.playcursor.width,
      height: this.settings.lineheight,
      opacity: 0.25,
      transformsEnabled: 'position',
    });

    const caret = new Line({
      points: [
        this.settings.playcursor.width / 2,
        0,
        this.settings.playcursor.width / 2,
        this.settings.lineheight,
      ],
      stroke: 'black',
      strokeWidth: 2,
      transformsEnabled: 'position',
    });

    group.add(frame);
    group.add(caret);

    if (this.layers !== undefined) {
      this.animation.playHead = new Animation(
        this.doPlayHeadAnimation,
        this.layers.playhead,
      );
    }

    return group;
  }

  public createLine(size: Size, position: Position, lineNum: number): Group {
    const result = new Group({
      name: 'line',
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      transformsEnabled: 'position',
    });

    let lineGroup = result;

    if (this.settings.cropping === 'circle' && this.innerWidth !== undefined) {
      lineGroup = this.createCropContainer();
      size = new Size(this.innerWidth, this.innerWidth);
    }

    this.createLineBackground(lineGroup, size);
    this.createLineGrid(lineGroup, size);
    this.createLineSignal(lineGroup, size, lineNum);
    this.createLineBorder(lineGroup, size);

    if (
      this.settings.cropping === 'circle' &&
      this.croppingData !== undefined
    ) {
      const shadowCircle = new Circle({
        stroke: '#555555',
        strokeWidth: 1,
        x: this.croppingData.x,
        y: this.croppingData.y,
        radius: this.croppingData.radius,
        shadowColor: 'gray',
        shadowEnabled: true,
        shadowBlur: 5,
        shadowOffset: { x: 2.5, y: 0 },
        shadowOpacity: 1,
      });
      result.add(shadowCircle);
      result.add(lineGroup);
      const borderedCircle = new Circle({
        stroke: '#555555',
        strokeWidth: 1,
        x: this.croppingData.x,
        y: this.croppingData.y,
        radius: this.croppingData.radius,
      });
      result.add(borderedCircle);
    }

    return result;
  }

  public createLineSelectionGroup(
    size: Size,
    position: Position,
    lineNum: number,
  ): Group {
    const result = new Group({
      name: 'line-selection',
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    });

    let lineGroup = result;

    if (this.settings.cropping === 'circle' && this.innerWidth !== undefined) {
      lineGroup = this.createCropContainer();
      size = new Size(this.innerWidth, this.innerWidth);
    }

    this.createLineSelection(lineGroup, size);

    if (
      this.settings.cropping === 'circle' &&
      this.croppingData !== undefined
    ) {
      const shadowCircle = new Circle({
        stroke: '#555555',
        strokeWidth: 1,
        x: this.croppingData.x,
        y: this.croppingData.y,
        radius: this.croppingData.radius,
        shadowColor: 'gray',
        shadowEnabled: true,
        shadowBlur: 5,
        shadowOffset: { x: 2.5, y: 0 },
        shadowOpacity: 1,
      });
      result.add(shadowCircle);
      result.add(lineGroup);
      const borderedCircle = new Circle({
        stroke: '#555555',
        strokeWidth: 1,
        x: this.croppingData.x,
        y: this.croppingData.y,
        radius: this.croppingData.radius,
      });
      result.add(borderedCircle);
    }

    return result;
  }

  public createLineSignal(line: Group, size: Size, lineNum: number) {
    const frame = new Shape({
      stroke: this.settings.data.color,
      strokeWidth: 1,
      width: size.width,
      height: size.height,
      sceneFunc: (context, shape) => {
        this.sceneFuncSignal(context, shape, lineNum);
      },
      transformsEnabled: 'position',
    });
    line.add(frame);
  }

  public sceneFuncSignal = (
    context: Context,
    shape: Shape,
    lineNum: number,
  ) => {
    if (
      this.layers !== undefined &&
      this.stage !== undefined &&
      this.innerWidth
    ) {
      const timeLineHeight = this.settings.timeline.enabled
        ? this.settings.timeline.height
        : 0;
      const midline = Math.round(
        (this.settings.lineheight - timeLineHeight) / 2,
      );
      const absXPos = lineNum * this.innerWidth;

      const zoomX = this.zoomX;
      const zoomY = this.zoomY;

      const position = {
        x: 0,
        y: 0,
      };
      context.beginPath();
      context.moveTo(
        position.x,
        position.y + midline - this.minmaxarray[absXPos],
      );

      if (
        !(midline === null || midline === undefined) &&
        !(zoomY === null || zoomY === undefined)
      ) {
        for (let x = 0; x + absXPos < absXPos + shape.width(); x++) {
          const xDraw = !this.settings.roundValues
            ? position.x + x * zoomX
            : Math.round(position.x + x * zoomX);
          const yDraw = !this.settings.roundValues
            ? position.y + midline - this.minmaxarray[x + absXPos] * zoomY
            : Math.round(
                position.y + midline - this.minmaxarray[x + absXPos] * zoomY,
              );

          if (!isNaN(yDraw) && !isNaN(xDraw)) {
            context.lineTo(xDraw, yDraw);
          } else {
            context.lineTo(x, midline);
          }
        }
      } else {
        if (midline === undefined || midline === undefined) {
          throw Error('midline is undefined!');
        } else if (zoomY === undefined || zoomY === undefined) {
          throw Error('ZoomY is undefined!');
        }
      }
      context.fillStrokeShape(shape);
    }
  };

  public doPlayHeadAnimation = () => {
    this.updatePlayCursor();
  };

  public updatePlayCursor = () => {
    if (
      this.settings.selection.enabled &&
      this.audioChunk &&
      this.canvasElements?.playHead &&
      this.audioTCalculator &&
      this.audioChunk.relativePlayposition &&
      this.PlayCursor
    ) {
      let currentAbsX = this.audioTCalculator.samplestoAbsX(
        this.audioChunk.relativePlayposition,
      );
      const endAbsX = this.audioTCalculator.samplestoAbsX(
        this.audioChunk.time.end.sub(this.audioChunk.time.start),
      );
      currentAbsX = Math.min(currentAbsX, endAbsX - 1);
      this.changePlayCursorAbsX(currentAbsX);

      // get line of PlayCursor
      const cursorPosition = this.timeUtils.getPlayCursorPositionOfLineByAbsX(
        this.PlayCursor.absX,
        this.innerWidth,
        this.settings,
      );
      this.canvasElements.playHead.position(cursorPosition);
    }
  };

  public changePlayCursorAbsX = (newValue: number) => {
    if (
      this.audioChunk !== undefined &&
      this.PlayCursor !== undefined &&
      this.audioTCalculator !== undefined
    ) {
      this.PlayCursor.changeAbsX(
        newValue,
        this.audioTCalculator,
        this.AudioPxWidth,
        this.audioChunk,
      );
    }
  };

  // =====================================================================
  // Segments / boundaries
  // =====================================================================

  /**
   * Per-segment layout computed by updateAllSegments' loop, extracted per
   * the design review's flag that the original ~190-line method needed
   * decomposing. Computes the segment's shape (via createSegmentOnCanvas)
   * and, if the segment ends within the audio, the boundary line to draw
   * for it — pure layout math plus the one createSegmentOnCanvas call,
   * with no drawing of its own.
   */
  private layoutSegment(params: {
    segment: TrattAnnotationSegment;
    index: number;
    startIndex: number;
    endIndex: number;
    numOfLines: number;
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
  }): {
    shape?: Group;
    boundary?: { x: number; y: number; num: number; id: number };
  } {
    const {
      segment,
      index: i,
      startIndex,
      endIndex,
      numOfLines,
      currentLevel,
    } = params;
    const result: {
      shape?: Group;
      boundary?: { x: number; y: number; num: number; id: number };
    } = {};

    if (
      this.audioManager === undefined ||
      this.audioChunk === undefined ||
      this.audioTCalculator === undefined ||
      this.innerWidth === undefined
    ) {
      return result;
    }

    const segments = currentLevel.items as TrattAnnotationSegment[];
    const beginTime =
      i > 0
        ? segments[i - 1].time.clone()
        : this.audioManager.createSampleUnit(0);
    const start = beginTime.sub(this.audioChunk.time.start.clone());
    const absXStart = this.audioTCalculator.samplestoAbsX(
      start,
      this.audioChunk.time.duration,
    );
    const absXEnd = this.audioTCalculator.samplestoAbsX(
      segment.time,
      this.audioChunk.time.duration,
    );

    const yStart =
      (this.innerWidth < this.AudioPxWidth
        ? Math.floor(absXStart / this.innerWidth)
        : 0) *
      (this.settings.lineheight + this.settings.margin.top);

    const yEnd =
      (this.innerWidth < this.AudioPxWidth
        ? Math.ceil(absXEnd / this.innerWidth)
        : 0) *
      (this.settings.lineheight + this.settings.margin.top);

    if (
      !this.isVisibleInView(
        0,
        yStart,
        this.innerWidth,
        yEnd - yStart === 0 ? this.settings.lineheight : yEnd - yStart,
      )
    ) {
      return result;
    }

    const createdShapes = this.createSegmentOnCanvas(
      numOfLines,
      { index: i, segment },
      { start: startIndex, end: endIndex },
      currentLevel,
    );

    if (createdShapes) {
      result.shape = createdShapes.overlayGroup;
    }

    // draw boundary
    if (
      segment.time.samples !==
        this.audioManager.resource.info.duration.samples &&
      segment.time.samples <= this.audioManager.resource.info.duration.samples
    ) {
      let relX = 0;
      if (this.settings.multiLine) {
        relX = (absXStart % this.innerWidth) + this.settings.margin.left;
      } else {
        relX = absXStart + this.settings.margin.left;
      }

      result.boundary = { x: relX, y: yStart, num: i, id: segment.id };
    }

    return result;
  }

  public updateAllSegments(
    clearAll = false,
    segmentCtx: AudioViewerSegmentRenderContext,
  ) {
    const currentLevel = segmentCtx.currentLevel;
    const y = 0;
    const segCanvasElements = this.layers?.overlay.find('.segments');
    if (clearAll) {
      segCanvasElements?.forEach((a) => a.destroy());
    }

    const segTimeLabels = this.layers?.overlay.find('#timeStamps');
    if (clearAll) {
      segTimeLabels?.forEach((a) => a.destroy());
    }

    if (clearAll && this.layers?.boundaries) {
      this.layers.boundaries.children.forEach((a) => a.destroy());
      this.layers.boundaries.children = [];
    }

    if (this.innerWidth !== undefined) {
      const maxLineWidth = this.innerWidth;
      let numOfLines = Math.ceil(this.AudioPxWidth / maxLineWidth);
      if (!this.settings.multiLine) {
        numOfLines = 1;
      }

      if (
        this.audioManager !== undefined &&
        this.layers !== undefined &&
        this.layers.overlay !== undefined &&
        currentLevel &&
        currentLevel.items.length > 0 &&
        this.audioChunk !== undefined &&
        this.viewport &&
        this._innerWidth &&
        this.size
      ) {
        let root: Group | Layer = this.layers.overlay;

        if (this.settings.cropping === 'circle' && !this.settings.multiLine) {
          const cropGroup = new Group({
            clipFunc: (ctx) => {
              if (this.croppingData !== undefined) {
                ctx.arc(
                  this.croppingData.x,
                  this.croppingData.y,
                  this.croppingData.radius,
                  0,
                  Math.PI * 2,
                  false,
                );
              }
            },
          });

          this.layers.overlay.add(cropGroup);
          root = cropGroup;
        }

        const { startIndex, endIndex } = getSegmentsOfRange(
          currentLevel.items as TrattAnnotationSegment[],
          this.audioChunk.time.start.clone(),
          this.audioChunk.time.end.clone(),
        );
        const segments = currentLevel.items as TrattAnnotationSegment[];

        const boundariesToDraw: {
          x: number;
          y: number;
          num: number;
          id: number;
        }[] = [];

        if (
          this.audioTCalculator !== undefined &&
          startIndex >= 0 &&
          endIndex >= 0 &&
          endIndex >= startIndex
        ) {
          const newShapes: (Group | Shape)[] = [];

          for (let i = startIndex; i <= endIndex; i++) {
            const { shape, boundary } = this.layoutSegment({
              segment: segments[i],
              index: i,
              startIndex,
              endIndex,
              numOfLines,
              currentLevel,
            });
            if (shape) {
              newShapes.push(shape);
            }
            if (boundary) {
              boundariesToDraw.push(boundary);
            }
          }

          // draw time labels
          if (this.settings.showTimePerLine) {
            const foundText = this.layers.overlay.findOne('#timeStamps');
            if (foundText !== undefined) {
              foundText.remove();
            }
            const timeStampLabels = new Shape({
              id: 'timeStamps',
              width: this.innerWidth,
              height: this.size.height,
              x: this.settings.margin.left,
              y: this.settings.margin.top,
              fontSize: 10,
              fontFamily: 'Arial',
              transformsEnabled: 'position',
              sceneFunc: (context, shape) => {
                this.timeLabelSceneFunction(y, numOfLines, context, shape);
              },
            });
            this.layers.overlay.add(timeStampLabels);
          }

          this.drawAllBoundaries(segmentCtx);

          const segmentsGroup = new Group({
            name: 'segments',
          });
          segmentsGroup.add(...newShapes);
          root.add(segmentsGroup);
        }
      }
    }

    this.bringToFront('#timeStamps');
    this.bringToFront('.line-selections');
  }

  public drawAllBoundaries(segmentCtx: AudioViewerSegmentRenderContext) {
    // draw boundaries after all overlays were drawn
    const currentLevel = segmentCtx.currentLevel;

    if (
      this.audioManager !== undefined &&
      this.layers !== undefined &&
      this.layers.overlay !== undefined &&
      currentLevel &&
      this.innerWidth &&
      currentLevel.items.length > 0 &&
      this.audioChunk !== undefined
    ) {
      let y = 0;
      const { startIndex, endIndex } = getSegmentsOfRange(
        currentLevel.items as TrattAnnotationSegment[],
        this.audioChunk.time.start.clone(),
        this.audioChunk.time.end.clone(),
      );
      const segments = currentLevel.items as TrattAnnotationSegment[];

      const boundariesToDraw: {
        x: number;
        y: number;
        num: number;
        id: number;
      }[] = [];

      if (this.audioTCalculator !== undefined) {
        for (let i = startIndex; i <= endIndex; i++) {
          const segment = segments[i];
          const start = segment.time.sub(this.audioChunk.time.start.clone());
          const absX = this.audioTCalculator.samplestoAbsX(
            start,
            this.audioChunk.time.duration,
          );

          y =
            (this.innerWidth < this.AudioPxWidth
              ? Math.floor(absX / this.innerWidth)
              : 0) *
            (this.settings.lineheight + this.settings.margin.top);

          // draw boundary
          if (
            segment.time.samples !==
              this.audioManager.resource.info.duration.samples &&
            segment.time.samples <=
              this.audioManager.resource.info.duration.samples
          ) {
            let relX = 0;
            if (this.settings.multiLine) {
              relX = (absX % this.innerWidth) + this.settings.margin.left;
            } else {
              relX = absX + this.settings.margin.left;
            }

            boundariesToDraw.push({ x: relX, y, num: i, id: segment.id });
          }
        }

        if (this.settings.boundaries.enabled) {
          this.layers.boundaries.children.forEach((a) => a.destroy());
          this.drawNewBoundaries(boundariesToDraw, segmentCtx);
          this.layers.boundaries.batchDraw();
        }
      }
    }
  }

  public drawNewBoundaries(
    boundariesToDraw: { x: number; y: number; num: number; id: number }[],
    segmentCtx: AudioViewerSegmentRenderContext,
  ) {
    const {
      annotation,
      currentLevel,
      onBoundaryMouseDown,
      onSpeakerLabelChanged,
    } = segmentCtx;
    if (this.layers) {
      let boundaryRoot: Group | Layer = this.layers.boundaries;
      if (this.settings.cropping === 'circle') {
        boundaryRoot = this.layers.boundaries.findOne(`#boundary-root`) as any;

        if (boundaryRoot === undefined) {
          boundaryRoot = this.createCropContainer('boundary-root');
          this.layers.boundaries.add(boundaryRoot);
        }
      }

      for (const boundary of boundariesToDraw) {
        const h = this.settings.lineheight;

        const foundBoundary = this.layers.boundaries.findOne(
          `#boundary_${boundary.id}`,
        );
        if (foundBoundary !== undefined) {
          foundBoundary.remove();
        }

        const boundaryObj = new Line({
          id: `boundary_${boundary.id}`,
          strokeWidth: this.settings.boundaries.width,
          stroke: this.settings.boundaries.color,
          points: [boundary.x, boundary.y, boundary.x, boundary.y + h],
          transformsEnabled: 'position',
        });

        boundaryObj.on('mousedown', () => {
          if (!this.settings.boundaries.readonly) {
            onBoundaryMouseDown(boundary.id);
          }
        });
        boundaryObj.on('mouseenter', () => {
          if (this.konvaContainer !== undefined) {
            this.renderer?.setStyle(this.konvaContainer, 'cursor', 'move');
          }
        });
        boundaryObj.on('mouseleave', () => {
          if (this.konvaContainer !== undefined) {
            this.renderer?.setStyle(this.konvaContainer, 'cursor', 'auto');
          }
        });

        boundaryRoot.add(boundaryObj);

        // Speaker label for the segment starting at this boundary
        if (annotation && currentLevel) {
          const allSegments = currentLevel.items as TrattAnnotationSegment[];
          const boundarySegIndex = allSegments.findIndex(
            (s) => s.id === boundary.id,
          );
          const nextSeg = allSegments[boundarySegIndex + 1];
          const speakerId = nextSeg?.getLabel('Speaker')?.value;

          const existingLabel = boundaryRoot.findOne(
            `#speaker_label_${boundary.id}`,
          );
          if (existingLabel) existingLabel.destroy();

          if (speakerId) {
            const allIds = getSpeakerIds(annotation);
            const bgColor = getSpeakerColor(speakerId, allIds);
            const textColor = getSpeakerTextColor(bgColor);

            const labelGroup = new Group({
              id: `speaker_label_${boundary.id}`,
              x: boundary.x + 4,
              y: boundary.y,
            });

            const labelText = new Text({
              text: speakerId,
              fontSize: 10,
              fill: textColor,
              x: 3,
              y: 3,
            });

            const textWidth = labelText.width();
            const textHeight = labelText.height();

            const labelRect = new Rect({
              width: textWidth + 6,
              height: textHeight + 6,
              fill: bgColor,
              cornerRadius: 2,
            });

            labelGroup.add(labelRect);
            labelGroup.add(labelText);

            labelGroup.on('click tap', () => {
              if (!annotation || !currentLevel) return;
              const currentAllSegments =
                currentLevel.items as TrattAnnotationSegment[];
              const currentBoundarySegIndex = currentAllSegments.findIndex(
                (s) => s.id === boundary.id,
              );
              const currentNextSeg =
                currentAllSegments[currentBoundarySegIndex + 1];
              if (!currentNextSeg) return;
              const currentSpeakerId =
                currentNextSeg.getLabel('Speaker')?.value ?? '';
              // no early return on empty — cycleNextSpeaker handles it
              const currentIds = getSpeakerIds(annotation);
              const nextId = cycleNextSpeaker(currentSpeakerId, currentIds);
              const clonedSeg =
                currentNextSeg.clone() as TrattAnnotationSegment;
              const changed = clonedSeg.changeLabel('Speaker', nextId);
              if (!changed) {
                clonedSeg.labels = [
                  ...clonedSeg.labels,
                  new OLabel('Speaker', nextId),
                ];
              }
              onSpeakerLabelChanged(clonedSeg);
              this.redraw();
            });

            boundaryRoot.add(labelGroup);
          }
        }
      }
    }
  }

  // ---- Per-segment shape builders (createSegmentOnCanvas decomposition) --

  private buildOverlayShape(params: {
    segment: TrattAnnotationSegment;
    lineNum1: number;
    lineNum2: number;
    segmentHeight: number;
    numOfLines: number;
    segmentInterval: { start: number; end: number };
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
  }): Shape {
    const {
      segment,
      lineNum1,
      lineNum2,
      segmentHeight,
      numOfLines,
      segmentInterval,
      currentLevel,
    } = params;
    return new Shape({
      x: this.settings.margin.left,
      y: lineNum1 * (this.settings.lineheight + this.settings.margin.top),
      fontFamily: 'Arial',
      fontSize: 9,
      width: this.innerWidth,
      height: segmentHeight,
      transformsEnabled: 'position',
      listening: false,
      sceneFunc: (context, shape) => {
        this.sceneFuncOverlay(
          context,
          shape,
          segment,
          numOfLines,
          segmentInterval,
          { start: lineNum1, end: lineNum2 },
          currentLevel,
        );
      },
    });
  }

  private buildTranscriptBackgroundShape(params: {
    segment: TrattAnnotationSegment;
    lineNum1: number;
    lineNum2: number;
    segmentHeight: number;
    numOfLines: number;
    segmentInterval: { start: number; end: number };
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
  }): Shape {
    const {
      segment,
      lineNum1,
      lineNum2,
      segmentHeight,
      numOfLines,
      segmentInterval,
      currentLevel,
    } = params;
    return new Shape({
      x: this.settings.margin.left,
      y: 0,
      width: this.innerWidth,
      listening: false,
      height: segmentHeight,
      transformsEnabled: 'position',
      sceneFunc: (context: Context, shape: Shape) => {
        this.sceneFuncTranscripts(
          context,
          shape,
          segmentInterval,
          segment,
          { from: lineNum1, to: lineNum2 },
          numOfLines,
          currentLevel,
        );
      },
    });
  }

  private buildSegmentTextShape(params: {
    segment: TrattAnnotationSegment;
    segmentInterval: { start: number; end: number };
    beginX: number;
    absX: number;
    numOfLines: number;
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
    lastIRef: { value: number | undefined };
  }): Shape {
    const {
      segment,
      segmentInterval,
      beginX,
      absX,
      numOfLines,
      currentLevel,
      lastIRef,
    } = params;
    return new Shape({
      fill: 'black',
      fontFamily: 'Arial',
      fontSize: 11,
      listening: false,
      x: this.settings.margin.left,
      y: 0,
      transformsEnabled: 'position',
      sceneFunc: (context, shape) => {
        if (
          currentLevel &&
          currentLevel.items.length > 0 &&
          this.audioManager
        ) {
          const segIndex = currentLevel.items.findIndex(
            (a) => a.id === segment.id,
          );
          const prevSeg =
            segIndex > segmentInterval.start
              ? (currentLevel.items[segIndex - 1] as TrattAnnotationSegment)
              : undefined;
          const seg = currentLevel.items[segIndex] as TrattAnnotationSegment;
          const nextSeg =
            segIndex < segmentInterval.end
              ? (currentLevel.items[segIndex + 1] as TrattAnnotationSegment)
              : undefined;
          void nextSeg;

          if (seg?.type !== 'segment') {
            return;
          }

          if (seg?.getFirstLabelWithoutName('Speaker')?.value !== undefined) {
            lastIRef.value = this.drawTextLabel(
              context,
              seg.getFirstLabelWithoutName('Speaker')!.value,
              this.innerWidth! < this.AudioPxWidth
                ? Math.floor(beginX / this.innerWidth!)
                : 0,
              this.innerWidth! < this.AudioPxWidth
                ? Math.floor(absX / this.innerWidth!)
                : 0,
              seg.time.clone(),
              prevSeg
                ? prevSeg.time.clone()
                : this.audioManager.createSampleUnit(0),
              lastIRef.value,
              numOfLines,
              seg,
              segIndex === currentLevel.items.length - 1,
            );
          }
        }
      },
    });
  }

  public createSegmentOnCanvas(
    numOfLines: number,
    segmentData: {
      index: number;
      segment: TrattAnnotationSegment;
    },
    segmentInterval: {
      start: number;
      end: number;
    },
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment>,
  ):
    | {
        overlayGroup: Group;
      }
    | undefined {
    const { segment, index } = segmentData;

    if (
      this.innerWidth &&
      this.audioManager !== undefined &&
      this.layers !== undefined &&
      this.layers.overlay !== undefined &&
      currentLevel &&
      currentLevel.items.length > 0 &&
      this.audioChunk !== undefined
    ) {
      if (this.audioTCalculator !== undefined) {
        if (segment !== undefined && segment?.time !== undefined) {
          const start = segment.time.sub(this.audioChunk.time.start.clone());
          const absX = this.audioTCalculator.samplestoAbsX(
            start,
            this.audioChunk.time.duration,
          );
          let beginTime = this.audioManager.createSampleUnit(0);
          const previousSegment: TrattAnnotationSegment | undefined =
            index > segmentInterval.start
              ? (currentLevel.items[index - 1] as TrattAnnotationSegment)
              : undefined;

          if (previousSegment && previousSegment.time !== undefined) {
            beginTime = previousSegment.time;
          }
          const beginX = this.audioTCalculator.samplestoAbsX(beginTime);
          const endX = this.audioTCalculator.samplestoAbsX(segment.time);
          const lineNum1 = this.settings.multiLine
            ? Math.floor(beginX / this.innerWidth)
            : 0;
          const lineNum2 = this.settings.multiLine
            ? Math.floor(endX / this.innerWidth)
            : 0;

          const segmentEnd = segment.time.clone();
          const audioChunkStart = this.audioChunk.time.start.clone();
          const audioChunkEnd = this.audioChunk.time.end.clone();
          let overlayGroup: Group | undefined = undefined;

          if (
            // segment start is in chunk
            (beginTime.samples >= audioChunkStart.samples &&
              beginTime.samples <= audioChunkEnd.samples) ||
            // segment end is in chunk
            (segmentEnd.samples >= audioChunkStart.samples &&
              segmentEnd.samples <= audioChunkEnd.samples) ||
            // segment start and end are out of chunk
            (beginTime.samples <= audioChunkStart.samples &&
              segmentEnd.samples >= audioChunkEnd.samples)
          ) {
            const lastIRef: { value: number | undefined } = { value: 0 };
            this.removeSegmentFromCanvas(segment.id);
            const segmentHeight =
              (lineNum2 - lineNum1 + 1) *
              (this.settings.lineheight + this.settings.margin.top);

            overlayGroup = new Group({
              id: `segment_${segment.id}`,
            });

            const overlaySegment = this.buildOverlayShape({
              segment,
              lineNum1,
              lineNum2,
              segmentHeight,
              numOfLines,
              segmentInterval,
              currentLevel,
            });

            overlayGroup.add(overlaySegment);

            if (this.settings.showTranscripts) {
              const textBackground = this.buildTranscriptBackgroundShape({
                segment,
                lineNum1,
                lineNum2,
                segmentHeight,
                numOfLines,
                segmentInterval,
                currentLevel,
              });

              overlayGroup.add(textBackground);
              const segmentText = this.buildSegmentTextShape({
                segment,
                segmentInterval,
                beginX,
                absX,
                numOfLines,
                currentLevel,
                lastIRef,
              });
              overlayGroup.add(segmentText);
            }
          }

          if (overlayGroup) {
            return { overlayGroup };
          }
        }
      }
    }

    return undefined;
  }

  public sceneFuncTranscripts = (
    context: Context,
    shape: Shape,
    segmentInterval: {
      start: number;
      end: number;
    },
    segment: TrattAnnotationSegment,
    lineInterval: {
      from: number;
      to: number;
    },
    numOfLines: number,
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment> | undefined,
  ) => {
    if (currentLevel?.items && this.audioManager && this.innerWidth) {
      const segIndex = currentLevel.items.findIndex((a) => a.id === segment.id);
      const prevSeg =
        segIndex > segmentInterval.start
          ? (currentLevel.items[segIndex - 1] as TrattAnnotationSegment)
          : undefined;
      const seg = currentLevel.items[segIndex] as TrattAnnotationSegment;

      this.transcriptBackgroundSceneFunc(
        lineInterval,
        seg,
        segIndex === currentLevel.items.length - 1,
        prevSeg ? prevSeg.time.clone() : this.audioManager.createSampleUnit(0),
        numOfLines,
        context,
        shape,
      );
    }
  };

  public sceneFuncOverlay = (
    context: Context,
    shape: Shape,
    segment: TrattAnnotationSegment,
    numOfLines: number,
    segmentInterval: {
      start: number;
      end: number;
    },
    lineInterval: {
      start: number;
      end: number;
    },
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment> | undefined,
  ) => {
    if (currentLevel?.items && this.audioManager && this.innerWidth) {
      // TODO perhaps there is a problem with segInterval if indices changes
      const segIndex = currentLevel.items.findIndex((a) => a.id === segment.id);
      const seg = currentLevel.items[segIndex] as TrattAnnotationSegment;
      const prevSeg =
        segIndex > segmentInterval.start
          ? (currentLevel.items[segIndex - 1] as TrattAnnotationSegment)
          : undefined;

      const nextSeg =
        segIndex < segmentInterval.end
          ? (currentLevel.items[segIndex + 1] as TrattAnnotationSegment)
          : undefined;

      this.overlaySceneFunction(
        { from: lineInterval.start, to: lineInterval.end },
        seg,
        nextSeg === undefined,
        prevSeg ? prevSeg.time.clone() : this.audioManager.createSampleUnit(0),
        numOfLines,
        context,
        shape,
        currentLevel,
      );
    }
  };

  public isVisibleInView(x: number, y: number, width: number, height: number) {
    if (this.viewport) {
      const view = this.viewport;
      const { topLeft, topRight, bottomLeft, bottomRight } = {
        topLeft: { x, y },
        topRight: { x: x + width, y },
        bottomLeft: { x, y: y + height },
        bottomRight: { x: x + width, y: y + height },
      };
      void topLeft;
      void topRight;
      void bottomLeft;
      void bottomRight;

      return Util.haveIntersection(
        { x, y, width, height },
        { x: view.x, y: view.y, height: view.height, width: view.width },
      );
    }
    return false;
  }

  public addNewSegmentOnCanvas(
    id: number,
    segmentCtx: AudioViewerSegmentRenderContext,
  ) {
    const currentLevel = segmentCtx.currentLevel;
    if (this.innerWidth !== undefined) {
      const maxLineWidth = this.innerWidth;
      let numOfLines = Math.ceil(this.AudioPxWidth / maxLineWidth);
      if (!this.settings.multiLine) {
        numOfLines = 1;
      }

      if (
        this.audioManager !== undefined &&
        this.layers !== undefined &&
        this.layers.overlay !== undefined &&
        currentLevel &&
        this.audioTCalculator &&
        currentLevel.items.length > 0 &&
        this.audioChunk !== undefined
      ) {
        const segments = currentLevel.items as TrattAnnotationSegment[];
        const i = currentLevel.items.findIndex((a) => a.id === id);
        const segment = segments[i];
        const start = segment.time.sub(this.audioChunk.time.start);
        const absX = this.audioTCalculator.samplestoAbsX(
          start,
          this.audioChunk.time.duration,
        );
        const y =
          (this.innerWidth < this.AudioPxWidth
            ? Math.floor(absX / this.innerWidth)
            : 0) *
          (this.settings.lineheight + this.settings.margin.top);
        const { startIndex, endIndex } = getSegmentsOfRange(
          currentLevel.items as TrattAnnotationSegment[],
          this.audioChunk.time.start,
          this.audioChunk.time.end,
        );
        const root: Group | Layer = this.layers.overlay;

        const boundariesToDraw: {
          x: number;
          y: number;
          num: number;
          id: number;
        }[] = [];

        const createdShapes = this.createSegmentOnCanvas(
          numOfLines,
          { index: i, segment: segment },
          { start: startIndex, end: endIndex },
          currentLevel,
        );

        if (createdShapes) {
          root.add(createdShapes.overlayGroup);
        }

        // draw boundary
        if (
          segment.time.samples !==
            this.audioManager.resource.info.duration.samples &&
          segment.time.samples <=
            this.audioManager.resource.info.duration.samples
        ) {
          let relX = 0;
          if (this.settings.multiLine) {
            relX = (absX % this.innerWidth) + this.settings.margin.left;
          } else {
            relX = absX + this.settings.margin.left;
          }

          boundariesToDraw.push({ x: relX, y, num: i, id: segment.id });
        }

        if (this.settings.boundaries.enabled) {
          this.drawNewBoundaries(boundariesToDraw, segmentCtx);
        }
      }
    }
  }

  public timeLabelSceneFunction = (
    y: number,
    numOfLines: number,
    context: Context,
    shape: Shape,
  ) => {
    if (
      this.canvasElements?.lastLine !== undefined &&
      this.layers !== undefined &&
      this.stage !== undefined &&
      this.audioChunk !== undefined &&
      this.innerWidth !== undefined &&
      this.innerWidth
    ) {
      for (let j = 0; j < numOfLines; j++) {
        // draw time label
        y = j * (this.settings.lineheight + this.settings.margin.top);

        let startTime =
          this.audioChunk.time.start.unix + j * (this.secondsPerLine * 1000);
        let endTime = 0;

        if (numOfLines > 1) {
          endTime = Math.min(
            startTime + this.secondsPerLine * 1000,
            this.audioChunk.time.duration.unix,
          );
          endTime = Math.ceil(endTime / 1000) * 1000;
          startTime = Math.floor(startTime / 1000) * 1000;
        } else {
          endTime =
            this.audioChunk.time.start.unix +
            this.audioChunk.time.duration.unix;
        }

        const maxDuration = this.audioChunk.time.duration.unix;
        const startTimeString = formatTimespan(startTime, {
          showHour: true,
          showMilliSeconds: !this.settings.multiLine,
          maxDuration,
        });
        const endTimeString = formatTimespan(endTime, {
          showHour: true,
          showMilliSeconds: !this.settings.multiLine,
          maxDuration,
        });
        const length = this.layers.overlay
          .getContext()
          .measureText(startTimeString).width;
        context.fillStyle = 'dimgray';
        context.fillText(startTimeString, 3, y + 8);
        context.fillText(
          endTimeString,
          (j < numOfLines - 1
            ? this.innerWidth
            : this.canvasElements.lastLine.width()) -
            length -
            3,
          y + 8,
        );
      }
    }
  };

  public transcriptBackgroundSceneFunc = (
    lineInterval: {
      from: number;
      to: number;
    },
    segment: TrattAnnotationSegment,
    isLastSegment: boolean,
    beginTime: SampleUnit,
    numOfLines: number,
    context: Context,
    shape: Shape,
  ) => {
    const viewY =
      lineInterval.from * (this.settings.lineheight + this.settings.margin.top);
    const viewHeight =
      (lineInterval.to + 1) *
        (this.settings.lineheight + this.settings.margin.top) -
      viewY;
    void viewHeight;

    if (
      this.layers !== undefined &&
      this.stage !== undefined &&
      this.canvasElements?.lastLine !== undefined &&
      this.innerWidth !== undefined
    ) {
      for (let j = lineInterval.from; j <= lineInterval.to; j++) {
        const localY =
          j * (this.settings.lineheight + this.settings.margin.top);

        if (segment?.time !== undefined) {
          const lineWidth =
            j < numOfLines - 1
              ? this.innerWidth
              : this.canvasElements.lastLine.width();
          const select = this.timeUtils.getRelativeSelectionByLine(
            j,
            lineWidth,
            beginTime,
            segment?.time,
            this.innerWidth,
            this.audioTCalculator,
            this.audioChunk,
          );

          let w = 0;
          let x = select.start;

          if (select.start > -1 && select.end > -1) {
            w = Math.abs(select.end - select.start);
          }

          if (select.start < 1 || select.start > lineWidth) {
            x = 1;
          }
          if (select.end < 1) {
            w = 0;
          }
          if (select.end < 1 || select.end > lineWidth) {
            w = select.end;
          }

          if (j === numOfLines - 1 && isLastSegment) {
            w = lineWidth - select.start + 1;
          }

          const transcript = segment.getFirstLabelWithoutName('Speaker')?.value;
          const hasTranscription =
            transcript !== undefined &&
            transcript.trim().length > 0 &&
            transcript !== this.silencePlaceholder;
          context.fillStyle = hasTranscription
            ? TRATT_COLORS.segmentTranscribed
            : this.settings.backgroundcolor;
          context.clearRect(x, localY + this.settings.lineheight - 20, w, 20);
          context.fillRect(x, localY + this.settings.lineheight - 20, w, 20);
        }
      }
      context.fillStrokeShape(shape);
    }
  };

  /**
   * Pure progress-bar geometry calc, extracted from overlaySceneFunction
   * (the design review's flagged ~193-line method) so the width/position
   * math for the ASR progress bar is separate from the actual
   * drawRoundedRect/fillText drawing calls.
   */
  private computeProgressBarLayout(params: {
    x: number;
    w: number;
    lineWidth: number;
    timestampWidth: number;
    selectStart: number;
    progress: number;
  }): {
    timeStampsWidth: number;
    progressWidth: number;
    progressStart: number;
    loadedPixels: number;
  } {
    const { x, w, lineWidth, timestampWidth, selectStart, progress } = params;
    let timeStampsWidth = 0;

    if (w === lineWidth) {
      // time labels on both sides
      timeStampsWidth = timestampWidth * 2;
    } else {
      if (x === 0 || selectStart + w === lineWidth) {
        // time label on the left or on the right
        timeStampsWidth = timestampWidth;
      }
    }

    const progressWidth = w - timeStampsWidth - 20;
    const progressStart = x + 10 + (x === 0 ? timestampWidth : 0);
    const loadedPixels = Math.round(progressWidth * (progress / 100));

    return { timeStampsWidth, progressWidth, progressStart, loadedPixels };
  }

  public overlaySceneFunction = (
    lineInterval: {
      from: number;
      to: number;
    },
    sceneSegment: TrattAnnotationSegment,
    isLastSegment: boolean,
    beginTime: SampleUnit,
    numOfLines: number,
    context: Context,
    shape: Shape,
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment> | undefined,
  ) => {
    if (
      currentLevel &&
      this.innerWidth &&
      currentLevel.items.length > 0 &&
      this.layers !== undefined &&
      this.stage !== undefined &&
      this.audioChunk &&
      this.canvasElements?.lastLine
    ) {
      if (sceneSegment && currentLevel.type === AnnotationLevelType.SEGMENT) {
        for (let j = 0; j <= lineInterval.to - lineInterval.from; j++) {
          const localY =
            j * (this.settings.lineheight + this.settings.margin.top);

          if (this.innerWidth !== undefined) {
            const startSecond = j * this.secondsPerLine;
            let endSecond = 0;

            if (numOfLines > 1) {
              endSecond = Math.ceil(
                Math.min(
                  startSecond + this.secondsPerLine,
                  this.audioChunk.time.duration.seconds,
                ),
              );
            } else {
              endSecond = Math.ceil(this.audioChunk.time.duration.seconds);
            }

            const maxDuration = this.audioChunk.time.duration.unix;

            const timeString = formatTimespan(endSecond * 1000, {
              showHour: true,
              showMilliSeconds: !this.settings.multiLine,
              maxDuration,
            });
            const timestampWidth = this.layers.overlay
              .getContext()
              .measureText(timeString).width;

            const h = this.settings.lineheight;
            const lineWidth =
              j < numOfLines - 1
                ? this.innerWidth
                : this.canvasElements.lastLine.width();
            const select = this.timeUtils.getRelativeSelectionByLine(
              j + lineInterval.from,
              lineWidth,
              beginTime,
              sceneSegment.time,
              this.innerWidth,
              this.audioTCalculator,
              this.audioChunk,
            );
            let w = 0;
            let x = select.start;

            if (select.start > -1 && select.end > -1) {
              w = Math.abs(select.end - select.start);
            }

            if (select.start < 1 || select.start > lineWidth) {
              x = 0;
            }
            if (select.end < 1) {
              w = 0;
            }
            if (select.end > lineWidth) {
              w = select.end;
            }

            if (j === numOfLines - 1 && isLastSegment) {
              w = lineWidth - select.start;
            }

            if (w === 0) {
              // skip drawing empty rect
              continue;
            }

            if (sceneSegment.context?.asr?.isBlockedBy === undefined) {
              context.clearRect(x, localY, w, h);
            } else {
              // something running
              let progressBarFillColor = '';
              let progressBarForeColor = '';
              if (
                sceneSegment.context?.asr?.isBlockedBy === ASRQueueItemType.ASR
              ) {
                // blocked by ASR
                context.fillStyle = TRATT_COLORS.asrBlockedFill;
                progressBarFillColor = TRATT_COLORS.asrBlockedProgress;
                progressBarForeColor = 'black';
              } else if (
                sceneSegment.context?.asr?.isBlockedBy ===
                ASRQueueItemType.ASRMAUS
              ) {
                context.fillStyle = TRATT_COLORS.asrMausBlockedFill;
                progressBarFillColor = TRATT_COLORS.asrMausBlockedProgress;
                progressBarForeColor = TRATT_COLORS.surfaceBackground;
              } else if (
                sceneSegment.context?.asr?.isBlockedBy === ASRQueueItemType.MAUS
              ) {
                context.fillStyle = TRATT_COLORS.mausBlockedFill;
                progressBarFillColor = TRATT_COLORS.mausBlockedProgress;
                progressBarForeColor = TRATT_COLORS.surfaceBackground;
              }
              context.clearRect(x, localY, w, h);
              context.fillRect(x, localY, w, h);

              if (
                this.settings.showProgressBars &&
                sceneSegment.context?.asr?.progressInfo !== undefined
              ) {
                const { progressWidth, progressStart, loadedPixels } =
                  this.computeProgressBarLayout({
                    x,
                    w,
                    lineWidth,
                    timestampWidth,
                    selectStart: select.start,
                    progress: sceneSegment.context.asr.progressInfo.progress,
                  });

                if (progressWidth > 10) {
                  this.drawRoundedRect(
                    context,
                    progressStart,
                    localY + 3,
                    15,
                    progressWidth,
                    5,
                    'transparent',
                    progressBarFillColor,
                  );
                  this.drawRoundedRect(
                    context,
                    progressStart,
                    localY + 3,
                    15,
                    loadedPixels,
                    5,
                    progressBarFillColor,
                  );

                  if (progressWidth > 100) {
                    const progressString = `${sceneSegment.context?.asr?.progressInfo.statusLabel} ${sceneSegment.context?.asr?.progressInfo.progress}%`;
                    const textLength =
                      context.measureText(progressString).width;
                    const textPosition = Math.round(
                      progressStart + (progressWidth - textLength) / 2,
                    );
                    context.fillStyle =
                      progressStart + loadedPixels > textPosition &&
                      progressBarForeColor === TRATT_COLORS.surfaceBackground
                        ? TRATT_COLORS.surfaceBackground
                        : 'black';
                    context.fillText(progressString, textPosition, localY + 14);
                  }
                }
              }
            }
          }
        }
        context.fillStrokeShape(shape);
      }
    }
  };

  public drawRoundedRect(
    context: any,
    x: number,
    y: number,
    height: number,
    width: number,
    radius: number,
    fillColor: string,
    strokeColor?: string,
  ) {
    if (height > 0 && width > 0) {
      context.fillStyle = fillColor;
      context.beginPath();
      context.moveTo(x + radius, y);
      context.lineTo(x + width - radius, y);
      context.quadraticCurveTo(x + width, y, x + width, y + radius);
      context.lineTo(x + width, y + height - radius);
      context.quadraticCurveTo(
        x + width,
        y + height,
        x + width - radius,
        y + height,
      );
      context.lineTo(x + radius, y + height);
      context.quadraticCurveTo(x, y + height, x, y + height - radius);
      context.lineTo(x, y + radius);
      context.quadraticCurveTo(x, y, x + radius, y);
      context.closePath();
      context.fill();
    }
    if (strokeColor !== undefined) {
      context.strokeWidth = 1;
      context.strokeStyle = strokeColor;
      context.stroke();
    }
  }

  public createScrollBar = (onScrollbarDragged: () => void) => {
    if (
      this.canvasElements?.lastLine !== undefined &&
      this.innerWidth !== undefined &&
      this.size
    ) {
      const group = new Group({
        id: 'scrollBar',
        x: this.innerWidth + this.settings.margin.left,
        y: 0,
        width: this.settings.scrollbar.width,
        height: this.size.height,
      });

      const background = new Rect({
        stroke: this.settings.scrollbar.background.stroke,
        strokeWidth: this.settings.scrollbar.background.strokeWidth,
        fill: this.settings.scrollbar.background.color,
        width: this.settings.scrollbar.width,
        height: this.size.height,
      });
      group.add(background);

      const rest =
        this.settings.scrollbar.width - this.settings.scrollbar.selector.width;
      const selector = new Rect({
        stroke: this.settings.scrollbar.selector.stroke,
        strokeWidth: this.settings.scrollbar.selector.strokeWidth,
        fill: this.settings.scrollbar.selector.color,
        width: this.settings.scrollbar.selector.width,
        height:
          (background.height() /
            (this.canvasElements.lastLine.y() +
              this.canvasElements.lastLine.height())) *
          background.height(),
        x: rest > 0 ? rest / 2 : 0,
        draggable: true,
        dragBoundFunc: (pos) => {
          if (
            this.size?.height !== undefined &&
            this.innerWidth !== undefined
          ) {
            pos.x = this.innerWidth - (rest > 0 ? rest / 2 : 0);
            pos.y = Math.max(
              Math.min(pos.y, this.size.height - selector.height()),
              0,
            );
            return pos;
          }
          return { x: 0, y: 0 };
        },
      });
      group.add(selector);
      this.canvasElements.scrollbarSelector = selector;

      selector.on('dragmove', onScrollbarDragged);

      selector.on('mouseenter', () => {
        if (this.konvaContainer !== undefined) {
          this.renderer?.setStyle(this.konvaContainer, 'cursor', 'pointer');
        }
      });
      selector.on('mouseleave', () => {
        if (this.konvaContainer !== undefined) {
          this.renderer?.setStyle(this.konvaContainer, 'cursor', 'auto');
        }
      });

      return group;
    }

    return undefined;
  };

  public drawSelection = (
    lineNum: number,
    lineWidth: number,
    drawnSelection: any,
  ) => {
    if (
      drawnSelection !== undefined &&
      drawnSelection.length > 0 &&
      this.stage !== undefined &&
      this.layers !== undefined &&
      this.innerWidth !== undefined
    ) {
      // draw gray selection
      const select = this.timeUtils.getRelativeSelectionByLine(
        lineNum,
        lineWidth,
        drawnSelection.start,
        drawnSelection.end,
        this.innerWidth,
        this.audioTCalculator,
        this.audioChunk,
      );

      const selections = this.layers.overlay.find('.selection');
      if (selections.length > lineNum && selections.length > 0) {
        if (lineNum > -1 && select) {
          const left = select.start;
          const right = select.end;
          let x = left > right ? right : left;

          let w = 0;

          if (left > -1 && right > -1) {
            w = Math.abs(right - left);
          }

          // draw selection rectangle
          if (left < 1 || left > lineWidth) {
            x = 1;
          }
          if (right < 1) {
            w = 0;
          }
          if (right < 1 || right > lineWidth) {
            w = right;
          }

          if (w > 0) {
            selections[lineNum].width(w);
            selections[lineNum].x(x);
          }
        }
      }
    }
  };

  public resetSelection() {
    if (this.layers?.overlay) {
      this.layers.overlay.find('.selection').forEach((child) => {
        child.width(0);
        child.x(0);
      });
    }
  }

  public drawWholeSelection(drawnSelection: any) {
    // draw selection
    this.resetSelection();
    if (
      this.layers !== undefined &&
      this.audioChunk !== undefined &&
      this.canvasElements?.lastLine
    ) {
      if (
        drawnSelection !== undefined &&
        !drawnSelection.duration.equals(this.audioChunk.time.duration) &&
        drawnSelection.duration.samples !== 0 &&
        this.audioTCalculator !== undefined &&
        this.innerWidth
      ) {
        drawnSelection.checkSelection();
        const selStart = this.audioTCalculator.samplestoAbsX(
          drawnSelection.start,
        );
        const selEnd = this.audioTCalculator.samplestoAbsX(drawnSelection.end);
        const lineNum1 =
          this.innerWidth < this.AudioPxWidth && this.settings.multiLine
            ? Math.floor(selStart / this.innerWidth)
            : 0;
        const lineNum2 =
          this.innerWidth < this.AudioPxWidth && this.settings.multiLine
            ? Math.floor(selEnd / this.innerWidth)
            : 0;
        const numOfLines = this.timeUtils.getNumberOfLines(
          this.innerWidth,
          this.AudioPxWidth,
        );

        for (let j = lineNum1; j <= lineNum2; j++) {
          const lineWidth =
            j < numOfLines - 1
              ? this.innerWidth
              : this.canvasElements.lastLine.width();
          this.drawSelection(j, lineWidth, drawnSelection);
        }
      }
    }
  }

  public removeSegmentFromCanvas(
    segmentID: number,
    oldAnnotation?: TrattAnnotation<any, any>,
  ) {
    void oldAnnotation;
    if (segmentID > -1) {
      const overlayGroup = this.layers?.overlay.findOne(
        `#segment_${segmentID}`,
      );
      const boundary = this.layers?.boundaries.findOne(
        `#boundary_${segmentID}`,
      );

      if (overlayGroup !== undefined) {
        overlayGroup.remove();
      }
      if (boundary !== undefined) {
        boundary.remove();
      }
    }
  }

  public redrawSegment(segmentID: number) {
    if (segmentID > -1) {
      const overlayGroup = this.layers?.overlay.findOne(
        `#segment_${segmentID}`,
      );
      const boundary = this.layers?.boundaries.findOne(
        `#boundary_${segmentID}`,
      );

      if (overlayGroup !== undefined) {
        overlayGroup.draw();
      }
      if (boundary !== undefined) {
        boundary.draw();
      }
    }
  }

  public createLineMouseCaret() {
    const group = new Group({
      name: 'mouseCaret',
      x: this.settings.margin.left,
      y: 0,
      width: 3,
      height: this.settings.lineheight,
    });

    const caret = new Line({
      points: [0, 0, 0, this.settings.lineheight],
      stroke: 'red',
      strokeWidth: 2,
      transformsEnabled: 'position',
    });

    group.add(caret);
    return group;
  }

  public refresh = (segmentCtx: AudioViewerSegmentRenderContext) => {
    const currentLevel = segmentCtx.currentLevel;
    if (
      this.audioChunk !== undefined &&
      this.audioTCalculator !== undefined &&
      currentLevel?.items &&
      currentLevel.items.length > 0 &&
      this.layers !== undefined
    ) {
      if (!this.refreshRunning) {
        this.refreshRunning = true;
        this.updateAllSegments(false, segmentCtx);
        this.layers.overlay.batchDraw();
        this.layers.boundaries.batchDraw();
        this.refreshRunning = false;
      }
    }
  };

  // ---- drawTextLabel + its pure crop helpers -------------------------

  /** Pure: shrinks `text` (already truncated to `text`) so its measured
   * width fits `maxWidth`, trimming `trimChars` extra characters as a
   * margin for whatever ellipsis the caller prepends/appends. Mirrors the
   * repeated `if (textLength > w) { leftHalf = ...; substring(...) }`
   * pattern from the original drawTextLabel, used identically by 3 of its
   * 4 branches (`textLength`, the pre-shrink measured width, is returned
   * separately from the shrunk text because at least one call site
   * positions text using the pre-shrink width — preserved verbatim from
   * the original, not "fixed", since this is a refactor not a rewrite). */
  private shrinkTextToWidth(
    text: string,
    maxWidth: number,
    measureTextWidth: (s: string) => number,
    trimChars: number,
  ): { text: string; textLength: number } {
    const textLength = measureTextWidth(text);
    if (textLength > maxWidth) {
      const leftHalf = maxWidth / textLength;
      const shrunk = text.substring(
        0,
        Math.floor(text.length * leftHalf) - trimChars,
      );
      return { text: shrunk, textLength };
    }
    return { text, textLength };
  }

  /** Pure: single-line label crop (lineNum1 === lineNum2 branch). */
  private cropSingleLineLabel(
    text: string,
    w: number,
    measureTextWidth: (s: string) => number,
  ): { text: string; textLength: number } {
    let textLength = measureTextWidth(text);
    let newText = text;
    if (textLength > w - 4) {
      // crop text
      const overflow = 1 - 1 / (textLength / (w - 35));
      const charsToRemove = Math.ceil((text.length * overflow) / 2);
      const start = Math.ceil(text.length / 2 - charsToRemove);
      const end = start + charsToRemove * 2;
      newText = text.substring(0, start);
      newText += '...';
      newText += text.substring(end);
      textLength = measureTextWidth(newText);
    }
    return { text: newText, textLength };
  }

  /** Pure: start-line label crop (j === lineNum1 branch of the
   * multi-line case). Returns the *pre-shrink* textLength alongside the
   * (possibly further-shrunk) text — see shrinkTextToWidth's doc. */
  private cropStartLineLabel(
    text: string,
    w: number,
    ratio: number,
    measureTextWidth: (s: string) => number,
  ): { text: string; textLength: number; lastI: number } {
    let newText = text.substring(0, Math.floor(text.length * ratio) - 2);
    const { text: shrunk, textLength } = this.shrinkTextToWidth(
      newText,
      w,
      measureTextWidth,
      2,
    );
    newText = shrunk;
    const lastI = newText.length;
    newText += '...';
    return { text: newText, textLength, lastI };
  }

  /** Pure: end-line label crop (j === lineNum2 branch). */
  private cropEndLineLabel(
    text: string,
    w: number,
    lastI: number,
    measureTextWidth: (s: string) => number,
  ): { text: string; textLength: number } {
    let newText = text.substring(lastI);
    const textLength = measureTextWidth(newText);

    if (textLength > w) {
      const leftHalf = w / textLength;
      newText = newText.substring(0, Math.floor(newText.length * leftHalf) - 3);
      newText = '...' + newText + '...';
    } else if (text !== this.silencePlaceholder) {
      newText = '...' + newText;
    } else {
      newText = text;
    }

    return { text: newText, textLength };
  }

  /** Pure: middle-line label crop (the remaining `lastI !== undefined`
   * branch). */
  private cropMiddleLineLabel(
    text: string,
    w: number,
    lastI: number,
    ratio: number,
    measureTextWidth: (s: string) => number,
  ): { text: string; textLength: number; lastI: number } {
    const endIndex = lastI + Math.floor(text.length * ratio);
    let newText = text.substring(lastI, endIndex);
    const textLength = measureTextWidth(newText);

    if (textLength > w) {
      const leftHalf = w / textLength;
      newText = newText.substring(0, Math.floor(newText.length * leftHalf) - 3);
    }
    const nextLastI = lastI + newText.length;

    if (text !== this.silencePlaceholder) {
      newText = '...' + newText + '...';
    } else {
      newText = text;
    }

    return { text: newText, textLength, lastI: nextLastI };
  }

  public drawTextLabel(
    context: Context,
    text: string,
    lineNum1: number,
    lineNum2: number,
    segmentEnd: SampleUnit,
    beginTime: SampleUnit,
    lastI: number | undefined,
    numOfLines: number,
    segment: TrattAnnotationSegment,
    isLastSegment: boolean,
  ): number | undefined {
    const viewY =
      lineNum1 * (this.settings.lineheight + this.settings.margin.top);
    const viewHeight =
      (lineNum2 + 1) * (this.settings.lineheight + this.settings.margin.top) -
      viewY;
    void viewHeight;

    if (
      text !== '' &&
      this.layers !== undefined &&
      this.stage !== undefined &&
      this.canvasElements?.lastLine !== undefined &&
      this.innerWidth !== undefined &&
      segment?.time !== undefined &&
      this.audioTCalculator !== undefined
    ) {
      const measureTextWidth = (s: string) => context.measureText(s).width;
      const y =
        lineNum1 * (this.settings.lineheight + this.settings.margin.top);
      for (let j = lineNum1; j <= lineNum2; j++) {
        const localY =
          (j + 1) * (this.settings.lineheight + this.settings.margin.top);

        const lineWidth =
          j < numOfLines - 1
            ? this.innerWidth
            : this.canvasElements.lastLine.width();
        const select = this.timeUtils.getRelativeSelectionByLine(
          j,
          lineWidth,
          beginTime,
          segment.time,
          this.innerWidth,
          this.audioTCalculator,
          this.audioChunk,
        );
        let w = 0;
        let x = select.start;

        if (select.start > -1 && select.end > -1) {
          w = Math.abs(select.end - select.start);
        }

        if (select.start < 1 || select.start > lineWidth) {
          x = 1;
        }
        if (select.end < 1) {
          w = 0;
        }
        if (select.end < 1 || select.end > lineWidth) {
          w = select.end;
        }

        if (j === numOfLines - 1 && isLastSegment) {
          w = lineWidth - select.start + 1;
        }

        if (lineNum1 === lineNum2) {
          const { text: newText, textLength } = this.cropSingleLineLabel(
            text,
            w,
            measureTextWidth,
          );
          const localX = (w - 4 - textLength) / 2 + x;
          context.fillText(
            newText,
            localX,
            localY - 5 - this.settings.margin.top,
          );
        } else {
          const totalWidth = this.audioTCalculator.samplestoAbsX(
            segmentEnd.sub(beginTime),
          );

          if (j === lineNum1) {
            // current line is start line
            const ratio = w / totalWidth;
            const {
              text: newText,
              textLength,
              lastI: newLastI,
            } = this.cropStartLineLabel(text, w, ratio, measureTextWidth);
            lastI = newLastI;
            const localX = (w - 4 - textLength) / 2 + x;
            context.fillText(
              newText,
              localX,
              localY - 5 - this.settings.margin.top,
            );
          } else if (j === lineNum2 && lastI !== undefined) {
            const { text: newText, textLength } = this.cropEndLineLabel(
              text,
              w,
              lastI,
              measureTextWidth,
            );
            const localX = (w - 4 - textLength) / 2 + x;
            context.fillText(
              newText,
              localX,
              localY - 5 - this.settings.margin.top,
            );
            lastI = 0;
          } else if (lastI !== undefined) {
            const ratio = w / totalWidth;
            const {
              text: newText,
              textLength,
              lastI: newLastI,
            } = this.cropMiddleLineLabel(
              text,
              w,
              lastI,
              ratio,
              measureTextWidth,
            );
            lastI = newLastI;
            const localX = (w - 4 - textLength) / 2 + x;
            context.fillText(
              newText,
              localX,
              localY - 5 - this.settings.margin.top,
            );
          }
        }
      }
      return lastI;
    }

    return undefined;
  }

  public initializeStageContainer(handlers: AudioViewerStageEventHandlers) {
    if (this.stage) {
      const stageContainer = this.stage.container();
      stageContainer.tabIndex = 1;

      // focus it
      // also stage will be in focus on its click
      stageContainer.removeEventListener('keydown', handlers.onKeyDown as any);
      stageContainer.addEventListener('keydown', handlers.onKeyDown as any);
      stageContainer.removeEventListener('keyup', handlers.onKeyUp as any);
      stageContainer.addEventListener('keyup', handlers.onKeyUp as any);
      stageContainer.removeEventListener('mouseleave', handlers.onMouseLeave);
      stageContainer.addEventListener('mouseleave', handlers.onMouseLeave);
      stageContainer.removeEventListener('mouseenter', handlers.onMouseEnter);
      stageContainer.addEventListener('mouseenter', handlers.onMouseEnter);
    }
  }

  public redraw() {
    this.stage?.batchDraw();
  }

  public redrawOverlay() {
    this.layers?.overlay.batchDraw();
  }

  public updateSize(stageWidth: number, stageHeight: number) {
    this.size = { width: stageWidth, height: stageHeight };
    this.styles.height = stageHeight;
  }

  public initializeLayers(onWheel: (event: KonvaEventObject<any>) => void) {
    if (this.stage) {
      this.layers = {
        background: new Layer({
          id: 'backgroundLayer',
          listening: false,
        }),
        overlay: new Layer({
          id: 'overlayLayer',
          listening: false,
        }),
        boundaries: new Layer({
          id: 'boundariesLayer',
        }),
        playhead: new Layer({
          id: 'playheadLayer',
          listening: false,
        }),
        scrollBars: new Layer({
          id: 'scrollBars',
        }),
      };

      this.stage.on('wheel', onWheel);
    }
  }
}

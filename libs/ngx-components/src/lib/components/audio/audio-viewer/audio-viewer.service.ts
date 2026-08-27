import { EventEmitter, Injectable, NgZone, Renderer2 } from '@angular/core';
import {
  AnnotationAnySegment,
  ASRContext,
  getStartTimeBySegmentID,
  TrattAnnotation,
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { AudioSelection, SampleUnit } from '@tratt/media';
import { SubscriptionManager } from '@tratt/utilities';
import {
  AudioChunk,
  AudioManager,
  AudioTimeCalculator,
  ShortcutManager,
} from '@tratt/web-media';
import type { Vector2d } from 'konva/lib/types';
import { ReplaySubject, Subject } from 'rxjs';
import { Subscription } from 'rxjs/internal/Subscription';
import { MultiThreadingService } from '../../../multi-threading.service';
import { PlayCursor } from '../../../obj/play-cursor';
import {
  AudioViewerInteractionService,
  type AudioViewerInteractionHost,
  type AudioViewerRenderRequest,
} from './audio-viewer-interaction.service';
import {
  AudioViewerRendererService,
  type AudioViewerSegmentRenderContext,
  type AudioViewerStageEventHandlers,
} from './audio-viewer-renderer.service';
import {
  AudioViewerSegmentsService,
  type AnnotationChange,
} from './audio-viewer-segments.service';
import { AudioViewerTimeUtils } from './audio-viewer-time-utils';
import { AudioViewerShortcutEvent } from './audio-viewer.component';
import { AudioviewerConfig } from './audio-viewer.config';

@Injectable()
export class AudioViewerService {
  /** Moved to AudioViewerInteractionService (S1 split, task 15/21) along
   * with the rest of the interaction state machine; pass-through accessors
   * keep the external contract (`audio-viewer.component.ts` reads
   * `av.focused`, `av.boundaryDragging`, `av.mouseDown`, `av.mouseCursor`,
   * `av.MouseClickPos`, `av.shortcutsManager`). */
  get focused(): boolean {
    return this.interaction.focused;
  }

  set focused(value: boolean) {
    this.interaction.focused = value;
  }

  get boundaryDragging(): Subject<{
    status: 'started' | 'stopped' | 'dragging';
    id: number;
    shiftPressed?: boolean;
  }> {
    return this.interaction.boundaryDragging;
  }

  get currentLevel():
    | TrattAnnotationAnyLevel<TrattAnnotationSegment>
    | undefined {
    return this.annotation?.currentLevel;
  }

  public get mouseCursorCanvasElement(): {
    location: Vector2d | undefined;
    size:
      | {
          height: number;
          width: number;
        }
      | undefined;
  } {
    if (this.canvasRenderer.canvasElements.mouseCaret === undefined) {
      return {
        location: {
          x: 0,
          y: 0,
        },
        size: {
          width: 0,
          height: 0,
        },
      };
    } else {
      return {
        location: this.canvasRenderer.canvasElements?.mouseCaret?.position(),
        size: this.canvasRenderer.canvasElements?.mouseCaret?.size(),
      };
    }
  }

  public playcursorchange = new EventEmitter<PlayCursor>();

  public annotationChange = new EventEmitter<
    TrattAnnotation<ASRContext, TrattAnnotationSegment>
  >();
  public currentLevelChange = new EventEmitter<{
    type: 'change' | 'remove' | 'add';
    items: {
      index?: number;
      id?: number;
      instance?: AnnotationAnySegment;
    }[];
    removeOptions?: {
      silenceCode: string | undefined;
      mergeTranscripts: boolean;
    };
  }>();

  // `stage`, `konvaContainer` and `size` moved to AudioViewerRendererService
  // (S1 split, task 14/21) — no pass-through accessor since nothing
  // outside the rendering bucket reads them; reach `this.canvasRenderer.X`
  // directly where needed.

  /** Angular DOM renderer, used by the rendering bucket to set cursor
   * styles on the canvas container. Moved to AudioViewerRendererService;
   * this pass-through preserves the external contract
   * (`audio-viewer.component.ts` does `this.av.renderer = this.renderer`). */
  public get renderer(): Renderer2 | undefined {
    return this.canvasRenderer.renderer;
  }

  public set renderer(value: Renderer2 | undefined) {
    this.canvasRenderer.renderer = value;
  }

  public shortcut = new EventEmitter<AudioViewerShortcutEvent>();
  public selchange = new EventEmitter<AudioSelection>();

  // `layers`, `canvasElements`, `styles` moved to
  // AudioViewerRendererService (S1 split, task 14/21); reach
  // `this.canvasRenderer.X` directly where needed outside the bucket.

  /** Moved to AudioViewerInteractionService (S1 split, task 15/21). */
  public get shortcutsManager(): ShortcutManager {
    return this.interaction.shortcutsManager;
  }

  public refreshOnInternChanges = true;

  /** Moved to AudioViewerRendererService (read live by its `sceneFuncGrid`
   * closure); pass-through accessor keeps this field's many other
   * (non-rendering) call sites in this class compiling unchanged. */
  public get audioTCalculator(): AudioTimeCalculator | undefined {
    return this.canvasRenderer.audioTCalculator;
  }

  public set audioTCalculator(value: AudioTimeCalculator | undefined) {
    this.canvasRenderer.audioTCalculator = value;
  }

  /** Moved to AudioViewerRendererService (read live by
   * `transcriptBackgroundSceneFunc`/`drawTextLabel`); externally settable
   * by audio-viewer.component.ts (`av.silencePlaceholder = ...`), so this
   * is a full accessor, not a one-time sync. */
  public get silencePlaceholder(): string | undefined {
    return this.canvasRenderer.silencePlaceholder;
  }

  public set silencePlaceholder(value: string | undefined) {
    this.canvasRenderer.silencePlaceholder = value;
  }

  public channelInitialized = new Subject<void>();
  public onInitialized = new ReplaySubject<void>(1);

  // `mouseClickPos`, `_focused` and `_boundaryDragging` moved to
  // AudioViewerInteractionService (S1 split, task 15/21).
  currentLevelID?: number;

  /** Moved to AudioViewerRendererService (read live by
   * `overlaySceneFunction`/`timeLabelSceneFunction`); externally settable
   * by audio-viewer.component.ts (`av.secondsPerLine = value`), so this is
   * a full accessor, not a one-time sync. */
  public get secondsPerLine(): number {
    return this.canvasRenderer.secondsPerLine;
  }

  public set secondsPerLine(value: number) {
    this.canvasRenderer.secondsPerLine = value;
  }

  // `hoveredLine` moved to AudioViewerInteractionService (task 15/21).
  public mousecursorchange = new EventEmitter<{
    event: MouseEvent | undefined;
    time: SampleUnit | undefined;
  }>();

  // `croppingData`, `animation`, `grid` moved to AudioViewerRendererService
  // (S1 split, task 14/21); reach `this.canvasRenderer.X` directly where
  // needed outside the bucket.

  annotation?: TrattAnnotation<ASRContext, TrattAnnotationSegment>;
  tempAnnotation?: TrattAnnotation<ASRContext, TrattAnnotationSegment>;
  public name = '';

  // AUDIO
  /** Moved to AudioViewerRendererService (read live by
   * `updatePlayCursor`/`changePlayCursorAbsX` and the segment-layout
   * scene functions); pass-through accessor keeps this field's many other
   * call sites in this class compiling unchanged. */
  protected get audioPxW(): number {
    return this.canvasRenderer.AudioPxWidth;
  }

  protected set audioPxW(value: number) {
    this.canvasRenderer.audioPxWidth = value;
  }

  /** Moved to AudioViewerRendererService (read live by `sceneFuncGrid`/
   * `sceneFuncSignal`/the segment-layout scene functions and set once,
   * inside the (also-moved) `initialize` method); pass-through accessor
   * keeps this field's many other call sites in this class compiling
   * unchanged. */
  protected get audioChunk(): AudioChunk | undefined {
    return this.canvasRenderer.audioChunk;
  }

  protected set audioChunk(value: AudioChunk | undefined) {
    this.canvasRenderer.audioChunk = value;
  }

  private subscrManager: SubscriptionManager<Subscription> =
    new SubscriptionManager<Subscription>();
  private timeUtils = new AudioViewerTimeUtils();

  private _drawnSelection: AudioSelection | undefined;

  get drawnSelection(): AudioSelection | undefined {
    return this._drawnSelection;
  }

  set drawnSelection(value: AudioSelection | undefined) {
    this._drawnSelection = value;
  }

  // MOUSE
  // `_mouseDown`/`_mouseCursor` moved to AudioViewerInteractionService
  // (task 15/21); these stay as pass-through getters because
  // 2D-editor/linear-editor read `av.mouseCursor` and `av.mouseDown`.
  get mouseDown(): boolean {
    return this.interaction.mouseDown;
  }

  get mouseCursor(): SampleUnit | undefined {
    return this.interaction.mouseCursor;
  }

  /** Moved to AudioViewerRendererService (set once, inside the also-moved
   * `initialize` method; read live by several scene functions). */
  get innerWidth(): number {
    return this.canvasRenderer.innerWidth;
  }

  get AudioPxWidth(): number {
    return this.audioPxW;
  }

  get MouseClickPos(): SampleUnit | undefined {
    return this.interaction.MouseClickPos;
  }

  set MouseClickPos(mouseClickPos: SampleUnit | undefined) {
    this.interaction.MouseClickPos = mouseClickPos;
  }

  // PlayCursor in absX
  // Moved to AudioViewerRendererService (read live by `updatePlayCursor`/
  // `changePlayCursorAbsX`).
  get PlayCursor(): PlayCursor | undefined {
    return this.canvasRenderer.PlayCursor;
  }

  set PlayCursor(playcursor: PlayCursor | undefined) {
    this.canvasRenderer.PlayCursor = playcursor;
  }

  /** Moved to AudioViewerInteractionService (task 15/21). The setter's
   * `redrawSegment`/`drawAllBoundaries`/`drawWholeSelection` calls are now
   * `renderRequest` emissions handled by `handleRenderRequest` below. */
  get dragableBoundaryID(): number {
    return this.interaction.dragableBoundaryID;
  }

  set dragableBoundaryID(value: number) {
    this.interaction.dragableBoundaryID = value;
  }

  public alert = new EventEmitter<{ type: string; message: string }>();
  public segmententer = new EventEmitter<{
    index: number;
    pos: { Y1: number; Y2: number };
  }>();

  /** Moved to AudioViewerRendererService (read live by `sceneFuncSignal`). */
  get zoomY(): number {
    return this.canvasRenderer.zoomY;
  }

  set zoomY(value: number) {
    this.canvasRenderer.zoomY = value;
  }

  private _settings = new AudioviewerConfig();

  get settings(): AudioviewerConfig {
    return this._settings;
  }

  /** `_settings` stays the storage of record here (not moved to the
   * renderer, unlike the other rendering-adjacent fields above) — its
   * default requires constructing an AudioviewerConfig, which the
   * renderer deliberately avoids importing (see that file's doc comment
   * on AudioViewerRenderSettings). Since AudioviewerConfig instances are
   * mutated in place elsewhere (`this.settings.pixelPerSec = ...` etc.)
   * rather than replaced, pushing the same object reference into the
   * renderer keeps its copy in sync automatically without a proxy. */
  set settings(value: AudioviewerConfig) {
    this._settings = value;
    this.canvasRenderer.settings = value;
  }

  /** Moved to AudioViewerRendererService (read live by `sceneFuncSignal`).
   * The original had no public setter (only `calculateZoom` wrote it,
   * internally, via the private `_zoomX` field); this setter replaces
   * that internal write path now that the field lives on the renderer. */
  get zoomX(): number {
    return this.canvasRenderer.zoomX;
  }

  set zoomX(value: number) {
    this.canvasRenderer.zoomX = value;
  }

  /** Moved to AudioViewerRendererService (read live by `sceneFuncSignal`). */
  get minmaxarray(): number[] {
    return this.canvasRenderer.minmaxarray;
  }

  set minmaxarray(value: number[]) {
    this.canvasRenderer.minmaxarray = value;
  }

  public get audioManager(): AudioManager | undefined {
    return this.audioChunk?.audioManager;
  }

  public getNextItemID() {
    return this.segments.getNextItemID();
  }

  constructor(
    private multiThreadingService: MultiThreadingService,
    private ngZone: NgZone,
    private segments: AudioViewerSegmentsService,
    private canvasRenderer: AudioViewerRendererService,
    private interaction: AudioViewerInteractionService,
  ) {
    // Sync the same AudioviewerConfig instance into the renderer so its
    // Konva scene functions read live settings (see settings setter
    // below for why this is a reference sync, not an accessor proxy).
    this.canvasRenderer.settings = this._settings;

    this.interaction.initialize(this.buildInteractionHost());
    this.subscrManager.add(
      this.interaction.renderRequest.subscribe((request) => {
        this.handleRenderRequest(request);
      }),
    );
  }

  /**
   * Bundles everything AudioViewerInteractionService needs but doesn't own.
   *
   * Every state read is a *method*, never a captured value — see
   * `AudioViewerInteractionHost`'s doc for the full reasoning. In short:
   * the interaction handlers are installed once on the stage container and
   * live for the viewer's lifetime, while `annotation` is replaced
   * wholesale on every change, so a captured value would freeze a stale
   * model into every keystroke and mouse move. The `EventEmitter`s are the
   * one exception: they are created once in this class's field
   * initializers and never reassigned.
   */
  private buildInteractionHost(): AudioViewerInteractionHost {
    return {
      canvas: {
        hasStage: () => this.canvasRenderer.stage !== undefined,
        hasLayers: () => this.canvasRenderer.layers !== undefined,
        hasCanvasElements: () =>
          this.canvasRenderer.canvasElements !== undefined,
        hasMouseCaret: () =>
          this.canvasRenderer.canvasElements?.mouseCaret !== undefined,
        hasScrollBar: () =>
          this.canvasRenderer.canvasElements?.scrollBar !== undefined,
        hasScrollbarSelector: () =>
          this.canvasRenderer.canvasElements?.scrollbarSelector !== undefined,
        hasLastLine: () =>
          this.canvasRenderer.canvasElements?.lastLine !== undefined,
        getStageHeight: () => this.canvasRenderer.size?.height,
        getScrollBarHeight: () =>
          this.canvasRenderer.canvasElements?.scrollBar?.height(),
        getScrollBarX: () => this.canvasRenderer.canvasElements?.scrollBar?.x(),
        getScrollbarSelectorY: () =>
          this.canvasRenderer.canvasElements?.scrollbarSelector?.y(),
        getScrollbarSelectorHeight: () =>
          this.canvasRenderer.canvasElements?.scrollbarSelector?.height(),
        getLastLineY: () => this.canvasRenderer.canvasElements?.lastLine?.y(),
        getLastLineHeight: () =>
          this.canvasRenderer.canvasElements?.lastLine?.height(),
        getBackgroundLayerY: () => this.canvasRenderer.layers?.background.y(),
      },

      getSettings: () => this.settings,
      getAnnotation: () => this.annotation,
      setAnnotation: (value) => {
        this.annotation = value;
      },
      getTempAnnotation: () => this.tempAnnotation,
      setTempAnnotation: (value) => {
        this.tempAnnotation = value;
      },
      getCurrentLevel: () => this.currentLevel,
      getAudioChunk: () => this.audioChunk,
      getAudioManager: () => this.audioManager,
      getAudioTCalculator: () => this.audioTCalculator,
      getPlayCursor: () => this.PlayCursor,
      getDrawnSelection: () => this.drawnSelection,
      setDrawnSelection: (value) => {
        this.drawnSelection = value;
      },
      getInnerWidth: () => this.innerWidth,
      getAudioPxWidth: () => this.AudioPxWidth,
      getSilencePlaceholder: () => this.silencePlaceholder,
      getRefreshOnInternChanges: () => this.refreshOnInternChanges,

      addOrRemoveSegment: () => this.addOrRemoveSegment(),
      getSegmentSelection: (positionSamples: number) =>
        this.getSegmentSelection(positionSamples),
      changeSegment: (start, segment) => this.changeSegment(start, segment),
      removeSegmentByIndex: (
        index,
        silenceCode,
        mergeTranscripts,
        triggerChange,
      ) =>
        this.removeSegmentByIndex(
          index,
          silenceCode,
          mergeTranscripts,
          triggerChange,
        ),
      selectSegment: (segIndex: number) => this.selectSegment(segIndex),
      changePlayCursorSamples: (newValue, chunk) =>
        this.changePlayCursorSamples(newValue, chunk),
      playSelection: (afterAudioEnded) => this.playSelection(afterAudioEnded),
      afterAudioEnded: () => this.afterAudioEnded(),
      getLineNumber: (x: number, y: number) => this.getLineNumber(x, y),

      shortcut: this.shortcut,
      alert: this.alert,
      segmententer: this.segmententer,
      selchange: this.selchange,
      mousecursorchange: this.mousecursorchange,
      currentLevelChange: this.currentLevelChange,
      annotationChange: this.annotationChange,
    };
  }

  /**
   * Performs the rendering side effects the interaction bucket asks for.
   *
   * Per the S1 split's DAG `AudioViewerInteractionService` may not reach
   * the renderer, so it emits an `AudioViewerRenderRequest` instead of
   * calling into it. This is the (only) place those are turned back into
   * renderer calls. `EventEmitter.emit` is synchronous, so each request is
   * handled at exactly the point in the interaction method where the
   * original direct call sat — the ordering of interleaved state mutation
   * and drawing is unchanged.
   */
  private handleRenderRequest(request: AudioViewerRenderRequest) {
    switch (request.type) {
      case 'redraw':
        this.redraw();
        break;
      case 'redraw-segment':
        this.redrawSegment(request.segmentID);
        break;
      case 'draw-all-boundaries':
        this.drawAllBoundaries();
        break;
      case 'draw-whole-selection':
        this.drawWholeSelection();
        break;
      case 'update-all-segments':
        this.updateAllSegments();
        break;
      case 'draw-stage':
        this.canvasRenderer.stage?.draw();
        break;
      case 'focus-stage-container':
        this.canvasRenderer.stage?.container().focus();
        break;
      case 'update-play-cursor':
        this.updatePlayCursor();
        break;
      case 'draw-playhead-layer':
        this.canvasRenderer.layers?.playhead.draw();
        break;
      case 'batch-draw-playhead-layer':
        this.canvasRenderer.layers?.playhead.batchDraw();
        break;
      case 'batch-draw-overlay-layer':
        this.canvasRenderer.layers?.overlay.batchDraw();
        break;
      case 'set-scrollbar-selector-y':
        this.canvasRenderer.canvasElements?.scrollbarSelector?.y(request.y);
        break;
      case 'set-mouse-caret-position':
        this.canvasRenderer.canvasElements?.mouseCaret?.position({
          x: request.x,
          y: request.y,
        });
        break;
      case 'scroll-layers-to-y':
        if (this.canvasRenderer.layers !== undefined) {
          // move all layers but keep scrollbars fixed
          this.canvasRenderer.layers.background.y(request.y);
          this.canvasRenderer.layers.overlay.y(request.y);
          this.canvasRenderer.layers.boundaries.y(request.y);
          this.canvasRenderer.layers.playhead.y(request.y);
          this.updateViewPort();
          this.showOnlyLinesInViewport();
          this.updateAllSegments();
        }
        break;
    }
  }

  /**
   * Bundles the segment/annotation-model data and callbacks that
   * AudioViewerRendererService's segment-drawing methods need but
   * deliberately don't own (see that service's class doc).
   *
   * `annotation`/`currentLevel` are handed over as *accessors*, not
   * values: Konva `sceneFunc` callbacks and the speaker-label click
   * handler the renderer builds outlive this call, while the annotation
   * model is replaced wholesale (`TrattAnnotation.clone()`) on every
   * `@Input() set annotation` write and `applyChanges` only rebuilds the
   * shapes immediately around a change. A captured value would freeze a
   * stale level into every surviving shape. The renderer still has no
   * dependency on the segment model — it only calls back into what we
   * passed it.
   */
  private buildSegmentRenderContext(): AudioViewerSegmentRenderContext {
    return {
      getCurrentLevel: () => this.currentLevel,
      getAnnotation: () => this.annotation,
      onBoundaryMouseDown: (id: number) => {
        this.dragableBoundaryID = id;
      },
      onSpeakerLabelChanged: (item: AnnotationAnySegment) => {
        this.currentLevelChange.emit({
          type: 'change',
          items: [{ instance: item }],
        });
      },
    };
  }

  /** Keyboard/mouse handlers the renderer's `initializeStageContainer`
   * wires onto the
   * stage container's native DOM events — these stay on
   * AudioViewerService (interaction, not rendering) so they're passed in
   * rather than referenced by the renderer via `this`. */
  private buildStageEventHandlers(): AudioViewerStageEventHandlers {
    return {
      onKeyDown: this.interaction.onKeyDown,
      onKeyUp: this.interaction.onKeyUp,
      onMouseEnter: this.interaction.onMouseEnter,
      onMouseLeave: this.interaction.onMouseLeave,
    };
  }

  public initialize(
    stageWidth: number | undefined,
    stageHeight: number | undefined,
    container: HTMLDivElement | undefined,
    audioChunk: AudioChunk | undefined,
  ) {
    if (stageWidth && stageHeight && container && this.renderer) {
      this.canvasRenderer.initialize(
        stageWidth,
        stageHeight,
        container,
        audioChunk,
        this.buildStageEventHandlers(),
        this.interaction.onWheel,
      );
      this.removeEventListenersFromContainer(container);
      this.addEventListenersForContainer(container);

      this.shortcutsManager.clearShortcuts();
      this.shortcutsManager.registerShortcutGroup(this.settings.shortcuts);
    }
  }

  private showOnlyLinesInViewport() {
    this.canvasRenderer.showOnlyLinesInViewport();
  }

  /**
   * apply changes from custom change detection. Only items relevant because audioviewer can only view on level at the same time.
   * @param changes
   * @private
   */
  public applyChanges(
    changes: AnnotationChange[],
    oldAnnotation: TrattAnnotation<ASRContext, TrattAnnotationSegment>,
  ) {
    const getIndexOfSegmentID = (
      level: TrattAnnotationAnyLevel<TrattAnnotationSegment>,
      id: number,
    ) => {
      return level.items.findIndex((a) => a.id === id);
    };

    const checkNeighbours = (item: AnnotationAnySegment) => {
      const currentLevel = (this
        .currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>)!;
      const rightNeighbour = currentLevel.getRightSibling(
        getIndexOfSegmentID(currentLevel, item.id),
      );
      if (rightNeighbour) {
        this.removeSegmentFromCanvas(rightNeighbour.id);
        this.addNewSegmentOnCanvas(rightNeighbour.id);
      }

      const leftNeighbour = currentLevel.getLeftSibling(
        getIndexOfSegmentID(currentLevel, item.id),
      );
      if (leftNeighbour) {
        this.removeSegmentFromCanvas(leftNeighbour.id);
        this.addNewSegmentOnCanvas(leftNeighbour.id);
      }
    };
    for (const change of changes) {
      if (change.type === 'change') {
        if (change.item?.new) {
          // item changed
          this.removeSegmentFromCanvas(change.item.new.id);
          this.addNewSegmentOnCanvas(change.item.new.id);

          checkNeighbours(change.item.new);
        }
      } else if (change.type === 'add') {
        if (change.item?.new) {
          this.addNewSegmentOnCanvas(change.item.new.id);
          checkNeighbours(change.item.new);
        }
      } else if (change.type === 'remove') {
        if (change.item?.old) {
          this.removeSegmentFromCanvas(change.item.old.id);
          const oldLevel =
            oldAnnotation.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
          const oldLeft = oldLevel.getLeftSibling(
            getIndexOfSegmentID(oldLevel, change!.item!.old!.id!),
          )! as TrattAnnotationSegment;
          if (oldLeft) {
            checkNeighbours(oldLeft);
          }
        }
      }
    }

    this.bringToFront('#timeStamps');
    this.bringToFront('.line-selections');
  }

  private bringToFront(name: string) {
    this.canvasRenderer.bringToFront(name);
  }

  public getPixelPerSecond(secondsPerLine: number) {
    return this.timeUtils.getPixelPerSecond(
      secondsPerLine,
      this.innerWidth,
      this.audioChunk,
    );
  }

  onResize = async (newWidth?: number, newHeight?: number) => {
    const drawnSelection = this.drawnSelection?.clone();
    const completed = await this.canvasRenderer.onResize(
      newWidth,
      newHeight,
      this.buildSegmentRenderContext(),
      this.buildStageEventHandlers(),
      this.interaction.onWheel,
      this.interaction.onScrollbarDragged,
      {
        initializeSettings: this.initializeSettings,
        scrollToAbsY: (absY: number) => this.scrollToAbsY(absY),
      },
    );
    if (completed) {
      this.drawnSelection = drawnSelection;
      this.drawWholeSelection();
    }
  };

  public initializeView() {
    if (
      this.canvasRenderer.initializeViewAndReportInitialized(
        this.buildSegmentRenderContext(),
        this.interaction.onScrollbarDragged,
      )
    ) {
      this.onInitialized.next();
    }
  }
  private updateViewPort() {
    this.canvasRenderer.updateViewPort();
  }
  public scrollToAbsY(absY: number) {
    if (
      this.canvasRenderer.canvasElements !== undefined &&
      this.canvasRenderer.canvasElements.lastLine !== undefined
    ) {
      const deltaY =
        absY /
        (this.canvasRenderer.canvasElements.lastLine.y() +
          this.canvasRenderer.canvasElements.lastLine.height());
      this.scrollWithDeltaY(-deltaY);
    }
  }

  async onSecondsPerLineChanged(secondsPerLine: number) {
    try {
      this.secondsPerLine = secondsPerLine;
      this.settings.pixelPerSec = this.getPixelPerSecond(this.secondsPerLine);
      await this.initializeSettings();
      this.initializeView();
    } catch (error) {
      console.error(error);
    }
  }

  public onPlaybackStarted() {
    if (
      this.canvasRenderer.animation.playHead &&
      !this.canvasRenderer.animation.playHead.isRunning()
    ) {
      this.ngZone.runOutsideAngular(() => {
        this.canvasRenderer.animation.playHead!.start();
      });
    }
  }

  public onPlaybackPaused() {
    if (this.canvasRenderer.animation.playHead !== undefined) {
      this.canvasRenderer.animation.playHead.stop();
    }
  }

  public onPlaybackStopped() {
    this.canvasRenderer.animation.playHead?.stop();
    this.updatePlayCursor();
    this.canvasRenderer.layers?.playhead.draw();
  }

  public onPlaybackEnded() {
    this.canvasRenderer.animation.playHead?.stop();
    this.updatePlayCursor();
    this.canvasRenderer.layers?.playhead.draw();
  }

  public updatePlayCursor = () => {
    this.canvasRenderer.updatePlayCursor();
  };
  updateAllSegments(clearAll = false) {
    this.canvasRenderer.updateAllSegments(
      clearAll,
      this.buildSegmentRenderContext(),
    );
  }
  drawAllBoundaries() {
    this.canvasRenderer.drawAllBoundaries(this.buildSegmentRenderContext());
  }

  /**
   * destroy this audioviewer object
   */
  public destroy() {
    this.subscrManager.destroy();
    this.interaction.destroy();
    this.canvasRenderer.stage?.destroy();

    this.canvasRenderer.konvaContainer?.removeEventListener(
      'keydown',
      this.interaction.onKeyDown,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'keyup',
      this.interaction.onKeyUp,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mouseleave',
      this.interaction.onMouseLeave,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mouseenter',
      this.interaction.onMouseEnter,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mousemove',
      this.interaction.onMouseMove,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mousedown',
      this.interaction.mouseChange,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mouseup',
      this.interaction.mouseChange,
    );
  }

  // `onMouseEnter`/`onMouseLeave` moved to AudioViewerInteractionService
  // (task 15/21); wired onto the stage container via
  // `buildStageEventHandlers()` above.

  /**
   * initialize settings
   */
  public initializeSettings = async () => {
    if (!this.audioManager) {
      throw new Error('Audiomanager is undefined');
    }
    if (!this.audioChunk) {
      throw new Error('AudioChunk is undefined');
    }
    if (!this.innerWidth) {
      throw new Error('Inner width is undefined');
    }

    if (this._settings.multiLine) {
      this.audioPxW =
        this.audioManager.resource.info.duration.seconds *
        this._settings.pixelPerSec;
      this.audioPxW =
        this.audioPxW < this.innerWidth ? this.innerWidth : this.AudioPxWidth;
    } else {
      this.audioPxW = this.innerWidth;
    }
    this.audioPxW = Math.round(this.audioPxW);

    if (this.audioPxW <= 0) {
      throw new Error(`Audio px is ${this.AudioPxWidth}`);
    }

    // initialize the default values
    this.audioTCalculator = new AudioTimeCalculator(
      this.audioChunk.time.duration,
      this.AudioPxWidth,
    );
    this.MouseClickPos = this.audioManager.createSampleUnit(0);
    this.interaction.setMouseCursor(this.audioManager.createSampleUnit(0));
    this.PlayCursor = new PlayCursor(
      0,
      new SampleUnit(0, this.audioChunk.sampleRate),
      this.innerWidth,
    );
    this._drawnSelection = this.audioChunk.selection.clone();
    this._drawnSelection.end = this._drawnSelection.start.clone();

    return this.afterChannelInitialized();
  };

  public async refreshComputedData(): Promise<void> {
    if (this.audioManager !== undefined && this.audioChunk !== undefined) {
      this.minmaxarray = await this.computeWholeDisplayData(
        this.AudioPxWidth / 2,
        this._settings.lineheight,
        this.audioManager.channel!,
        {
          start: Math.ceil(
            this.audioChunk.time.start.samples /
              this.audioManager.channelDataFactor,
          ),
          end: Math.min(
            this.audioManager.channel!.length,
            Math.ceil(
              this.audioChunk.time.end.samples /
                this.audioManager.channelDataFactor,
            ),
          ),
        },
      );
    } else {
      throw new Error('audioManager or audioChunk is undefined');
    }
  }

  // `onKeyDown` moved to AudioViewerInteractionService (task 15/21) and
  // decomposed there into one `handle*` method per shortcut (or per group
  // of shortcuts that shared a body verbatim).

  /**
   * playSelection() plays the selected signal fragment or the selection in this chunk
   */
  playSelection = (afterAudioEnded: () => void) => {
    this.audioChunk
      ?.startPlayback()
      .then(() => {
        if (this.audioChunk !== undefined) {
          if (
            this.drawnSelection !== undefined &&
            this.drawnSelection.duration.samples > 0
          ) {
            this.audioChunk.selection = this.drawnSelection.clone();
            this.audioChunk.absolutePlayposition =
              this.audioChunk.selection.start.clone();
          }
          afterAudioEnded();
        }
      })
      .catch((error: any) => {
        console.error(error);
      });
  };

  public async selectSegment(
    segIndex: number,
  ): Promise<{ posY1: number; posY2: number }> {
    if (
      segIndex > -1 &&
      this.currentLevel &&
      this.currentLevel.items.length > 0 &&
      this.audioChunk !== undefined &&
      this.audioManager !== undefined
    ) {
      const segment = this.currentLevel.items[
        segIndex
      ] as TrattAnnotationSegment;
      if (segment.type !== 'segment') {
        throw new Error("Segment is not of type 'segment'");
      }
      const items = this.currentLevel.items as TrattAnnotationSegment[];

      const startTime = getStartTimeBySegmentID(items, segment.id);

      // Width fallback: innerWidth is laid out lazily by the viewer's resize
      // observer. For linked levels (e.g. translation) the level switch can
      // outrun layout, leaving innerWidth undefined at click time even though
      // every other geometry condition holds. Fall back to AudioPxWidth — the
      // pre-computed full canvas width — so the popup-open path is not blocked
      // by transient layout state.
      const effectiveInnerWidth = this.innerWidth ?? this.AudioPxWidth;

      const segSamples = segment?.time?.samples;
      const segStartSamples = (startTime as any)?.samples;
      const chunkStart = this.audioChunk.time.start.samples;
      const chunkEnd = this.audioChunk.time.end.samples;
      const guardChecks = {
        hasSegSamples: segSamples !== undefined,
        hasCalculator: this.audioTCalculator !== undefined,
        startInChunk: segStartSamples >= chunkStart,
        endInChunk: segSamples !== undefined && segSamples <= chunkEnd + 1,
        hasWidth: effectiveInnerWidth !== undefined,
      };
      const guardPasses =
        guardChecks.hasSegSamples &&
        guardChecks.hasCalculator &&
        guardChecks.startInChunk &&
        guardChecks.endInChunk &&
        guardChecks.hasWidth;

      if (guardPasses) {
        const tcalc = this.audioTCalculator!;
        const widthForLayout = effectiveInnerWidth!;
        const absX = tcalc.samplestoAbsX(segment.time);
        let begin: TrattAnnotationSegment;

        if (segIndex > 0) {
          begin = items[segIndex - 1];
        } else {
          begin = new TrattAnnotationSegment(
            this.getNextItemID(),
            this.audioManager.createSampleUnit(0),
            [],
          );
        }

        const beginX = tcalc.samplestoAbsX(begin.time);
        const posY1 =
          widthForLayout < this.AudioPxWidth
            ? Math.floor(beginX / widthForLayout + 1) *
                (this.settings.lineheight + this.settings.margin.bottom) -
              this.settings.margin.bottom
            : 0;

        let posY2 = 0;

        if (widthForLayout < this.AudioPxWidth) {
          posY2 =
            Math.floor(absX / widthForLayout + 1) *
              (this.settings.lineheight + this.settings.margin.bottom) -
            this.settings.margin.bottom;
        }

        const boundarySelect = this.getSegmentSelection(
          segment.time.samples - 1,
        );
        if (boundarySelect) {
          this.audioChunk.selection = boundarySelect;
          this.drawnSelection = boundarySelect.clone();
          this.settings.selection.color = 'gray';
          this.audioChunk.absolutePlayposition =
            this.audioChunk.selection.start.clone();
          this.changePlayCursorSamples(this.audioChunk.selection.start);
          this.updatePlayCursor();

          if (this.audioManager.isPlaying) {
            this.audioManager.stopPlayback().catch((error: any) => {
              console.error(error);
            });
          }
        }

        return { posY1, posY2 };
      } else {
        // Emit a diagnostic to the dev console so an operator can see which
        // specific subcondition rejected — otherwise the user only sees the
        // 'segment invisible' toast which gives no actionable detail.
        console.warn(
          '[audio-viewer.selectSegment] visibility guard rejected segment',
          {
            segIndex,
            currentLevelName: this.currentLevel?.name,
            currentLevelLinkedKind: (this.currentLevel as any)?.linkedKind,
            guardChecks,
            segSamples,
            segStartSamples,
            chunkStart,
            chunkEnd,
            innerWidth: this.innerWidth,
            audioPxWidth: this.AudioPxWidth,
            audioTCalculator: this.audioTCalculator !== undefined,
          },
        );
        throw new Error('Segment not selected.');
      }
    } else {
      throw new Error('Invalid segment');
    }
  }

  /**
   * checks if the comboKey is part of the list of disabled keys
   */
  // `isDisabledKey` moved to AudioViewerInteractionService (task 15/21).

  /**
   * change samples of playcursor
   */
  public changePlayCursorSamples = (
    newValue: SampleUnit,
    chunk?: AudioChunk,
  ) => {
    if (this.PlayCursor !== undefined && this.audioTCalculator !== undefined) {
      this.PlayCursor.changeSamples(newValue, this.audioTCalculator, chunk);
      this.playcursorchange.emit(this.PlayCursor);
    }
  };

  /**
   * computeDisplayData() generates an array of min-max pairs representing the
   * audio signal. The values of the array are float in the range -1 .. 1.
   */
  async computeWholeDisplayData(
    width: number,
    height: number,
    cha: Float32Array,
    _interval: { start: number; end: number },
  ): Promise<number[]> {
    return this.timeUtils.computeWholeDisplayData(
      width,
      height,
      cha,
      _interval,
      this._settings.roundValues,
      this.multiThreadingService,
    );
  }

  /**
   * addSegment() adds a boundary to the list of segments or removes the segment
   */
  public addOrRemoveSegment():
    | {
        type: string;
        seg_samples: number;
        seg_ID: number;
        msg: { type: string; text: string };
      }
    | undefined {
    return this.segments.addOrRemoveSegment({
      settings: this.settings,
      audioTCalculator: this.audioTCalculator,
      audioChunk: this.audioChunk,
      audioPxW: this.audioPxW,
      mouseCursor: this.interaction.mouseCursor,
      annotation: this.annotation,
      audioManager: this.audioManager,
      silencePlaceholder: this.silencePlaceholder,
      drawnSelection: this.drawnSelection,
      currentLevelChange: this.currentLevelChange,
      annotationChange: this.annotationChange,
    });
  }

  /**
   * get selection of segment
   * @returns AudioSelection
   */
  public getSegmentSelection(
    positionSamples: number,
  ): AudioSelection | undefined {
    return this.segments.getSegmentSelection(
      positionSamples,
      this.annotation,
      this.audioManager,
    );
  }

  private calculateZoom(height: number, width: number, minmaxarray: number[]) {
    const result = this.timeUtils.calculateZoom(
      height,
      width,
      minmaxarray,
      this.AudioPxWidth,
      this._settings.justifySignalHeight,
      this._settings.timeline.enabled,
      this._settings.timeline.height,
      this.zoomX,
      this.zoomY,
    );
    this.zoomX = result.zoomX;
    this.zoomY = result.zoomY;
  }

  /**
   * after Channel was initialized
   */
  private async afterChannelInitialized(calculateZoom = true): Promise<void> {
    try {
      await this.refreshComputedData();

      if (calculateZoom) {
        this.calculateZoom(
          this._settings.lineheight,
          this.AudioPxWidth,
          this.minmaxarray,
        );
      }
      if (this.audioChunk !== undefined) {
        this.audioChunk.absolutePlayposition =
          this.audioChunk.time.start.clone();
      }
      this.channelInitialized.next();
      this.channelInitialized.complete();
    } catch (e) {
      console.error(e);
      this.channelInitialized.error(e);
    }
  }

  private addNewSegmentOnCanvas(id: number) {
    this.canvasRenderer.addNewSegmentOnCanvas(
      id,
      this.buildSegmentRenderContext(),
    );
  }
  public removeSegmentByIndex(
    index: number,
    silenceCode: string | undefined,
    mergeTranscripts: boolean,
    triggerChange = true,
    changeTranscript?: (transcript: string) => string,
  ) {
    this.segments.removeSegmentByIndex(
      this.annotation,
      index,
      silenceCode,
      mergeTranscripts,
      triggerChange,
      this.currentLevelChange,
      this.annotationChange,
      changeTranscript,
    );
  }

  public changeSegment(start: SampleUnit, segment: TrattAnnotationSegment) {
    this.segments.changeSegment(
      this.annotation!,
      this.currentLevelChange,
      this.annotationChange,
      start,
      segment,
    );
  }

  getChanges(
    oldAnnotation: TrattAnnotation<ASRContext, TrattAnnotationSegment>,
    newAnnotation: TrattAnnotation<ASRContext, TrattAnnotationSegment>,
  ): AnnotationChange[] {
    return this.segments.getChanges(oldAnnotation, newAnnotation);
  }

  private drawWholeSelection() {
    this.canvasRenderer.drawWholeSelection(this.drawnSelection);
  }

  // `changeMouseCursorSamples` moved to AudioViewerInteractionService
  // (task 15/21).

  /**
   * called if audio ended normally because end of segment reached
   */
  private afterAudioEnded = () => {
    if (this.audioChunk !== undefined && !this.audioChunk.replay) {
      // let cursor jump to start
      this.audioChunk.absolutePlayposition =
        this.audioChunk.selection.start.clone();
      this.drawnSelection =
        this.drawnSelection !== undefined
          ? this.drawnSelection?.clone()
          : undefined;
    }

    this.updatePlayCursor();
    if (this.canvasRenderer.layers !== undefined) {
      this.canvasRenderer.layers.playhead.batchDraw();
    }
  };

  private removeSegmentFromCanvas(
    segmentID: number,
    oldAnnotation?: TrattAnnotation<any, any>,
  ) {
    this.canvasRenderer.removeSegmentFromCanvas(segmentID, oldAnnotation);
  }
  private redrawSegment(segmentID: number) {
    this.canvasRenderer.redrawSegment(segmentID);
  }

  public redraw() {
    this.canvasRenderer.redraw();
  }
  // `onWheel` and `onScrollbarDragged` moved to
  // AudioViewerInteractionService (task 15/21); they are handed to the
  // renderer as callbacks by `initialize`/`initializeView` above.

  /** Delegate kept because `scrollToAbsY` (facade-owned) calls it. */
  private scrollWithDeltaY(deltaY: number) {
    this.interaction.scrollWithDeltaY(deltaY);
  }

  private removeEventListenersFromContainer(container: HTMLElement) {
    container.removeEventListener('mousemove', this.interaction.onMouseMove);
    container.removeEventListener('mousedown', this.interaction.mouseChange);
    container.removeEventListener('mouseup', this.interaction.mouseChange);
  }

  // `mouseChange` moved to AudioViewerInteractionService (task 15/21).

  public getLineNumber(x: number, y: number) {
    return this.timeUtils.getLineNumber(
      x,
      y,
      this.innerWidth,
      this.AudioPxWidth,
      this.settings,
    );
  }

  // `onMouseMove` moved to AudioViewerInteractionService (task 15/21).

  private addEventListenersForContainer(container: HTMLElement) {
    container.addEventListener('mousemove', this.interaction.onMouseMove);
    container.addEventListener('mousedown', this.interaction.mouseChange);
    container.addEventListener('mouseup', this.interaction.mouseChange);
  }

  focus() {
    this.interaction.focus();
  }
}

// Moved to AudioViewerSegmentsService (task 13, S1 split) along with the
// getChanges() method that produces it; re-exported here so existing
// imports (e.g. audio-viewer.component.ts's
// `import { AnnotationChange } from './audio-viewer.service'`) keep working
// unchanged.
export type { AnnotationChange } from './audio-viewer-segments.service';

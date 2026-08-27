import { EventEmitter, Injectable, NgZone, Renderer2 } from '@angular/core';
import {
  AnnotationAnySegment,
  AnnotationLevelType,
  ASRContext,
  ASRQueueItemType,
  getSegmentBySamplePosition,
  getStartTimeBySegmentID,
  OLabel,
  TrattAnnotation,
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { AudioSelection, PlayBackStatus, SampleUnit } from '@tratt/media';
import { SubscriptionManager } from '@tratt/utilities';
import {
  AudioChunk,
  AudioManager,
  AudioTimeCalculator,
  ShortcutGroup,
  ShortcutManager,
} from '@tratt/web-media';
import { Context } from 'konva/lib/Context';
import { Group } from 'konva/lib/Group';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Shape } from 'konva/lib/Shape';
import type { Vector2d } from 'konva/lib/types';
import { ReplaySubject, Subject, timer } from 'rxjs';
import { Subscription } from 'rxjs/internal/Subscription';
import { MultiThreadingService } from '../../../multi-threading.service';
import { Position, Size } from '../../../obj';
import { PlayCursor } from '../../../obj/play-cursor';
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
  get focused(): boolean {
    return this._focused;
  }

  get boundaryDragging(): Subject<{
    status: 'started' | 'stopped' | 'dragging';
    id: number;
    shiftPressed?: boolean;
  }> {
    return this._boundaryDragging;
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

  public shortcutsManager: ShortcutManager;
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

  public overboundary = false;
  public shiftPressed = false;

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
  protected mouseClickPos: SampleUnit | undefined;
  private _focused = false;
  public onInitialized = new ReplaySubject<void>(1);

  private _boundaryDragging: Subject<{
    status: 'started' | 'stopped' | 'dragging';
    id: number;
    shiftPressed?: boolean;
  }>;
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

  private hoveredLine = -1;
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

  protected hZoom = 0;

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
  private _mouseDown = false;

  get mouseDown(): boolean {
    return this._mouseDown;
  }

  private _mouseCursor: SampleUnit | undefined;

  get mouseCursor(): SampleUnit | undefined {
    return this._mouseCursor;
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
    return this.mouseClickPos;
  }

  set MouseClickPos(mouseClickPos: SampleUnit | undefined) {
    this.mouseClickPos = mouseClickPos;
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

  private _dragableBoundaryID = -1;

  get dragableBoundaryID(): number {
    return this._dragableBoundaryID;
  }

  set dragableBoundaryID(value: number) {
    if (value > -1 && this._dragableBoundaryID === -1) {
      // started
      this.tempAnnotation = this.annotation;
      this.subscrManager.add(
        timer(0).subscribe({
          next: () => {
            this.redrawSegment(value);
            this.drawAllBoundaries();
            this.drawWholeSelection();
          },
        }),
      );

      if (this.refreshOnInternChanges) {
        this.redrawSegment(value);
      }

      this._boundaryDragging.next({
        shiftPressed: this.shiftPressed,
        id: value,
        status: 'started',
      });
    }
    this._dragableBoundaryID = value;
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
  ) {
    this.shortcutsManager = new ShortcutManager();
    this._boundaryDragging = new Subject<{
      status: 'started' | 'stopped' | 'dragging';
      id: number;
      shiftPressed?: boolean;
    }>();
    // Sync the same AudioviewerConfig instance into the renderer so its
    // Konva scene functions read live settings (see settings setter
    // below for why this is a reference sync, not an accessor proxy).
    this.canvasRenderer.settings = this._settings;
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

  /** Keyboard/mouse handlers `initializeStageContainer` wires onto the
   * stage container's native DOM events — these stay on
   * AudioViewerService (interaction, not rendering) so they're passed in
   * rather than referenced by the renderer via `this`. */
  private buildStageEventHandlers(): AudioViewerStageEventHandlers {
    return {
      onKeyDown: this.onKeyDown,
      onKeyUp: this.onKeyUp,
      onMouseEnter: this.onMouseEnter,
      onMouseLeave: this.onMouseLeave,
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
        this.onWheel,
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
      this.onWheel,
      this.onScrollbarDragged,
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
        this.onScrollbarDragged,
      )
    ) {
      this.onInitialized.next();
    }
  }
  public updateLines = () => {
    this.canvasRenderer.updateLines();
  };
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

  private createCropContainer(id?: string): Group {
    return this.canvasRenderer.createCropContainer(id);
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

  private createLineBackground(line: Group, size: Size) {
    this.canvasRenderer.createLineBackground(line, size);
  }
  private createLineBorder(line: Group, size: Size) {
    this.canvasRenderer.createLineBorder(line, size);
  }
  private createLineSelection(line: Group, size: Size) {
    this.canvasRenderer.createLineSelection(line, size);
  }
  private createLineGrid(line: Group, size: Size) {
    this.canvasRenderer.createLineGrid(line, size);
  }
  private sceneFuncGrid = (context: Context, shape: Shape) => {
    this.canvasRenderer.sceneFuncGrid(context, shape);
  };
  private createLinePlayCursor() {
    return this.canvasRenderer.createLinePlayCursor();
  }
  private createLine(size: Size, position: Position, lineNum: number): Group {
    return this.canvasRenderer.createLine(size, position, lineNum);
  }
  private createLineSelectionGroup(
    size: Size,
    position: Position,
    lineNum: number,
  ): Group {
    return this.canvasRenderer.createLineSelectionGroup(
      size,
      position,
      lineNum,
    );
  }
  private createLineSignal(line: Group, size: Size, lineNum: number) {
    this.canvasRenderer.createLineSignal(line, size, lineNum);
  }
  private sceneFuncSignal = (
    context: Context,
    shape: Shape,
    lineNum: number,
  ) => {
    this.canvasRenderer.sceneFuncSignal(context, shape, lineNum);
  };
  private doPlayHeadAnimation = () => {
    this.canvasRenderer.doPlayHeadAnimation();
  };
  public updatePlayCursor = () => {
    this.canvasRenderer.updatePlayCursor();
  };
  private changePlayCursorAbsX = (newValue: number) => {
    this.canvasRenderer.changePlayCursorAbsX(newValue);
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
  private drawNewBoundaries(
    boundariesToDraw: {
      x: number;
      y: number;
      num: number;
      id: number;
    }[],
  ) {
    this.canvasRenderer.drawNewBoundaries(
      boundariesToDraw,
      this.buildSegmentRenderContext(),
    );
  }
  private createSegmentOnCanvas(
    numOfLines: number,
    segmentData: {
      index: number;
      segment: TrattAnnotationSegment;
    },
    segmentInterval: {
      start: number;
      end: number;
    },
  ):
    | {
        overlayGroup: Group;
      }
    | undefined {
    return this.canvasRenderer.createSegmentOnCanvas(
      numOfLines,
      segmentData,
      segmentInterval,
      () => this.currentLevel,
    );
  }
  private sceneFuncTranscripts = (
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
  ) => {
    this.canvasRenderer.sceneFuncTranscripts(
      context,
      shape,
      segmentInterval,
      segment,
      lineInterval,
      numOfLines,
      this.currentLevel,
    );
  };
  private sceneFuncOverlay = (
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
  ) => {
    this.canvasRenderer.sceneFuncOverlay(
      context,
      shape,
      segment,
      numOfLines,
      segmentInterval,
      lineInterval,
      this.currentLevel,
    );
  };
  public async setMouseClickPosition(
    absX: number,
    lineNum: number,
    $event: Event,
  ): Promise<number | undefined> {
    if (this.audioChunk !== undefined) {
      const absXInTime = this.audioTCalculator?.absXChunktoSampleUnit(
        absX,
        this.audioChunk,
      );

      if (
        absXInTime !== undefined &&
        this.audioManager !== undefined &&
        this.audioChunk !== undefined &&
        this.annotation?.currentLevel !== undefined &&
        this.annotation.currentLevel.items.length > 0 &&
        this.audioTCalculator !== undefined &&
        this.PlayCursor !== undefined
      ) {
        this._mouseCursor = absXInTime.clone();

        if (!this.audioManager.isPlaying) {
          // same line
          // fix margin settings
          if ($event.type === 'mousedown') {
            // no line defined or same line
            this.mouseClickPos = absXInTime.clone();
            this.audioChunk.startpos = this.mouseClickPos.clone();
            this.audioChunk.selection.start = absXInTime.clone();
            this.audioChunk.selection.end = absXInTime.clone();
            if (!this.shiftPressed) {
              this._drawnSelection = this.audioChunk.selection.clone();
            }

            if (this._dragableBoundaryID > -1) {
              const currentLevel = this
                .currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
              const index = this.annotation.currentLevel.items.findIndex(
                (a) => a.id === this._dragableBoundaryID,
              );

              const segmentBefore = currentLevel!.getLeftSibling(index);
              const segment = this.annotation.currentLevel.items[
                index
              ] as TrattAnnotationSegment<ASRContext>;
              const segmentAfter = currentLevel!.getRightSibling(index);

              if (
                segment?.context?.asr?.isBlockedBy === ASRQueueItemType.ASR ||
                segmentBefore?.context?.asr?.isBlockedBy ===
                  ASRQueueItemType.ASR ||
                segmentAfter?.context?.asr?.isBlockedBy === ASRQueueItemType.ASR
              ) {
                // prevent dragging boundary of blocked segment
                this._dragableBoundaryID = -1;
              }
            }
            this._mouseDown = true;
          } else if ($event.type === 'mouseup') {
            this.handleBoundaryDragging(absX, absXInTime, true);

            this.overboundary = false;
            this._mouseDown = false;

            this._boundaryDragging.next({
              shiftPressed: this.shiftPressed,
              id: this._dragableBoundaryID,
              status: 'stopped',
            });
            this._dragableBoundaryID = -1;
            this.updateAllSegments();
          }

          return lineNum;
        } else if (
          this.audioManager.state === PlayBackStatus.PLAYING &&
          $event.type === 'mouseup'
        ) {
          try {
            await this.audioChunk.stopPlayback();

            if (
              this.audioChunk !== undefined &&
              this.audioTCalculator !== undefined
            ) {
              this.audioChunk.startpos = absXInTime.clone();
              this.audioChunk.selection.end = absXInTime.clone();
              this._drawnSelection = this.audioChunk.selection.clone();
              this.PlayCursor?.changeSamples(
                absXInTime,
                this.audioTCalculator,
                this.audioChunk,
              );

              this._mouseDown = false;
              this._dragableBoundaryID = -1;
            }

            return lineNum;
          } catch (e) {
            console.error(e);
          }
        }
      }
    }

    return undefined;
  }

  handleBoundaryDragging(absX: number, absXInTime: SampleUnit, emit = false) {
    let annotation = this.tempAnnotation?.clone();
    const currentLevel =
      annotation?.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const limitPadding = 500;

    const index = currentLevel?.items.findIndex(
      (a) => a.id === this._dragableBoundaryID,
    );
    if (
      annotation &&
      currentLevel &&
      index !== undefined &&
      index > -1 &&
      this.audioTCalculator &&
      this.audioChunk &&
      this.audioManager &&
      this.PlayCursor
    ) {
      const draggedItem = currentLevel.items[index];

      if (
        this.settings.boundaries.enabled &&
        !this.settings.boundaries.readonly &&
        this._dragableBoundaryID > -1
      ) {
        // some boundary dragged
        const segment: TrattAnnotationSegment | undefined =
          draggedItem?.clone();

        if (segment) {
          if (!this.shiftPressed) {
            // move only this boundary
            const previousSegment: TrattAnnotationSegment | undefined =
              currentLevel.getLeftSibling(index)!;
            const nextSegment: TrattAnnotationSegment | undefined =
              currentLevel.getRightSibling(index)!;

            let newTime = this.audioTCalculator.absXChunktoSampleUnit(
              absX,
              this.audioChunk,
            )!;

            if (
              previousSegment &&
              newTime.samples < previousSegment.time.samples + limitPadding
            ) {
              newTime = previousSegment.time.add(
                this.audioManager.createSampleUnit(limitPadding),
              );
            } else if (
              nextSegment &&
              newTime.samples > nextSegment.time.samples - limitPadding
            ) {
              newTime = nextSegment.time.sub(
                this.audioManager.createSampleUnit(limitPadding),
              );
            }

            segment.time = newTime;
            annotation.changeCurrentSegmentBySamplePosition(
              segment.time,
              segment,
            );

            if (emit) {
              this.currentLevelChange.emit({
                type: 'change',
                items: [
                  {
                    instance: segment,
                  },
                ],
              });
              this.annotationChange.emit(annotation);
            }
          } else if (this.drawnSelection?.duration?.samples) {
            // move all segments with difference to left or right
            const oldSamplePosition = segment.time.samples;
            const newSamplePosition =
              this.audioTCalculator.absXChunktoSampleUnit(
                absX,
                this.audioChunk,
              )?.samples;
            const diff = newSamplePosition! - oldSamplePosition;
            let changedItems: TrattAnnotationSegment[] = [];

            if (diff > 0) {
              // shift to right
              for (const currentLevelElement of (annotation.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>)!
                .items) {
                if (
                  currentLevelElement.time.samples >= segment.time.samples &&
                  currentLevelElement.time.samples + diff <
                    this.drawnSelection.end!.samples
                ) {
                  const newItem = currentLevelElement.clone(
                    currentLevelElement.id,
                  );
                  newItem.time = currentLevelElement.time.add(
                    this.audioManager.createSampleUnit(diff),
                  );
                  annotation = annotation.changeCurrentItemById(
                    currentLevelElement.id,
                    newItem,
                  );
                  changedItems.push(newItem);
                }
              }
            } else {
              // shift to left
              for (const currentLevelElement of (annotation.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>)!
                .items) {
                if (
                  currentLevelElement.time.samples <= segment.time.samples &&
                  currentLevelElement.time.samples + diff >
                    this.drawnSelection.start!.samples
                ) {
                  const newItem = currentLevelElement.clone(
                    currentLevelElement.id,
                  );
                  newItem.time = currentLevelElement.time.add(
                    this.audioManager.createSampleUnit(diff),
                  );
                  annotation = annotation.changeCurrentItemById(
                    currentLevelElement.id,
                    newItem,
                  );
                  changedItems.push(newItem);
                } else if (currentLevelElement.time.samples - diff < 0) {
                  changedItems = [];
                  break;
                }
              }
            }

            if (changedItems.length > 0 && emit) {
              this.currentLevelChange.emit({
                type: 'change',
                items: changedItems.map((a) => ({ instance: a })),
              });
              this.annotationChange.emit(annotation);
            }
          }
        }
        this.annotation = annotation;
      } else {
        // set selection
        this.audioChunk.selection.end = absXInTime.clone();
        this.audioChunk.selection.checkSelection();
        this._drawnSelection = this.audioChunk.selection.clone();

        this.PlayCursor.changeSamples(
          this.audioChunk.absolutePlayposition.clone(),
          this.audioTCalculator,
          this.audioChunk,
        );
      }
    }
  }

  onKeyUp = (event: KeyboardEvent) => {
    this.shiftPressed = false;
    this.shortcutsManager.checkKeyEvent(event, Date.now());
  };

  /**
   * destroy this audioviewer object
   */
  public destroy() {
    this.subscrManager.destroy();
    this.canvasRenderer.stage?.destroy();

    this.canvasRenderer.konvaContainer?.removeEventListener(
      'keydown',
      this.onKeyDown,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'keyup',
      this.onKeyUp,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mouseleave',
      this.onMouseLeave,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mouseenter',
      this.onMouseEnter,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mousemove',
      this.onMouseMove,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mousedown',
      this.mouseChange,
    );
    this.canvasRenderer.konvaContainer?.removeEventListener(
      'mouseup',
      this.mouseChange,
    );
  }

  private onMouseEnter = () => {
    this.canvasRenderer.stage?.container().focus();
    this._focused = true;
  };

  private onMouseLeave = () => {
    this._focused = false;
  };

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
    this._mouseCursor = this.audioManager.createSampleUnit(0);
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

  private isVisibleInView(x: number, y: number, width: number, height: number) {
    return this.canvasRenderer.isVisibleInView(x, y, width, height);
  }
  private onKeyDown = (event: KeyboardEvent) => {
    const shortcutInfo = this.shortcutsManager.checkKeyEvent(event, Date.now());

    this.shiftPressed =
      event.keyCode === 16 ||
      event.code?.includes('Shift') ||
      event.key?.includes('Shift');

    if (shortcutInfo !== undefined) {
      const comboKey = shortcutInfo.shortcut;

      if (this.settings.shortcutsEnabled) {
        if (this._focused && this.isDisabledKey(comboKey)) {
          // key pressed is disabled by config
          event.preventDefault();
        } else {
          const shortcutName = shortcutInfo.shortcutName;
          const focuscheck =
            shortcutInfo.onFocusOnly === false ||
            shortcutInfo.onFocusOnly === this._focused;

          if (focuscheck) {
            switch (shortcutName) {
              case 'undo':
                if (
                  this.settings.boundaries.enabled &&
                  this._focused &&
                  !this.settings.boundaries.readonly
                ) {
                  this.shortcut.emit({
                    shortcut: comboKey,
                    shortcutName,
                    type: 'application',
                    timePosition: this?.mouseCursor?.clone(),
                    timestamp: shortcutInfo.timestamp,
                  });
                }
                break;
              case 'redo':
                if (
                  this.settings.boundaries.enabled &&
                  this._focused &&
                  !this.settings.boundaries.readonly
                ) {
                  this.shortcut.emit({
                    shortcut: comboKey,
                    shortcutName,
                    type: 'application',
                    timePosition: this?.mouseCursor?.clone(),
                    timestamp: shortcutInfo.timestamp,
                  });
                }
                break;
              case 'set_boundary':
                if (
                  this.settings.boundaries.enabled &&
                  !this.settings.boundaries.readonly &&
                  this._focused &&
                  this.audioManager !== undefined &&
                  this.annotation?.currentLevel?.items
                ) {
                  const result = this.addOrRemoveSegment();
                  if (result !== undefined && result.msg !== undefined) {
                    if (result.msg.text && result.msg.text !== '') {
                      this.alert.emit({
                        type: result.msg.type,
                        message: result.msg.text,
                      });
                    } else if (result.type !== undefined) {
                      this.shortcut.emit({
                        shortcut: comboKey,
                        shortcutName,
                        value: result.type,
                        type: 'boundary',
                        timePosition: this.audioManager.createSampleUnit(
                          result.seg_samples,
                        ),
                        timestamp: shortcutInfo.timestamp,
                      });
                    }
                  }
                }
                break;
              case 'set_break':
                if (
                  this.settings.boundaries.enabled &&
                  this._focused &&
                  this.mouseCursor !== undefined
                ) {
                  const xSamples = this.mouseCursor.clone();

                  if (
                    xSamples !== undefined &&
                    this.currentLevel &&
                    this.currentLevel.items.length > 0
                  ) {
                    const segmentI = getSegmentBySamplePosition(
                      this.currentLevel.items as TrattAnnotationSegment[],
                      xSamples,
                    );
                    if (
                      this.currentLevel.type === AnnotationLevelType.SEGMENT
                    ) {
                      const segment = this.currentLevel.items[
                        segmentI
                      ] as TrattAnnotationSegment<ASRContext>;
                      if (
                        segmentI > -1 &&
                        segment.context?.asr?.isBlockedBy === undefined &&
                        this.silencePlaceholder !== undefined
                      ) {
                        if (
                          segment.getFirstLabelWithoutName('Speaker')?.value !==
                          this.silencePlaceholder
                        ) {
                          segment.changeFirstLabelWithoutName(
                            'Speaker',
                            this.silencePlaceholder,
                          );
                          this.shortcut.emit({
                            shortcut: comboKey,
                            shortcutName,
                            value: 'set_break',
                            type: 'segment',
                            timePosition: xSamples.clone(),
                            timestamp: shortcutInfo.timestamp,
                          });
                        } else {
                          segment.changeFirstLabelWithoutName('Speaker', '');
                          this.shortcut.emit({
                            shortcut: comboKey,
                            shortcutName,
                            value: 'remove_break',
                            type: 'segment',
                            timePosition: xSamples.clone(),
                            timestamp: shortcutInfo.timestamp,
                          });
                        }
                        this.changeSegment(xSamples, segment);
                        this.redraw();
                      }
                    }
                  }
                }
                break;
              case 'play_selection':
                if (
                  this._focused &&
                  this.currentLevel?.items &&
                  this.currentLevel.items.length > 0 &&
                  this.audioChunk !== undefined &&
                  this.audioManager !== undefined &&
                  this.mouseCursor !== undefined
                ) {
                  const xSamples = this.mouseCursor.clone();

                  const boundarySelect = this.getSegmentSelection(
                    this.mouseCursor.samples,
                  );
                  if (boundarySelect) {
                    const segmentI = getSegmentBySamplePosition(
                      this.currentLevel
                        .items as TrattAnnotationSegment<ASRContext>[],
                      xSamples,
                    );
                    if (segmentI > -1) {
                      if (
                        this.currentLevel.type === AnnotationLevelType.SEGMENT
                      ) {
                        const currentLevel = this
                          .currentLevel as TrattAnnotationSegmentLevel<
                          TrattAnnotationSegment<ASRContext>
                        >;
                        const segment = currentLevel.items[segmentI];

                        const startTime = getStartTimeBySegmentID(
                          currentLevel.items as TrattAnnotationSegment<ASRContext>[],
                          segment.id,
                        );

                        // make shure, that segments boundaries are visible
                        if (
                          segment?.time !== undefined &&
                          (startTime as any).samples >=
                            this.audioChunk.time.start.samples &&
                          segment.time.samples <=
                            this.audioChunk.time.end.samples + 1 &&
                          this.audioTCalculator !== undefined
                        ) {
                          const absX = this.audioTCalculator.samplestoAbsX(
                            segment.time,
                          );
                          this.audioChunk.selection = boundarySelect.clone();
                          this.drawnSelection = boundarySelect.clone();
                          this.selchange.emit(this.audioChunk.selection);
                          this.drawWholeSelection();

                          const begin = (
                            segmentI > 0
                              ? this.currentLevel.items[segmentI - 1]
                              : this.annotation!.createSegment(
                                  this.audioManager.createSampleUnit(0),
                                  [new OLabel(this.currentLevel.name, '')],
                                )
                          ) as TrattAnnotationSegment<ASRContext>;

                          if (
                            begin?.time !== undefined &&
                            this.innerWidth !== undefined
                          ) {
                            const beginX = this.audioTCalculator.samplestoAbsX(
                              begin.time,
                            );

                            const posY1 =
                              this.innerWidth < this.AudioPxWidth
                                ? Math.floor(beginX / this.innerWidth + 1) *
                                    (this.settings.lineheight +
                                      this.settings.margin.bottom) -
                                  this.settings.margin.bottom
                                : 0;

                            const posY2 =
                              this.innerWidth < this.AudioPxWidth
                                ? Math.floor(absX / this.innerWidth + 1) *
                                    (this.settings.lineheight +
                                      this.settings.margin.bottom) -
                                  this.settings.margin.bottom
                                : 0;

                            if (
                              xSamples.samples >=
                                this.audioChunk.selection.start.samples &&
                              xSamples.samples <=
                                this.audioChunk.selection.end.samples
                            ) {
                              this.audioChunk.absolutePlayposition =
                                this.audioChunk.selection.start.clone();
                              this.changePlayCursorSamples(
                                this.audioChunk.selection.start,
                              );
                              this.updatePlayCursor();

                              this.shortcut.emit({
                                shortcut: comboKey,
                                shortcutName,
                                value: shortcutName,
                                type: 'audio',
                                timePosition: xSamples.clone(),
                                selection: boundarySelect.clone(),
                                timestamp: shortcutInfo.timestamp,
                              });

                              this.audioChunk.stopPlayback().then(() => {
                                if (this.audioChunk !== undefined) {
                                  // after stopping start audio playback
                                  this.audioChunk.selection =
                                    boundarySelect.clone();
                                  this.playSelection(this.afterAudioEnded);
                                }
                              });
                            }

                            if (!this.settings.multiLine) {
                              this.segmententer.emit({
                                index: segmentI,
                                pos: { Y1: posY1, Y2: posY2 },
                              });
                            }
                          } else {
                            console.warn(
                              '[audio-viewer.play_selection] segment invisible guard rejected',
                              {
                                segmentI,
                                currentLevelName: this.currentLevel?.name,
                                currentLevelLinkedKind: (
                                  this.currentLevel as any
                                )?.linkedKind,
                                segSamples: segment?.time?.samples,
                                startSamples: (startTime as any)?.samples,
                                chunkStart: this.audioChunk?.time.start.samples,
                                chunkEnd: this.audioChunk?.time.end.samples,
                                audioTCalculator:
                                  this.audioTCalculator !== undefined,
                              },
                            );
                            this.alert.emit({
                              type: 'error',
                              message: 'segment invisible',
                            });
                          }
                        }
                      }
                    }
                  }
                }
                break;
              case 'delete_boundaries':
                if (
                  this.settings.boundaries.enabled &&
                  !this.settings.boundaries.readonly &&
                  this._focused &&
                  this.currentLevel?.items &&
                  this.currentLevel.items.length > 0 &&
                  this.audioManager !== undefined
                ) {
                  let start = undefined;
                  let end = undefined;
                  const removedIDs: number[] = [];

                  if (this.currentLevel.items.length > 0) {
                    this.shortcut.emit({
                      shortcut: comboKey,
                      shortcutName,
                      value: shortcutName,
                      type: 'audio',
                      timePosition: this.mouseCursor?.clone(),
                      selection: this.drawnSelection?.clone(),
                      timestamp: shortcutInfo.timestamp,
                    });

                    for (let i = 0; i < this.currentLevel.items.length; i++) {
                      const segment = this.currentLevel.items[
                        i
                      ] as TrattAnnotationSegment<ASRContext>;

                      if (segment?.time !== undefined) {
                        if (
                          this.drawnSelection !== undefined &&
                          segment.time.samples >=
                            this.drawnSelection.start.samples &&
                          segment.time.samples <=
                            this.drawnSelection.end.samples &&
                          i < this.currentLevel.items.length - 1
                        ) {
                          this.removeSegmentByIndex(
                            i,
                            this.silencePlaceholder,
                            true,
                            false,
                          );
                          removedIDs.push(segment.id);
                          i--;
                          if (start === undefined) {
                            start = i;
                          }
                          end = i;
                        } else if (
                          this.drawnSelection !== undefined &&
                          this.drawnSelection.end.samples < segment.time.samples
                        ) {
                          break;
                        }
                      }
                    }
                  }

                  if (
                    start !== undefined &&
                    end !== undefined &&
                    this.drawnSelection !== undefined
                  ) {
                    this.drawnSelection.start =
                      this.audioManager.createSampleUnit(0);
                    this.drawnSelection.end = this.drawnSelection.start.clone();
                  }

                  if (removedIDs && removedIDs.length > 0) {
                    this.annotationChange.emit(this.annotation);
                    this.currentLevelChange.emit({
                      type: 'remove',
                      items: removedIDs.map((a) => ({
                        id: a,
                      })),
                      removeOptions: {
                        silenceCode: this.silencePlaceholder,
                        mergeTranscripts: true,
                      },
                    });
                  }
                }
                break;
              case 'segment_enter':
                if (
                  this.settings.boundaries.enabled &&
                  !this.settings.boundaries.readonly &&
                  this._focused &&
                  this.currentLevel?.items &&
                  this.currentLevel.items.length > 0 &&
                  this.canvasRenderer.stage !== undefined &&
                  this.mouseCursor !== undefined
                ) {
                  event.preventDefault();
                  this.shortcut.emit({
                    shortcut: comboKey,
                    shortcutName,
                    value: shortcutName,
                    type: 'segment',
                    timePosition: this.mouseCursor?.clone(),
                    timestamp: shortcutInfo.timestamp,
                  });

                  const segInde = getSegmentBySamplePosition(
                    this.currentLevel
                      .items as TrattAnnotationSegment<ASRContext>[],
                    this.mouseCursor,
                  );
                  this.selectSegment(segInde)
                    .then(({ posY1, posY2 }) => {
                      this._focused = false;
                      this.drawWholeSelection();
                      this.canvasRenderer.stage?.draw();
                      this.segmententer.emit({
                        index: segInde,
                        pos: { Y1: posY1, Y2: posY2 },
                      });
                    })
                    .catch(() => {
                      this.alert.emit({
                        type: 'error',
                        message: 'segment invisible',
                      });
                    });
                }
                break;
              case 'cursor_left':
                if (
                  this._focused &&
                  this.audioManager !== undefined &&
                  this.mouseCursor !== undefined
                ) {
                  // move cursor to left
                  this.shortcut.emit({
                    shortcut: comboKey,
                    shortcutName,
                    value: shortcutName,
                    type: 'mouse',
                    timePosition: this.mouseCursor?.clone(),
                    timestamp: shortcutInfo.timestamp,
                  });
                  this.moveCursor(
                    'left',
                    this.settings.stepWidthRatio * this.audioManager.sampleRate,
                  );
                  this.changeMouseCursorSamples(this.mouseCursor);
                  this.mousecursorchange.emit({
                    event: undefined,
                    time: this.mouseCursor,
                  });
                }
                break;
              case 'cursor_right':
                if (
                  this._focused &&
                  this.audioManager !== undefined &&
                  this.mouseCursor !== undefined
                ) {
                  // move cursor to right
                  this.shortcut.emit({
                    shortcut: comboKey,
                    shortcutName,
                    value: shortcutName,
                    type: 'mouse',
                    timePosition: this.mouseCursor.clone(),
                    timestamp: shortcutInfo.timestamp,
                  });

                  this.moveCursor(
                    'right',
                    this.settings.stepWidthRatio * this.audioManager.sampleRate,
                  );
                  this.changeMouseCursorSamples(this.mouseCursor);
                  this.mousecursorchange.emit({
                    event: undefined,
                    time: this.mouseCursor,
                  });
                }
                break;
              case 'playonhover':
                if (
                  this._focused &&
                  !this.settings.boundaries.readonly &&
                  this.mouseCursor !== undefined
                ) {
                  // move cursor to right
                  this.shortcut.emit({
                    shortcut: comboKey,
                    shortcutName,
                    value: shortcutName,
                    type: 'option',
                    timePosition: this.mouseCursor.clone(),
                    timestamp: shortcutInfo.timestamp,
                  });
                }
                break;

              case 'do_asr':
                if (
                  this.settings.boundaries.enabled &&
                  this.focused &&
                  this.settings.asr.enabled &&
                  this.currentLevel?.items &&
                  this.currentLevel.items.length > 0 &&
                  this.mouseCursor !== undefined
                ) {
                  const segmentI = getSegmentBySamplePosition(
                    this.currentLevel
                      .items as TrattAnnotationSegment<ASRContext>[],
                    this.mouseCursor,
                  );
                  const segment = this.currentLevel.items[
                    segmentI
                  ] as TrattAnnotationSegment<ASRContext>;

                  if (segmentI > -1) {
                    if (segment?.context?.asr?.isBlockedBy === undefined) {
                      this.shortcut.emit({
                        shortcut: comboKey,
                        shortcutName,
                        value: 'do_asr',
                        type: 'segment',
                        timePosition: this.mouseCursor.clone(),
                        timestamp: shortcutInfo.timestamp,
                      });
                    } else {
                      this.shortcut.emit({
                        shortcut: comboKey,
                        shortcutName,
                        value: 'cancel_asr',
                        type: 'segment',
                        timePosition: this.mouseCursor.clone(),
                        timestamp: shortcutInfo.timestamp,
                      });
                    }
                  }
                }
                break;
              case 'do_asr_maus':
                if (
                  this.settings.boundaries.enabled &&
                  this.settings.asr.enabled &&
                  this.currentLevel?.items &&
                  this.currentLevel.items.length > 0 &&
                  this.mouseCursor !== undefined
                ) {
                  const segmentI = getSegmentBySamplePosition(
                    this.currentLevel
                      .items as TrattAnnotationSegment<ASRContext>[],
                    this.mouseCursor,
                  );
                  const segment = this.currentLevel.items[
                    segmentI
                  ] as TrattAnnotationSegment<ASRContext>;

                  if (segmentI > -1) {
                    if (segment?.context?.asr?.isBlockedBy === undefined) {
                      this.shortcut.emit({
                        shortcut: comboKey,
                        shortcutName,
                        value: 'do_asr_maus',
                        type: 'segment',
                        timePosition: this.mouseCursor.clone(),
                        timestamp: shortcutInfo.timestamp,
                      });
                    } else {
                      this.shortcut.emit({
                        shortcut: comboKey,
                        shortcutName,
                        value: 'cancel_asr_maus',
                        type: 'segment',
                        timePosition: this.mouseCursor.clone(),
                        timestamp: shortcutInfo.timestamp,
                      });
                    }
                  }
                }
                break;

              case 'do_maus':
                if (
                  this.settings.boundaries.enabled &&
                  this.settings.asr.enabled &&
                  this.currentLevel?.items &&
                  this.currentLevel.items.length > 0 &&
                  this.mouseCursor !== undefined
                ) {
                  const segmentI = getSegmentBySamplePosition(
                    this.currentLevel
                      .items as TrattAnnotationSegment<ASRContext>[],
                    this.mouseCursor,
                  );
                  const segment = this.currentLevel.items[
                    segmentI
                  ] as TrattAnnotationSegment<ASRContext>;

                  if (segmentI > -1) {
                    if (segment?.context?.asr?.isBlockedBy === undefined) {
                      this.shortcut.emit({
                        shortcut: comboKey,
                        shortcutName,
                        value: 'do_maus',
                        type: 'segment',
                        timePosition: this.mouseCursor.clone(),
                        timestamp: shortcutInfo.timestamp,
                      });
                    } else {
                      this.shortcut.emit({
                        shortcut: comboKey,
                        shortcutName,
                        value: 'cancel_maus',
                        type: 'segment',
                        timePosition: this.mouseCursor.clone(),
                        timestamp: shortcutInfo.timestamp,
                      });
                    }
                  }
                }
                break;
            }
          }
        }
      }
    }
  };

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
  private isDisabledKey(comboKey: string): boolean {
    for (const disabledKey of this.settings.disabledKeys) {
      if (disabledKey === comboKey) {
        return true;
      }
    }

    return false;
  }

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
   * get Line by absolute width of the audio sample
   */
  getPlayCursorPositionOfLineByAbsX(absX: number): {
    x: number;
    y: number;
  } {
    return this.timeUtils.getPlayCursorPositionOfLineByAbsX(
      absX,
      this.innerWidth,
      this.settings,
    );
  }

  /**
   * get selection of an sample relative to its position and width
   */
  public getRelativeSelectionByLine(
    lineNum: number,
    lineWidth: number,
    startSamples: SampleUnit,
    endSamples: SampleUnit,
    innerWidth: number,
  ): { start: number; end: number } {
    return this.timeUtils.getRelativeSelectionByLine(
      lineNum,
      lineWidth,
      startSamples,
      endSamples,
      innerWidth,
      this.audioTCalculator,
      this.audioChunk,
    );
  }

  /**
   * save mouse position for further processing
   */
  public setMouseMovePosition(absX: number) {
    if (
      this.audioTCalculator !== undefined &&
      this.audioChunk !== undefined &&
      this.annotation?.currentLevel?.items &&
      this.annotation.currentLevel.items.length > 0
    ) {
      const absXTime = this.audioTCalculator.absXChunktoSampleUnit(
        absX,
        this.audioChunk,
      );

      if (absXTime !== undefined) {
        this._mouseCursor = absXTime.clone();

        if (this.mouseDown && this._dragableBoundaryID < 0) {
          // mouse down, nothing dragged
          if (!this.shiftPressed) {
            this.audioChunk.selection.end = absXTime.clone();
            this._drawnSelection = this.audioChunk.selection.clone();
          }
        } else if (
          this.settings.boundaries.enabled &&
          this.mouseDown &&
          this._dragableBoundaryID > -1
        ) {
          this.handleBoundaryDragging(absX, absXTime, false);

          this._boundaryDragging.next({
            shiftPressed: this.shiftPressed,
            id: this._dragableBoundaryID,
            status: 'dragging',
          });
          this.canvasRenderer.layers?.overlay.batchDraw();
        }
      }
    }
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
      mouseCursor: this._mouseCursor,
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

  /**
   * move cursor to one direction and x samples
   */
  public moveCursor(direction: string, samples: number) {
    if (
      this._mouseCursor !== undefined &&
      this.audioChunk !== undefined &&
      this.audioManager !== undefined
    ) {
      if (samples > 0) {
        const mouseCursorPosition = this._mouseCursor.samples;
        if (
          (direction === 'left' || direction === 'right') &&
          ((mouseCursorPosition >=
            this.audioChunk.time.start.samples + samples &&
            direction === 'left') ||
            (mouseCursorPosition <=
              this.audioChunk.time.end.samples - samples &&
              direction === 'right'))
        ) {
          if (direction === 'left') {
            if (
              this._mouseCursor.samples >=
              this.audioChunk.time.start.samples + samples
            ) {
              this._mouseCursor = this._mouseCursor.sub(
                this.audioManager.createSampleUnit(samples),
              );
            }
          } else if (direction === 'right') {
            if (
              this._mouseCursor.samples <=
              this.audioChunk.time.end.samples - samples
            ) {
              this._mouseCursor = this._mouseCursor.add(
                this.audioManager.createSampleUnit(samples),
              );
            }
          }
        }
      } else {
        throw new Error(
          'can not move cursor by given samples. Number of samples less than 0.',
        );
      }
    }
  }

  /**
   *
   * IMPORTANT! DON'T make async from this method, because it's not working with async in a web worker!
   *
   * @param width
   * @param height
   * @param channel
   * @param interval
   * @param roundValues
   * @param xZoom
   */
  private computeDisplayData = (
    width: number,
    height: number,
    channel: Float32Array,
    interval: {
      start: number;
      end: number;
    },
    roundValues: boolean,
    xZoom: number,
  ) => {
    return this.timeUtils.computeDisplayData(
      width,
      height,
      channel,
      interval,
      roundValues,
      xZoom,
    );
  };

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
  private timeLabelSceneFunction = (
    y: number,
    numOfLines: number,
    context: Context,
    shape: Shape,
  ) => {
    this.canvasRenderer.timeLabelSceneFunction(y, numOfLines, context, shape);
  };
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

  public addSegment(start: SampleUnit, value?: string) {
    this.segments.addSegment(
      this.annotation!,
      this.currentLevelChange,
      this.annotationChange,
      start,
      value,
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

  private transcriptBackgroundSceneFunc = (
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
    this.canvasRenderer.transcriptBackgroundSceneFunc(
      lineInterval,
      segment,
      isLastSegment,
      beginTime,
      numOfLines,
      context,
      shape,
    );
  };
  private overlaySceneFunction = (
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
  ) => {
    this.canvasRenderer.overlaySceneFunction(
      lineInterval,
      sceneSegment,
      isLastSegment,
      beginTime,
      numOfLines,
      context,
      shape,
      this.currentLevel,
    );
  };
  private drawRoundedRect(
    context: any,
    x: number,
    y: number,
    height: number,
    width: number,
    radius: number,
    fillColor: string,
    strokeColor?: string,
  ) {
    this.canvasRenderer.drawRoundedRect(
      context,
      x,
      y,
      height,
      width,
      radius,
      fillColor,
      strokeColor,
    );
  }
  private createScrollBar = () => {
    return this.canvasRenderer.createScrollBar(this.onScrollbarDragged);
  };
  private drawSelection = (lineNum: number, lineWidth: number) => {
    this.canvasRenderer.drawSelection(lineNum, lineWidth, this.drawnSelection);
  };
  private resetSelection() {
    this.canvasRenderer.resetSelection();
  }
  private drawWholeSelection() {
    this.canvasRenderer.drawWholeSelection(this.drawnSelection);
  }
  private getNumberOfLines() {
    return this.timeUtils.getNumberOfLines(this.innerWidth, this.AudioPxWidth);
  }

  private changeMouseCursorSamples = (newValue: SampleUnit) => {
    if (
      this.canvasRenderer.canvasElements?.mouseCaret !== undefined &&
      this.canvasRenderer.layers !== undefined &&
      this.audioTCalculator !== undefined &&
      this.innerWidth !== undefined
    ) {
      const absX = this.audioTCalculator.samplestoAbsX(newValue);
      const lines = Math.floor(absX / this.innerWidth);
      const x = absX % this.innerWidth;
      const y = lines * (this.settings.lineheight + this.settings.margin.top);

      this.canvasRenderer.canvasElements.mouseCaret.position({
        x,
        y,
      });
      this.canvasRenderer.layers.playhead.batchDraw();
    }
  };

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
  private createLineMouseCaret() {
    return this.canvasRenderer.createLineMouseCaret();
  }
  public refresh = () => {
    this.canvasRenderer.refresh(this.buildSegmentRenderContext());
  };
  public updateShortcuts(shortcuts: ShortcutGroup) {
    this.settings.shortcuts = shortcuts;
    if (this.shortcutsManager.shortcuts.length > 1) {
      this.shortcutsManager.clearShortcuts();
      this.shortcutsManager.registerShortcutGroup(shortcuts);
    }
  }

  private drawTextLabel(
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
    return this.canvasRenderer.drawTextLabel(
      context,
      text,
      lineNum1,
      lineNum2,
      segmentEnd,
      beginTime,
      lastI,
      numOfLines,
      segment,
      isLastSegment,
    );
  }
  private initializeStageContainer() {
    this.canvasRenderer.initializeStageContainer(
      this.buildStageEventHandlers(),
    );
  }
  public redraw() {
    this.canvasRenderer.redraw();
  }
  public redrawOverlay() {
    this.canvasRenderer.redrawOverlay();
  }
  private updateSize(stageWidth: number, stageHeight: number) {
    this.canvasRenderer.updateSize(stageWidth, stageHeight);
  }
  private initializeLayers() {
    this.canvasRenderer.initializeLayers(this.onWheel);
  }
  private onWheel = (event: KonvaEventObject<any>) => {
    if (
      this.canvasRenderer.canvasElements?.scrollBar !== undefined &&
      this.canvasRenderer.canvasElements?.scrollbarSelector !== undefined &&
      this.canvasRenderer.size?.height !== undefined
    ) {
      event.evt.preventDefault();
      let newY = Math.max(
        0,
        Math.min(
          this.canvasRenderer.canvasElements.scrollBar.height(),
          this.canvasRenderer.canvasElements.scrollbarSelector.y() +
            event.evt.deltaY / 2,
        ),
      );
      newY = Math.max(
        Math.min(
          newY,
          this.canvasRenderer.size.height -
            this.canvasRenderer.canvasElements.scrollbarSelector.height(),
        ),
        0,
      );
      this.canvasRenderer.canvasElements.scrollbarSelector.y(newY);
      this.onScrollbarDragged();
    }
  };

  private scrollWithDeltaY(deltaY: number) {
    if (
      this.canvasRenderer.layers !== undefined &&
      this.canvasRenderer.stage !== undefined &&
      this.canvasRenderer.canvasElements !== undefined &&
      this.canvasRenderer.canvasElements.lastLine !== undefined
    ) {
      const newY =
        (this.canvasRenderer.canvasElements.lastLine.y() +
          this.canvasRenderer.canvasElements.lastLine.height()) *
        deltaY;

      if (newY !== this.canvasRenderer.layers.background.y()) {
        // move all layers but keep scrollbars fixed
        this.canvasRenderer.layers.background.y(newY);
        this.canvasRenderer.layers.overlay.y(newY);
        this.canvasRenderer.layers.boundaries.y(newY);
        this.canvasRenderer.layers.playhead.y(newY);
        this.updateViewPort();
        this.showOnlyLinesInViewport();
        this.updateAllSegments();
      }
    }
  }

  private onScrollbarDragged = () => {
    if (
      this.canvasRenderer.canvasElements.scrollbarSelector !== undefined &&
      this.canvasRenderer.canvasElements?.scrollBar
    ) {
      // delta in %
      const delta =
        this.canvasRenderer.canvasElements.scrollbarSelector.y() /
        this.canvasRenderer.canvasElements.scrollBar.height();

      this.scrollWithDeltaY(-delta);
    }
  };

  private removeEventListenersFromContainer(container: HTMLElement) {
    container.removeEventListener('mousemove', this.onMouseMove);
    container.removeEventListener('mousedown', this.mouseChange);
    container.removeEventListener('mouseup', this.mouseChange);
  }

  private mouseChange = async (event: any) => {
    if (this.innerWidth) {
      const absXPos = this.hoveredLine * this.innerWidth + event.layerX;

      if (
        absXPos !== undefined &&
        absXPos > 0 &&
        this.settings?.selection.enabled &&
        this.audioChunk &&
        this.canvasRenderer.layers !== undefined &&
        (!this.canvasRenderer.canvasElements.scrollBar ||
          event.layerX < this.canvasRenderer.canvasElements.scrollBar!.x())
      ) {
        if (event.type === 'mousedown') {
          this.audioChunk.selection.start =
            this.audioChunk.absolutePlayposition.clone();
          this.audioChunk.selection.end =
            this.audioChunk.absolutePlayposition.clone();
        }

        await this.setMouseClickPosition(absXPos, this.hoveredLine, event);

        if (this.canvasRenderer.layers !== undefined) {
          this.updatePlayCursor();
          this.canvasRenderer.layers.playhead.draw();
        }

        if (event.type !== 'mousedown') {
          this.selchange.emit(this.audioChunk.selection);
        }
        this.drawWholeSelection();
      }
      this._focused = true;
    }
  };

  public getLineNumber(x: number, y: number) {
    return this.timeUtils.getLineNumber(
      x,
      y,
      this.innerWidth,
      this.AudioPxWidth,
      this.settings,
    );
  }

  private onMouseMove = (event: any) => {
    if (
      this.canvasRenderer.canvasElements?.mouseCaret &&
      this.canvasRenderer.layers &&
      this.canvasRenderer.stage &&
      this.innerWidth
    ) {
      const tempLine = this.getLineNumber(
        event.layerX,
        event.layerY + Math.abs(this.canvasRenderer.layers.background.y()),
      );
      this.hoveredLine = tempLine > -1 ? tempLine : this.hoveredLine;
      const maxLines = Math.ceil(this.AudioPxWidth / this.innerWidth);
      const restAbsX = this.hoveredLine * this.innerWidth;
      const lineWidth =
        this.hoveredLine === maxLines - 1 && maxLines > 1
          ? this.AudioPxWidth - restAbsX
          : this.innerWidth;
      const layerX = Math.min(event.layerX, lineWidth);
      const absXPos = Math.min(
        this.hoveredLine * this.innerWidth + layerX,
        this.AudioPxWidth,
      );

      if (!this.settings.cursor.fixed) {
        this.canvasRenderer.canvasElements.mouseCaret.position({
          x: layerX,
          y:
            this.hoveredLine *
            (this.settings.lineheight + this.settings.margin.top),
        });
        this.canvasRenderer.layers.playhead.batchDraw();
        if (this.drawnSelection && this.drawnSelection.duration.samples > 0) {
          this.drawWholeSelection();
        }
      }
      this.setMouseMovePosition(absXPos);
      this.mousecursorchange.emit({
        event,
        time: this.mouseCursor,
      });
      this.canvasRenderer.stage.container().focus();
      this._focused = true;
    }
  };

  private addEventListenersForContainer(container: HTMLElement) {
    container.addEventListener('mousemove', this.onMouseMove);
    container.addEventListener('mousedown', this.mouseChange);
    container.addEventListener('mouseup', this.mouseChange);
  }

  focus() {
    this.canvasRenderer.stage?.container().focus();
    this._focused = true;
  }
}

// Moved to AudioViewerSegmentsService (task 13, S1 split) along with the
// getChanges() method that produces it; re-exported here so existing
// imports (e.g. audio-viewer.component.ts's
// `import { AnnotationChange } from './audio-viewer.service'`) keep working
// unchanged.
export type { AnnotationChange } from './audio-viewer-segments.service';

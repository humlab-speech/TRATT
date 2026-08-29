import { EventEmitter, Injectable } from '@angular/core';
import {
  AnnotationLevelType,
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
  ShortcutEvent,
  ShortcutGroup,
  ShortcutManager,
} from '@tratt/web-media';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Subject, timer } from 'rxjs';
import { Subscription } from 'rxjs/internal/Subscription';
import type { PlayCursor } from '../../../obj/play-cursor';
import type {
  AudioViewerShortcutEvent,
  CurrentLevelChangeEvent,
} from './audio-viewer.component';

/**
 * The subset of `AudioviewerConfig` that the interaction bucket reads (and,
 * for `shortcuts`, writes). Declared locally rather than importing
 * `AudioviewerConfig` for the same reason as
 * `AudioViewerSegmentsService`'s `AudioViewerBoundarySettings` and
 * `AudioViewerTimeUtils`' `AudioViewerLineSettings`: importing
 * `AudioviewerConfig` drags in ng-bootstrap via the `obj` barrel, which
 * fails to load in vitest's node test environment. A real
 * `AudioviewerConfig` instance satisfies this shape structurally, so the
 * facade keeps handing over `this.settings` unchanged.
 */
export interface AudioViewerInteractionSettings {
  shortcutsEnabled: boolean;
  shortcuts: ShortcutGroup;
  disabledKeys: string[];
  multiLine: boolean;
  lineheight: number;
  stepWidthRatio: number;
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  boundaries: {
    enabled: boolean;
    readonly: boolean;
    width: number;
  };
  selection: {
    enabled: boolean;
  };
  cursor: {
    fixed: boolean;
  };
}

/** Result shape of the facade's `addOrRemoveSegment()`. */
export interface AddOrRemoveSegmentResult {
  type: string;
  seg_samples: number;
  seg_ID: number;
  msg: { type: string; text: string };
}

/**
 * A void, fire-and-forget rendering command produced by the interaction
 * bucket.
 *
 * Per the S1 split's DAG, `AudioViewerInteractionService` must not know
 * about `AudioViewerRendererService`. Every place the pre-split code
 * called straight into a rendering method (`updateAllSegments()`,
 * `redraw()`, `drawAllBoundaries()`, `layers.playhead.batchDraw()`, …)
 * now emits one of these instead, and `AudioViewerService` (the facade)
 * subscribes and performs the actual canvas work.
 *
 * `EventEmitter.emit` is synchronous (Angular's `EventEmitter` is a
 * `Subject` with `async === false`), so the emit-then-continue ordering is
 * byte-for-byte the same as the original direct calls — this is
 * deliberately NOT an async/queued hand-off.
 */
export type AudioViewerRenderRequest =
  | { type: 'redraw' }
  | { type: 'redraw-segment'; segmentID: number }
  | { type: 'draw-all-boundaries' }
  | { type: 'draw-whole-selection' }
  | { type: 'update-all-segments' }
  | { type: 'draw-stage' }
  | { type: 'focus-stage-container' }
  | { type: 'update-play-cursor' }
  | { type: 'draw-playhead-layer' }
  | { type: 'batch-draw-playhead-layer' }
  | { type: 'batch-draw-overlay-layer' }
  | { type: 'set-scrollbar-selector-y'; y: number }
  | { type: 'set-mouse-caret-position'; x: number; y: number }
  | { type: 'scroll-layers-to-y'; y: number };

/**
 * Read-only canvas geometry the interaction bucket needs but does not own.
 *
 * Rendering *commands* travel out via `renderRequest` (see
 * `AudioViewerRenderRequest`), but a handful of interaction methods also
 * need to *read* live Konva geometry — the scroll-bar selector's position,
 * the background layer's y offset, whether the mouse caret exists yet.
 * An emitter cannot serve a read, so those go through this narrow port of
 * named primitives. It is deliberately expressed in plain numbers and
 * booleans: no Konva types, no renderer type, nothing that would let this
 * bucket reach past the queries listed here.
 *
 * EVERY member here must be a *method*, never a pre-resolved value: they
 * are called from event handlers that are installed once and then live for
 * the lifetime of the viewer, while the underlying Konva nodes are
 * recreated whenever the canvas is rebuilt.
 */
export interface AudioViewerCanvasQueries {
  hasStage(): boolean;
  hasLayers(): boolean;
  hasCanvasElements(): boolean;
  hasMouseCaret(): boolean;
  hasScrollBar(): boolean;
  hasScrollbarSelector(): boolean;
  hasLastLine(): boolean;
  getStageHeight(): number | undefined;
  getScrollBarHeight(): number | undefined;
  getScrollBarX(): number | undefined;
  getScrollbarSelectorY(): number | undefined;
  getScrollbarSelectorHeight(): number | undefined;
  getLastLineY(): number | undefined;
  getLastLineHeight(): number | undefined;
  getBackgroundLayerY(): number | undefined;
}

/**
 * Everything `AudioViewerInteractionService` needs from the facade
 * (`AudioViewerService`) that it does not own itself.
 *
 * ## Why every state read is a getter *method*
 *
 * This is the single most important invariant in this file. The handlers
 * in this service (`onKeyDown`, `onMouseMove`, `mouseChange`, `onWheel`,
 * …) are arrow-function class properties: they are created ONCE, handed to
 * `addEventListener`, and then survive for the lifetime of the viewer. The
 * annotation model, by contrast, is replaced *wholesale* on every change
 * (`TrattAnnotation.clone()` on every `@Input() set annotation`, and
 * `handleBoundaryDragging` reassigns it too) — it is never mutated in
 * place. `audioChunk`, `settings`, `drawnSelection` and
 * `audioTCalculator` are likewise reassigned over the viewer's lifetime.
 *
 * So if this interface exposed `annotation: TrattAnnotation` as a plain
 * property, the object literal the facade builds would capture whatever
 * annotation existed at construction time and every keystroke thereafter
 * would operate on a stale model — silently reverting the user's edits the
 * moment a handler emitted a clone of a stale segment back into the store.
 * That exact bug was introduced (and later fixed) by the task-14 renderer
 * extraction; the accessor-method shape here exists to make it
 * structurally impossible to repeat.
 *
 * **Do not "simplify" any `getX(): T` below into `x: T`.** The only plain
 * properties allowed are the `EventEmitter`s: those are created once in
 * `AudioViewerService`'s field initializers and never reassigned, so
 * holding the reference is holding the live object.
 */
export interface AudioViewerInteractionHost {
  readonly canvas: AudioViewerCanvasQueries;

  // --- live state reads/writes (see class doc: methods, never values) ---
  getSettings(): AudioViewerInteractionSettings;
  getAnnotation(): TrattAnnotation<TrattAnnotationSegment> | undefined;
  setAnnotation(
    value: TrattAnnotation<TrattAnnotationSegment> | undefined,
  ): void;
  getTempAnnotation(): TrattAnnotation<TrattAnnotationSegment> | undefined;
  setTempAnnotation(
    value: TrattAnnotation<TrattAnnotationSegment> | undefined,
  ): void;
  getCurrentLevel():
    | TrattAnnotationAnyLevel<TrattAnnotationSegment>
    | undefined;
  getAudioChunk(): AudioChunk | undefined;
  getAudioManager(): AudioManager | undefined;
  getAudioTCalculator(): AudioTimeCalculator | undefined;
  getPlayCursor(): PlayCursor | undefined;
  getDrawnSelection(): AudioSelection | undefined;
  setDrawnSelection(value: AudioSelection | undefined): void;
  getInnerWidth(): number;
  getAudioPxWidth(): number;
  getSilencePlaceholder(): string | undefined;
  getRefreshOnInternChanges(): boolean;

  // --- operations owned by other buckets / the facade ---
  addOrRemoveSegment(): AddOrRemoveSegmentResult | undefined;
  getSegmentSelection(positionSamples: number): AudioSelection | undefined;
  changeSegment(start: SampleUnit, segment: TrattAnnotationSegment): void;
  removeSegmentByIndex(
    index: number,
    silenceCode: string | undefined,
    mergeTranscripts: boolean,
    triggerChange: boolean,
  ): void;
  selectSegment(segIndex: number): Promise<{ posY1: number; posY2: number }>;
  changePlayCursorSamples(newValue: SampleUnit, chunk?: AudioChunk): void;
  playSelection(afterAudioEnded: () => void): void;
  afterAudioEnded(): void;
  getLineNumber(x: number, y: number): number;

  // --- outputs owned by the facade (stable references, see class doc) ---
  readonly shortcut: EventEmitter<AudioViewerShortcutEvent>;
  readonly alert: EventEmitter<{ type: string; message: string }>;
  readonly segmententer: EventEmitter<{
    index: number;
    pos: { Y1: number; Y2: number };
  }>;
  readonly selchange: EventEmitter<AudioSelection>;
  readonly mousecursorchange: EventEmitter<{
    event: MouseEvent | undefined;
    time: SampleUnit | undefined;
  }>;
  readonly currentLevelChange: EventEmitter<CurrentLevelChangeEvent>;
  readonly annotationChange: EventEmitter<
    TrattAnnotation<TrattAnnotationSegment>
  >;
}

/**
 * AudioViewerInteractionService holds the keyboard/mouse interaction logic
 * extracted from AudioViewerService (S1 split, task 15/21).
 *
 * It owns the interaction state machine — which boundary is being dragged,
 * whether the mouse is down, where the mouse cursor and last click are,
 * whether the viewer is focused, which line is hovered, and the shortcut
 * manager — and nothing else. Model state (annotation/audio/settings) and
 * canvas state stay on their own buckets and are reached exclusively
 * through `AudioViewerInteractionHost`, whose accessors are all live (see
 * that interface's doc for why this matters).
 *
 * Per the split's DAG this service never touches
 * `AudioViewerRendererService`: rendering side effects leave via the
 * `renderRequest` emitter, canvas reads come in via `host.canvas`.
 */
@Injectable()
export class AudioViewerInteractionService {
  /**
   * Rendering side effects requested by interaction. Subscribed by
   * `AudioViewerService`, which is the only thing allowed to translate
   * these into renderer calls.
   */
  public renderRequest = new EventEmitter<AudioViewerRenderRequest>();

  public shortcutsManager = new ShortcutManager();
  public shiftPressed = false;
  public overboundary = false;

  private host!: AudioViewerInteractionHost;
  private subscrManager: SubscriptionManager<Subscription> =
    new SubscriptionManager<Subscription>();

  private mouseClickPos: SampleUnit | undefined;
  private _mouseDown = false;
  private _mouseCursor: SampleUnit | undefined;
  private _dragableBoundaryID = -1;
  private _focused = false;
  private hoveredLine = -1;

  private _boundaryDragging = new Subject<{
    status: 'started' | 'stopped' | 'dragging';
    id: number;
    shiftPressed?: boolean;
  }>();

  /**
   * Hands over the live view of everything this bucket doesn't own. Called
   * once, from `AudioViewerService`'s constructor.
   */
  public initialize(host: AudioViewerInteractionHost) {
    this.host = host;
  }

  public destroy() {
    this.subscrManager.destroy();
  }

  get boundaryDragging(): Subject<{
    status: 'started' | 'stopped' | 'dragging';
    id: number;
    shiftPressed?: boolean;
  }> {
    return this._boundaryDragging;
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  get mouseDown(): boolean {
    return this._mouseDown;
  }

  get mouseCursor(): SampleUnit | undefined {
    return this._mouseCursor;
  }

  /**
   * `AudioViewerService.initializeSettings()` seeds the cursor at sample 0
   * on (re)initialization; the facade deliberately exposes only a getter
   * publicly, so this write path is a method rather than a setter.
   */
  public setMouseCursor(value: SampleUnit | undefined) {
    this._mouseCursor = value;
  }

  get MouseClickPos(): SampleUnit | undefined {
    return this.mouseClickPos;
  }

  set MouseClickPos(value: SampleUnit | undefined) {
    this.mouseClickPos = value;
  }

  get dragableBoundaryID(): number {
    return this._dragableBoundaryID;
  }

  set dragableBoundaryID(value: number) {
    if (value > -1 && this._dragableBoundaryID === -1) {
      // started
      this.host.setTempAnnotation(this.host.getAnnotation());
      this.subscrManager.add(
        timer(0).subscribe({
          next: () => {
            this.renderRequest.emit({
              type: 'redraw-segment',
              segmentID: value,
            });
            this.renderRequest.emit({ type: 'draw-all-boundaries' });
            this.renderRequest.emit({ type: 'draw-whole-selection' });
          },
        }),
      );

      if (this.host.getRefreshOnInternChanges()) {
        this.renderRequest.emit({ type: 'redraw-segment', segmentID: value });
      }

      this._boundaryDragging.next({
        shiftPressed: this.shiftPressed,
        id: value,
        status: 'started',
      });
    }
    this._dragableBoundaryID = value;
  }

  // ===========================================================================
  // MOUSE
  // ===========================================================================

  public async setMouseClickPosition(
    absX: number,
    lineNum: number,
    $event: Event,
  ): Promise<number | undefined> {
    if (this.host.getAudioChunk() !== undefined) {
      const absXInTime = this.host
        .getAudioTCalculator()
        ?.absXChunktoSampleUnit(absX, this.host.getAudioChunk()!);

      const annotation = this.host.getAnnotation();

      if (
        absXInTime !== undefined &&
        this.host.getAudioManager() !== undefined &&
        this.host.getAudioChunk() !== undefined &&
        annotation?.currentLevel !== undefined &&
        annotation.currentLevel.items.length > 0 &&
        this.host.getAudioTCalculator() !== undefined &&
        this.host.getPlayCursor() !== undefined
      ) {
        this._mouseCursor = absXInTime.clone();

        if (!this.host.getAudioManager()!.isPlaying) {
          // same line
          // fix margin settings
          if ($event.type === 'mousedown') {
            // no line defined or same line
            this.mouseClickPos = absXInTime.clone();
            this.host.getAudioChunk()!.startpos = this.mouseClickPos.clone();
            this.host.getAudioChunk()!.selection.start = absXInTime.clone();
            this.host.getAudioChunk()!.selection.end = absXInTime.clone();
            if (!this.shiftPressed) {
              this.host.setDrawnSelection(
                this.host.getAudioChunk()!.selection.clone(),
              );
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
            this.renderRequest.emit({ type: 'update-all-segments' });
          }

          return lineNum;
        } else if (
          this.host.getAudioManager()!.state === PlayBackStatus.PLAYING &&
          $event.type === 'mouseup'
        ) {
          try {
            await this.host.getAudioChunk()!.stopPlayback();

            if (
              this.host.getAudioChunk() !== undefined &&
              this.host.getAudioTCalculator() !== undefined
            ) {
              this.host.getAudioChunk()!.startpos = absXInTime.clone();
              this.host.getAudioChunk()!.selection.end = absXInTime.clone();
              this.host.setDrawnSelection(
                this.host.getAudioChunk()!.selection.clone(),
              );
              this.host
                .getPlayCursor()
                ?.changeSamples(
                  absXInTime,
                  this.host.getAudioTCalculator()!,
                  this.host.getAudioChunk()!,
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
    let annotation = this.host.getTempAnnotation()?.clone();
    const currentLevel =
      annotation?.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const limitPadding = 500;
    const settings = this.host.getSettings();
    const audioTCalculator = this.host.getAudioTCalculator();
    const audioChunk = this.host.getAudioChunk();
    const audioManager = this.host.getAudioManager();
    const playCursor = this.host.getPlayCursor();

    const index = currentLevel?.items.findIndex(
      (a) => a.id === this._dragableBoundaryID,
    );
    if (
      annotation &&
      currentLevel &&
      index !== undefined &&
      index > -1 &&
      audioTCalculator &&
      audioChunk &&
      audioManager &&
      playCursor
    ) {
      const draggedItem = currentLevel.items[index];

      if (
        settings.boundaries.enabled &&
        !settings.boundaries.readonly &&
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

            let newTime = audioTCalculator.absXChunktoSampleUnit(
              absX,
              audioChunk,
            )!;

            if (
              previousSegment &&
              newTime.samples < previousSegment.time.samples + limitPadding
            ) {
              newTime = previousSegment.time.add(
                audioManager.createSampleUnit(limitPadding),
              );
            } else if (
              nextSegment &&
              newTime.samples > nextSegment.time.samples - limitPadding
            ) {
              newTime = nextSegment.time.sub(
                audioManager.createSampleUnit(limitPadding),
              );
            }

            segment.time = newTime;
            annotation.changeCurrentSegmentBySamplePosition(
              segment.time,
              segment,
            );

            if (emit) {
              this.host.currentLevelChange.emit({
                type: 'change',
                items: [
                  {
                    instance: segment,
                  },
                ],
              });
              this.host.annotationChange.emit(annotation);
            }
          } else if (this.host.getDrawnSelection()?.duration?.samples) {
            // move all segments with difference to left or right
            const drawnSelection = this.host.getDrawnSelection()!;
            const oldSamplePosition = segment.time.samples;
            const newSamplePosition = audioTCalculator.absXChunktoSampleUnit(
              absX,
              audioChunk,
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
                    drawnSelection.end!.samples
                ) {
                  const newItem = currentLevelElement.clone(
                    currentLevelElement.id,
                  );
                  newItem.time = currentLevelElement.time.add(
                    audioManager.createSampleUnit(diff),
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
                    drawnSelection.start!.samples
                ) {
                  const newItem = currentLevelElement.clone(
                    currentLevelElement.id,
                  );
                  newItem.time = currentLevelElement.time.add(
                    audioManager.createSampleUnit(diff),
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
              this.host.currentLevelChange.emit({
                type: 'change',
                items: changedItems.map((a) => ({ instance: a })),
              });
              this.host.annotationChange.emit(annotation);
            }
          }
        }
        this.host.setAnnotation(annotation);
      } else {
        // set selection
        audioChunk.selection.end = absXInTime.clone();
        audioChunk.selection.checkSelection();
        this.host.setDrawnSelection(audioChunk.selection.clone());

        playCursor.changeSamples(
          audioChunk.absolutePlayposition.clone(),
          audioTCalculator,
          audioChunk,
        );
      }
    }
  }

  /**
   * save mouse position for further processing
   */
  public setMouseMovePosition(absX: number) {
    const audioTCalculator = this.host.getAudioTCalculator();
    const audioChunk = this.host.getAudioChunk();
    const annotation = this.host.getAnnotation();
    const settings = this.host.getSettings();

    if (
      audioTCalculator !== undefined &&
      audioChunk !== undefined &&
      annotation?.currentLevel?.items &&
      annotation.currentLevel.items.length > 0
    ) {
      const absXTime = audioTCalculator.absXChunktoSampleUnit(absX, audioChunk);

      if (absXTime !== undefined) {
        this._mouseCursor = absXTime.clone();

        if (this.mouseDown && this._dragableBoundaryID < 0) {
          // mouse down, nothing dragged
          if (!this.shiftPressed) {
            audioChunk.selection.end = absXTime.clone();
            this.host.setDrawnSelection(audioChunk.selection.clone());
          }
        } else if (
          settings.boundaries.enabled &&
          this.mouseDown &&
          this._dragableBoundaryID > -1
        ) {
          this.handleBoundaryDragging(absX, absXTime, false);

          this._boundaryDragging.next({
            shiftPressed: this.shiftPressed,
            id: this._dragableBoundaryID,
            status: 'dragging',
          });
          this.renderRequest.emit({ type: 'batch-draw-overlay-layer' });
        }
      }
    }
  }

  /**
   * move cursor to one direction and x samples
   */
  public moveCursor(direction: string, samples: number) {
    const audioChunk = this.host.getAudioChunk();
    const audioManager = this.host.getAudioManager();

    if (
      this._mouseCursor !== undefined &&
      audioChunk !== undefined &&
      audioManager !== undefined
    ) {
      if (samples > 0) {
        const mouseCursorPosition = this._mouseCursor.samples;
        if (
          (direction === 'left' || direction === 'right') &&
          ((mouseCursorPosition >= audioChunk.time.start.samples + samples &&
            direction === 'left') ||
            (mouseCursorPosition <= audioChunk.time.end.samples - samples &&
              direction === 'right'))
        ) {
          if (direction === 'left') {
            if (
              this._mouseCursor.samples >=
              audioChunk.time.start.samples + samples
            ) {
              this._mouseCursor = this._mouseCursor.sub(
                audioManager.createSampleUnit(samples),
              );
            }
          } else if (direction === 'right') {
            if (
              this._mouseCursor.samples <=
              audioChunk.time.end.samples - samples
            ) {
              this._mouseCursor = this._mouseCursor.add(
                audioManager.createSampleUnit(samples),
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

  public changeMouseCursorSamples = (newValue: SampleUnit) => {
    const audioTCalculator = this.host.getAudioTCalculator();
    const innerWidth = this.host.getInnerWidth();

    if (
      this.host.canvas.hasMouseCaret() &&
      this.host.canvas.hasLayers() &&
      audioTCalculator !== undefined &&
      innerWidth !== undefined
    ) {
      const settings = this.host.getSettings();
      const absX = audioTCalculator.samplestoAbsX(newValue);
      const lines = Math.floor(absX / innerWidth);
      const x = absX % innerWidth;
      const y = lines * (settings.lineheight + settings.margin.top);

      this.renderRequest.emit({ type: 'set-mouse-caret-position', x, y });
      this.renderRequest.emit({ type: 'batch-draw-playhead-layer' });
    }
  };

  public onMouseEnter = () => {
    this.renderRequest.emit({ type: 'focus-stage-container' });
    this._focused = true;
  };

  public onMouseLeave = () => {
    this._focused = false;
  };

  public focus() {
    this.renderRequest.emit({ type: 'focus-stage-container' });
    this._focused = true;
  }

  public mouseChange = async (event: any) => {
    const innerWidth = this.host.getInnerWidth();
    if (innerWidth) {
      const absXPos = this.hoveredLine * innerWidth + event.layerX;

      if (
        absXPos !== undefined &&
        absXPos > 0 &&
        this.host.getSettings()?.selection.enabled &&
        this.host.getAudioChunk() &&
        this.host.canvas.hasLayers() &&
        (!this.host.canvas.hasScrollBar() ||
          event.layerX < this.host.canvas.getScrollBarX()!)
      ) {
        if (event.type === 'mousedown') {
          this.host.getAudioChunk()!.selection.start = this.host
            .getAudioChunk()!
            .absolutePlayposition.clone();
          this.host.getAudioChunk()!.selection.end = this.host
            .getAudioChunk()!
            .absolutePlayposition.clone();
        }

        await this.setMouseClickPosition(absXPos, this.hoveredLine, event);

        if (this.host.canvas.hasLayers()) {
          this.renderRequest.emit({ type: 'update-play-cursor' });
          this.renderRequest.emit({ type: 'draw-playhead-layer' });
        }

        if (event.type !== 'mousedown') {
          this.host.selchange.emit(this.host.getAudioChunk()!.selection);
        }
        this.renderRequest.emit({ type: 'draw-whole-selection' });
      }
      this._focused = true;
    }
  };

  public onMouseMove = (event: any) => {
    const innerWidth = this.host.getInnerWidth();

    if (
      this.host.canvas.hasMouseCaret() &&
      this.host.canvas.hasLayers() &&
      this.host.canvas.hasStage() &&
      innerWidth
    ) {
      const settings = this.host.getSettings();
      const audioPxWidth = this.host.getAudioPxWidth();
      const tempLine = this.host.getLineNumber(
        event.layerX,
        event.layerY + Math.abs(this.host.canvas.getBackgroundLayerY()!),
      );
      this.hoveredLine = tempLine > -1 ? tempLine : this.hoveredLine;
      const maxLines = Math.ceil(audioPxWidth / innerWidth);
      const restAbsX = this.hoveredLine * innerWidth;
      const lineWidth =
        this.hoveredLine === maxLines - 1 && maxLines > 1
          ? audioPxWidth - restAbsX
          : innerWidth;
      const layerX = Math.min(event.layerX, lineWidth);
      const absXPos = Math.min(
        this.hoveredLine * innerWidth + layerX,
        audioPxWidth,
      );

      if (!settings.cursor.fixed) {
        this.renderRequest.emit({
          type: 'set-mouse-caret-position',
          x: layerX,
          y: this.hoveredLine * (settings.lineheight + settings.margin.top),
        });
        this.renderRequest.emit({ type: 'batch-draw-playhead-layer' });
        const drawnSelection = this.host.getDrawnSelection();
        if (drawnSelection && drawnSelection.duration.samples > 0) {
          this.renderRequest.emit({ type: 'draw-whole-selection' });
        }
      }
      this.setMouseMovePosition(absXPos);
      this.host.mousecursorchange.emit({
        event,
        time: this.mouseCursor,
      });
      this.renderRequest.emit({ type: 'focus-stage-container' });
      this._focused = true;
    }
  };

  // ===========================================================================
  // SCROLLING
  // ===========================================================================

  public onWheel = (event: KonvaEventObject<any>) => {
    const canvas = this.host.canvas;
    if (
      canvas.hasScrollBar() &&
      canvas.hasScrollbarSelector() &&
      canvas.getStageHeight() !== undefined
    ) {
      event.evt.preventDefault();
      let newY = Math.max(
        0,
        Math.min(
          canvas.getScrollBarHeight()!,
          canvas.getScrollbarSelectorY()! + event.evt.deltaY / 2,
        ),
      );
      newY = Math.max(
        Math.min(
          newY,
          canvas.getStageHeight()! - canvas.getScrollbarSelectorHeight()!,
        ),
        0,
      );
      this.renderRequest.emit({ type: 'set-scrollbar-selector-y', y: newY });
      this.onScrollbarDragged();
    }
  };

  public scrollWithDeltaY(deltaY: number) {
    const canvas = this.host.canvas;
    if (
      canvas.hasLayers() &&
      canvas.hasStage() &&
      canvas.hasCanvasElements() &&
      canvas.hasLastLine()
    ) {
      const newY =
        (canvas.getLastLineY()! + canvas.getLastLineHeight()!) * deltaY;

      if (newY !== canvas.getBackgroundLayerY()) {
        // move all layers but keep scrollbars fixed
        this.renderRequest.emit({ type: 'scroll-layers-to-y', y: newY });
      }
    }
  }

  public onScrollbarDragged = () => {
    const canvas = this.host.canvas;
    if (canvas.hasScrollbarSelector() && canvas.hasScrollBar()) {
      // delta in %
      const delta =
        canvas.getScrollbarSelectorY()! / canvas.getScrollBarHeight()!;

      this.scrollWithDeltaY(-delta);
    }
  };

  // ===========================================================================
  // KEYBOARD
  // ===========================================================================

  public updateShortcuts(shortcuts: ShortcutGroup) {
    this.host.getSettings().shortcuts = shortcuts;
    if (this.shortcutsManager.shortcuts.length > 1) {
      this.shortcutsManager.clearShortcuts();
      this.shortcutsManager.registerShortcutGroup(shortcuts);
    }
  }

  public isDisabledKey(comboKey: string): boolean {
    for (const disabledKey of this.host.getSettings().disabledKeys) {
      if (disabledKey === comboKey) {
        return true;
      }
    }

    return false;
  }

  public onKeyUp = (event: KeyboardEvent) => {
    this.shiftPressed = false;
    this.shortcutsManager.checkKeyEvent(event, Date.now());
  };

  /**
   * Keyboard entry point. The original was a single ~630-line
   * `switch (shortcutName)`; the per-shortcut bodies now live in the
   * `handle*` methods below and this stays a slim guard + dispatch.
   *
   * The guards are the same ones (and in the same order) the original
   * nested `if`s expressed, just inverted into early returns.
   */
  public onKeyDown = (event: KeyboardEvent) => {
    const shortcutInfo = this.shortcutsManager.checkKeyEvent(event, Date.now());

    this.shiftPressed =
      event.keyCode === 16 ||
      event.code?.includes('Shift') ||
      event.key?.includes('Shift');

    if (shortcutInfo === undefined) {
      return;
    }

    if (!this.host.getSettings().shortcutsEnabled) {
      return;
    }

    const comboKey = shortcutInfo.shortcut;

    if (this._focused && this.isDisabledKey(comboKey)) {
      // key pressed is disabled by config
      event.preventDefault();
      return;
    }

    const focuscheck =
      shortcutInfo.onFocusOnly === false ||
      shortcutInfo.onFocusOnly === this._focused;

    if (!focuscheck) {
      return;
    }

    switch (shortcutInfo.shortcutName) {
      case 'undo':
      case 'redo':
        this.handleUndoRedo(shortcutInfo);
        break;
      case 'set_boundary':
        this.handleSetBoundary(shortcutInfo);
        break;
      case 'set_break':
        this.handleSetBreak(shortcutInfo);
        break;
      case 'play_selection':
        this.handlePlaySelection(shortcutInfo);
        break;
      case 'delete_boundaries':
        this.handleDeleteBoundaries(shortcutInfo);
        break;
      case 'segment_enter':
        this.handleSegmentEnter(event, shortcutInfo);
        break;
      case 'cursor_left':
        this.handleMoveCursor(shortcutInfo, 'left');
        break;
      case 'cursor_right':
        this.handleMoveCursor(shortcutInfo, 'right');
        break;
      case 'playonhover':
        this.handlePlayOnHover(shortcutInfo);
        break;
    }
  };

  /**
   * `undo`/`redo` had byte-identical bodies in the original switch — the
   * only difference was the `case` label, and both forward `shortcutName`
   * verbatim, so they share one handler.
   */
  private handleUndoRedo(shortcutInfo: ShortcutEvent) {
    const settings = this.host.getSettings();
    if (
      settings.boundaries.enabled &&
      this._focused &&
      !settings.boundaries.readonly
    ) {
      this.host.shortcut.emit({
        shortcut: shortcutInfo.shortcut,
        shortcutName: shortcutInfo.shortcutName,
        type: 'application',
        timePosition: this?.mouseCursor?.clone(),
        timestamp: shortcutInfo.timestamp,
      });
    }
  }

  private handleSetBoundary(shortcutInfo: ShortcutEvent) {
    const settings = this.host.getSettings();
    const audioManager = this.host.getAudioManager();

    if (
      settings.boundaries.enabled &&
      !settings.boundaries.readonly &&
      this._focused &&
      audioManager !== undefined &&
      this.host.getAnnotation()?.currentLevel?.items
    ) {
      const result = this.host.addOrRemoveSegment();
      if (result !== undefined && result.msg !== undefined) {
        if (result.msg.text && result.msg.text !== '') {
          this.host.alert.emit({
            type: result.msg.type,
            message: result.msg.text,
          });
        } else if (result.type !== undefined) {
          this.host.shortcut.emit({
            shortcut: shortcutInfo.shortcut,
            shortcutName: shortcutInfo.shortcutName,
            value: result.type,
            type: 'boundary',
            timePosition: audioManager.createSampleUnit(result.seg_samples),
            timestamp: shortcutInfo.timestamp,
          });
        }
      }
    }
  }

  private handleSetBreak(shortcutInfo: ShortcutEvent) {
    const settings = this.host.getSettings();

    if (
      settings.boundaries.enabled &&
      this._focused &&
      this.mouseCursor !== undefined
    ) {
      const xSamples = this.mouseCursor.clone();
      const currentLevel = this.host.getCurrentLevel();
      const silencePlaceholder = this.host.getSilencePlaceholder();

      if (
        xSamples !== undefined &&
        currentLevel &&
        currentLevel.items.length > 0
      ) {
        const segmentI = getSegmentBySamplePosition(
          currentLevel.items as TrattAnnotationSegment[],
          xSamples,
        );
        if (currentLevel.type === AnnotationLevelType.SEGMENT) {
          const segment = currentLevel.items[
            segmentI
          ] as TrattAnnotationSegment;
          if (segmentI > -1 && silencePlaceholder !== undefined) {
            if (
              segment.getFirstLabelWithoutName('Speaker')?.value !==
              silencePlaceholder
            ) {
              segment.changeFirstLabelWithoutName(
                'Speaker',
                silencePlaceholder,
              );
              this.host.shortcut.emit({
                shortcut: shortcutInfo.shortcut,
                shortcutName: shortcutInfo.shortcutName,
                value: 'set_break',
                type: 'segment',
                timePosition: xSamples.clone(),
                timestamp: shortcutInfo.timestamp,
              });
            } else {
              segment.changeFirstLabelWithoutName('Speaker', '');
              this.host.shortcut.emit({
                shortcut: shortcutInfo.shortcut,
                shortcutName: shortcutInfo.shortcutName,
                value: 'remove_break',
                type: 'segment',
                timePosition: xSamples.clone(),
                timestamp: shortcutInfo.timestamp,
              });
            }
            this.host.changeSegment(xSamples, segment);
            this.renderRequest.emit({ type: 'redraw' });
          }
        }
      }
    }
  }

  private handlePlaySelection(shortcutInfo: ShortcutEvent) {
    const currentLevel = this.host.getCurrentLevel();
    const audioChunk = this.host.getAudioChunk();
    const audioManager = this.host.getAudioManager();
    const settings = this.host.getSettings();

    if (
      this._focused &&
      currentLevel?.items &&
      currentLevel.items.length > 0 &&
      audioChunk !== undefined &&
      audioManager !== undefined &&
      this.mouseCursor !== undefined
    ) {
      const xSamples = this.mouseCursor.clone();

      const boundarySelect = this.host.getSegmentSelection(
        this.mouseCursor.samples,
      );
      if (boundarySelect) {
        const segmentI = getSegmentBySamplePosition(
          currentLevel.items as TrattAnnotationSegment[],
          xSamples,
        );
        if (segmentI > -1) {
          if (currentLevel.type === AnnotationLevelType.SEGMENT) {
            const segmentLevel =
              currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
            const segment = segmentLevel.items[segmentI];

            const startTime = getStartTimeBySegmentID(
              segmentLevel.items as TrattAnnotationSegment[],
              segment.id,
            );

            const audioTCalculator = this.host.getAudioTCalculator();

            // make shure, that segments boundaries are visible
            if (
              segment?.time !== undefined &&
              (startTime as any).samples >= audioChunk.time.start.samples &&
              segment.time.samples <= audioChunk.time.end.samples + 1 &&
              audioTCalculator !== undefined
            ) {
              const absX = audioTCalculator.samplestoAbsX(segment.time);
              audioChunk.selection = boundarySelect.clone();
              this.host.setDrawnSelection(boundarySelect.clone());
              this.host.selchange.emit(audioChunk.selection);
              this.renderRequest.emit({ type: 'draw-whole-selection' });

              const begin = (
                segmentI > 0
                  ? currentLevel.items[segmentI - 1]
                  : this.host
                      .getAnnotation()!
                      .createSegment(audioManager.createSampleUnit(0), [
                        new OLabel(currentLevel.name, ''),
                      ])
              ) as TrattAnnotationSegment;

              const innerWidth = this.host.getInnerWidth();
              const audioPxWidth = this.host.getAudioPxWidth();

              if (begin?.time !== undefined && innerWidth !== undefined) {
                const beginX = audioTCalculator.samplestoAbsX(begin.time);

                const posY1 =
                  innerWidth < audioPxWidth
                    ? Math.floor(beginX / innerWidth + 1) *
                        (settings.lineheight + settings.margin.bottom) -
                      settings.margin.bottom
                    : 0;

                const posY2 =
                  innerWidth < audioPxWidth
                    ? Math.floor(absX / innerWidth + 1) *
                        (settings.lineheight + settings.margin.bottom) -
                      settings.margin.bottom
                    : 0;

                if (
                  xSamples.samples >= audioChunk.selection.start.samples &&
                  xSamples.samples <= audioChunk.selection.end.samples
                ) {
                  audioChunk.absolutePlayposition =
                    audioChunk.selection.start.clone();
                  this.host.changePlayCursorSamples(audioChunk.selection.start);
                  this.renderRequest.emit({ type: 'update-play-cursor' });

                  this.host.shortcut.emit({
                    shortcut: shortcutInfo.shortcut,
                    shortcutName: shortcutInfo.shortcutName,
                    value: shortcutInfo.shortcutName,
                    type: 'audio',
                    timePosition: xSamples.clone(),
                    selection: boundarySelect.clone(),
                    timestamp: shortcutInfo.timestamp,
                  });

                  audioChunk.stopPlayback().then(() => {
                    const chunk = this.host.getAudioChunk();
                    if (chunk !== undefined) {
                      // after stopping start audio playback
                      chunk.selection = boundarySelect.clone();
                      this.host.playSelection(() =>
                        this.host.afterAudioEnded(),
                      );
                    }
                  });
                }

                if (!settings.multiLine) {
                  this.host.segmententer.emit({
                    index: segmentI,
                    pos: { Y1: posY1, Y2: posY2 },
                  });
                }
              } else {
                console.warn(
                  '[audio-viewer.play_selection] segment invisible guard rejected',
                  {
                    segmentI,
                    currentLevelName: currentLevel?.name,
                    currentLevelLinkedKind: (currentLevel as any)?.linkedKind,
                    segSamples: segment?.time?.samples,
                    startSamples: (startTime as any)?.samples,
                    chunkStart: audioChunk?.time.start.samples,
                    chunkEnd: audioChunk?.time.end.samples,
                    audioTCalculator: audioTCalculator !== undefined,
                  },
                );
                this.host.alert.emit({
                  type: 'error',
                  message: 'segment invisible',
                });
              }
            }
          }
        }
      }
    }
  }

  private handleDeleteBoundaries(shortcutInfo: ShortcutEvent) {
    const settings = this.host.getSettings();
    const currentLevel = this.host.getCurrentLevel();
    const audioManager = this.host.getAudioManager();
    const silencePlaceholder = this.host.getSilencePlaceholder();

    if (
      settings.boundaries.enabled &&
      !settings.boundaries.readonly &&
      this._focused &&
      currentLevel?.items &&
      currentLevel.items.length > 0 &&
      audioManager !== undefined
    ) {
      let start = undefined;
      let end = undefined;
      const removedIDs: number[] = [];

      if (currentLevel.items.length > 0) {
        this.host.shortcut.emit({
          shortcut: shortcutInfo.shortcut,
          shortcutName: shortcutInfo.shortcutName,
          value: shortcutInfo.shortcutName,
          type: 'audio',
          timePosition: this.mouseCursor?.clone(),
          selection: this.host.getDrawnSelection()?.clone(),
          timestamp: shortcutInfo.timestamp,
        });

        for (let i = 0; i < currentLevel.items.length; i++) {
          const segment = currentLevel.items[i] as TrattAnnotationSegment;

          if (segment?.time !== undefined) {
            const drawnSelection = this.host.getDrawnSelection();
            if (
              drawnSelection !== undefined &&
              segment.time.samples >= drawnSelection.start.samples &&
              segment.time.samples <= drawnSelection.end.samples &&
              i < currentLevel.items.length - 1
            ) {
              this.host.removeSegmentByIndex(
                i,
                silencePlaceholder,
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
              drawnSelection !== undefined &&
              drawnSelection.end.samples < segment.time.samples
            ) {
              break;
            }
          }
        }
      }

      const drawnSelection = this.host.getDrawnSelection();
      if (
        start !== undefined &&
        end !== undefined &&
        drawnSelection !== undefined
      ) {
        drawnSelection.start = audioManager.createSampleUnit(0);
        drawnSelection.end = drawnSelection.start.clone();
      }

      if (removedIDs && removedIDs.length > 0) {
        this.host.annotationChange.emit(this.host.getAnnotation());
        this.host.currentLevelChange.emit({
          type: 'remove',
          items: removedIDs.map((a) => ({
            id: a,
          })),
          removeOptions: {
            silenceCode: silencePlaceholder,
            mergeTranscripts: true,
          },
        });
      }
    }
  }

  private handleSegmentEnter(
    event: KeyboardEvent,
    shortcutInfo: ShortcutEvent,
  ) {
    const settings = this.host.getSettings();
    const currentLevel = this.host.getCurrentLevel();

    if (
      settings.boundaries.enabled &&
      !settings.boundaries.readonly &&
      this._focused &&
      currentLevel?.items &&
      currentLevel.items.length > 0 &&
      this.host.canvas.hasStage() &&
      this.mouseCursor !== undefined
    ) {
      event.preventDefault();
      this.host.shortcut.emit({
        shortcut: shortcutInfo.shortcut,
        shortcutName: shortcutInfo.shortcutName,
        value: shortcutInfo.shortcutName,
        type: 'segment',
        timePosition: this.mouseCursor?.clone(),
        timestamp: shortcutInfo.timestamp,
      });

      const segInde = getSegmentBySamplePosition(
        currentLevel.items as TrattAnnotationSegment[],
        this.mouseCursor,
      );
      this.host
        .selectSegment(segInde)
        .then(({ posY1, posY2 }) => {
          this._focused = false;
          this.renderRequest.emit({ type: 'draw-whole-selection' });
          this.renderRequest.emit({ type: 'draw-stage' });
          this.host.segmententer.emit({
            index: segInde,
            pos: { Y1: posY1, Y2: posY2 },
          });
        })
        .catch(() => {
          this.host.alert.emit({
            type: 'error',
            message: 'segment invisible',
          });
        });
    }
  }

  /**
   * `cursor_left` and `cursor_right` had identical bodies apart from the
   * direction string passed to `moveCursor`.
   */
  private handleMoveCursor(
    shortcutInfo: ShortcutEvent,
    direction: 'left' | 'right',
  ) {
    const audioManager = this.host.getAudioManager();
    const settings = this.host.getSettings();

    if (
      this._focused &&
      audioManager !== undefined &&
      this.mouseCursor !== undefined
    ) {
      // move cursor to the given direction
      this.host.shortcut.emit({
        shortcut: shortcutInfo.shortcut,
        shortcutName: shortcutInfo.shortcutName,
        value: shortcutInfo.shortcutName,
        type: 'mouse',
        timePosition: this.mouseCursor?.clone(),
        timestamp: shortcutInfo.timestamp,
      });
      this.moveCursor(
        direction,
        settings.stepWidthRatio * audioManager.sampleRate,
      );
      this.changeMouseCursorSamples(this.mouseCursor!);
      this.host.mousecursorchange.emit({
        event: undefined,
        time: this.mouseCursor,
      });
    }
  }

  private handlePlayOnHover(shortcutInfo: ShortcutEvent) {
    const settings = this.host.getSettings();

    if (
      this._focused &&
      !settings.boundaries.readonly &&
      this.mouseCursor !== undefined
    ) {
      this.host.shortcut.emit({
        shortcut: shortcutInfo.shortcut,
        shortcutName: shortcutInfo.shortcutName,
        value: shortcutInfo.shortcutName,
        type: 'option',
        timePosition: this.mouseCursor.clone(),
        timestamp: shortcutInfo.timestamp,
      });
    }
  }
}

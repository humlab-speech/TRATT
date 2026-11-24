import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  ViewChild,
} from '@angular/core';
import { formatTime } from '../boundary-time';
import { computePeaks } from './peaks';

const WIDTH = 360;
const HEIGHT = 100;
const HALF_WINDOW_S = 1.5;

/**
 * Waveform snippet (±1.5 s) around one segment boundary. Dragging the line
 * previews a new position; `boundaryChange` fires once on release.
 */
@Component({
  selector: 'tratt-boundary-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      #canvas
      [width]="width"
      [height]="height"
      [style.cursor]="canDrag ? 'ew-resize' : 'default'"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="cancelDrag()"
    ></canvas>
    <div class="bp-label">{{ label }}</div>
  `,
  styles: `
    :host {
      display: block;
      padding: 6px;
      background: var(--bs-body-bg, #fff);
      border: 1px solid var(--tratt-border, #ccc);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    canvas {
      display: block;
      touch-action: none;
    }
    .bp-label {
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-size: 0.85rem;
    }
  `,
})
export class BoundaryPopoverComponent implements AfterViewInit, OnChanges {
  @Input() channel?: Float32Array;
  @Input() factor = 1;
  @Input() sampleRate = 1;
  /** current boundary position in samples */
  @Input() boundary = 0;
  /** start of the segment left of the boundary / end of the one right of it */
  @Input() leftStart = 0;
  @Input() rightEnd = 0;
  @Input() editable = false;
  @Input() clamp: (samples: number) => number = (samples) => samples;
  @Output() boundaryChange = new EventEmitter<number>();

  @ViewChild('canvas', { static: true })
  canvas!: ElementRef<HTMLCanvasElement>;

  readonly width = WIDTH;
  readonly height = HEIGHT;

  private preview?: number;
  private dragging = false;

  constructor(private cd: ChangeDetectorRef) {}

  get canDrag(): boolean {
    return this.editable && !!this.channel;
  }

  get label(): string {
    return formatTime(this.preview ?? this.boundary, this.sampleRate);
  }

  private get windowStart(): number {
    return this.boundary - HALF_WINDOW_S * this.sampleRate;
  }

  private get windowEnd(): number {
    return this.boundary + HALF_WINDOW_S * this.sampleRate;
  }

  ngAfterViewInit() {
    this.draw();
  }

  ngOnChanges() {
    this.preview = undefined;
    this.draw();
  }

  onPointerDown(event: PointerEvent) {
    if (!this.canDrag) return;
    this.dragging = true;
    this.canvas.nativeElement.setPointerCapture(event.pointerId);
    this.onPointerMove(event);
  }

  onPointerMove(event: PointerEvent) {
    if (!this.dragging) return;
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    this.preview = this.clamp(
      Math.round(
        this.windowStart + ratio * (this.windowEnd - this.windowStart),
      ),
    );
    this.draw();
    this.cd.markForCheck();
  }

  onPointerUp(event: PointerEvent) {
    if (!this.dragging) return;
    this.onPointerMove(event);
    this.dragging = false;
    const result = this.preview;
    if (result !== undefined && result !== this.boundary) {
      this.boundaryChange.emit(result);
    } else {
      this.preview = undefined;
      this.draw();
      this.cd.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  cancelDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.preview = undefined;
    this.draw();
    this.cd.markForCheck();
  }

  private draw() {
    const el = this.canvas?.nativeElement;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const start = this.windowStart;
    const span = this.windowEnd - start;
    const x = (sample: number) => ((sample - start) / span) * WIDTH;
    const at = this.preview ?? this.boundary;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(40, 120, 220, 0.15)';
    ctx.fillRect(x(this.leftStart), 0, x(at) - x(this.leftStart), HEIGHT);
    ctx.fillStyle = 'rgba(230, 140, 30, 0.15)';
    ctx.fillRect(x(at), 0, x(this.rightEnd) - x(at), HEIGHT);

    if (this.channel) {
      const peaks = computePeaks(
        this.channel,
        this.factor,
        start,
        this.windowEnd,
        WIDTH,
      );
      const mid = HEIGHT / 2;
      ctx.fillStyle = getComputedStyle(el).color;
      peaks.forEach((p, px) => {
        const top = mid - p.max * mid;
        ctx.fillRect(px, top, 1, Math.max(1, (p.max - p.min) * mid));
      });
    }

    ctx.fillStyle = '#d62828';
    ctx.fillRect(Math.round(x(at)) - 1, 0, 2, HEIGHT);
  }
}

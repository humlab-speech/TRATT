import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { PlayBackStatus } from '@tratt/media';
import { Subscription } from 'rxjs';
import { AudioService } from '../../../shared/service';
import { computePeaks, Peak } from '../boundary-popover/peaks';
import { unitAt } from '../boundary-time';

const HEIGHT = 44;
/** Height of the unit-state strip under the waveform. */
const STRIP = 5;

type UnitState = 'success' | 'info' | 'danger';

/**
 * The whole recording as one waveform strip, for the Overview footer: unit
 * boundaries, each unit's state (transcribed / break / empty) as a coloured
 * strip, the selected unit shaded, and a position line that follows playback.
 * Clicking (or the arrow keys) asks the parent to select a unit; it does not
 * start or move playback.
 */
@Component({
  selector: 'tratt-overview-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    <canvas
      #canvas
      tabindex="0"
      role="slider"
      [attr.aria-label]="'g.overview timeline' | transloco"
      [attr.aria-valuemin]="1"
      [attr.aria-valuemax]="unitCount"
      [attr.aria-valuenow]="selected + 1"
      [title]="'g.overview timeline help' | transloco"
      (pointerdown)="onPointerDown($event)"
      (keydown)="onKeyDown($event)"
    ></canvas>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    canvas {
      display: block;
      width: 100%;
      height: ${HEIGHT}px;
      cursor: pointer;
      border: 1px solid var(--tratt-border, #ccc);
      border-radius: 4px;
      background: var(--bs-body-bg, #fff);
      color: var(--bs-body-color, #333);
    }
    canvas:focus-visible {
      outline: 2px solid var(--tratt-interactive, #0d6efd);
      outline-offset: 1px;
    }
  `,
})
export class OverviewTimelineComponent
  implements AfterViewInit, OnChanges, OnDestroy
{
  /** The tier whose units are shown. */
  @Input() level?: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
  /** Text that marks a unit as a break, if the guidelines define one. */
  @Input() breakMarker?: string;
  /** Selected unit index, -1 for none. */
  @Input() selected = -1;
  /** Where the position line rests when nothing plays (samples). */
  @Input() cursor?: number;
  /** The unit at the clicked point, and the point itself (samples). */
  @Output() unitPicked = new EventEmitter<{ unit: number; sample: number }>();

  @ViewChild('canvas', { static: true })
  canvas!: ElementRef<HTMLCanvasElement>;

  private readonly audio = inject(AudioService);
  private readonly zone = inject(NgZone);
  private resizeObserver?: ResizeObserver;
  private stateSub?: Subscription;
  private frame = 0;
  private peaks?: { width: number; values: Peak[] };
  private ends: number[] = [];

  /** The level's units; only a SEGMENT level has times. */
  private get segments(): TrattAnnotationSegment[] {
    return this.level?.type === 'SEGMENT'
      ? (this.level.items as TrattAnnotationSegment[])
      : [];
  }

  get unitCount(): number {
    return this.ends.length;
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(this.canvas.nativeElement);
    });
    this.stateSub = this.audio.current?.statechange.subscribe((state) => {
      if (state === PlayBackStatus.PLAYING) this.follow();
      else this.draw();
    });
    this.draw();
  }

  ngOnChanges() {
    this.ends = this.segments.map((item) => item.time.samples);
    this.draw();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.stateSub?.unsubscribe();
    cancelAnimationFrame(this.frame);
  }

  onPointerDown(event: PointerEvent) {
    const total = this.totalSamples;
    if (!total || this.ends.length === 0) return;
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const sample = Math.round(ratio * total);
    this.unitPicked.emit({ unit: unitAt(this.ends, sample), sample });
  }

  onKeyDown(event: KeyboardEvent) {
    const step =
      event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!step || this.ends.length === 0) return;
    event.preventDefault();
    const unit = Math.min(
      this.ends.length - 1,
      Math.max(0, (this.selected < 0 ? 0 : this.selected) + step),
    );
    this.unitPicked.emit({ unit, sample: this.unitStart(unit) });
  }

  private get totalSamples(): number {
    const manager = this.audio.current;
    return (
      manager?.resource?.info?.duration?.samples ??
      this.ends[this.ends.length - 1] ??
      0
    );
  }

  private unitStart(unit: number): number {
    return unit > 0 ? this.ends[unit - 1] : 0;
  }

  /** Redraws every animation frame while audio plays, for the position line. */
  private follow() {
    cancelAnimationFrame(this.frame);
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        this.draw();
        if (this.audio.current?.isPlaying) {
          this.frame = requestAnimationFrame(tick);
        }
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  private unitState(item: TrattAnnotationSegment): UnitState {
    const text = (item.getFirstLabelWithoutName('Speaker')?.value ?? '').trim();
    if (this.breakMarker && text === this.breakMarker) return 'info';
    if (text === '') return this.breakMarker ? 'info' : 'danger';
    return 'success';
  }

  private draw() {
    const el = this.canvas?.nativeElement;
    const ctx = el?.getContext('2d');
    const manager = this.audio.current;
    if (!el || !ctx || !manager) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(el.clientWidth * dpr));
    const height = Math.round(HEIGHT * dpr);
    if (el.width !== width || el.height !== height) {
      el.width = width;
      el.height = height;
    }
    const total = this.totalSamples;
    ctx.clearRect(0, 0, width, height);
    if (!total) return;

    const style = getComputedStyle(el);
    const css = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    const x = (sample: number) => (sample / total) * width;
    const strip = Math.round(STRIP * dpr);
    const waveHeight = height - strip;

    // selected unit
    if (this.selected >= 0 && this.selected < this.ends.length) {
      const from = x(this.unitStart(this.selected));
      ctx.fillStyle = 'rgba(40, 120, 220, 0.18)';
      ctx.fillRect(from, 0, x(this.ends[this.selected]) - from, height);
    }

    // waveform
    const channel = manager.channel;
    if (channel) {
      if (this.peaks?.width !== width) {
        this.peaks = {
          width,
          values: computePeaks(
            channel,
            manager.channelDataFactor ?? 1,
            0,
            total,
            width,
          ),
        };
      }
      const mid = waveHeight / 2;
      ctx.fillStyle = style.color;
      ctx.globalAlpha = 0.6;
      this.peaks.values.forEach((p, px) => {
        const top = mid - p.max * mid;
        ctx.fillRect(px, top, 1, Math.max(1, (p.max - p.min) * mid));
      });
      ctx.globalAlpha = 1;
    }

    // unit states and boundaries
    const colours: Record<UnitState, string> = {
      success: css('--tratt-success', '#5a9e2f'),
      info: css('--tratt-info', '#2a9db0'),
      danger: css('--tratt-danger', '#d62828'),
    };
    const items = this.segments;
    items.forEach((item, i) => {
      const from = x(this.unitStart(i));
      const to = x(this.ends[i]);
      ctx.fillStyle = colours[this.unitState(item)];
      ctx.fillRect(from, waveHeight, Math.max(1, to - from), strip);
      if (i < items.length - 1 && to - from >= 3 * dpr) {
        ctx.fillStyle = css('--tratt-border', '#ccc');
        ctx.fillRect(Math.round(to), 0, 1, waveHeight);
      }
    });

    // position line: playback while playing, else the resting cursor
    const position = manager.isPlaying
      ? manager.playPosition?.samples
      : this.cursor;
    if (position !== undefined) {
      ctx.fillStyle = '#d62828';
      ctx.fillRect(Math.round(x(position)) - dpr, 0, 2 * dpr, height);
    }
  }
}

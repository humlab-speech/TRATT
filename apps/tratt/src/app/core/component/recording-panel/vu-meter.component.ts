import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  observeTheme,
  resolveTrattColors,
  TRATT_COLORS,
} from '@tratt/ngx-components';

@Component({
  selector: 'tratt-vu-meter',
  standalone: true,
  imports: [TranslocoPipe],
  template: `<canvas
    #cv
    [width]="width"
    [height]="height"
    [attr.aria-label]="'recording.level meter' | transloco"
  ></canvas>`,
  styles: [':host { display: inline-block; line-height: 0; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VuMeterComponent implements AfterViewInit, OnDestroy {
  @ViewChild('cv', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  @Input() width = 160;
  @Input() height = 14;

  private _peakDb = -Infinity;
  private _rmsDb = -Infinity;
  private peakHoldDb = -Infinity;
  private peakHoldAt = 0;
  private raf = 0;
  private destroyed = false;

  @Input() set peakDb(v: number) {
    this._peakDb = v;
    if (v > this.peakHoldDb) {
      this.peakHoldDb = v;
      this.peakHoldAt = performance.now();
    }
  }

  @Input() set rmsDb(v: number) {
    this._rmsDb = v;
  }

  private colors = resolveTrattColors();
  private stopThemeWatch?: () => void;

  ngAfterViewInit(): void {
    this.stopThemeWatch = observeTheme(() => {
      this.colors = resolveTrattColors();
    });
    const loop = () => {
      if (this.destroyed) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopThemeWatch?.();
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  private dbToFrac(db: number): number {
    if (!isFinite(db)) return 0;
    const min = -60;
    const clamped = Math.max(min, Math.min(0, db));
    return (clamped - min) / -min;
  }

  private draw(): void {
    const c = this.canvas?.nativeElement;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = this.colors.surfaceBackground;
    ctx.fillRect(0, 0, w, h);

    const rms = this.dbToFrac(this._rmsDb);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, TRATT_COLORS.accentSuccess);
    grad.addColorStop(0.7, TRATT_COLORS.accentWarning);
    grad.addColorStop(1, TRATT_COLORS.accentError);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w * rms, h);

    const now = performance.now();
    if (now - this.peakHoldAt > 50) {
      this.peakHoldDb -= 0.04 * (now - this.peakHoldAt);
      this.peakHoldAt = now;
    }
    const peak = this.dbToFrac(this.peakHoldDb);
    if (peak > 0) {
      ctx.fillStyle = this.colors.textPrimary;
      ctx.fillRect(Math.min(w - 2, w * peak), 0, 2, h);
    }
  }
}

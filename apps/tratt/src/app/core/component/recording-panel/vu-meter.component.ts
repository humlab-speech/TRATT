import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'octra-vu-meter',
  standalone: true,
  template: `<canvas
    #cv
    [width]="width"
    [height]="height"
    [attr.aria-label]="'Recording level meter'"
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

  ngAfterViewInit(): void {
    const loop = () => {
      if (this.destroyed) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
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

    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, w, h);

    const rms = this.dbToFrac(this._rmsDb);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#22c55e');
    grad.addColorStop(0.7, '#eab308');
    grad.addColorStop(1, '#ef4444');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w * rms, h);

    const now = performance.now();
    if (now - this.peakHoldAt > 50) {
      this.peakHoldDb -= 0.04 * (now - this.peakHoldAt);
      this.peakHoldAt = now;
    }
    const peak = this.dbToFrac(this.peakHoldDb);
    if (peak > 0) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.min(w - 2, w * peak), 0, 2, h);
    }
  }
}

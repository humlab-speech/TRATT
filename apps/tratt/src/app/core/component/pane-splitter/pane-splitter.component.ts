import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  NgZone,
  OnInit,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Below half the minimum, a drag (or a step down) hides the pane. */
const SNAP_RATIO = 0.5;
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;
/** Longer than the CSS transition; covers a missed `transitionend`. */
const SETTLE_FALLBACK_MS = 400;

export type PaneSize = number | 'hidden' | 'default' | 'wide';

/**
 * The handle between a two-column grid's panes: drag it, click its arrows
 * or use the arrow keys to size the start pane.
 *
 * Deliberately thin: the size is one CSS custom property,
 * `--pane-splitter-size`, set on the `container`, which the container's own
 * styles use as its first column (and clamp, so the other pane keeps
 * `endMinSize`). Animating a change is the container's CSS transition on
 * `grid-template-columns`; this component never animates anything itself.
 * While dragging it sets `data-pane-resizing` on the container (transition
 * off, no text selection) and writes the property straight from the
 * pointer, outside Angular. `data-pane-hidden` marks a hidden start pane.
 *
 * The size is a share of the container's width: that is what the default
 * is, what is remembered, and what is kept when the container resizes.
 *
 * Editors redraw their canvases on window `resize`, so one is dispatched
 * once a change has settled: after the transition, or the drag.
 */
@Component({
  selector: 'tratt-pane-splitter',
  templateUrl: './pane-splitter.component.html',
  styleUrls: ['./pane-splitter.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
})
export class PaneSplitterComponent implements OnInit {
  /** The grid whose first column this sizes. */
  readonly container = input.required<HTMLElement>();
  /** The id of the start pane, for `aria-controls`. */
  readonly controls = input<string | undefined>(undefined);
  /** The start pane's default share of the container's width. */
  readonly defaultRatio = input(0.25);
  /** The narrowest the start pane gets without being hidden. */
  readonly minSize = input(260);
  /** What the other pane always keeps. */
  readonly endMinSize = input(384);
  /** Remembers the size per browser when set. */
  readonly storageKey = input<string | undefined>(undefined);

  /** The start pane's width in px; 0 is hidden. */
  readonly size = signal(0);
  protected readonly hidden = computed(() => this.size() === 0);
  protected readonly atMax = computed(() => this.size() >= this.wideSize() - 1);
  protected readonly maxSize = signal(0);

  private readonly zone = inject(NgZone);
  private readonly host = inject(ElementRef<HTMLElement>);
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private removeTransitionListener: (() => void) | undefined;
  private resizeObserver: ResizeObserver | undefined;
  /** The size as a share of the container's width; 0 is hidden. */
  private ratio = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.settleTimer);
      this.removeTransitionListener?.();
      this.resizeObserver?.disconnect();
    });
  }

  ngOnInit(): void {
    this.ratio = this.readStored() ?? this.defaultRatio();
    // Before the first paint: nothing has been drawn at another size yet.
    this.apply(this.toPx(this.ratio), false, false);
    this.followContainerWidth();
  }

  /** The default width in px. */
  protected defaultSize(): number {
    return Math.max(this.minSize(), this.toPx(this.defaultRatio()));
  }

  /**
   * Sizes the start pane; animated by the container's CSS unless
   * `animate` is false. Sizes are clamped to what the container allows.
   */
  setSize(size: PaneSize, animate = true): void {
    const px =
      size === 'hidden'
        ? 0
        : size === 'default'
          ? this.defaultSize()
          : size === 'wide'
            ? this.wideSize()
            : size;
    this.apply(px, animate);
    this.ratio = this.toRatio(this.size());
    this.store();
  }

  /** ‹: back to the default width, then hidden. */
  shrink(): void {
    const size = this.size();
    if (size === 0) {
      return;
    }
    this.setSize(size > this.defaultSize() + 1 ? 'default' : 'hidden');
  }

  /** ›: shown again at the default width, then wide. */
  grow(): void {
    const size = this.size();
    this.setSize(
      size === 0
        ? 'default'
        : size < this.defaultSize() - 1
          ? 'default'
          : 'wide',
    );
  }

  /**
   * A click on the hidden pane's edge shows it again. (A drag that ends on
   * the strip never gets here: its click is swallowed.)
   */
  onStripClick(): void {
    if (this.hidden()) {
      this.setSize('default');
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const size = this.size();
    switch (event.key) {
      case 'ArrowLeft':
        this.setSize(this.snap(size - step));
        break;
      case 'ArrowRight':
        this.setSize(size === 0 ? this.minSize() : size + step);
        break;
      case 'Home':
        this.setSize('hidden');
        break;
      case 'End':
        this.setSize('wide');
        break;
      case 'Enter':
        this.setSize(size === 0 ? 'default' : 'hidden');
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * Drags from anywhere on the handle, the arrows included: a press that
   * moves more than a few px is a drag, and the click it would end in is
   * swallowed; one that doesn't is an ordinary click.
   */
  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const container = this.container();
    const handle = event.currentTarget as HTMLElement;
    // On the document: the handle is a few px wide, and the pointer leaves
    // it before a drag is recognised (and captured).
    const doc = handle.ownerDocument;
    const startX = event.clientX;
    const startSize = this.size();
    let dragging = false;
    let frame = 0;
    let next = startSize;

    this.zone.runOutsideAngular(() => {
      const move = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        if (!dragging) {
          if (Math.abs(dx) < 4) {
            return;
          }
          dragging = true;
          handle.setPointerCapture?.(e.pointerId);
          container.toggleAttribute('data-pane-resizing', true);
        }
        next = this.snap(startSize + dx);
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            this.write(next);
          });
        }
      };
      const end = (e: PointerEvent) => {
        doc.removeEventListener('pointermove', move);
        doc.removeEventListener('pointerup', end);
        doc.removeEventListener('pointercancel', end);
        if (!dragging) {
          return;
        }
        cancelAnimationFrame(frame);
        if (handle.hasPointerCapture?.(e.pointerId)) {
          handle.releasePointerCapture(e.pointerId);
        }
        container.removeAttribute('data-pane-resizing');
        // The click that ends a drag is not a click on an arrow. It comes
        // in this same task, if at all; the timeout drops an unused guard.
        const swallow = (click: Event) => {
          click.stopPropagation();
          click.preventDefault();
        };
        handle.addEventListener('click', swallow, {
          capture: true,
          once: true,
        });
        setTimeout(() => handle.removeEventListener('click', swallow, true));
        this.zone.run(() => {
          this.apply(next, false);
          this.ratio = this.toRatio(this.size());
          this.store();
        });
      };
      doc.addEventListener('pointermove', move);
      doc.addEventListener('pointerup', end);
      doc.addEventListener('pointercancel', end);
    });
  }

  /** Half-way below the minimum hides the pane; above it, clamps. */
  private snap(px: number): number {
    if (px < this.minSize() * SNAP_RATIO) {
      return 0;
    }
    return Math.min(Math.max(px, this.minSize()), this.computeMax());
  }

  private toPx(ratio: number): number {
    if (ratio === 0) {
      return 0;
    }
    const width = this.container().clientWidth;
    // Unlaid-out (tests, hidden): the minimum, until the width is known.
    return width > 0 ? Math.round(ratio * width) : this.minSize();
  }

  private toRatio(px: number): number {
    const width = this.container().clientWidth;
    return width > 0 ? px / width : this.ratio;
  }

  /** A wider or narrower container keeps the pane's share of it. */
  private followContainerWidth(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const container = this.container();
    let width = container.clientWidth;
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        if (container.clientWidth === width) {
          return;
        }
        width = container.clientWidth;
        // Not remembered: the share is what the user chose.
        this.zone.run(() => this.apply(this.toPx(this.ratio), false, false));
      });
      this.resizeObserver.observe(container);
    });
  }

  private wideSize(): number {
    const width = this.container().clientWidth;
    return Math.max(
      this.defaultSize(),
      Math.min(Math.round(width / 2), this.computeMax()),
    );
  }

  private computeMax(): number {
    const width = this.container().clientWidth;
    // Unlaid-out (tests, hidden): don't clamp what can't be measured.
    return width > 0
      ? Math.max(this.minSize(), width - this.endMinSize())
      : Number.MAX_SAFE_INTEGER;
  }

  private apply(px: number, animate: boolean, notify = true): void {
    const container = this.container();
    const size =
      px === 0 ? 0 : Math.min(Math.max(px, this.minSize()), this.computeMax());
    if (!animate) {
      // Also skips the transition for a first, restored size.
      container.toggleAttribute('data-pane-resizing', true);
    }
    this.write(size);
    this.size.set(size);
    this.maxSize.set(this.computeMax());
    if (!animate) {
      // Reading layout commits the new size before the transition is back.
      void container.offsetWidth;
      container.removeAttribute('data-pane-resizing');
      if (notify) {
        this.settled();
      }
      return;
    }
    this.whenSettled();
  }

  /** Straight to the DOM: called per frame while dragging. */
  private write(px: number): void {
    const container = this.container();
    container.style.setProperty('--pane-splitter-size', `${px}px`);
    container.toggleAttribute('data-pane-hidden', px === 0);
    this.host.nativeElement
      .querySelector('[role="separator"]')
      ?.setAttribute('aria-valuenow', String(px));
  }

  private whenSettled(): void {
    clearTimeout(this.settleTimer);
    this.removeTransitionListener?.();
    const container = this.container();
    const done = () => {
      clearTimeout(this.settleTimer);
      this.removeTransitionListener?.();
      this.removeTransitionListener = undefined;
      this.settled();
    };
    const onEnd = (event: TransitionEvent) => {
      if (
        event.target === container &&
        event.propertyName === 'grid-template-columns'
      ) {
        done();
      }
    };
    this.zone.runOutsideAngular(() => {
      container.addEventListener('transitionend', onEnd);
      this.removeTransitionListener = () =>
        container.removeEventListener('transitionend', onEnd);
      // Reduced motion, or no change at all: no transitionend comes.
      this.settleTimer = setTimeout(done, SETTLE_FALLBACK_MS);
    });
  }

  private settled(): void {
    // Editors size their canvases on window resize.
    window.dispatchEvent(new Event('resize'));
  }

  private readStored(): number | undefined {
    const key = this.storageKey();
    if (!key) {
      return undefined;
    }
    try {
      const raw = globalThis.localStorage?.getItem(key);
      // Number(null) and Number('') are 0: a hidden pane on a first visit.
      const value = raw ? Number(raw) : NaN;
      if (!Number.isFinite(value) || value < 0) {
        return undefined;
      }
      // Above 1: a width in px, as stored before sizes were shares.
      return value <= 1 ? value : this.toRatio(value) || undefined;
    } catch {
      return undefined;
    }
  }

  private store(): void {
    const key = this.storageKey();
    if (!key) {
      return;
    }
    try {
      globalThis.localStorage?.setItem(
        key,
        String(Math.round(this.ratio * 10_000) / 10_000),
      );
    } catch {
      // Blocked storage: the size just won't survive a reload.
    }
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

const LIFETIME_MS = 8000;
const WIDTH = 190;
const HEIGHT = 32;
const OFFSET = 12;

/**
 * Discreet "merge N units" pill shown next to the pointer after the user marked
 * several adjacent units. Easy to ignore: it fades out by itself and goes away
 * on Esc or any click elsewhere.
 */
@Component({
  selector: 'tratt-merge-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    <button
      type="button"
      class="btn btn-sm btn-outline-secondary merge-pill"
      (mousedown)="$event.preventDefault()"
      (click)="merge.emit()"
    >
      <i class="fa-solid fa-compress me-1"></i>
      {{ 'g.merge units' | transloco: { count: count } }}
    </button>
  `,
  styles: `
    :host {
      position: fixed;
      z-index: 2000;
      opacity: 0.85;
      animation: merge-pop-fade 1s ease-in forwards;
      animation-delay: 7s;
    }
    .merge-pill {
      background: var(--bs-body-bg, #fff);
      font-size: 0.8rem;
      white-space: nowrap;
    }
    @keyframes merge-pop-fade {
      to {
        opacity: 0;
      }
    }
  `,
})
export class MergePopoverComponent implements OnInit, OnDestroy {
  /** pointer position (viewport px) */
  @Input() x = 0;
  @Input() y = 0;
  /** number of units that would be merged */
  @Input() count = 2;
  @Output() merge = new EventEmitter<void>();
  @Output() dismiss = new EventEmitter<void>();

  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  @HostBinding('style.left.px') get left(): number {
    return Math.max(
      4,
      Math.min(this.x + OFFSET, window.innerWidth - WIDTH - 4),
    );
  }

  @HostBinding('style.top.px') get top(): number {
    return Math.max(
      4,
      Math.min(this.y + OFFSET, window.innerHeight - HEIGHT - 4),
    );
  }

  ngOnInit() {
    this.timer = setTimeout(() => this.dismiss.emit(), LIFETIME_MS);
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.dismiss.emit();
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutsidePointerDown(event: Event) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.dismiss.emit();
    }
  }
}

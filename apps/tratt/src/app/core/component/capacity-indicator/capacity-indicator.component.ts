import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AlertService } from '../../shared/service/alert.service';
import { CapacityService } from '../../shared/service/capacity.service';

/**
 * Renders a byte count the way the capacity copy reads it: whole decimal
 * megabytes below a gigabyte, one decimal above. Decimal throughout, matching
 * every other size figure in this app (`KbWhisperModel.sizeMb`,
 * `OPUS_MT_BYTES_PER_PAIR`) and `navigator.storage.estimate()`'s own units.
 * The decimal separator follows `locale` (UI language; "en" when omitted),
 * so Swedish/German read "11,0 GB".
 */
export function formatBytes(bytes: number, locale = 'en'): string {
  const safe = Math.max(0, bytes);
  if (safe >= 1_000_000_000) {
    let gb: string;
    try {
      gb = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(safe / 1_000_000_000);
    } catch {
      gb = (safe / 1_000_000_000).toFixed(1);
    }
    return `${gb} GB`;
  }
  return `${Math.round(safe / 1_000_000)} MB`;
}

/** Fraction of the RAM budget at which the bar turns amber. */
const MEMORY_WARN_RATIO = 0.55;
/** Fraction of the RAM budget at which the bar turns red. */
const MEMORY_DANGER_RATIO = 0.8;
/** Fraction of the storage quota counted as "nearly full". */
const STORAGE_DANGER_RATIO = 0.8;

/**
 * Two bars in the `/workbench` left rail: browser storage, and estimated
 * working memory.
 *
 * The working-memory bar's colour IS step 3c's "warn, don't block": it turns
 * amber past 55% of `RAM_BUDGET_BYTES` and red past 80%, within one
 * `CAPACITY_POLL_MS` of a drop pushing residency there. Nothing here blocks,
 * gates, or intercepts anything — the multi-file ingest flow is untouched.
 *
 * Both figures are approximations and the copy says so. Storage cannot be
 * attributed per item in this app (no serialized byte length is ever
 * recorded), so the "annotations" figure is `usedBytes - modelsEstimateBytes`
 * and the models figure is clamped to `usedBytes` — a model configured but
 * not yet downloaded must never make the bar overflow.
 */
@Component({
  selector: 'tratt-capacity-indicator',
  templateUrl: './capacity-indicator.component.html',
  styleUrls: ['./capacity-indicator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
})
export class CapacityIndicatorComponent {
  private readonly capacity = inject(CapacityService);
  private readonly uiLang = toSignal(inject(TranslocoService).langChanges$, {
    initialValue: 'en',
  });

  private readonly storage = this.capacity.storage;
  private readonly memory = this.capacity.residentMemory;
  private readonly alertService = inject(AlertService);
  private readonly transloco = inject(TranslocoService);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Folded by default: the figures are for those who ask for them. */
  readonly expanded = signal(false);

  /**
   * The flashing note above the figures, pointing at them: up from crossing
   * a limit until dismissed, or until usage drops below it again.
   */
  readonly callout = signal(false);

  /** False when the browser exposes no storage estimate at all. */
  readonly storageAvailable = computed(() => this.storage().quotaBytes > 0);

  /** Models, never counted above what is really on disk. */
  private readonly modelsBytes = computed(() =>
    Math.min(this.storage().modelsEstimateBytes, this.storage().usedBytes),
  );

  private readonly annotationsBytes = computed(() =>
    Math.max(0, this.storage().usedBytes - this.modelsBytes()),
  );

  /**
   * False when nothing is configured yet (`modelsBytes() === 0`), i.e. the
   * models/annotations split is genuinely UNKNOWN rather than genuinely a
   * zero split. Bytes already sitting in browser storage (e.g. cached
   * Whisper models downloaded from `/local`, which this route knows nothing
   * about) would otherwise be attributed entirely to "annotations" — see F1
   * of the step 3c final review. Mirrors `storageAvailable()`'s shape: don't
   * assert a confident breakdown the data can't support.
   */
  readonly storageBreakdownKnown = computed(() => this.modelsBytes() > 0);

  readonly modelsPercent = computed(() =>
    this.percentOf(this.modelsBytes(), this.storage().quotaBytes),
  );

  readonly annotationsPercent = computed(() =>
    this.percentOf(this.annotationsBytes(), this.storage().quotaBytes),
  );

  readonly memoryPercent = computed(() =>
    this.percentOf(this.memory().estimatedBytes, this.memory().budgetBytes),
  );

  readonly memoryLevel = computed<'ok' | 'warn' | 'danger'>(() => {
    const budget = this.memory().budgetBytes;
    if (budget <= 0) {
      return 'ok';
    }
    const ratio = this.memory().estimatedBytes / budget;
    if (ratio > MEMORY_DANGER_RATIO) {
      return 'danger';
    }
    if (ratio > MEMORY_WARN_RATIO) {
      return 'warn';
    }
    return 'ok';
  });

  /**
   * The worst of the two: 'danger' when memory is in the red or storage is
   * nearly full, 'warn' while memory is amber.
   */
  readonly level = computed<'ok' | 'warn' | 'danger'>(() => {
    const { usedBytes, quotaBytes } = this.storage();
    const storageFull =
      quotaBytes > 0 && usedBytes / quotaBytes > STORAGE_DANGER_RATIO;
    return storageFull ? 'danger' : this.memoryLevel();
  });

  constructor() {
    // Reaching a limit unfolds the figures and points at them, once per
    // crossing. Out of sight (a hidden rail), a toast says where to look.
    let warned = false;
    effect(() => {
      const danger = this.level() === 'danger';
      if (danger && !warned) {
        untracked(() => {
          this.expanded.set(true);
          this.callout.set(true);
          afterNextRender(() => this.bringIntoView(), {
            injector: this.injector,
          });
        });
      } else if (!danger && warned) {
        untracked(() => this.callout.set(false));
      }
      warned = danger;
    });
  }

  dismissCallout(): void {
    this.callout.set(false);
  }

  private bringIntoView(): void {
    const el = this.host.nativeElement;
    if (!this.isRendered(el)) {
      void this.alertService.showAlert(
        'warning',
        this.transloco.translate('workbench.capacity.near_limit_toast'),
      );
      return;
    }
    const reduce = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    // Within the rail's own scroll: the page itself never jumps.
    el.scrollIntoView?.({
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }

  /** False in a hidden rail (or one not laid out at all). */
  protected isRendered(el: HTMLElement): boolean {
    return el.checkVisibility
      ? el.checkVisibility({ visibilityProperty: true })
      : el.getClientRects().length > 0;
  }

  readonly storageUsedText = computed(() =>
    formatBytes(this.storage().usedBytes, this.uiLang()),
  );
  readonly storageQuotaText = computed(() =>
    formatBytes(this.storage().quotaBytes, this.uiLang()),
  );
  readonly modelsText = computed(() =>
    formatBytes(this.modelsBytes(), this.uiLang()),
  );
  readonly annotationsText = computed(() =>
    formatBytes(this.annotationsBytes(), this.uiLang()),
  );
  readonly memoryUsedText = computed(() =>
    formatBytes(this.memory().estimatedBytes, this.uiLang()),
  );
  readonly memoryBudgetText = computed(() =>
    formatBytes(this.memory().budgetBytes, this.uiLang()),
  );
  readonly residentCount = computed(() => this.memory().residentCount);

  private percentOf(value: number, total: number): number {
    if (total <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, (value / total) * 100));
  }
}

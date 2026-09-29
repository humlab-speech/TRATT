import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CapacityService } from '../../shared/service/capacity.service';

/**
 * Renders a byte count the way the capacity copy reads it: whole decimal
 * megabytes below a gigabyte, one decimal above. Decimal throughout, matching
 * every other size figure in this app (`KbWhisperModel.sizeMb`,
 * `OPUS_MT_BYTES_PER_PAIR`) and `navigator.storage.estimate()`'s own units.
 */
export function formatBytes(bytes: number): string {
  const safe = Math.max(0, bytes);
  if (safe >= 1_000_000_000) {
    return `${(safe / 1_000_000_000).toFixed(1)} GB`;
  }
  return `${Math.round(safe / 1_000_000)} MB`;
}

/** Fraction of the RAM budget at which the bar turns amber. */
const MEMORY_WARN_RATIO = 0.55;
/** Fraction of the RAM budget at which the bar turns red. */
const MEMORY_DANGER_RATIO = 0.8;

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

  private readonly storage = this.capacity.storage;
  private readonly memory = this.capacity.residentMemory;

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

  readonly storageUsedText = computed(() =>
    formatBytes(this.storage().usedBytes),
  );
  readonly storageQuotaText = computed(() =>
    formatBytes(this.storage().quotaBytes),
  );
  readonly modelsText = computed(() => formatBytes(this.modelsBytes()));
  readonly annotationsText = computed(() =>
    formatBytes(this.annotationsBytes()),
  );
  readonly memoryUsedText = computed(() =>
    formatBytes(this.memory().estimatedBytes),
  );
  readonly memoryBudgetText = computed(() =>
    formatBytes(this.memory().budgetBytes),
  );
  readonly residentCount = computed(() => this.memory().residentCount);

  private percentOf(value: number, total: number): number {
    if (total <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, (value / total) * 100));
  }
}

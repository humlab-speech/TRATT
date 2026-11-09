import { Dictionary } from '@ngrx/entity';
import {
  BundleRunStatus,
  fileFraction,
  isPreparing,
  runStatusOf,
} from '../../store/pipeline-queue';

/** How far a run of the queue has come, for the run button. */
export interface RunProgress {
  /** The file being transcribed, counted from 1. */
  current: number;
  total: number;
  /** The whole run, 0–1. */
  fraction: number;
  /**
   * The current file is being prepared (decoded, or its model loaded):
   * work that `fraction` can't show yet.
   */
  preparing: boolean;
}

/**
 * @param batch every file seen in this run so far, finished ones included
 *   (the queue itself forgets a file once it has run)
 */
export function runProgress(
  batch: ReadonlySet<string>,
  queued: readonly string[],
  activeId: string | null,
  runs: Dictionary<BundleRunStatus>,
): RunProgress | null {
  const all = new Set([...batch, ...queued]);
  if (activeId) {
    all.add(activeId);
  }
  const total = all.size;
  if (total === 0) {
    return null;
  }
  const finished = total - queued.length - (activeId ? 1 : 0);
  const status = activeId ? runStatusOf(runs, activeId) : null;
  const active = status ? fileFraction(status) : 0;
  return {
    current: Math.min(finished + 1, total),
    total,
    fraction: Math.min(1, (finished + active) / total),
    preparing: status ? isPreparing(status) : false,
  };
}

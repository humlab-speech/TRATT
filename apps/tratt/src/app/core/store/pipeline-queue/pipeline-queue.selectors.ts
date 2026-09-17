import { Dictionary } from '@ngrx/entity';
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { BundleRunStatus, PipelineQueueState } from './index';

export const selectPipelineQueueFeature =
  createFeatureSelector<PipelineQueueState>('pipelineQueue');

export const selectQueueMode = createSelector(
  selectPipelineQueueFeature,
  (s) => s.mode,
);

export const selectActiveBundleId = createSelector(
  selectPipelineQueueFeature,
  (s) => s.activeId,
);

export const selectQueuedBundleIds = createSelector(
  selectPipelineQueueFeature,
  (s) => s.queue,
);

/**
 * The whole `runs` dictionary in one read. Consumers index it via
 * `runStatusOf(runs, bundleId)` (which applies the "absent ⇒ idle" default).
 *
 * Deliberately NOT a `selectBundleRunStatus(bundleId)` selector factory as
 * the spec sketched: every consumer needs all rows at once (the bundle list
 * renders a status per row; the ready-count filters across all bundles), and
 * a factory selector called inside an `@for` allocates a fresh memoized
 * selector per row per render.
 */
export const selectAllRunStatuses = createSelector(
  selectPipelineQueueFeature,
  (s): Dictionary<BundleRunStatus> => s.runs,
);

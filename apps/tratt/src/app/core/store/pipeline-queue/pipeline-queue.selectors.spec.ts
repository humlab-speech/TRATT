import { describe, expect, it } from '@jest/globals';
import {
  BundleRunStatus,
  computeReadyBundleIds,
  IDLE_RUN_STATUS,
  runStatusOf,
} from './index';
import {
  selectActiveBundleId,
  selectAllRunStatuses,
  selectQueueMode,
} from './pipeline-queue.selectors';

const runs: Record<string, BundleRunStatus> = {
  done: { state: 'done' },
  failed: { state: 'failed', error: { kind: 'oom', message: 'x' } },
  queued: { state: 'queued' },
  running: { state: 'running', stage: 'asr' },
  interrupted: { state: 'interrupted' },
};

describe('runStatusOf', () => {
  it('returns the shared idle status for an absent entry', () => {
    expect(runStatusOf({}, 'missing')).toBe(IDLE_RUN_STATUS);
    expect(runStatusOf({}, 'missing').state).toBe('idle');
  });

  it('returns the stored entry when present', () => {
    expect(runStatusOf(runs, 'done')).toEqual({ state: 'done' });
  });
});

describe('computeReadyBundleIds', () => {
  const summaries = [
    { bundleId: 'idle', awaitingMedia: false },
    { bundleId: 'done', awaitingMedia: false },
    { bundleId: 'failed', awaitingMedia: false },
    { bundleId: 'queued', awaitingMedia: false },
    { bundleId: 'running', awaitingMedia: false },
    { bundleId: 'interrupted', awaitingMedia: false },
  ];

  it('excludes queued, running and done bundles', () => {
    expect(computeReadyBundleIds(summaries, runs, () => true)).toEqual([
      'idle',
      'failed',
      'interrupted',
    ]);
  });

  it('excludes a bundle awaiting media with no resident manager', () => {
    const ready = computeReadyBundleIds(
      [{ bundleId: 'idle', awaitingMedia: true }],
      {},
      () => false,
    );
    expect(ready).toEqual([]);
  });

  it('includes a bundle whose store flag says awaiting media but whose audio is actually resident', () => {
    const ready = computeReadyBundleIds(
      [{ bundleId: 'idle', awaitingMedia: true }],
      {},
      (id) => id === 'idle',
    );
    expect(ready).toEqual(['idle']);
  });
});

describe('pipeline-queue.selectors', () => {
  const state = {
    pipelineQueue: {
      queue: ['b'],
      activeId: 'a',
      mode: 'running' as const,
      runs,
    },
  };

  it('projects mode, activeId and runs', () => {
    expect(selectQueueMode(state as any)).toBe('running');
    expect(selectActiveBundleId(state as any)).toBe('a');
    expect(selectAllRunStatuses(state as any)).toBe(runs);
  });
});

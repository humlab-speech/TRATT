import { describe, expect, it } from '@jest/globals';
import { PipelineQueueState } from './index';
import { PipelineQueueActions } from './pipeline-queue.actions';
import { initialState, reducer } from './pipeline-queue.reducer';

function seed(overrides: Partial<PipelineQueueState> = {}): PipelineQueueState {
  return { ...initialState, ...overrides };
}

describe('pipeline-queue.reducer', () => {
  it('returns the initial state for an unknown action', () => {
    expect(reducer(undefined, { type: '@@INIT' } as any)).toEqual(initialState);
  });

  describe('enqueued', () => {
    it('appends ids to the FIFO tail and marks each queued', () => {
      const state = reducer(
        initialState,
        PipelineQueueActions.enqueued({ bundleIds: ['a', 'b'] }),
      );
      expect(state.queue).toEqual(['a', 'b']);
      expect(state.runs['a']).toEqual({ state: 'queued' });
      expect(state.runs['b']).toEqual({ state: 'queued' });
      expect(state.activeId).toBeNull();
      expect(state.mode).toBe('idle');
    });

    it('appends to an existing queue rather than replacing it', () => {
      const first = reducer(
        initialState,
        PipelineQueueActions.enqueued({ bundleIds: ['a'] }),
      );
      const second = reducer(
        first,
        PipelineQueueActions.enqueued({ bundleIds: ['b'] }),
      );
      expect(second.queue).toEqual(['a', 'b']);
    });

    it('skips ids already queued or already active', () => {
      const state = reducer(
        seed({ queue: ['a'], activeId: 'z', mode: 'running' }),
        PipelineQueueActions.enqueued({ bundleIds: ['a', 'z', 'b'] }),
      );
      expect(state.queue).toEqual(['a', 'b']);
    });

    it('clears a previous error when a failed bundle is re-enqueued', () => {
      const failed = seed({
        runs: {
          a: { state: 'failed', error: { kind: 'oom', message: 'boom' } },
        },
      });
      const state = reducer(
        failed,
        PipelineQueueActions.enqueued({ bundleIds: ['a'] }),
      );
      expect(state.runs['a']).toEqual({ state: 'queued' });
    });
  });

  describe('activateNext', () => {
    it('pops the head into activeId and marks it running at the decode stage', () => {
      const state = reducer(
        seed({ queue: ['a', 'b'], runs: { a: { state: 'queued' } } }),
        PipelineQueueActions.activateNext(),
      );
      expect(state.activeId).toBe('a');
      expect(state.queue).toEqual(['b']);
      expect(state.mode).toBe('running');
      expect(state.runs['a']).toEqual({ state: 'running', stage: 'decode' });
    });

    it('goes idle when the queue is empty', () => {
      const state = reducer(
        seed({ queue: [], activeId: 'a', mode: 'running' }),
        PipelineQueueActions.activateNext(),
      );
      expect(state.activeId).toBeNull();
      expect(state.mode).toBe('idle');
    });
  });

  describe('progress', () => {
    it('updates stage and progress on the active bundle only', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          runs: {
            a: { state: 'running', stage: 'decode' },
            b: { state: 'queued' },
          },
        }),
        PipelineQueueActions.progress({ stage: 'asr', progress: 0.25 }),
      );
      expect(state.runs['a']).toEqual({
        state: 'running',
        stage: 'asr',
        progress: 0.25,
      });
      expect(state.runs['b']).toEqual({ state: 'queued' });
    });

    it('keeps the previous progress value when the tick carries none', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          runs: { a: { state: 'running', stage: 'asr', progress: 0.4 } },
        }),
        PipelineQueueActions.progress({ stage: 'diarization' }),
      );
      expect(state.runs['a']).toEqual({
        state: 'running',
        stage: 'diarization',
        progress: 0.4,
      });
    });

    it('is a no-op when nothing is active', () => {
      const before = seed({ runs: { a: { state: 'queued' } } });
      const state = reducer(
        before,
        PipelineQueueActions.progress({ stage: 'asr', progress: 0.5 }),
      );
      expect(state).toBe(before);
    });
  });

  describe('bundleDone', () => {
    it('marks the bundle done and clears activeId', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          queue: ['b'],
          runs: { a: { state: 'running', stage: 'asr', progress: 0.9 } },
        }),
        PipelineQueueActions.bundleDone({ bundleId: 'a' }),
      );
      expect(state.runs['a']).toEqual({ state: 'done' });
      expect(state.activeId).toBeNull();
      expect(state.queue).toEqual(['b']);
      expect(state.mode).toBe('running');
    });

    it('leaves activeId untouched when the completing bundle is not the active one', () => {
      // Same guard as bundleFailed's — a late bundleDone for a bundle the
      // queue has already moved past must not clobber the real activeId.
      const state = reducer(
        seed({
          activeId: 'b',
          mode: 'running',
          runs: { a: { state: 'running' }, b: { state: 'running' } },
        }),
        PipelineQueueActions.bundleDone({ bundleId: 'a' }),
      );
      expect(state.activeId).toBe('b');
      expect(state.runs['a']).toEqual({ state: 'done' });
      expect(state.runs['b']).toEqual({ state: 'running' });
    });
  });

  describe('bundleFailed', () => {
    it('records the error, clears activeId and leaves the rest of the queue intact', () => {
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'running',
          queue: ['b'],
          runs: {
            a: { state: 'running', stage: 'asr' },
            b: { state: 'queued' },
          },
        }),
        PipelineQueueActions.bundleFailed({
          bundleId: 'a',
          error: { kind: 'oom', message: 'GPU out of memory' },
        }),
      );
      expect(state.runs['a']).toEqual({
        state: 'failed',
        error: { kind: 'oom', message: 'GPU out of memory' },
      });
      expect(state.activeId).toBeNull();
      expect(state.queue).toEqual(['b']);
      expect(state.runs['b']).toEqual({ state: 'queued' });
    });

    it('leaves activeId untouched when the completing bundle is not the active one', () => {
      // Guards against a late/out-of-order bundleFailed for a bundle the
      // queue has already moved past clobbering the real in-flight id.
      const state = reducer(
        seed({
          activeId: 'b',
          mode: 'running',
          runs: { a: { state: 'running' }, b: { state: 'running' } },
        }),
        PipelineQueueActions.bundleFailed({
          bundleId: 'a',
          error: { kind: 'unknown', message: 'stale failure' },
        }),
      );
      expect(state.activeId).toBe('b');
      expect(state.runs['a']).toEqual({
        state: 'failed',
        error: { kind: 'unknown', message: 'stale failure' },
      });
      expect(state.runs['b']).toEqual({ state: 'running' });
    });
  });

  describe('pause', () => {
    it('parks in pausing while a bundle is still running', () => {
      const state = reducer(
        seed({ activeId: 'a', mode: 'running', queue: ['b'] }),
        PipelineQueueActions.pause(),
      );
      expect(state.mode).toBe('pausing');
      expect(state.activeId).toBe('a');
      expect(state.queue).toEqual(['b']);
    });

    it('stops immediately when nothing is active', () => {
      const state = reducer(
        seed({
          activeId: null,
          mode: 'running',
          queue: ['b'],
          runs: { b: { state: 'queued' } },
        }),
        PipelineQueueActions.pause(),
      );
      expect(state.mode).toBe('idle');
      expect(state.queue).toEqual([]);
      expect(state.runs['b']).toEqual({ state: 'idle' });
    });
  });

  describe('stopped', () => {
    it('drops pending ids and resets them to idle, not queued', () => {
      const state = reducer(
        seed({
          activeId: null,
          mode: 'pausing',
          queue: ['b', 'c'],
          runs: {
            a: { state: 'done' },
            b: { state: 'queued' },
            c: { state: 'queued' },
          },
        }),
        PipelineQueueActions.stopped(),
      );
      expect(state.queue).toEqual([]);
      expect(state.mode).toBe('idle');
      expect(state.activeId).toBeNull();
      expect(state.runs['a']).toEqual({ state: 'done' });
      expect(state.runs['b']).toEqual({ state: 'idle' });
      expect(state.runs['c']).toEqual({ state: 'idle' });
    });

    it('also resets a still-active bundle to idle, never leaving it stuck running', () => {
      // Off the intended call sequence (bundleDone/bundleFailed normally
      // clears activeId before stopped() is dispatched), but stopNow()
      // guards it anyway so a UI reading runStatusOf() can never see a
      // permanently-spinning row with nothing left to advance it.
      const state = reducer(
        seed({
          activeId: 'a',
          mode: 'pausing',
          queue: ['b'],
          runs: {
            a: { state: 'running', stage: 'asr', progress: 0.5 },
            b: { state: 'queued' },
          },
        }),
        PipelineQueueActions.stopped(),
      );
      expect(state.activeId).toBeNull();
      expect(state.runs['a']).toEqual({ state: 'idle' });
      expect(state.runs['b']).toEqual({ state: 'idle' });
    });
  });

  describe('restoreInterrupted', () => {
    it('rehydrates queued and running as interrupted, never as running', () => {
      const state = reducer(
        initialState,
        PipelineQueueActions.restoreInterrupted({
          entries: [
            { bundleId: 'a', state: 'queued' },
            { bundleId: 'b', state: 'running' },
            { bundleId: 'c', state: 'done' },
            { bundleId: 'd', state: 'failed' },
            { bundleId: 'e', state: 'idle' },
          ],
        }),
      );
      expect(state.runs['a']).toEqual({ state: 'interrupted' });
      expect(state.runs['b']).toEqual({ state: 'interrupted' });
      expect(state.runs['c']).toEqual({ state: 'done' });
      expect(state.runs['d']).toEqual({ state: 'failed' });
      expect(state.runs['e']).toBeUndefined();
      expect(state.queue).toEqual([]);
      expect(state.activeId).toBeNull();
      expect(state.mode).toBe('idle');
    });
  });
});

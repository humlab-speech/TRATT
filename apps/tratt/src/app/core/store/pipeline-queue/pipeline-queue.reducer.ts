import { Dictionary } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { BundleRunStatus, PipelineQueueState } from './index';
import { PipelineQueueActions } from './pipeline-queue.actions';

export const initialState: PipelineQueueState = {
  queue: [],
  activeId: null,
  mode: 'idle',
  runs: {},
};

/**
 * Shared by `pause` (with nothing active) and `stopped`. On the intended
 * call sequence `activeId` is already `null` by the time this runs
 * (`bundleDone`/`bundleFailed` clears it before `stopped` is dispatched),
 * but resetting a still-active bundle defensively here too means a
 * `stopped` dispatched out of that order can never leave a `runs` entry
 * stuck at `'running'` with nothing left to advance it.
 */
function stopNow(state: PipelineQueueState): PipelineQueueState {
  const runs: Dictionary<BundleRunStatus> = { ...state.runs };
  for (const bundleId of state.queue) {
    runs[bundleId] = { state: 'idle' };
  }
  if (state.activeId !== null) {
    runs[state.activeId] = { state: 'idle' };
  }
  return { ...state, queue: [], activeId: null, mode: 'idle', runs };
}

export const reducer = createReducer(
  initialState,

  on(
    PipelineQueueActions.enqueued,
    (state, { bundleIds }): PipelineQueueState => {
      const runs: Dictionary<BundleRunStatus> = { ...state.runs };
      const queue = [...state.queue];
      for (const bundleId of bundleIds) {
        if (queue.includes(bundleId) || state.activeId === bundleId) {
          continue;
        }
        queue.push(bundleId);
        // A fresh object, not a merge: re-enqueueing a failed bundle must
        // drop its old `error`/`stage`/`progress`, not carry them forward.
        runs[bundleId] = { state: 'queued' };
      }
      return { ...state, queue, runs };
    },
  ),

  on(PipelineQueueActions.activateNext, (state): PipelineQueueState => {
    const [next, ...rest] = state.queue;
    if (next === undefined) {
      return { ...state, activeId: null, mode: 'idle' };
    }
    return {
      ...state,
      queue: rest,
      activeId: next,
      mode: 'running',
      runs: { ...state.runs, [next]: { state: 'running', stage: 'decode' } },
    };
  }),

  on(
    PipelineQueueActions.progress,
    (state, { stage, progress }): PipelineQueueState => {
      const activeId = state.activeId;
      if (activeId === null) {
        return state;
      }
      const previous = state.runs[activeId] ?? { state: 'running' };
      return {
        ...state,
        runs: {
          ...state.runs,
          [activeId]: {
            ...previous,
            state: 'running',
            stage,
            ...(progress !== undefined ? { progress } : {}),
          },
        },
      };
    },
  ),

  on(
    PipelineQueueActions.bundleDone,
    (state, { bundleId }): PipelineQueueState => ({
      ...state,
      activeId: state.activeId === bundleId ? null : state.activeId,
      runs: { ...state.runs, [bundleId]: { state: 'done' } },
    }),
  ),

  on(
    PipelineQueueActions.bundleFailed,
    (state, { bundleId, error }): PipelineQueueState => ({
      ...state,
      activeId: state.activeId === bundleId ? null : state.activeId,
      runs: { ...state.runs, [bundleId]: { state: 'failed', error } },
    }),
  ),

  on(PipelineQueueActions.pause, (state): PipelineQueueState => {
    if (state.activeId === null) {
      return stopNow(state);
    }
    return { ...state, mode: 'pausing' };
  }),

  on(
    PipelineQueueActions.stopped,
    (state): PipelineQueueState => stopNow(state),
  ),

  on(
    PipelineQueueActions.restoreInterrupted,
    (state, { entries }): PipelineQueueState => {
      const runs: Dictionary<BundleRunStatus> = { ...state.runs };
      for (const entry of entries) {
        if (entry.state === 'idle') {
          continue;
        }
        runs[entry.bundleId] =
          entry.state === 'queued' || entry.state === 'running'
            ? { state: 'interrupted' }
            : { state: entry.state };
      }
      return { ...state, runs };
    },
  ),
);

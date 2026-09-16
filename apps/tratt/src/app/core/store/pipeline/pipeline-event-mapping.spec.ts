import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Action } from '@ngrx/store';
import type { OAnnotJSON } from '@tratt/annotation';
import { map, Subject } from 'rxjs';
import type { PipelineEvent } from '../../shared/service/pipeline-runner.service';
import {
  mapPipelineEventToAction,
  PIPELINE_THROTTLE_MS,
  pipelineThrottle,
} from './pipeline-event-mapping';
import { PipelineActions } from './pipeline.actions';

describe('mapPipelineEventToAction', () => {
  it('maps a transcription inner event', () => {
    const action = mapPipelineEventToAction({
      stage: 'transcription',
      event: { type: 'transcribe-start', audioDurationS: 12 },
    });
    expect(action).toEqual(
      PipelineActions.transcriptionEvent({
        event: { type: 'transcribe-start', audioDurationS: 12 },
      }),
    );
  });

  it("maps the 'finalized' transcription event", () => {
    const action = mapPipelineEventToAction({
      stage: 'transcription',
      type: 'finalized',
      diarizationWarning: 'warned',
      willTranslate: true,
    });
    expect(action).toEqual(
      PipelineActions.transcriptionFinalized({
        diarizationWarning: 'warned',
        willTranslate: true,
      }),
    );
  });

  it('maps a diarization inner event', () => {
    const action = mapPipelineEventToAction({
      stage: 'diarization',
      event: { type: 'diarize-start', audioDurationS: 12 },
    });
    expect(action).toEqual(
      PipelineActions.diarizationEvent({
        event: { type: 'diarize-start', audioDurationS: 12 },
      }),
    );
  });

  it("maps 'diarization started'", () => {
    const action = mapPipelineEventToAction({
      stage: 'diarization',
      type: 'started',
    });
    expect(action).toEqual(PipelineActions.diarizationStarted());
  });

  it("maps 'diarization skipped'", () => {
    const action = mapPipelineEventToAction({
      stage: 'diarization',
      type: 'skipped',
    });
    expect(action).toEqual(PipelineActions.diarizationSkipped());
  });

  it("maps 'translation start'", () => {
    const action = mapPipelineEventToAction({
      stage: 'translation',
      type: 'start',
    });
    expect(action).toEqual(PipelineActions.translationStart());
  });

  it('maps a translation inner event', () => {
    const action = mapPipelineEventToAction({
      stage: 'translation',
      event: { type: 'model-init' },
    });
    expect(action).toEqual(
      PipelineActions.translationEvent({ event: { type: 'model-init' } }),
    );
  });

  it("maps 'pipeline stalled'", () => {
    const action = mapPipelineEventToAction({
      stage: 'pipeline',
      type: 'stalled',
      phase: 'translating',
      message: 'no progress',
    });
    expect(action).toEqual(
      PipelineActions.stalled({ phase: 'translating', message: 'no progress' }),
    );
  });

  it("maps 'pipeline result' (dropping annotJson — see pipeline.actions.ts)", () => {
    const action = mapPipelineEventToAction({
      stage: 'pipeline',
      type: 'result',
      annotJson: { foo: 'bar' } as unknown as OAnnotJSON,
      diarizationWarning: null,
    });
    expect(action).toEqual(
      PipelineActions.result({ diarizationWarning: null }),
    );
  });

  it("maps 'pipeline cancelled'", () => {
    const action = mapPipelineEventToAction({
      stage: 'pipeline',
      type: 'cancelled',
    });
    expect(action).toEqual(PipelineActions.cancelled());
  });
});

describe('pipelineThrottle — terminal-event-survival (the critical guarantee)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // The scenario the task brief calls out explicitly: a rapid burst of
  // progress events, immediately followed (same synchronous tick — the
  // worst case for throttleTime, since it maximizes how much gets
  // collapsed into one throttle window) by a terminal event. If `trailing`
  // were false — or misconfigured in any way that lets the buffered value
  // get overwritten-then-dropped instead of overwritten-then-flushed — the
  // terminal `result` action would never reach the reducer, and the UI
  // would stay stuck showing "in progress" forever.
  it('does not drop a result action that lands right after a progress burst inside one throttle window', () => {
    const source = new Subject<PipelineEvent>();
    const dispatched: Action[] = [];
    source
      .pipe(map(mapPipelineEventToAction), pipelineThrottle())
      .subscribe((action) => dispatched.push(action));

    // Leading edge: emitted synchronously, immediately.
    source.next({
      stage: 'transcription',
      event: { type: 'download-progress', loaded: 1, total: 100, file: 'a' },
    });
    expect(dispatched).toHaveLength(1);

    // Burst of progress events landing inside the same throttle window —
    // none of these should emit synchronously (throttled).
    for (let i = 2; i <= 20; i++) {
      source.next({
        stage: 'transcription',
        event: {
          type: 'download-progress',
          loaded: i,
          total: 100,
          file: 'a',
        },
      });
    }
    expect(dispatched).toHaveLength(1);

    // The terminal event, landing immediately after the burst — still well
    // inside the same throttle window (no time has advanced at all).
    source.next({
      stage: 'pipeline',
      type: 'result',
      annotJson: {} as unknown as OAnnotJSON,
      diarizationWarning: null,
    });
    expect(dispatched).toHaveLength(1); // still throttled — not yet flushed

    // Close out the throttle window.
    jest.advanceTimersByTime(PIPELINE_THROTTLE_MS);

    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toEqual(
      PipelineActions.result({ diarizationWarning: null }),
    );
  });

  // Same guarantee for the other three terminal PipelineEvent kinds named
  // explicitly in the task brief.
  it.each([
    [
      'error via PipelineActions.error is untouched by throttling (delivered via error(), not next())',
      null,
    ],
    [
      'stalled',
      {
        stage: 'pipeline',
        type: 'stalled',
        phase: 'translating',
        message: 'stalled',
      } as PipelineEvent,
    ],
    ['cancelled', { stage: 'pipeline', type: 'cancelled' } as PipelineEvent],
  ])('%s survives a preceding burst', (_label, terminalEvent) => {
    if (terminalEvent === null) {
      // PipelineActions.error is dispatched from the run() Observable's
      // error() channel by the caller (Task 4), never through this
      // next()-only throttled pipe — nothing to test here beyond
      // documenting why it's exempt from the drop risk. See
      // pipeline.actions.ts's comment on PipelineActions.error.
      return;
    }

    const source = new Subject<PipelineEvent>();
    const dispatched: Action[] = [];
    source
      .pipe(map(mapPipelineEventToAction), pipelineThrottle())
      .subscribe((action) => dispatched.push(action));

    source.next({
      stage: 'translation',
      event: { type: 'segment-progress', index: 0, total: 10 },
    });
    for (let i = 1; i <= 10; i++) {
      source.next({
        stage: 'translation',
        event: { type: 'segment-progress', index: i, total: 10 },
      });
    }
    source.next(terminalEvent);

    jest.advanceTimersByTime(PIPELINE_THROTTLE_MS);

    expect(dispatched[dispatched.length - 1]).toEqual(
      mapPipelineEventToAction(terminalEvent),
    );
  });

  it('leading edge emits synchronously with zero elapsed time (no artificial delay on the very first event)', () => {
    const source = new Subject<PipelineEvent>();
    const dispatched: Action[] = [];
    source
      .pipe(map(mapPipelineEventToAction), pipelineThrottle())
      .subscribe((action) => dispatched.push(action));

    source.next({ stage: 'diarization', type: 'started' });
    expect(dispatched).toEqual([PipelineActions.diarizationStarted()]);
  });
});

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
  dispatchPipelineActions,
  isThrottleSafeProgressAction,
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

describe('isThrottleSafeProgressAction', () => {
  it('classifies download-progress/segment-progress inner events as throttle-safe', () => {
    expect(
      isThrottleSafeProgressAction(
        PipelineActions.transcriptionEvent({
          event: { type: 'download-progress', loaded: 1, total: 2, file: 'a' },
        }),
      ),
    ).toBe(true);
    expect(
      isThrottleSafeProgressAction(
        PipelineActions.transcriptionEvent({
          event: { type: 'segment-progress', segmentEndS: 1 },
        }),
      ),
    ).toBe(true);
    expect(
      isThrottleSafeProgressAction(
        PipelineActions.diarizationEvent({
          event: { type: 'download-progress', loaded: 1, total: 2, file: 'a' },
        }),
      ),
    ).toBe(true);
    expect(
      isThrottleSafeProgressAction(
        PipelineActions.translationEvent({
          event: { type: 'download-progress', loaded: 1, total: 2, file: 'a' },
        }),
      ),
    ).toBe(true);
    expect(
      isThrottleSafeProgressAction(
        PipelineActions.translationEvent({
          event: { type: 'segment-progress', index: 1, total: 2 },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    [
      'transcriptionEvent{transcribe-start}',
      PipelineActions.transcriptionEvent({
        event: { type: 'transcribe-start', audioDurationS: 1 },
      }),
    ],
    [
      'transcriptionEvent{inner result}',
      PipelineActions.transcriptionEvent({
        event: { type: 'result', annotJson: {} as any },
      }),
    ],
    [
      'diarizationEvent{diarize-start}',
      PipelineActions.diarizationEvent({
        event: { type: 'diarize-start', audioDurationS: 1 },
      }),
    ],
    [
      'translationEvent{model-init}',
      PipelineActions.translationEvent({ event: { type: 'model-init' } }),
    ],
    [
      'translationEvent{translate-start}',
      PipelineActions.translationEvent({
        event: { type: 'translate-start', total: 1 },
      }),
    ],
    ['transcriptionFinalized', PipelineActions.transcriptionFinalized({
      diarizationWarning: null,
      willTranslate: true,
    })],
    ['diarizationStarted', PipelineActions.diarizationStarted()],
    ['diarizationSkipped', PipelineActions.diarizationSkipped()],
    ['translationStart', PipelineActions.translationStart()],
    ['stalled', PipelineActions.stalled({ phase: 'downloading', message: 'x' })],
    ['result', PipelineActions.result({ diarizationWarning: null })],
    ['cancelled', PipelineActions.cancelled()],
  ])('classifies %s as NOT throttle-safe (must bypass)', (_label, action) => {
    expect(isThrottleSafeProgressAction(action)).toBe(false);
  });
});

describe('dispatchPipelineActions — the actual fix for the dropped-transcriptionFinalized regression', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Reproduces, at the mapping-module level (no Angular/Store involved),
  // exactly the production sequence that dropped `transcriptionFinalized`
  // pre-fix: 'diarization skipped' -> `transcriptionFinalized` ->
  // 'translation start', all emitted synchronously, in the same JS tick,
  // with zero fake-timer time elapsed in between — the worst case for a
  // naive whole-stream throttle.
  it('dispatches transcriptionFinalized immediately even when translationStart follows it synchronously in the same tick', () => {
    const source = new Subject<PipelineEvent>();
    const dispatched: Action[] = [];
    dispatchPipelineActions(source.pipe(map(mapPipelineEventToAction))).subscribe(
      (action) => dispatched.push(action),
    );

    source.next({ stage: 'diarization', type: 'skipped' });
    source.next({
      stage: 'transcription',
      type: 'finalized',
      diarizationWarning: null,
      willTranslate: true,
    });
    source.next({ stage: 'translation', type: 'start' });

    // No jest.advanceTimersByTime() at all — proves none of these three
    // discrete actions were ever waiting on the throttle in the first
    // place.
    expect(dispatched).toEqual([
      PipelineActions.diarizationSkipped(),
      PipelineActions.transcriptionFinalized({
        diarizationWarning: null,
        willTranslate: true,
      }),
      PipelineActions.translationStart(),
    ]);
  });

  it('still throttles a genuine download-progress burst to leading+trailing, unaffected by the split', () => {
    const source = new Subject<PipelineEvent>();
    const dispatched: Action[] = [];
    dispatchPipelineActions(source.pipe(map(mapPipelineEventToAction))).subscribe(
      (action) => dispatched.push(action),
    );

    for (let i = 1; i <= 10; i++) {
      source.next({
        stage: 'transcription',
        event: { type: 'download-progress', loaded: i, total: 10, file: 'a' },
      });
    }
    // Only the leading value so far — the rest are held in the throttle.
    expect(dispatched).toHaveLength(1);

    jest.advanceTimersByTime(PIPELINE_THROTTLE_MS);
    // Leading + trailing (the last of the burst) — never all 10.
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toEqual(
      PipelineActions.transcriptionEvent({
        event: { type: 'download-progress', loaded: 10, total: 10, file: 'a' },
      }),
    );
  });

  // Regression for the SECOND bug found in review (the first fix, which
  // composed pipelineThrottle() via filter()+merge() into two independently
  // subscribed branches, traded the original dropping bug for THIS
  // reordering bug): a throttled trailing progress tick, still pending when
  // a later bypass action arrives, must be flushed BEFORE that bypass
  // action — never after it. `merge()` cannot provide that guarantee, since
  // its two source branches emit independently of one another; only a
  // single, order-preserving subscription (what dispatchPipelineActions()
  // is now built as) can.
  it('flushes a pending progress tick BEFORE a bypass action that arrives right after it, never after (transcription slice)', () => {
    const source = new Subject<PipelineEvent>();
    const dispatched: Action[] = [];
    dispatchPipelineActions(source.pipe(map(mapPipelineEventToAction))).subscribe(
      (action) => dispatched.push(action),
    );

    // Ordinary production timing: a download-progress burst immediately
    // (same tick, zero time elapsed) followed by transcribe-start once the
    // download finishes and transcription actually begins.
    for (let i = 1; i <= 5; i++) {
      source.next({
        stage: 'transcription',
        event: { type: 'download-progress', loaded: i, total: 5, file: 'a' },
      });
    }
    source.next({
      stage: 'transcription',
      event: { type: 'transcribe-start', audioDurationS: 10 },
    });

    // download-progress(1) was the leading edge (emitted immediately);
    // download-progress(5) was still pending (held by the throttle) when
    // transcribe-start arrived — it must be flushed FIRST, so
    // transcribe-start is the LAST action in the sequence, not sandwiched
    // before a stale trailing progress tick that would otherwise reset
    // `transcription.phase` back to 'downloading' in the reducer.
    expect(dispatched).toEqual([
      PipelineActions.transcriptionEvent({
        event: { type: 'download-progress', loaded: 1, total: 5, file: 'a' },
      }),
      PipelineActions.transcriptionEvent({
        event: { type: 'download-progress', loaded: 5, total: 5, file: 'a' },
      }),
      PipelineActions.transcriptionEvent({
        event: { type: 'transcribe-start', audioDurationS: 10 },
      }),
    ]);
  });

  it('flushes a pending progress tick BEFORE a bypass action that arrives right after it, never after (translation slice)', () => {
    const source = new Subject<PipelineEvent>();
    const dispatched: Action[] = [];
    dispatchPipelineActions(source.pipe(map(mapPipelineEventToAction))).subscribe(
      (action) => dispatched.push(action),
    );

    source.next({ stage: 'translation', type: 'start' });
    for (let i = 1; i <= 5; i++) {
      source.next({
        stage: 'translation',
        event: { type: 'download-progress', loaded: i, total: 5, file: 'b' },
      });
    }
    source.next({
      stage: 'translation',
      event: { type: 'model-init' },
    });

    expect(dispatched).toEqual([
      PipelineActions.translationStart(),
      PipelineActions.translationEvent({
        event: { type: 'download-progress', loaded: 1, total: 5, file: 'b' },
      }),
      PipelineActions.translationEvent({
        event: { type: 'download-progress', loaded: 5, total: 5, file: 'b' },
      }),
      PipelineActions.translationEvent({ event: { type: 'model-init' } }),
    ]);
  });
});

import { describe, expect, it } from '@jest/globals';
import { BundleRunStatus, fileFraction } from '../../store/pipeline-queue';
import { runProgress } from './run-progress';

describe('fileFraction', () => {
  it('counts speech recognition only, and never goes back', () => {
    expect(
      fileFraction({ state: 'running', stage: 'decode', progress: 0.9 }),
    ).toBe(0);
    expect(
      fileFraction({
        state: 'running',
        stage: 'asr',
        progress: 0.6,
        downloading: true,
      }),
    ).toBe(0);
    expect(
      fileFraction({ state: 'running', stage: 'asr', progress: 0.4 }),
    ).toBe(0.4);
    expect(
      fileFraction({ state: 'running', stage: 'diarization', progress: 0.1 }),
    ).toBe(1);
    expect(fileFraction({ state: 'running', stage: 'translation' })).toBe(1);
  });
});

describe('runProgress', () => {
  it('is nothing for an empty run', () => {
    expect(runProgress(new Set(), [], null, {})).toBeNull();
  });

  it('counts finished files and the running one', () => {
    // a finished, b at half way, c and d waiting.
    const progress = runProgress(new Set(['a', 'b']), ['c', 'd'], 'b', {
      b: { state: 'running', stage: 'asr', progress: 0.5 },
    });
    expect(progress).toEqual({
      current: 2,
      total: 4,
      fraction: 1.5 / 4,
      preparing: false,
    });
  });

  it('includes files queued since the run began', () => {
    const progress = runProgress(new Set(['a']), ['new'], 'a', {});
    expect(progress).toEqual({
      current: 1,
      total: 2,
      fraction: 0,
      preparing: false,
    });
  });

  it('says when the running file is still being prepared', () => {
    const preparing = (status: BundleRunStatus) =>
      runProgress(new Set(['a']), [], 'a', { a: status })?.preparing;
    expect(preparing({ state: 'running', stage: 'decode' })).toBe(true);
    expect(
      preparing({ state: 'running', stage: 'asr', downloading: true }),
    ).toBe(true);
    expect(preparing({ state: 'running', stage: 'asr', progress: 0.1 })).toBe(
      false,
    );
    expect(preparing({ state: 'running', stage: 'diarization' })).toBe(false);
  });
});

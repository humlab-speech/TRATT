import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AudioSelection, PlayBackStatus, SampleUnit } from '@tratt/media';
import { AudioChunk, AudioManager } from '@tratt/web-media';
import { Subject } from 'rxjs';

describe('AudioChunk', () => {
  const sampleRate = 16000;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createAudioManagerMock() {
    const statechange = new Subject<PlayBackStatus>();
    const startPlayback = jest.fn<() => Promise<void>>();
    const stopPlayback = jest.fn<() => Promise<void>>();
    const pausePlayback = jest.fn<() => Promise<void>>();

    startPlayback.mockResolvedValue(undefined);
    stopPlayback.mockResolvedValue(undefined);
    pausePlayback.mockResolvedValue(undefined);

    const manager = {
      isPlaying: false,
      statechange,
      startPlayback,
      stopPlayback,
      pausePlayback,
      playPosition: new SampleUnit(0, sampleRate),
      audioMechanism: {
        playBackRate: 1,
      },
      sampleRate,
      gainNode: undefined,
      state: PlayBackStatus.INITIALIZED,
    } as unknown as AudioManager;

    return {
      manager,
      startPlayback,
      stopPlayback,
      statechange,
    };
  }

  it('cancels a queued replay restart when stopPlayback is called', async () => {
    const { manager, startPlayback, statechange } = createAudioManagerMock();
    const chunk = new AudioChunk(
      new AudioSelection(
        new SampleUnit(0, sampleRate),
        new SampleUnit(sampleRate, sampleRate),
      ),
      manager,
    );

    chunk.toggleReplay();
    void chunk.startPlayback(false);
    await Promise.resolve();

    expect(startPlayback).toHaveBeenCalledTimes(1);

    statechange.next(PlayBackStatus.ENDED);
    await Promise.resolve();

    await chunk.stopPlayback();
    jest.advanceTimersByTime(250);
    await Promise.resolve();

    expect(startPlayback).toHaveBeenCalledTimes(1);
  });

  it('delegates to the manager even when isPlaying is stale/false (pending-play race)', async () => {
    // isPlaying reflects the mechanism's _state, which lags reality between
    // a native play() call and its 'canplay' event — a Stop click landing in
    // that window must still reach the mechanism, not take a no-op branch.
    const { manager, stopPlayback } = createAudioManagerMock();
    const chunk = new AudioChunk(
      new AudioSelection(
        new SampleUnit(0, sampleRate),
        new SampleUnit(sampleRate, sampleRate),
      ),
      manager,
    );

    expect(manager.isPlaying).toBe(false);
    await chunk.stopPlayback();

    expect(stopPlayback).toHaveBeenCalledTimes(1);
  });

  it('does not reject when the manager has nothing to stop (no audio instance yet)', async () => {
    // AudioManager.stopPlayback() can reject (e.g. HtmlAudioMechanism has no
    // audio element prepared yet). Existing callers of
    // AudioChunk.stopPlayback() don't all .catch() it, so this must not
    // turn into an unhandled rejection now that the isPlaying guard is gone.
    const { manager, stopPlayback } = createAudioManagerMock();
    stopPlayback.mockRejectedValueOnce(new Error('Missing Audio instance.'));
    const chunk = new AudioChunk(
      new AudioSelection(
        new SampleUnit(0, sampleRate),
        new SampleUnit(sampleRate, sampleRate),
      ),
      manager,
    );

    await expect(chunk.stopPlayback()).resolves.toBeUndefined();
    expect(stopPlayback).toHaveBeenCalledTimes(1);
  });
});

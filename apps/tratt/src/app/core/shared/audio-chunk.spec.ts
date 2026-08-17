import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AudioSelection, PlayBackStatus, SampleUnit } from '@octra/media';
import { AudioChunk, AudioManager } from '@octra/web-media';
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
});

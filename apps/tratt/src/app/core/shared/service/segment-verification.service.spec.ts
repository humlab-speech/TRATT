import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  OLabel,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { PlayBackStatus, SampleUnit } from '@tratt/media';
import { Subject } from 'rxjs';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { AudioService } from './audio.service';
import { SegmentVerificationService } from './segment-verification.service';

// The real services are wired to NgRx/IndexedDB and real audio decoding;
// the service under test only touches the members faked below.
jest.mock('../../store/login-mode/annotation/annotation.store.service', () => ({
  AnnotationStoreService: class AnnotationStoreService {},
}));
jest.mock('./audio.service', () => ({
  AudioService: class AudioService {},
}));

interface ManagerFake {
  isPlaying: boolean;
  playOnHover: boolean;
  playPosition: { samples: number };
  statechange: Subject<PlayBackStatus>;
}

class FakeAudioService {
  private registryVersion = signal(0);
  managers: ManagerFake[] = [];

  // Mirrors the real AudioService: the getter reads the registry-version
  // signal so SegmentVerificationService's effect re-runs on registry bumps.
  get audiomanagers(): ManagerFake[] {
    this.registryVersion();
    return this.managers;
  }

  register(manager: ManagerFake): void {
    this.managers = [...this.managers, manager];
    this.registryVersion.update((v) => v + 1);
  }
}

describe('SegmentVerificationService', () => {
  let audioService: FakeAudioService;
  let manager: ManagerFake;
  let currentLevel: TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
  let changeCurrentItemById: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    audioService = new FakeAudioService();
    manager = {
      isPlaying: false,
      playOnHover: false,
      playPosition: { samples: 0 },
      statechange: new Subject<PlayBackStatus>(),
    };
    currentLevel = new TrattAnnotationSegmentLevel(1, 'Transcript', [
      new TrattAnnotationSegment(1, new SampleUnit(16000, 16000), [
        new OLabel('Transcript', 'Hello'),
      ]),
      new TrattAnnotationSegment(2, new SampleUnit(32000, 16000), [
        new OLabel('Transcript', 'World'),
      ]),
    ]);
    currentLevel.items[0].verified = false;
    currentLevel.items[1].verified = false;
    changeCurrentItemById = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: AudioService, useValue: audioService },
        {
          provide: AnnotationStoreService,
          useValue: {
            get currentLevel() {
              return currentLevel;
            },
            changeCurrentItemById,
          },
        },
      ],
    });
    TestBed.inject(SegmentVerificationService);
    audioService.register(manager);
    // Angular effects do not run synchronously; flush so the service's
    // registry-watching effect subscribes to the manager's statechange.
    TestBed.flushEffects();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks a segment verified after 200ms of real playback inside it', () => {
    manager.isPlaying = true;
    manager.playPosition.samples = 1000; // inside segment 1
    manager.statechange.next(PlayBackStatus.PLAYING);

    jest.advanceTimersByTime(100);
    expect(changeCurrentItemById).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(changeCurrentItemById).toHaveBeenCalledTimes(1);
    const [id, item] = changeCurrentItemById.mock.calls[0];
    expect(id).toBe(1);
    expect((item as TrattAnnotationSegment).verified).toBe(true);
  });

  it('ignores hover scrubbing', () => {
    manager.isPlaying = true;
    manager.playOnHover = true;
    manager.playPosition.samples = 1000;
    manager.statechange.next(PlayBackStatus.PLAYING);

    jest.advanceTimersByTime(500);
    expect(changeCurrentItemById).not.toHaveBeenCalled();
  });

  it('marks the segment the position is in, not a later one', () => {
    manager.isPlaying = true;
    manager.playPosition.samples = 20000; // inside segment 2
    manager.statechange.next(PlayBackStatus.PLAYING);

    jest.advanceTimersByTime(300);
    expect(changeCurrentItemById).toHaveBeenCalledTimes(1);
    expect(changeCurrentItemById.mock.calls[0][0]).toBe(2);
  });

  it('resets accumulation when playback stops', () => {
    manager.isPlaying = true;
    manager.playPosition.samples = 1000;
    manager.statechange.next(PlayBackStatus.PLAYING);
    jest.advanceTimersByTime(100);
    manager.statechange.next(PlayBackStatus.STOPPED);
    manager.isPlaying = false;

    manager.statechange.next(PlayBackStatus.PLAYING);
    manager.isPlaying = true;
    jest.advanceTimersByTime(100);
    // 100ms in the first run + 100ms after the reset: still below 200ms.
    expect(changeCurrentItemById).not.toHaveBeenCalled();
  });

  it('does not re-dispatch for an already verified segment', () => {
    currentLevel.items[0].verified = true;
    manager.isPlaying = true;
    manager.playPosition.samples = 1000;
    manager.statechange.next(PlayBackStatus.PLAYING);

    jest.advanceTimersByTime(1000);
    expect(changeCurrentItemById).not.toHaveBeenCalled();
  });

  it('ignores playback past the last segment end', () => {
    manager.isPlaying = true;
    manager.playPosition.samples = 40000;
    manager.statechange.next(PlayBackStatus.PLAYING);

    jest.advanceTimersByTime(1000);
    expect(changeCurrentItemById).not.toHaveBeenCalled();
  });
});

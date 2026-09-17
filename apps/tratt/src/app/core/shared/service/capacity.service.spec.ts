import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// Convention (see pipeline-queue.service.spec.ts): both services build their
// Worker via `new URL('...', import.meta.url)`, which ts-jest's CommonJS
// config cannot compile (TS1343). capacity.service.ts imports both modules
// with `import type` only, so nothing here touches the real classes — these
// guards protect against any future value import sneaking into the graph.
jest.mock('./local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('./local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { TestBed } from '@angular/core/testing';
import { AudioManager } from '@tratt/web-media';
import { AudioService } from './audio.service';
import {
  CAPACITY_POLL_MS,
  CapacityService,
  DIARIZATION_MODEL_ESTIMATE_BYTES,
  estimateModelBytes,
  estimateResidentBytes,
  RAM_BUDGET_BYTES,
} from './capacity.service';
import { DIARIZATION_DEFAULT_MODEL_ID } from './local-diarization-runtime.service';
import type { TranscriptionOptions } from './local-transcription.service';
import type { TranslationAvailability } from './local-translation.service';

function asrOptions(
  modelId: string,
  withDiarization = false,
): TranscriptionOptions {
  return {
    modelId,
    useWebGPU: false,
    language: 'sv',
    ...(withDiarization
      ? {
          diarization: {
            modelId: DIARIZATION_DEFAULT_MODEL_ID,
            useWebGPU: false,
          },
        }
      : {}),
  };
}

/**
 * A stand-in for a resident AudioManager. Only the two properties the
 * estimator reads are present — `resource.size` (source bytes) and `channel`
 * (the single resident PCM array). See the design doc's 2.5 finding: there is
 * never a second, 16 kHz copy resident on the manager.
 */
function managerWith(
  sizeBytes: number | undefined,
  channelSamples: number | undefined,
): AudioManager {
  return {
    resource: { size: sizeBytes },
    channel:
      channelSamples === undefined
        ? undefined
        : new Float32Array(channelSamples),
  } as unknown as AudioManager;
}

describe('estimateModelBytes', () => {
  it('is zero when nothing is configured', () => {
    expect(estimateModelBytes(null, null)).toBe(0);
  });

  it('counts the configured ASR model at its advertised decimal-MB size', () => {
    expect(
      estimateModelBytes(
        asrOptions('onnx-community/kb-whisper-small-ONNX'),
        null,
      ),
    ).toBe(400_000_000);
  });

  it('adds the flat diarization placeholder when diarization is configured', () => {
    expect(
      estimateModelBytes(
        asrOptions('onnx-community/kb-whisper-small-ONNX', true),
        null,
      ),
    ).toBe(400_000_000 + DIARIZATION_MODEL_ESTIMATE_BYTES);
  });

  it('still counts diarization when the ASR model id is unknown', () => {
    expect(
      estimateModelBytes(asrOptions('some/unknown-model', true), null),
    ).toBe(DIARIZATION_MODEL_ESTIMATE_BYTES);
  });

  it('reuses TranslationAvailability.estimatedBytes for a direct pair', () => {
    const availability: TranslationAvailability = {
      kind: 'direct',
      modelId: 'Xenova/opus-mt-sv-en',
      estimatedBytes: 80_000_000,
    };
    expect(
      estimateModelBytes(
        asrOptions('onnx-community/kb-whisper-small-ONNX'),
        availability,
      ),
    ).toBe(400_000_000 + 80_000_000);
  });

  it('reuses TranslationAvailability.estimatedBytes for a pivot pair', () => {
    const availability: TranslationAvailability = {
      kind: 'pivot',
      legA: 'Xenova/opus-mt-sv-en',
      legB: 'Xenova/opus-mt-en-de',
      estimatedBytes: 160_000_000,
    };
    expect(estimateModelBytes(null, availability)).toBe(160_000_000);
  });

  it('counts nothing for an unavailable translation pair', () => {
    const availability: TranslationAvailability = {
      kind: 'unavailable',
      reason: 'no path',
    };
    expect(estimateModelBytes(null, availability)).toBe(0);
  });
});

describe('estimateResidentBytes', () => {
  it('is zero with no resident managers', () => {
    expect(estimateResidentBytes([])).toBe(0);
  });

  it('sums source bytes plus 4 bytes per resident Float32 sample', () => {
    // 1 MB source + 1000 samples * 4 bytes.
    expect(estimateResidentBytes([managerWith(1_000_000, 1000)])).toBe(
      1_000_000 + 4000,
    );
  });

  it('sums across several resident managers', () => {
    expect(
      estimateResidentBytes([
        managerWith(1_000_000, 1000),
        managerWith(2_000_000, 500),
      ]),
    ).toBe(1_000_000 + 4000 + 2_000_000 + 2000);
  });

  it('counts only source bytes for a manager whose PCM has been freed', () => {
    expect(estimateResidentBytes([managerWith(1_000_000, undefined)])).toBe(
      1_000_000,
    );
  });

  it('treats an undefined resource size as zero rather than NaN', () => {
    expect(estimateResidentBytes([managerWith(undefined, 1000)])).toBe(4000);
  });

  it("does not throw when a manager's resource getter throws", () => {
    const broken = {
      get resource(): never {
        throw new Error('audio mechanism not constructed');
      },
      channel: undefined,
    } as unknown as AudioManager;

    expect(() =>
      estimateResidentBytes([broken, managerWith(1_000_000, 0)]),
    ).not.toThrow();
    expect(estimateResidentBytes([broken, managerWith(1_000_000, 0)])).toBe(
      1_000_000,
    );
  });
});

describe('CapacityService', () => {
  let managers: AudioManager[];
  let estimate: jest.Mock<() => Promise<StorageEstimate>>;
  let originalStorage: PropertyDescriptor | undefined;

  /** Installs a fake `navigator.storage` — no real quota API is ever called. */
  function installStorage(value: unknown): void {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value,
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    managers = [];
    estimate = jest.fn(async () => ({
      usage: 500_000_000,
      quota: 8_000_000_000,
    }));
    originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
    installStorage({ estimate });

    TestBed.configureTestingModule({
      providers: [
        CapacityService,
        {
          provide: AudioService,
          useValue: {
            get audiomanagers() {
              return managers;
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
    if (originalStorage) {
      Object.defineProperty(navigator, 'storage', originalStorage);
    } else {
      delete (navigator as unknown as Record<string, unknown>).storage;
    }
    jest.restoreAllMocks();
  });

  it('reads real storage figures once, immediately on construction', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(service.storage().usedBytes).toBe(500_000_000);
    expect(service.storage().quotaBytes).toBe(8_000_000_000);
  });

  it('reports zeroes when the browser exposes no storage manager', async () => {
    installStorage(undefined);
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    expect(service.storage().usedBytes).toBe(0);
    expect(service.storage().quotaBytes).toBe(0);
  });

  it('keeps the last known figures when estimate() rejects', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    estimate.mockRejectedValueOnce(new Error('denied'));
    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS);

    expect(service.storage().usedBytes).toBe(500_000_000);
  });

  it('sums resident memory over the live AudioService registry', async () => {
    managers = [managerWith(1_000_000, 1000), managerWith(2_000_000, 500)];
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);

    expect(service.residentMemory().estimatedBytes).toBe(
      1_000_000 + 4000 + 2_000_000 + 2000,
    );
    expect(service.residentMemory().residentCount).toBe(2);
    expect(service.residentMemory().budgetBytes).toBe(RAM_BUDGET_BYTES);
  });

  it('picks up a newly resident bundle on the next poll', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(service.residentMemory().residentCount).toBe(0);

    managers = [managerWith(1_000_000, 1000)];
    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS);

    expect(service.residentMemory().residentCount).toBe(1);
    expect(service.residentMemory().estimatedBytes).toBe(1_000_000 + 4000);
  });

  it('polls storage again on each interval', async () => {
    TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(estimate).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS * 3);
    expect(estimate).toHaveBeenCalledTimes(4);
  });

  it('stops polling once its injector is destroyed', async () => {
    TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(estimate).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    await jest.advanceTimersByTimeAsync(CAPACITY_POLL_MS * 3);

    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('applies configured model sizes immediately, without waiting for a poll', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    expect(service.storage().modelsEstimateBytes).toBe(0);

    service.setConfiguredOptions(
      asrOptions('onnx-community/kb-whisper-small-ONNX', true),
    );

    expect(service.storage().modelsEstimateBytes).toBe(
      400_000_000 + DIARIZATION_MODEL_ESTIMATE_BYTES,
    );
  });

  it('clears the model estimate when options are cleared', async () => {
    const service = TestBed.inject(CapacityService);
    await jest.advanceTimersByTimeAsync(0);
    service.setConfiguredOptions(
      asrOptions('onnx-community/kb-whisper-small-ONNX'),
    );
    expect(service.storage().modelsEstimateBytes).toBe(400_000_000);

    service.setConfiguredOptions(null);

    expect(service.storage().modelsEstimateBytes).toBe(0);
  });
});

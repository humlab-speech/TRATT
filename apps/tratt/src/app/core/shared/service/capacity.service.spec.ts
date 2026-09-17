import { describe, expect, it, jest } from '@jest/globals';

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

import { AudioManager } from '@tratt/web-media';
import { DIARIZATION_DEFAULT_MODEL_ID } from './local-diarization-runtime.service';
import type { TranscriptionOptions } from './local-transcription.service';
import type { TranslationAvailability } from './local-translation.service';
import {
  DIARIZATION_MODEL_ESTIMATE_BYTES,
  estimateModelBytes,
  estimateResidentBytes,
} from './capacity.service';

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
      estimateModelBytes(asrOptions('onnx-community/kb-whisper-small-ONNX'), null),
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
    expect(estimateModelBytes(asrOptions('some/unknown-model', true), null)).toBe(
      DIARIZATION_MODEL_ESTIMATE_BYTES,
    );
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

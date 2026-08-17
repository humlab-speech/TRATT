import { describe, expect, it } from '@jest/globals';
import {
  classifyTranscriptionWorkerError,
  transcriptionFriendlyError,
} from './local-transcription-errors';

describe('local transcription error helpers', () => {
  it('classifies WebGPU backend import failures for WASM fallback', () => {
    const raw =
      'no available backend found. ERR: [webgpu] TypeError: Importing a module script failed.';

    expect(classifyTranscriptionWorkerError(raw, true)).toEqual({
      code: 'webgpu-backend-load-failed',
      shouldFallbackToWasm: true,
    });
  });

  it('keeps GPU memory failures on the WebGPU guidance path', () => {
    const raw = 'WebGPU device lost: out of memory';

    expect(transcriptionFriendlyError(raw, true)).toContain(
      'WebGPU error: the GPU ran out of memory',
    );
  });
});

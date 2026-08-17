export type TranscriptionWorkerErrorCode =
  | 'webgpu-backend-load-failed'
  | 'webgpu-runtime'
  | 'unknown';

export interface TranscriptionWorkerErrorInfo {
  code: TranscriptionWorkerErrorCode;
  shouldFallbackToWasm: boolean;
}

export function classifyTranscriptionWorkerError(
  raw: string,
  usedWebGPU: boolean,
): TranscriptionWorkerErrorInfo {
  const lower = raw.toLowerCase();
  const backendImportFailed =
    usedWebGPU &&
    lower.includes('no available backend found') &&
    lower.includes('[webgpu]') &&
    lower.includes('importing a module script failed');

  if (backendImportFailed) {
    return {
      code: 'webgpu-backend-load-failed',
      shouldFallbackToWasm: true,
    };
  }

  const isGpuError =
    lower.includes('device') ||
    lower.includes('gpu') ||
    lower.includes('webgpu') ||
    lower.includes('out of memory') ||
    lower.includes('oom');

  if (usedWebGPU && isGpuError) {
    return {
      code: 'webgpu-runtime',
      shouldFallbackToWasm: false,
    };
  }

  return {
    code: 'unknown',
    shouldFallbackToWasm: false,
  };
}

export function transcriptionFriendlyError(
  raw: string,
  usedWebGPU: boolean,
): string {
  const info = classifyTranscriptionWorkerError(raw, usedWebGPU);

  if (info.code === 'webgpu-backend-load-failed') {
    return (
      'WebGPU could not start because the browser failed to load its GPU backend. ' +
      'TRATT will retry with WASM automatically. If this keeps happening, update the page and try again.'
    );
  }

  if (info.code === 'webgpu-runtime') {
    return (
      'WebGPU error: the GPU ran out of memory or lost its connection ' +
      '(common with large models or after the display sleeps). ' +
      'Try disabling WebGPU in the transcription options and run with WASM instead.'
    );
  }

  return raw;
}

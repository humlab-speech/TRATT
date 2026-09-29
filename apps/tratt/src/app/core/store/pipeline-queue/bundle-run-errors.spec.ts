import { describe, expect, it } from '@jest/globals';
import {
  bundleRunErrorFromPipelineEvent,
  classifyBundleRunError,
} from './bundle-run-errors';

describe('classifyBundleRunError', () => {
  it('classifies the audio-decode failure the runner surfaces as decode', () => {
    expect(
      classifyBundleRunError(
        new Error('Audio channel data not available'),
        false,
      ),
    ).toEqual({
      kind: 'decode',
      message: 'Audio channel data not available',
    });
  });

  it('classifies the friendly WebGPU runtime message as oom', () => {
    const friendly =
      'WebGPU error: the GPU ran out of memory or lost its connection ' +
      '(common with large models or after the display sleeps). ' +
      'Try disabling WebGPU in the transcription options and run with WASM instead.';
    expect(classifyBundleRunError(new Error(friendly), true).kind).toBe('oom');
  });

  it('classifies the raw backend-import failure as model-load', () => {
    const raw =
      'no available backend found. ERR: [webgpu] importing a module script failed';
    expect(classifyBundleRunError(new Error(raw), true).kind).toBe(
      'model-load',
    );
  });

  it('classifies a plain out-of-memory message as oom even without WebGPU', () => {
    expect(
      classifyBundleRunError(new Error('WASM allocation failed'), false).kind,
    ).toBe('oom');
  });

  it('classifies a model download failure as model-load', () => {
    expect(
      classifyBundleRunError(
        new Error('Failed to fetch model onnx-community/kb-whisper-small-ONNX'),
        false,
      ).kind,
    ).toBe('model-load');
  });

  it('falls back to unknown for anything unrecognised', () => {
    expect(classifyBundleRunError(new Error('something odd'), false)).toEqual({
      kind: 'unknown',
      message: 'something odd',
    });
  });

  it('accepts a plain string and a non-error value', () => {
    expect(classifyBundleRunError('plain string failure', false)).toEqual({
      kind: 'unknown',
      message: 'plain string failure',
    });
    expect(classifyBundleRunError(undefined, false)).toEqual({
      kind: 'unknown',
      message: 'Unknown pipeline error.',
    });
  });
});

describe('bundleRunErrorFromPipelineEvent', () => {
  it('maps the pipeline cancelled event to the cancelled kind', () => {
    expect(
      bundleRunErrorFromPipelineEvent({
        stage: 'pipeline',
        type: 'cancelled',
      }),
    ).toEqual({ kind: 'cancelled', message: 'Run cancelled.' });
  });

  it('returns null for every non-terminal event', () => {
    expect(
      bundleRunErrorFromPipelineEvent({
        stage: 'pipeline',
        type: 'stalled',
        phase: 'downloading',
        message: 'stalled',
      }),
    ).toBeNull();
    expect(
      bundleRunErrorFromPipelineEvent({
        stage: 'diarization',
        type: 'skipped',
      }),
    ).toBeNull();
  });
});

import { describe, expect, it } from '@jest/globals';
import { DIARIZATION_DEFAULT_MODEL_ID } from '../../shared/service/local-diarization-runtime.service';
import { buildTranscriptionOptions } from './auto-transcribe-options.helpers';

describe('buildTranscriptionOptions', () => {
  it('returns null when auto transcription is disabled', () => {
    expect(
      buildTranscriptionOptions({
        audioLoaded: true,
        annotationAlreadyLoaded: false,
        enabled: false,
        modelId: 'onnx-community/whisper-small',
        useWebGPU: false,
        dtype: 'q4',
        language: 'en',
        speakerSegmentationEnabled: true,
      }),
    ).toBeNull();
  });

  it('omits diarization when speaker segmentation is disabled', () => {
    expect(
      buildTranscriptionOptions({
        audioLoaded: true,
        annotationAlreadyLoaded: false,
        enabled: true,
        modelId: 'onnx-community/whisper-small',
        useWebGPU: false,
        dtype: 'q4',
        language: 'en',
        speakerSegmentationEnabled: false,
      }),
    ).toEqual({
      modelId: 'onnx-community/whisper-small',
      useWebGPU: false,
      dtype: 'q4',
      language: 'en',
    });
  });

  it('adds public no-auth diarization options when speaker segmentation is enabled', () => {
    expect(
      buildTranscriptionOptions({
        audioLoaded: true,
        annotationAlreadyLoaded: false,
        enabled: true,
        modelId: 'onnx-community/whisper-small',
        useWebGPU: true,
        dtype: 'q4',
        language: 'en',
        speakerSegmentationEnabled: true,
      }),
    ).toEqual({
      modelId: 'onnx-community/whisper-small',
      useWebGPU: true,
      dtype: 'q4',
      language: 'en',
      diarization: {
        modelId: DIARIZATION_DEFAULT_MODEL_ID,
        useWebGPU: false,
      },
    });
  });
});

import { describe, expect, it } from '@jest/globals';
import { describePipeline, languageName } from './pipeline-summary';

describe('describePipeline', () => {
  const tiny = 'onnx-community/whisper-tiny-ONNX';

  it('is off when auto-transcription is off', () => {
    expect(describePipeline(null, null, 'en')).toEqual({ on: false });
  });

  it('names the model, language, speakers and translation target', () => {
    expect(
      describePipeline(
        {
          modelId: tiny,
          useWebGPU: true,
          language: 'en',
          diarization: { modelId: 'd', useWebGPU: false, numSpeakers: 2 },
        },
        { sourceLanguage: 'en', targetLanguage: 'de' },
        'en',
      ),
    ).toEqual({
      on: true,
      model: 'Whisper Tiny',
      language: 'English',
      speakers: 2,
      translateTo: 'German',
    });
  });

  it('says "auto" for an unspecified speaker count, and nothing without separation', () => {
    const auto = describePipeline(
      {
        modelId: tiny,
        useWebGPU: false,
        language: 'sv',
        diarization: { modelId: 'd', useWebGPU: false },
      },
      null,
      'en',
    );
    expect(auto.speakers).toBe('auto');
    expect(auto.translateTo).toBeUndefined();

    const none = describePipeline(
      { modelId: tiny, useWebGPU: false, language: 'sv' },
      null,
      'en',
    );
    expect(none.speakers).toBeUndefined();
  });

  it('uses the short radio-label form for other model families', () => {
    expect(
      describePipeline(
        {
          modelId: 'onnx-community/whisper-large-v3-turbo',
          useWebGPU: true,
          language: 'en',
        },
        null,
        'en',
      ).model,
    ).toBe('Whisper Large-v3-turbo');
    expect(
      describePipeline(
        {
          modelId: 'onnx-community/kb-whisper-medium-ONNX',
          useWebGPU: true,
          language: 'sv',
        },
        null,
        'en',
      ).model,
    ).toBe('Whisper Medium');
  });

  it('falls back to the model id for an unknown model', () => {
    expect(
      describePipeline(
        { modelId: 'someone/custom', useWebGPU: false, language: 'en' },
        null,
        'en',
      ).model,
    ).toBe('someone/custom');
  });
});

describe('languageName', () => {
  it('names languages in the UI language, capitalised', () => {
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('de', 'sv')).toBe('Tyska');
  });

  it('falls back to the code', () => {
    expect(languageName('zz', 'en')).toBe('zz');
  });
});

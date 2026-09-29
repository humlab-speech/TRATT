import { describe, expect, it, jest } from '@jest/globals';

// Convention (see pipeline-queue.service.spec.ts / bundle-list.component.spec.ts):
// these two services build their Worker via `new URL('...', import.meta.url)`,
// which ts-jest's CommonJS config cannot compile (TS1343). This spec's import
// graph reaches auto-transcribe-options.component.ts, which references
// local-transcription.service.ts, so stub both leaf modules out.
jest.mock('../../shared/service/local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import {
  ALL_WHISPER_MODELS,
  findWhisperModelSizeMb,
} from './whisper-model-sizes';

describe('findWhisperModelSizeMb', () => {
  it('finds a KB (Swedish) model', () => {
    expect(findWhisperModelSizeMb('onnx-community/kb-whisper-small-ONNX')).toBe(
      400,
    );
  });

  it('finds a Finnish model', () => {
    expect(
      findWhisperModelSizeMb(
        'FredrikKarlssonSpeech/whisper-medium-finnish-onnx',
      ),
    ).toBe(684);
  });

  it('finds a Norwegian model', () => {
    expect(
      findWhisperModelSizeMb('FredrikKarlssonSpeech/nb-whisper-large-onnx'),
    ).toBe(1210);
  });

  it('finds an OpenAI model', () => {
    expect(findWhisperModelSizeMb('onnx-community/whisper-tiny-ONNX')).toBe(95);
  });

  it('returns undefined for a model id in none of the four arrays', () => {
    expect(findWhisperModelSizeMb('some/unknown-model')).toBeUndefined();
  });

  it('returns undefined for an empty id rather than matching by accident', () => {
    expect(findWhisperModelSizeMb('')).toBeUndefined();
  });

  it('covers every model in all four arrays with a positive size', () => {
    expect(ALL_WHISPER_MODELS.length).toBe(15);
    for (const model of ALL_WHISPER_MODELS) {
      expect(findWhisperModelSizeMb(model.modelId)).toBe(model.sizeMb);
      expect(model.sizeMb).toBeGreaterThan(0);
    }
  });
});

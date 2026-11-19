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

import * as en from '../../../../assets/i18n/en.json';
import {
  FINNISH_WHISPER_MODELS,
  KB_WHISPER_MODELS,
  LULE_SAMI_WHISPER_MODELS,
  NORTHERN_SAMI_WHISPER_MODELS,
  NORWEGIAN_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from './auto-transcribe-options.component';
import {
  ALL_WHISPER_MODELS,
  findWhisperModelSizeMb,
} from './whisper-model-sizes';

describe('findWhisperModelSizeMb', () => {
  it('uses the 4-bit download on WebGPU for KB (Swedish) Small', () => {
    expect(
      findWhisperModelSizeMb('onnx-community/kb-whisper-small-ONNX', true),
    ).toBe(299);
  });

  it('uses the larger 8-bit download on WASM for KB (Swedish) Small', () => {
    expect(
      findWhisperModelSizeMb('onnx-community/kb-whisper-small-ONNX', false),
    ).toBe(407);
  });

  it('finds a Finnish model, which is the same 4-bit build on both lanes', () => {
    expect(
      findWhisperModelSizeMb(
        'FredrikKarlssonSpeech/whisper-medium-finnish-onnx',
        true,
      ),
    ).toBe(712);
    expect(
      findWhisperModelSizeMb(
        'FredrikKarlssonSpeech/whisper-medium-finnish-onnx',
        false,
      ),
    ).toBe(712);
  });

  it('finds a Norwegian model', () => {
    expect(
      findWhisperModelSizeMb(
        'FredrikKarlssonSpeech/nb-whisper-large-onnx',
        true,
      ),
    ).toBe(1263);
  });

  it('finds an OpenAI model', () => {
    expect(
      findWhisperModelSizeMb('onnx-community/whisper-tiny-ONNX', true),
    ).toBe(96);
  });

  it('returns undefined for a model id in none of the four arrays', () => {
    expect(findWhisperModelSizeMb('some/unknown-model', true)).toBeUndefined();
  });

  it('returns undefined for an empty id rather than matching by accident', () => {
    expect(findWhisperModelSizeMb('', true)).toBeUndefined();
  });

  it('covers every model in all model arrays with a positive size', () => {
    expect(ALL_WHISPER_MODELS.length).toBe(
      [
        KB_WHISPER_MODELS,
        FINNISH_WHISPER_MODELS,
        NORWEGIAN_WHISPER_MODELS,
        NORTHERN_SAMI_WHISPER_MODELS,
        LULE_SAMI_WHISPER_MODELS,
        OPENAI_WHISPER_MODELS,
      ].reduce((n, models) => n + models.length, 0),
    );
    for (const model of ALL_WHISPER_MODELS) {
      expect(findWhisperModelSizeMb(model.modelId, true)).toBe(model.sizeMb);
      expect(model.sizeMb).toBeGreaterThan(0);
    }
  });

  it('keeps a separate WASM size only where WASM is not the 4-bit build', () => {
    for (const model of ALL_WHISPER_MODELS) {
      const wasm = model.sizeMbWasm ?? model.sizeMb;
      expect(findWhisperModelSizeMb(model.modelId, false)).toBe(wasm);
      if (model.dtypeWasm === 'q4') {
        expect(model.sizeMbWasm).toBeUndefined();
      } else {
        expect(model.sizeMbWasm).toBeDefined();
      }
    }
  });

  it('leaves the size in every English model label to the registry', () => {
    const labels = (
      en as unknown as {
        login: {
          'auto-transcription': {
            models: Record<string, Record<string, string>>;
          };
        };
      }
    ).login['auto-transcription'].models;
    for (const model of ALL_WHISPER_MODELS) {
      const entry = labels[model.i18nKey ?? model.key];
      expect(entry).toBeDefined();
      for (const lane of ['wasm', 'webgpu'] as const) {
        expect(entry[lane]).toContain('{{size}}');
        expect(entry[lane]).not.toMatch(/\d+(?:[.,]\d+)?\s*(?:MB|GB)/);
      }
    }
  });
});

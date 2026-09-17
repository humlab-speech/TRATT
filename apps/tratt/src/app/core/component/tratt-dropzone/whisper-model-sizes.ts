import {
  FINNISH_WHISPER_MODELS,
  KB_WHISPER_MODELS,
  KbWhisperModel,
  NORWEGIAN_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from './auto-transcribe-options.component';

/**
 * Every Whisper model this app can offer, across all four language families.
 *
 * The arrays themselves stay where they are (in the options component) — they
 * cannot move without editing `core/pages/login/login.component.ts`, which is
 * outside step 3c's scope. This module is the sibling pure helper, the same
 * shape as `auto-transcribe-options.helpers.ts`.
 *
 * Note the deliberate ordering: KB (Swedish) first, OpenAI last. No `modelId`
 * appears in more than one array today, so ordering is presentational only —
 * but if that ever changed, the more specific fine-tune would win over the
 * generic OpenAI base model, which is the answer a size estimate wants.
 */
export const ALL_WHISPER_MODELS: readonly KbWhisperModel[] = [
  ...KB_WHISPER_MODELS,
  ...FINNISH_WHISPER_MODELS,
  ...NORWEGIAN_WHISPER_MODELS,
  ...OPENAI_WHISPER_MODELS,
];

/**
 * The advertised download size, in decimal MB, of the Whisper model with this
 * id — or `undefined` if the id is not one this app offers (e.g. a stale id
 * persisted from an older release).
 *
 * There was no per-id lookup before step 3c: `getModelsForLanguage()` in the
 * options component dispatches by LANGUAGE and is module-private, and
 * `login.component.ts` hand-rolls a two-array `.find()` that misses the
 * Finnish and Norwegian families entirely. Callers that have a model id and
 * need its size should use this, not re-derive it.
 */
export function findWhisperModelSizeMb(modelId: string): number | undefined {
  if (!modelId) {
    return undefined;
  }
  return ALL_WHISPER_MODELS.find((model) => model.modelId === modelId)
    ?.sizeMb;
}

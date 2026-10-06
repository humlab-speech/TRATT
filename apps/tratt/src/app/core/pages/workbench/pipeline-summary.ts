import {
  FINNISH_WHISPER_MODELS,
  KB_WHISPER_MODELS,
  NORWEGIAN_WHISPER_MODELS,
  OPENAI_WHISPER_MODELS,
} from '../../component/tratt-dropzone/auto-transcribe-options.component';
import { TranscriptionOptions } from '../../shared/service/local-transcription.service';
import { TranslationOptions } from '../../shared/service/local-translation.service';

/** What the workbench rail shows about the pipeline while its settings are
 * closed. */
export interface PipelineSummary {
  /** Auto-transcription runs on new files. */
  on: boolean;
  /** e.g. "Whisper Tiny" — the short form of the model's radio label. */
  model?: string;
  /** Transcription language, named in the UI language. */
  language?: string;
  /** Speaker separation: an expected count, or `'auto'`; absent when off. */
  speakers?: number | 'auto';
  /** Translation target, named in the UI language; absent when off. */
  translateTo?: string;
}

const ALL_MODELS = [
  ...KB_WHISPER_MODELS,
  ...FINNISH_WHISPER_MODELS,
  ...NORWEGIAN_WHISPER_MODELS,
  ...OPENAI_WHISPER_MODELS,
];

/** Same rule as the settings' compact radio labels ("Large-v3-turbo"). */
function modelName(modelId: string): string {
  const key = ALL_MODELS.find((m) => m.modelId === modelId)?.key;
  if (!key) {
    return modelId;
  }
  return `Whisper ${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** "English" / "Engelska" for `en`, in `displayLang`; the code if unknown. */
export function languageName(code: string, displayLang: string): string {
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames([displayLang, 'en'], { type: 'language' }).of(
      code,
    );
  } catch {
    name = undefined;
  }
  if (!name || name === code) {
    return code;
  }
  return name.charAt(0).toLocaleUpperCase(displayLang) + name.slice(1);
}

export function describePipeline(
  transcribe: TranscriptionOptions | null,
  translate: TranslationOptions | null,
  displayLang: string,
): PipelineSummary {
  if (!transcribe) {
    return { on: false };
  }
  const diarization = transcribe.diarization;
  return {
    on: true,
    model: modelName(transcribe.modelId),
    language: transcribe.language
      ? languageName(transcribe.language, displayLang)
      : undefined,
    speakers: diarization ? (diarization.numSpeakers ?? 'auto') : undefined,
    translateTo: translate
      ? languageName(translate.targetLanguage, displayLang)
      : undefined,
  };
}

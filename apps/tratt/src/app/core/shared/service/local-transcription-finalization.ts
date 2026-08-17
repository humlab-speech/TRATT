import { OAnnotJSON } from '@octra/annotation';
import { pickInitialLevelName } from '@octra/utilities';
import {
  applySpeakerTurnsToAnnotJson,
  SpeakerTurn,
} from './local-diarization.service';

export interface TranscriptionFinalizationOptions {
  language?: string;
  speakerTurns?: SpeakerTurn[];
}

export function finalizeTranscriptionAnnotJson(
  annotJson: OAnnotJSON,
  options: TranscriptionFinalizationOptions,
): OAnnotJSON {
  const levelName = pickInitialLevelName({ asrLanguage: options.language });
  for (const level of annotJson.levels ?? []) {
    if (level.name === 'OCTRA_1') {
      level.name = levelName;
    }
    for (const item of (level as { items?: { labels?: { name: string }[] }[] })
      .items ?? []) {
      for (const label of item.labels ?? []) {
        if (label.name === 'OCTRA_1') {
          label.name = levelName;
        }
      }
    }
  }

  if (options.speakerTurns?.length) {
    return applySpeakerTurnsToAnnotJson(annotJson, options.speakerTurns);
  }

  return annotJson;
}

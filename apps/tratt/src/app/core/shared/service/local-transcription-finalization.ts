import { OAnnotJSON, OSegment, OSegmentLevel } from '@tratt/annotation';
import { renamePlaceholderLevels } from '@tratt/utilities';
import {
  applySpeakerTurnsToAnnotJson,
  SpeakerTurn,
} from './local-diarization.service';

export interface TranscriptionFinalizationOptions {
  speakerTurns?: SpeakerTurn[];
  /** Localized tier name (follows the UI language). */
  defaultLevelName: string;
}

export function finalizeTranscriptionAnnotJson(
  annotJson: OAnnotJSON,
  options: TranscriptionFinalizationOptions,
): OAnnotJSON {
  renamePlaceholderLevels(annotJson, options.defaultLevelName);

  const result = options.speakerTurns?.length
    ? applySpeakerTurnsToAnnotJson(annotJson, options.speakerTurns)
    : annotJson;

  // Everything this function touches was produced automatically by ASR: no
  // human has listened to or edited it yet, so every transcription segment
  // starts out as non-verified. Stamp AFTER diarization so rebuilt segments
  // (which preserve `verified` from their source) keep the same value.
  for (const level of result.levels ?? []) {
    if (level instanceof OSegmentLevel) {
      for (const item of level.items) {
        if (item instanceof OSegment) {
          item.verified = false;
        }
      }
    }
  }

  return result;
}

import { OAnnotJSON } from '@tratt/annotation';
import {
  applySpeakerTurnsToAnnotJson,
  SpeakerTurn,
} from '../../shared/service/local-diarization.service';

interface ApplyOptionalSpeakerSegmentationArgs {
  annotJson: OAnnotJSON;
  diarizationEnabled: boolean;
  runDiarization: () => Promise<SpeakerTurn[]>;
}

interface ApplyOptionalSpeakerSegmentationResult {
  annotJson: OAnnotJSON;
  /** Raw error message when diarization failed, for the caller to localize. Null on success or when disabled. */
  errorMessage: string | null;
}

export async function applyOptionalSpeakerSegmentation(
  args: ApplyOptionalSpeakerSegmentationArgs,
): Promise<ApplyOptionalSpeakerSegmentationResult> {
  if (!args.diarizationEnabled) {
    return {
      annotJson: args.annotJson,
      errorMessage: null,
    };
  }

  try {
    const turns = await args.runDiarization();
    return {
      annotJson: applySpeakerTurnsToAnnotJson(args.annotJson, turns),
      errorMessage: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      annotJson: args.annotJson,
      errorMessage: message,
    };
  }
}

import { OAnnotJSON } from '@octra/annotation';
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
  warning: string | null;
}

export async function applyOptionalSpeakerSegmentation(
  args: ApplyOptionalSpeakerSegmentationArgs,
): Promise<ApplyOptionalSpeakerSegmentationResult> {
  if (!args.diarizationEnabled) {
    return {
      annotJson: args.annotJson,
      warning: null,
    };
  }

  try {
    const turns = await args.runDiarization();
    return {
      annotJson: applySpeakerTurnsToAnnotJson(args.annotJson, turns),
      warning: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      annotJson: args.annotJson,
      warning: `Speaker separation failed: ${message}`,
    };
  }
}

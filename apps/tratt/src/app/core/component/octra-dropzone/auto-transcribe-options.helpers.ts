import {
  DIARIZATION_DEFAULT_MODEL_ID,
  DiarizationOptions,
} from '../../shared/service/local-diarization-runtime.service';
import { TranscriptionOptions } from '../../shared/service/local-transcription.service';

interface BuildTranscriptionOptionsArgs {
  audioLoaded: boolean;
  annotationAlreadyLoaded: boolean;
  enabled: boolean;
  modelId: string;
  useWebGPU: boolean;
  dtype?: string;
  language: string;
  speakerSegmentationEnabled: boolean;
  numSpeakers?: number | null;
}

export function buildTranscriptionOptions(
  args: BuildTranscriptionOptionsArgs,
): TranscriptionOptions | null {
  if (!args.audioLoaded || args.annotationAlreadyLoaded || !args.enabled) {
    return null;
  }

  const diarization: DiarizationOptions | undefined =
    args.speakerSegmentationEnabled
      ? {
          modelId: DIARIZATION_DEFAULT_MODEL_ID,
          useWebGPU: false,
          ...(args.numSpeakers != null
            ? { numSpeakers: args.numSpeakers }
            : {}),
        }
      : undefined;

  return {
    modelId: args.modelId,
    useWebGPU: args.useWebGPU,
    ...(args.dtype ? { dtype: args.dtype } : {}),
    language: args.language,
    ...(diarization ? { diarization } : {}),
  };
}

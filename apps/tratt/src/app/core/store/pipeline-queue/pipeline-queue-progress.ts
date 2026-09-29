import { Action } from '@ngrx/store';
import { PipelineActions } from '../pipeline/pipeline.actions';
import { BundleRunStage } from './index';

export interface QueueProgressUpdate {
  stage: BundleRunStage;
  progress?: number;
}

export interface QueueProgressResult {
  /** null when the action carries no stage/progress information. */
  update: QueueProgressUpdate | null;
  /**
   * Carried forward between calls: transcription `segment-progress` events
   * report `segmentEndS` only, so the total duration must be remembered
   * from the earlier `transcribe-start` event to turn it into a fraction.
   */
  audioDurationS: number;
}

function fraction(loaded: number, total: number): number | undefined {
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return Math.min(1, Math.max(0, loaded / total));
}

function update(
  stage: BundleRunStage,
  progress: number | undefined,
): QueueProgressUpdate {
  return progress === undefined ? { stage } : { stage, progress };
}

/**
 * Turns one already-mapped `PipelineActions` action (produced by step 3a's
 * `mapPipelineEventToAction`, reused verbatim) into a bundle-scoped queue
 * progress update.
 *
 * Deliberately a pure function over the step-3a action type rather than over
 * the raw `PipelineEvent`: `PipelineQueueService` pipes the event stream
 * through `mapPipelineEventToAction` → `dispatchPipelineActions()` so it
 * inherits 3a's order-preserving ~4Hz throttle exactly, and this runs on the
 * far side of that throttle. The old singleton `pipeline` slice's ACTIONS
 * are reused as an intermediate representation; none of them are ever
 * dispatched by the queue, so the `pipeline` slice's own state is never
 * touched.
 */
export function mapPipelineActionToQueueProgress(
  action: Action,
  audioDurationS: number,
): QueueProgressResult {
  if (action.type === PipelineActions.transcriptionEvent.type) {
    const event = (
      action as ReturnType<typeof PipelineActions.transcriptionEvent>
    ).event;
    switch (event.type) {
      case 'download-progress':
        return {
          update: update('asr', fraction(event.loaded, event.total)),
          audioDurationS,
        };
      case 'transcribe-start':
        return {
          update: update('asr', 0),
          audioDurationS: event.audioDurationS,
        };
      case 'segment-progress':
        return {
          update: update('asr', fraction(event.segmentEndS, audioDurationS)),
          audioDurationS,
        };
      case 'backend-fallback':
        return { update: update('asr', 0), audioDurationS };
      default:
        return { update: null, audioDurationS };
    }
  }

  if (action.type === PipelineActions.diarizationStarted.type) {
    return { update: update('diarization', 0), audioDurationS };
  }

  if (action.type === PipelineActions.diarizationEvent.type) {
    const event = (
      action as ReturnType<typeof PipelineActions.diarizationEvent>
    ).event;
    if (event.type === 'download-progress') {
      return {
        update: update('diarization', fraction(event.loaded, event.total)),
        audioDurationS,
      };
    }
    return { update: null, audioDurationS };
  }

  if (action.type === PipelineActions.translationStart.type) {
    return { update: update('translation', 0), audioDurationS };
  }

  if (action.type === PipelineActions.translationEvent.type) {
    const event = (
      action as ReturnType<typeof PipelineActions.translationEvent>
    ).event;
    if (event.type === 'download-progress') {
      return {
        update: update('translation', fraction(event.loaded, event.total)),
        audioDurationS,
      };
    }
    if (event.type === 'segment-progress') {
      return {
        update: update('translation', fraction(event.index, event.total)),
        audioDurationS,
      };
    }
    return { update: null, audioDurationS };
  }

  return { update: null, audioDurationS };
}

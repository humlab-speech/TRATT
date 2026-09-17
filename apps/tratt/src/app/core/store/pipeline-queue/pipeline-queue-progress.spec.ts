import { describe, expect, it } from '@jest/globals';
import { PipelineActions } from '../pipeline/pipeline.actions';
import { mapPipelineActionToQueueProgress } from './pipeline-queue-progress';

describe('mapPipelineActionToQueueProgress', () => {
  it('maps transcription download progress to the asr stage', () => {
    const result = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: {
          type: 'download-progress',
          loaded: 25,
          total: 100,
          file: 'model.onnx',
        },
      }),
      0,
    );
    expect(result.update).toEqual({ stage: 'asr', progress: 0.25 });
    expect(result.audioDurationS).toBe(0);
  });

  it('captures the audio duration from transcribe-start and uses it for segment progress', () => {
    const started = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: { type: 'transcribe-start', audioDurationS: 40 },
      }),
      0,
    );
    expect(started.update).toEqual({ stage: 'asr', progress: 0 });
    expect(started.audioDurationS).toBe(40);

    const progressed = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: { type: 'segment-progress', segmentEndS: 10 },
      }),
      started.audioDurationS,
    );
    expect(progressed.update).toEqual({ stage: 'asr', progress: 0.25 });
  });

  it('reports segment progress with no stage progress value when the duration is unknown', () => {
    const result = mapPipelineActionToQueueProgress(
      PipelineActions.transcriptionEvent({
        event: { type: 'segment-progress', segmentEndS: 10 },
      }),
      0,
    );
    expect(result.update).toEqual({ stage: 'asr' });
  });

  it('maps diarization start and download progress to the diarization stage', () => {
    expect(
      mapPipelineActionToQueueProgress(PipelineActions.diarizationStarted(), 0)
        .update,
    ).toEqual({ stage: 'diarization', progress: 0 });

    expect(
      mapPipelineActionToQueueProgress(
        PipelineActions.diarizationEvent({
          event: {
            type: 'download-progress',
            loaded: 1,
            total: 4,
            file: 'seg.onnx',
          },
        }),
        0,
      ).update,
    ).toEqual({ stage: 'diarization', progress: 0.25 });
  });

  it('maps translation start and segment progress to the translation stage', () => {
    expect(
      mapPipelineActionToQueueProgress(PipelineActions.translationStart(), 0)
        .update,
    ).toEqual({ stage: 'translation', progress: 0 });

    expect(
      mapPipelineActionToQueueProgress(
        PipelineActions.translationEvent({
          event: { type: 'segment-progress', index: 3, total: 12 },
        }),
        0,
      ).update,
    ).toEqual({ stage: 'translation', progress: 0.25 });
  });

  it('guards against a zero total rather than emitting NaN', () => {
    expect(
      mapPipelineActionToQueueProgress(
        PipelineActions.transcriptionEvent({
          event: {
            type: 'download-progress',
            loaded: 0,
            total: 0,
            file: 'model.onnx',
          },
        }),
        0,
      ).update,
    ).toEqual({ stage: 'asr' });
  });

  it('returns no update for actions that carry no stage progress', () => {
    expect(
      mapPipelineActionToQueueProgress(PipelineActions.cancelled(), 0).update,
    ).toBeNull();
    expect(
      mapPipelineActionToQueueProgress(PipelineActions.diarizationSkipped(), 0)
        .update,
    ).toBeNull();
  });
});

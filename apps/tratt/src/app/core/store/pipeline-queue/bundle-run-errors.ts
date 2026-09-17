import { classifyTranscriptionWorkerError } from '../../shared/service/local-transcription-errors';
import type { PipelineEvent } from '../../shared/service/pipeline-runner.service';
import { BundleRunError } from './index';

/**
 * The exact message `LocalTranscriptionService` errors with when
 * `prepareMonoAudioForMlModel()` finds no channel data
 * (local-transcription.service.ts:88) — the one decode-class failure
 * `PipelineRunnerService.run()` itself can produce.
 */
export const DECODE_FAILURE_MESSAGE = 'Audio channel data not available';

const OOM_MARKERS = [
  'out of memory',
  'oom',
  'allocation failed',
  'array buffer allocation failed',
  'quotaexceeded',
];

const MODEL_LOAD_MARKERS = [
  'no available backend',
  'importing a module script failed',
  'failed to fetch',
  'failed to load model',
  'networkerror',
  'could not locate file',
];

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'Unknown pipeline error.';
}

/**
 * Maps whatever `PipelineRunnerService.run()`'s Observable errors with onto
 * the spec's five `BundleRunErrorKind` classes.
 *
 * `classifyTranscriptionWorkerError()` is reused rather than reimplemented,
 * but it alone is not sufficient here, for a reason found by reading the
 * source: `LocalTranscriptionService` wraps the FRIENDLY message
 * (`transcriptionFriendlyError(...)`) in the `Error` it errors with
 * (local-transcription.service.ts:181-185), not the raw worker message. The
 * friendly text still classifies as 'webgpu-runtime' (it contains "gpu"),
 * but can never classify as 'webgpu-backend-load-failed' — that branch needs
 * raw substrings the friendly text drops. The raw path IS still reachable
 * (diarization's worker errors are not rewritten, and an unrecognised
 * transcription error passes through verbatim since `transcriptionFriendly
 * Error` returns `raw` in its default branch), so both are handled: the
 * classifier is consulted first, then message markers fill the gaps.
 */
export function classifyBundleRunError(
  error: unknown,
  usedWebGPU: boolean,
): BundleRunError {
  const message = messageOf(error);
  const lower = message.toLowerCase();

  if (lower.includes(DECODE_FAILURE_MESSAGE.toLowerCase())) {
    return { kind: 'decode', message };
  }

  const info = classifyTranscriptionWorkerError(message, usedWebGPU);
  if (info.code === 'webgpu-backend-load-failed') {
    return { kind: 'model-load', message };
  }
  if (info.code === 'webgpu-runtime') {
    // 'webgpu-runtime' is specifically "the GPU ran out of memory or lost
    // its connection" — the spec's 'oom' class, not 'unknown'.
    return { kind: 'oom', message };
  }

  if (OOM_MARKERS.some((marker) => lower.includes(marker))) {
    return { kind: 'oom', message };
  }
  if (MODEL_LOAD_MARKERS.some((marker) => lower.includes(marker))) {
    return { kind: 'model-load', message };
  }

  return { kind: 'unknown', message };
}

/**
 * The one `PipelineEvent` that is itself a terminal failure for the queue:
 * `{stage:'pipeline', type:'cancelled'}`, emitted by
 * `PipelineRunnerService.cancel()` right before it completes the run
 * Observable. `'stalled'` is deliberately NOT terminal — the runner keeps
 * running after a stall; it is a warning, and treating it as a failure would
 * abandon runs that go on to succeed.
 */
export function bundleRunErrorFromPipelineEvent(
  event: PipelineEvent,
): BundleRunError | null {
  if (event.stage === 'pipeline' && event.type === 'cancelled') {
    return { kind: 'cancelled', message: 'Run cancelled.' };
  }
  return null;
}

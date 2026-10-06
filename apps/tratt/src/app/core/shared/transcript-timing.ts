import { TrattAnnotationSegmentLevel } from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';

/**
 * Where a transcript ends: the latest end of the last segment over all its
 * segment levels, in that segment's sample rate. Transcripts produced or
 * imported here are padded to the full audio duration (ASR results,
 * `padSegmentLevels`), so this is the recording's duration when the audio
 * itself isn't available (a file restored from an earlier visit).
 * `undefined` for a transcript without timed segments.
 */
export function transcriptEnd(transcript: unknown): SampleUnit | undefined {
  const levels = (transcript as { levels?: unknown[] } | undefined)?.levels;
  let end: SampleUnit | undefined;
  for (const level of levels ?? []) {
    if (level instanceof TrattAnnotationSegmentLevel) {
      const last = level.items[level.items.length - 1];
      if (last?.time && (!end || last.time.samples > end.samples)) {
        end = last.time;
      }
    }
  }
  return end && end.sampleRate > 0 ? end : undefined;
}

import { SpeakerTurn } from './local-diarization.service';

export interface PyannoteSpeakerSegment {
  id: number;
  start: number;
  end: number;
  confidence?: number;
}

/**
 * A contiguous region of speech attributed to one *local* speaker slot by the
 * segmentation model. `localId` is only meaningful within a single model
 * window: the segmentation model has no notion of global speaker identity, so
 * cross-window identity is recovered separately (see `speaker-clustering`).
 */
export interface MergedTurn {
  startS: number;
  endS: number;
  localId: string;
}

export const DEFAULT_MERGE_GAP_S = 0.8;
export const DEFAULT_MIN_TURN_S = 0.35;

export interface MergeOptions {
  mergeGapS?: number;
  minTurnS?: number;
  minConfidence?: number;
}

/**
 * Collapses the raw per-window segmentation output into speaker turns: drops
 * non-speech and tiny segments, sorts by time, and merges adjacent segments
 * of the same local speaker within `mergeGapS`.
 */
export function mergePyannoteSegments(
  segments: PyannoteSpeakerSegment[],
  options?: MergeOptions,
): MergedTurn[] {
  const mergeGapS = options?.mergeGapS ?? DEFAULT_MERGE_GAP_S;
  const minTurnS = options?.minTurnS ?? DEFAULT_MIN_TURN_S;
  const minConfidence = options?.minConfidence;

  const filtered = [...segments]
    .filter((segment) => segment.end > segment.start)
    .filter(
      (segment) =>
        minConfidence == null || (segment.confidence ?? 1) >= minConfidence,
    )
    .sort((a, b) => a.start - b.start)
    .filter((segment) => segment.end - segment.start >= minTurnS);

  const merged: MergedTurn[] = [];

  for (const segment of filtered) {
    const localId = String(segment.id);
    const previous = merged.at(-1);

    if (
      previous &&
      previous.localId === localId &&
      segment.start - previous.endS <= mergeGapS
    ) {
      previous.endS = segment.end;
      continue;
    }

    merged.push({
      startS: segment.start,
      endS: segment.end,
      localId,
    });
  }

  return merged;
}

/**
 * Assigns sequential speaker ids (`'0'`, `'1'`, …) in order of first
 * appearance, so the first speaker to talk is always speaker `'0'`.
 */
export function renumberByFirstAppearance(turns: MergedTurn[]): SpeakerTurn[] {
  const ids = new Map<string, string>();
  let next = 0;

  return turns.map((turn) => {
    if (!ids.has(turn.localId)) {
      ids.set(turn.localId, String(next++));
    }
    return {
      startS: turn.startS,
      endS: turn.endS,
      speakerId: ids.get(turn.localId)!,
    };
  });
}

/**
 * Fallback labelling used when speaker embeddings cannot be extracted (e.g.
 * the embedding model fails to download): every local speaker slot is treated
 * as its own global speaker, numbered by first appearance. This loses
 * cross-window identity but never crashes the pipeline.
 */
export function normalizePyannoteSpeakerTurns(
  segments: PyannoteSpeakerSegment[],
  options?: MergeOptions,
): SpeakerTurn[] {
  return renumberByFirstAppearance(mergePyannoteSegments(segments, options));
}

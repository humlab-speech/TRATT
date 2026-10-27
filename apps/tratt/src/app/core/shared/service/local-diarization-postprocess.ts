import { SpeakerTurn } from './local-diarization.service';

export interface PyannoteSpeakerSegment {
  id: number;
  start: number;
  end: number;
  confidence?: number;
}

export const DEFAULT_MERGE_GAP_S = 0.8;
export const DEFAULT_MIN_TURN_S = 0.35;

/**
 * Bounds the number of distinct speakers to `numSpeakers` by folding the
 * least-talkative speakers into their temporally closest kept neighbour.
 *
 * The segmentation model (`pyannote-segmentation-3.0`) has no global speaker
 * identity and no clustering step, so this is a heuristic constraint rather
 * than true diarization: it only caps the speaker labels the app emits, which
 * is what the user-requested "number of speakers" can honour on this model.
 */
function capSpeakerCount(
  turns: Array<{ startS: number; endS: number; speakerId: string }>,
  numSpeakers: number | undefined,
): Array<{ startS: number; endS: number; speakerId: string }> {
  if (numSpeakers == null || numSpeakers < 1) {
    return turns;
  }
  const ids = [...new Set(turns.map((t) => t.speakerId))];
  if (ids.length <= numSpeakers) {
    return turns;
  }

  const duration = new Map<string, number>();
  for (const t of turns) {
    duration.set(
      t.speakerId,
      (duration.get(t.speakerId) ?? 0) + (t.endS - t.startS),
    );
  }
  const kept = new Set(
    ids
      .sort((a, b) => (duration.get(b) ?? 0) - (duration.get(a) ?? 0))
      .slice(0, numSpeakers),
  );

  return turns.map((t) => {
    if (kept.has(t.speakerId)) {
      return t;
    }
    let best = '';
    let bestGap = Infinity;
    for (const n of turns) {
      if (!kept.has(n.speakerId)) {
        continue;
      }
      const gap = Math.max(0, t.startS - n.endS, n.startS - t.endS);
      if (gap < bestGap) {
        bestGap = gap;
        best = n.speakerId;
      }
    }
    return { ...t, speakerId: best };
  });
}

export function normalizePyannoteSpeakerTurns(
  segments: PyannoteSpeakerSegment[],
  options?: {
    mergeGapS?: number;
    minTurnS?: number;
    minConfidence?: number;
    numSpeakers?: number;
  },
): SpeakerTurn[] {
  const mergeGapS = options?.mergeGapS ?? DEFAULT_MERGE_GAP_S;
  const minTurnS = options?.minTurnS ?? DEFAULT_MIN_TURN_S;
  const minConfidence = options?.minConfidence;
  const numSpeakers = options?.numSpeakers;

  const filtered = [...segments]
    .filter((segment) => segment.end > segment.start)
    .filter(
      (segment) =>
        minConfidence == null || (segment.confidence ?? 1) >= minConfidence,
    )
    .sort((a, b) => a.start - b.start)
    .filter((segment) => segment.end - segment.start >= minTurnS);

  const merged: Array<{ startS: number; endS: number; speakerId: string }> = [];

  for (const segment of filtered) {
    const speakerId = String(segment.id);
    const previous = merged.at(-1);

    if (
      previous &&
      previous.speakerId === speakerId &&
      segment.start - previous.endS <= mergeGapS
    ) {
      previous.endS = segment.end;
      continue;
    }

    merged.push({
      startS: segment.start,
      endS: segment.end,
      speakerId,
    });
  }

  const capped = capSpeakerCount(merged, numSpeakers);

  const normalizedSpeakerIds = new Map<string, string>();
  let nextSpeakerNumber = 0;

  return capped.map((segment) => {
    if (!normalizedSpeakerIds.has(segment.speakerId)) {
      normalizedSpeakerIds.set(segment.speakerId, String(nextSpeakerNumber++));
    }

    return {
      ...segment,
      speakerId: normalizedSpeakerIds.get(segment.speakerId)!,
    };
  });
}

import { OLabel, TrattAnnotationSegment } from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';

/** One segment as the text editor sees it: where it ends and its text. */
export interface EditedSegment {
  time: SampleUnit;
  text: string;
}

const SPEAKER_LABEL = 'Speaker';

function textLabelName(
  segment: TrattAnnotationSegment,
  levelName: string,
): string {
  if (segment.getLabel(levelName)) {
    return levelName;
  }
  return segment.getFirstLabelWithoutName(SPEAKER_LABEL)?.name ?? levelName;
}

function textOf(segment: TrattAnnotationSegment, levelName: string): string {
  return segment.getLabel(textLabelName(segment, levelName))?.value ?? '';
}

/**
 * Turns what a free-text editor (Dictaphone) holds — segment texts split at
 * boundary markers — back into a level's items WITHOUT losing what that
 * editor cannot show: the other labels of each segment (the diarization
 * `Speaker` label) and segment ids.
 *
 * - A segment whose end matches an existing segment's end keeps that
 *   segment's id and every non-text label; only its text is replaced.
 * - A segment ending where no segment ended before (a boundary the user
 *   inserted) is new, but inherits the non-text labels of the segment it was
 *   split from (the first old segment ending at or after it).
 *
 * Returns `undefined` when nothing changed, so callers can skip the store
 * write entirely — flushing an untouched editor (switching files or
 * editors) must not rewrite the transcript.
 */
export function mergeEditedSegments(
  previous: readonly TrattAnnotationSegment[],
  edited: readonly EditedSegment[],
  levelName: string,
  createSegment: (time: SampleUnit, labels: OLabel[]) => TrattAnnotationSegment,
): TrattAnnotationSegment[] | undefined {
  const unchanged =
    previous.length === edited.length &&
    previous.every(
      (segment, i) =>
        segment.time.samples === edited[i].time.samples &&
        textOf(segment, levelName) === edited[i].text,
    );
  if (unchanged) {
    return undefined;
  }

  return edited.map(({ time, text }) => {
    const same = previous.find((s) => s.time.samples === time.samples);
    if (same) {
      const result = same.clone();
      const name = textLabelName(same, levelName);
      if (!result.changeLabel(name, text)) {
        result.labels = [new OLabel(name, text), ...result.labels];
      }
      return result;
    }
    const parent = previous.find((s) => s.time.samples >= time.samples);
    const inherited = parent
      ? parent.labels.filter(
          (label) => label.name !== textLabelName(parent, levelName),
        )
      : [];
    return createSegment(time, [new OLabel(levelName, text), ...inherited]);
  });
}

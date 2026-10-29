import {
  AnnotationLevelType,
  TrattAnnotation,
  TrattAnnotationSegment,
} from '@tratt/annotation';

/**
 * Categorical speaker colours from the Språkbanken palette. Red and yellow
 * are excluded – they carry UI meaning (errors, warnings). Brand colours
 * first, then their strong variants, neutrals and tints.
 */
export const SPEAKER_COLORS: readonly string[] = [
  '#1E989F', // blue          → black text 6.1:1
  '#5AA018', // green         → black text 6.5:1
  '#595959', // dark grey     → white text 7.0:1
  '#187A7F', // blue strong   → white text 5.1:1
  '#488013', // green strong  → white text 4.8:1
  '#D2EAEC', // blue tint     → black text
  '#DEECD1', // green tint    → black text
  '#FCDED1', // orange tint   → black text
  '#8C8C8C', // mid grey      → black text 6.2:1
  '#EBEBEB', // light grey    → black text
];

export const LIGHT_TEXT = '#FFFFFF';
export const BLACK_TEXT = '#000000';

const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function getSpeakerIds(
  annotation: TrattAnnotation<TrattAnnotationSegment>,
): string[] {
  const ids = new Set<string>();
  for (const level of annotation.levels) {
    if (level.type !== AnnotationLevelType.SEGMENT) continue;
    for (const item of level.items as TrattAnnotationSegment[]) {
      const spk = item.getLabel('Speaker')?.value;
      if (spk) ids.add(spk);
    }
  }
  return [...ids].sort(naturalCompare);
}

export function getSpeakerColor(speakerId: string, allIds: string[]): string {
  const sorted = [...allIds].sort(naturalCompare);
  const index = sorted.indexOf(speakerId);
  const safeIndex = index < 0 ? 0 : index;
  return SPEAKER_COLORS[safeIndex % SPEAKER_COLORS.length];
}

export function getSpeakerTextColor(bgHex: string): string {
  if (!bgHex || bgHex.length < 7) return LIGHT_TEXT;
  const r = parseInt(bgHex.slice(1, 3), 16) / 255;
  const g = parseInt(bgHex.slice(3, 5), 16) / 255;
  const b = parseInt(bgHex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L < 0.179 ? LIGHT_TEXT : BLACK_TEXT;
}

export function cycleNextSpeaker(currentId: string, allIds: string[]): string {
  const sorted = [...allIds].sort(naturalCompare);
  if (sorted.length === 0) return currentId;
  const index = sorted.indexOf(currentId);
  if (index < 0) return sorted[0];
  return sorted[(index + 1) % sorted.length];
}

export function renameSpeakerInAnnotation(
  oldId: string,
  newId: string,
  annotation: TrattAnnotation<TrattAnnotationSegment>,
): TrattAnnotation<TrattAnnotationSegment> {
  const cloned = annotation.clone() as TrattAnnotation<TrattAnnotationSegment>;
  for (const level of cloned.levels) {
    if (level.type !== AnnotationLevelType.SEGMENT) continue;
    for (const item of level.items as TrattAnnotationSegment[]) {
      if (item.getLabel('Speaker')?.value === oldId) {
        item.changeLabel('Speaker', newId);
      }
    }
  }
  return cloned;
}

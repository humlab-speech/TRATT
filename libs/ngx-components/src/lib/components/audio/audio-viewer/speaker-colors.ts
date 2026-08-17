import {
  AnnotationLevelType,
  OctraAnnotation,
  OctraAnnotationSegment,
} from '@octra/annotation';

/**
 * Categorical colours for speaker labels, from the Umeå University palette.
 *
 * Ordered so the earliest speakers are easy to tell apart, and so the two
 * colours that also carry UI meaning — chrome navy `#2A4765` and the
 * CTA-adjacent terracotta `#B87D5E` — sort last and rarely appear.
 */
export const SPEAKER_COLORS: readonly string[] = [
  '#3D6B5C',
  '#9C7A8C',
  '#D7B17C',
  '#5B8E8A',
  '#6B5B6E',
  '#C9918A',
  '#8B8FAE',
  '#73A790',
  '#C2A08A',
  '#A8C3D4',
  '#4A5E7A',
  '#EABAB9',
  '#C4D4C0',
  '#D4C7B5',
  '#000000',
  '#B87D5E',
  '#2A4765',
];

export const LIGHT_TEXT = '#FFFFFF';
export const BLACK_TEXT = '#000000';

const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function getSpeakerIds(
  annotation: OctraAnnotation<any, OctraAnnotationSegment>,
): string[] {
  const ids = new Set<string>();
  for (const level of annotation.levels) {
    if (level.type !== AnnotationLevelType.SEGMENT) continue;
    for (const item of level.items as OctraAnnotationSegment[]) {
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
  annotation: OctraAnnotation<any, OctraAnnotationSegment>,
): OctraAnnotation<any, OctraAnnotationSegment> {
  const cloned = annotation.clone() as OctraAnnotation<
    any,
    OctraAnnotationSegment
  >;
  for (const level of cloned.levels) {
    if (level.type !== AnnotationLevelType.SEGMENT) continue;
    for (const item of level.items as OctraAnnotationSegment[]) {
      if (item.getLabel('Speaker')?.value === oldId) {
        item.changeLabel('Speaker', newId);
      }
    }
  }
  return cloned;
}

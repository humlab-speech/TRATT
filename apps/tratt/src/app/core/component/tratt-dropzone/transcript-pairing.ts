import {
  AnnotationLevelType,
  Converter,
  OAnnotJSON,
  OLabel,
  OSegment,
  OSegmentLevel,
} from '@tratt/annotation';

/**
 * Name of the recording a transcript file belongs to: its file name minus
 * the longest known transcript extension (`example_annot.json`,
 * `example.TextGrid` → `example`), else minus its last extension.
 */
export function transcriptBasename(
  fullname: string,
  converters: readonly Converter[],
): string {
  const lower = fullname.toLowerCase();
  const extension = converters
    .flatMap((converter) => converter.extensions)
    .map((ext) => ext.toLowerCase())
    .sort((a, b) => b.length - a.length)
    .find((ext) => lower.endsWith(ext) && lower.length > ext.length);
  return extension
    ? fullname.slice(0, fullname.length - extension.length)
    : fullname.replace(/\.[^.]+$/, '');
}

/** A recording's name without its extension. */
export function audioBasename(fullname: string): string {
  return fullname.replace(/\.[^.]+$/, '');
}

/** Basenames compare case-insensitively (`Interview.wav` ↔ `interview.srt`). */
export function sameBasename(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Makes every segment level of an imported transcript span the whole
 * recording: an empty segment before a first segment that doesn't start at
 * 0, and one after a last segment that ends before the audio does.
 * Mutates `annotjson`.
 */
export function padSegmentLevels(
  annotjson: OAnnotJSON,
  durationSamples: number,
): void {
  for (const lvl of annotjson.levels) {
    if (lvl.type !== AnnotationLevelType.SEGMENT) {
      continue;
    }
    const level = lvl as OSegmentLevel<OSegment>;
    if (level.items.length === 0) {
      continue;
    }
    if (level.items[0].sampleStart !== 0) {
      level.items = [
        new OSegment(0, 0, level.items[0].sampleStart!, [
          new OLabel(level.name, ''),
        ]),
        ...level.items.map(
          (a) => new OSegment(a.id, a.sampleStart!, a.sampleDur!, a.labels),
        ),
      ];
      level.items.forEach((item, i) => (item.id = i + 1));
    }

    const last = level.items[level.items.length - 1];
    const end = last.sampleStart! + last.sampleDur!;
    if (end !== durationSamples) {
      level.items.push(
        new OSegment(last.id + 1, end, durationSamples - end, [
          new OLabel(level.name, ''),
        ]),
      );
    }
  }
}

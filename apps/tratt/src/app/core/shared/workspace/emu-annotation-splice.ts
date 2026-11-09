import { IAnnotJSON, ISegment, ISegmentLevel } from '@tratt/annotation';

/**
 * Pass-through editing of an EMU `_annot.json`: TRATT owns exactly one SEGMENT
 * level. Everything else is kept as the server sent it.
 *
 * Boundary convention: EMU segments are inclusive (`[start, start+dur]`, the
 * next segment starts at `start+dur+1`); TRATT's end is exclusive
 * (`start+dur`). The conversion happens here and nowhere else: TRATT-side
 * `sampleDur` = EMU `sampleDur` + 1.
 */

type EmuItem = Record<string, any> & { id: number };
type EmuLevel = Record<string, any> & {
  name: string;
  type: string;
  items: EmuItem[];
};
type EmuAnnotation = Record<string, any> & { levels: EmuLevel[] };

export interface EmuDbConfig {
  levelDefinitions?: {
    name: string;
    type: string;
    attributeDefinitions?: { name: string }[];
  }[];
  linkDefinitions?: { superlevelName: string; sublevelName: string }[];
}

/**
 * The label names EMU accepts on `levelName`: its declared attributes (the
 * first is the level's own name by EMU convention). Without a declaration only
 * the level's own name is allowed.
 */
export function allowedLabelNames(
  dbConfig: EmuDbConfig | undefined,
  levelName: string,
): string[] {
  const def = dbConfig?.levelDefinitions?.find((l) => l.name === levelName);
  const names = def?.attributeDefinitions?.map((a) => a.name) ?? [];
  return names.length > 0 ? names : [levelName];
}

/**
 * An edited owned level (TRATT convention) as plain EMU-shaped data:
 * - only `id`, `sampleStart`, `sampleDur` and `labels` per item (TRATT's
 *   serializer adds `type` and `verified`);
 * - TRATT's break marker on its own means "empty segment" (TRATT normalises
 *   empty segments to it when guidelines load), so it is written as '';
 * - only labels EMU declares for the level are kept. The level's own text
 *   label is always present, named after the level.
 */
export function toPlainOwnedLevel(
  level: ISegmentLevel,
  options: { allowedLabels?: string[]; breakMarker?: string } = {},
): ISegmentLevel {
  const allowed = new Set(options.allowedLabels ?? [level.name]);
  const marker = options.breakMarker;
  return {
    name: level.name,
    type: level.type,
    items: level.items.map((item) => {
      const labels = (item.labels ?? []).map((l) => ({
        name: l.name,
        value:
          marker !== undefined && (l.value ?? '').trim() === marker
            ? ''
            : (l.value ?? ''),
      }));
      // The text label: the one named after the level, else the first one
      // that is not a speaker label (e.g. a placeholder name).
      const text =
        labels.find((l) => l.name === level.name) ??
        labels.find((l) => l.name !== 'Speaker');
      const kept = labels.filter(
        (l) => l !== text && l.name !== level.name && allowed.has(l.name),
      );
      return {
        id: item.id,
        sampleStart: item.sampleStart,
        sampleDur: item.sampleDur,
        labels: [{ name: level.name, value: text?.value ?? '' }, ...kept],
      };
    }),
  };
}

/** Whether a level holds anything a person or ASR produced. */
export function hasContent(level: ISegmentLevel | undefined): boolean {
  if (!level) return false;
  if (level.items.length > 1) return true;
  return level.items.some((i) =>
    (i.labels ?? []).some((l) => (l.value ?? '').trim() !== ''),
  );
}

/**
 * What "unsaved changes" compares: ids, boundaries and label values of a
 * plain level. Any level without content is the same as an empty one, so a
 * new bundle's single empty segment is not a change.
 */
export function ownedLevelKey(level: ISegmentLevel | undefined): string {
  if (!hasContent(level)) return 'EMPTY';
  return JSON.stringify(
    level!.items.map((i) => [
      i.id,
      i.sampleStart,
      i.sampleDur,
      (i.labels ?? []).map((l) => [l.name, l.value ?? '']),
    ]),
  );
}

export type Editability =
  | { editable: true }
  | { editable: false; reason: 'no-transcription-level' | 'level-linked' };

/** Whether the workspace may edit `levelName` given the project's DBconfig. */
export function checkEditable(
  dbConfig: EmuDbConfig,
  levelName: string,
): Editability {
  const def = dbConfig.levelDefinitions?.find((l) => l.name === levelName);
  if (!def || def.type !== 'SEGMENT') {
    return { editable: false, reason: 'no-transcription-level' };
  }
  const linked = (dbConfig.linkDefinitions ?? []).some(
    (l) => l.superlevelName === levelName || l.sublevelName === levelName,
  );
  return linked
    ? { editable: false, reason: 'level-linked' }
    : { editable: true };
}

function maxItemId(annotation: EmuAnnotation): number {
  let max = 0;
  for (const level of annotation.levels) {
    for (const item of level.items ?? []) {
      max = Math.max(max, item.id);
    }
  }
  return max;
}

/**
 * The owned level in TRATT's convention. If the bundle has no items in it,
 * one empty segment covering the recording (`totalSamples`) is offered; it is
 * written on first save.
 */
export function extractOwnedLevel(
  annotation: IAnnotJSON,
  levelName: string,
  totalSamples: number,
): ISegmentLevel {
  const emu = annotation as unknown as EmuAnnotation;
  const level = emu.levels.find((l) => l.name === levelName);
  const items: ISegment[] = level?.items?.length
    ? level.items.map((i) => ({
        id: i.id,
        sampleStart: i.sampleStart,
        sampleDur: i.sampleDur + 1,
        labels: (i.labels ?? []).map((l: any) => ({
          name: l.name,
          value: l.value,
        })),
      }))
    : [
        {
          id: maxItemId(emu) + 1,
          sampleStart: 0,
          sampleDur: totalSamples,
          labels: [{ name: levelName, value: '' }],
        },
      ];
  return {
    name: levelName,
    type: 'SEGMENT' as ISegmentLevel['type'],
    items,
  };
}

const normalize = (i: EmuItem) =>
  JSON.stringify({
    id: i.id,
    sampleStart: i.sampleStart,
    sampleDur: i.sampleDur,
    labels: (i.labels ?? []).map((l: any) => [l.name, l.value]),
  });

/**
 * Splices `edited` (TRATT convention) back into `original`. Returns a new
 * object; `original` is not modified. Unchanged items are emitted exactly as
 * stored, so an edit-free round trip is byte-identical.
 */
export function spliceOwnedLevel(
  original: IAnnotJSON,
  edited: ISegmentLevel,
): IAnnotJSON {
  const emu = JSON.parse(JSON.stringify(original)) as EmuAnnotation;
  const level = emu.levels.find((l) => l.name === edited.name);
  const originalItems = new Map<number, EmuItem>(
    (level?.items ?? []).map((i) => [i.id, i]),
  );
  let nextId = maxItemId(emu);
  const usedNewIds = new Set<number>();

  const items: EmuItem[] = edited.items.map((item) => {
    const converted: EmuItem = {
      id: item.id,
      sampleStart: item.sampleStart,
      sampleDur: item.sampleDur - 1,
      labels: item.labels.map((l) => ({ name: l.name, value: l.value })),
    };
    const before = originalItems.get(item.id);
    if (before) {
      if (normalize(before) === normalize(converted)) {
        return before;
      }
      // keep any extra fields of the stored item
      return { ...before, ...converted };
    }
    // New segment: ids must be unique across the whole bundle.
    do {
      nextId++;
    } while (usedNewIds.has(nextId));
    usedNewIds.add(nextId);
    return { ...converted, id: nextId };
  });

  if (level) {
    level.items = items;
  } else {
    emu.levels.push({ name: edited.name, type: 'SEGMENT', items });
  }
  return emu as unknown as IAnnotJSON;
}

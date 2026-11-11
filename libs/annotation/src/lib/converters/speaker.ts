import { OSegment } from '../annotjson';

/** Label that carries a segment's speaker. */
export const SPEAKER_LABEL = 'Speaker';

/**
 * Default speaker prefix pattern used by every time-aligned text format on
 * import: a WebVTT voice tag `<v Name>` (what `speakerPrefix` writes) or the
 * legacy `[Name]`, optionally followed by a colon, at the start of a unit.
 */
export const DEFAULT_SPEAKER_PATTERN = '(?:<v +|\\[)([^>\\]]+)[>\\]] *:? *';

/** `<v Name> ` when `enabled` and the segment has a speaker, else ''. */
export function speakerPrefix(item: OSegment, enabled: boolean): string {
  const speaker = item.labels?.find((l) => l.name === SPEAKER_LABEL)?.value;
  return enabled && speaker ? `<v ${speaker}> ` : '';
}

/**
 * Splits a leading speaker prefix (first capture group of `pattern`) off a
 * unit's text read from a file.
 */
export function splitSpeaker(
  text: string,
  pattern?: string,
): { speaker?: string; text: string } {
  if (!pattern) return { text };
  const m = new RegExp(`^(?:${pattern})`).exec(text);
  if (!m?.[1]) return { text };
  return { speaker: m[1].trim(), text: text.slice(m[0].length) };
}

/** Import options shared by formats that read the `[Name] ` speaker prefix. */
export class SpeakerImportOptions {
  speakerIdentifierPattern?: string = DEFAULT_SPEAKER_PATTERN;

  constructor(partial?: Partial<SpeakerImportOptions>) {
    if (partial) Object.assign(this, partial);
  }
}

/** JSON schema for `SpeakerImportOptions`, shown in the import options modal. */
export const speakerImportSchema = () => ({
  $gui_support: true,
  type: 'object',
  properties: {
    speakerIdentifierPattern: {
      title: 'speakerIdentifierPattern',
      toggleable: true,
      type: 'string',
      default: DEFAULT_SPEAKER_PATTERN,
      description:
        'Regular expression (with one capture group) matching the speaker prefix at the start of a unit. The first capture group becomes the speaker name.',
    },
  },
});
